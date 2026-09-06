import { Router, type Request, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import multer from "multer";
import pdfParse from "pdf-parse";
import { requireIrocAuth } from "./iroc.js";
import { pool } from "@workspace/db";
import { recipientLanguageForCountry, supplierReorderLanguageContext } from "../lib/recipient-language.js";
import {
  enforceSupplierReorderDraftLanguage,
  type SupplierReorderDraft,
} from "../lib/tori-reorder-language.js";
import { applyEmailSignature } from "../lib/email-signatures.js";
import { getEmailDeliveryProvider, isSmtpConfigured, sendEmail } from "../lib/email.js";
import { ObjectStorageService } from "../lib/objectStorage.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const router = Router();
const MINIMUM_EXTRACTED_PDF_TEXT_LENGTH = 50;
const SUPPLIER_REORDER_EMAIL_SEND_ERROR =
  "Supplier email could not be sent. The Tori mailbox role 'tori_ai' may be unavailable; the reorder remains pending and can be retried.";
const SUPPLIER_REORDER_DELIVERY_UNCONFIRMED =
  "The transport outcome is unconfirmed. Do not retry until delivery has been reconciled with the supplier or mailbox.";

function isPdfUpload(file: Express.Multer.File): boolean {
  const hasPdfMetadata =
    file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");
  const hasPdfSignature = file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"));
  return hasPdfMetadata && hasPdfSignature;
}

function sendPdfTextWarning(res: Response, extractedCharacterCount: number): void {
  res.status(422).json({
    error: "Tori could not read enough selectable text from this PDF.",
    warning: {
      code: "PDF_TEXT_NOT_EXTRACTABLE",
      reason: "image_only_or_scanned_pdf",
      extracted_character_count: extractedCharacterCount,
      guidance: "Upload a searchable text PDF or paste the document text manually.",
    },
  });
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const TORI_SYSTEM_PROMPT = `You are Tori, the dedicated AI operations and inventory agent for iROC GmbH, a medical device distribution company. You help the admin team analyze supplier invoices, classify transactions, and prepare structured data for the inventory and expense management system.

CRITICAL BUSINESS RULES FOR iROC GmbH:
1. "service": Intangible expenses (e.g. shipping/freight, consulting, repairs, utilities, software subscriptions).
2. "company_usage": Tangible items bought for our own office or warehouse operations (e.g. packaging tape, printers, warehouse tools, office furniture). These are expenses, not resale inventory.
3. "resale": Tangible items that match our core distribution inventory (medical devices, instruments, accessories). These must be added to the inventory system to be resold to customers.

OPERATIONAL DECISION TREE:
- STEP 1: Determine if the invoice is for a "product" or a "service".
- STEP 2: If it is a product, classify usage strictly as "resale" or "company_usage" using the Distribution Contract rules and Admin Learning Logs if provided. If no context is given, use your best judgment and explain in tori_notes.
- STEP 3: If usage is "resale", extract all line items — Item Name, SKU (if present), Quantity, Unit Price, Currency. Note anything missing or unreadable.
- STEP 4: Identify the manufacturer/seller name and contact email from the invoice layout.

RESPONSE FORMAT — INVOICE ANALYSIS:
When analyzing a new invoice, respond with ONLY a valid JSON object inside a \`\`\`json code block. No prose outside the block.

Required shape:
\`\`\`json
{
  "classification": {
    "type": "product" | "service",
    "usage": "resale" | "company_usage" | "none"
  },
  "vendor": {
    "name": string | null,
     "email": string | null,
     "country": string | null
  },
  "line_items": [
    {
      "name": string,
      "sku": string | null,
      "quantity": number | null,
      "unit_price": number | null,
      "currency": string | null
    }
  ],
  "missing_info": [string],
  "tori_notes": string
}
\`\`\`

RESPONSE FORMAT — FOLLOW-UP QUESTIONS:
When the admin asks a follow-up question about the analysis (re-classification, vendor trust, inventory decisions, etc.), respond in clear natural language. Only return JSON again if explicitly asked to re-analyze.`;

const LEARNING_SYSTEM_PROMPT = `You are Tori, the AI operations agent for iROC GmbH. An administrator has corrected one of your previous invoice analyses. Your job is to reason about why your original output was wrong and produce a concise, actionable "Internal Knowledge Base Context" entry.

LEARNING RULES:
1. Evaluate the admin correction against the original Tori output.
2. Identify precisely why the original classification failed (wrong product type, wrong vendor category, missed SKU, incorrect price reading, etc.).
3. State a clear rule adjustment for future analyses involving that specific manufacturer, item category, or pattern.
4. If the correction is marked as a universal rule, explicitly state it applies to all future invoices regardless of vendor.

OUTPUT: Respond with ONLY a JSON object inside a \`\`\`json code block:
\`\`\`json
{
  "learned_context": string,
  "is_universal_rule": boolean,
  "vendor_hint": string | null,
  "category_hint": string | null,
  "tori_reflection": string
}
\`\`\`
Where:
- "learned_context": 2–5 sentences starting with "LEARNED RULE:" that will be injected into future analyses.
- "is_universal_rule": true if the admin marked this as applying to all vendors.
- "vendor_hint": the vendor/manufacturer name this applies to, or null if universal.
- "category_hint": the product category this applies to, or null if not category-specific.
- "tori_reflection": a brief honest self-critique explaining what Tori missed.`;

const REORDER_SYSTEM_PROMPT = `You are Tori, the AI operations assistant for iROC GmbH, a medical device distribution company. Your task is to draft a professional reorder request email to a supplier.

REORDER EMAIL RULES:
1. Tone must be formal, professional, and collaborative — representing iROC GmbH.
2. Request the exact quantity specified (the last ordered quantity).
3. Reference the agreed contract price explicitly in the email.
4. CRITICAL DISCOUNT RULE: If the sales milestone is marked as achieved, politely remind the manufacturer of this milestone in the email body and explicitly note that iROC GmbH expects the lower, volume-discounted milestone pricing on this and all future invoices.
5. Sign off as: "Tori – AI Operations Assistant, on behalf of iROC GmbH".
6. Write the entire subject and email body in the language specified in the request context.
7. Do not add an iROC company address, telephone number, email address, website,
   or legal/company-contact footer. The application adds the current legal
   signature separately.

OUTPUT: Respond with ONLY a JSON object inside a \`\`\`json code block:
\`\`\`json
{
  "to": string,
  "subject": string,
  "email_body_markdown": string
}
\`\`\``;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getRecentLearnedContext(): Promise<string> {
  try {
    const { rows } = await pool.query(
      `SELECT learned_context, is_universal_rule, vendor_hint, category_hint
       FROM tori_learning_logs
       ORDER BY created_at DESC
       LIMIT 20`,
    );
    if (rows.length === 0) return "";
    const lines = rows.map((r: {
      learned_context: string;
      is_universal_rule: boolean;
      vendor_hint: string | null;
      category_hint: string | null;
    }) => {
      const scope = r.is_universal_rule
        ? "[UNIVERSAL RULE]"
        : [r.vendor_hint, r.category_hint].filter(Boolean).join(", ") || "[GENERAL]";
      return `${scope}: ${r.learned_context}`;
    });
    return `\n\n--- ADMIN LEARNING LOGS (apply these rules) ---\n${lines.join("\n")}\n--- END LEARNING LOGS ---`;
  } catch {
    return "";
  }
}

async function callOpenAI(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  maxTokens = 8_000,
): Promise<string> {
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("AI integration not configured");

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: "gpt-5", max_completion_tokens: maxTokens, messages }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI call failed ${res.status}: ${errText}`);
  }
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

function parseJsonBlock(text: string): unknown {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  const candidate = match?.[1] ?? text.trim();
  return JSON.parse(candidate);
}

interface SupplierReorderFallbackDetails {
  vendorEmail: string;
  productName: string;
  productSku: string | null;
  quantity: number;
  contractPrice: number | null;
  salesMilestoneAchieved: boolean;
}

function safeSupplierReorderFallback(
  details: SupplierReorderFallbackDetails,
  country: string | null | undefined,
): SupplierReorderDraft {
  const isGerman = supplierReorderLanguageContext(country).includes("German");
  const sku = details.productSku ? ` (SKU: ${details.productSku})` : "";
  const price = details.contractPrice != null ? `EUR ${details.contractPrice}` : isGerman ? "gemäß Vertrag" : "as agreed in the contract";
  const milestone = details.salesMilestoneAchieved
    ? (isGerman
      ? "\n\nDa der Verkaufsmeilenstein erreicht wurde, erwarten wir die vergünstigte Meilensteinpreisgestaltung für diese und alle zukünftigen Rechnungen."
      : "\n\nAs the sales milestone has been achieved, we expect the lower volume-discounted milestone pricing on this and all future invoices.")
    : "";
  return isGerman
    ? {
        to: details.vendorEmail,
        subject: `Nachbestellung: ${details.productName}`,
        email_body_markdown: `Sehr geehrte Damen und Herren,\n\nbitte liefern Sie uns ${details.quantity} Stück ${details.productName}${sku}. Der vereinbarte Vertragspreis beträgt ${price}.${milestone}\n\nMit freundlichen Grüßen,\n\nTori – AI Operations Assistant, im Auftrag der iROC GmbH`,
      }
    : {
        to: details.vendorEmail,
        subject: `Reorder request: ${details.productName}`,
        email_body_markdown: `Dear Sir or Madam,\n\nPlease supply ${details.quantity} units of ${details.productName}${sku}. The agreed contract price is ${price}.${milestone}\n\nKind regards,\n\nTori – AI Operations Assistant, on behalf of iROC GmbH`,
      };
}

const COMPANY_CONTACT_MARKER = /\b(?:phone|telephone|tel\.?|fax|e-?mail|web(?:site)?|telefon)\b|https?:\/\/|\S+@\S+|\+?\d[\d\s()./-]{6,}/i;
const COMPANY_FOOTER_MARKER = /\b(?:iROC\s+GmbH|GmbH|AG|Ltd\.?|Inc\.?|LLC|S\.?A\.?|S\.?r\.?l\.?)\b/i;
const ADDRESS_MARKER = /\b(?:str(?:aße|asse)?|street|road|avenue|platz|weg|lane|drive|boulevard)\b|\b\d{5}\s+\p{L}/iu;

/**
 * A model must not control iROC's legal contact details. Remove a trailing
 * company/contact footer while leaving Tori's preceding personal sign-off
 * intact; the canonical, CMS-backed footer is appended below.
 */
export function removeSupplierCompanyContactFooter(body: string): string {
  const paragraphs = body
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  let firstFooterParagraph = -1;
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const paragraph = paragraphs[index];
    const isToriSignoff = /\bTori\b/i.test(paragraph);
    const isCompanyFooterContent = COMPANY_CONTACT_MARKER.test(paragraph)
      || COMPANY_FOOTER_MARKER.test(paragraph)
      || ADDRESS_MARKER.test(paragraph);
    if (firstFooterParagraph === -1) {
      if (!isToriSignoff && isCompanyFooterContent) {
        firstFooterParagraph = index;
        continue;
      }
      break;
    }
    if (COMPANY_CONTACT_MARKER.test(paragraph)) {
      firstFooterParagraph = index;
      continue;
    }
    // "on behalf of iROC GmbH" is Tori's required personal sign-off, not a
    // company contact block. Keep it when it directly precedes a bad footer.
    if (isToriSignoff) {
      break;
    }
    if (COMPANY_FOOTER_MARKER.test(paragraph) || ADDRESS_MARKER.test(paragraph)) {
      firstFooterParagraph = index;
      continue;
    }
    break;
  }

  return firstFooterParagraph === -1
    ? paragraphs.join("\n\n")
    : paragraphs.slice(0, firstFooterParagraph).join("\n\n");
}

export async function finalizeSupplierReorderDraft(
  draft: SupplierReorderDraft,
  language: "de" | "en",
): Promise<SupplierReorderDraft> {
  const base = removeSupplierCompanyContactFooter(draft.email_body_markdown);
  const rendered = await applyEmailSignature(base, "tori", language);
  return {
    ...draft,
    email_body_markdown: rendered.text,
  };
}

async function generateSupplierReorderDraft(
  userPrompt: string,
  country: string | null | undefined,
  fallbackDetails: SupplierReorderFallbackDetails,
): Promise<SupplierReorderDraft> {
  const language = supplierReorderLanguageContext(country).includes("German") ? "de" : "en";
  const initialDraft = parseJsonBlock(await callOpenAI([
    { role: "system", content: REORDER_SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ], 2_000)) as SupplierReorderDraft;

  const result = await enforceSupplierReorderDraftLanguage(
    initialDraft,
    language,
    async () => parseJsonBlock(await callOpenAI([
      {
        role: "system",
        content: `${REORDER_SYSTEM_PROMPT}\n\nNON-NEGOTIABLE: Rewrite the supplied draft entirely in ${language === "de" ? "German" : "English"}. Do not include any text in another language.`,
      },
      { role: "user", content: `${userPrompt}\n\n--- DRAFT TO REWRITE ---\n${JSON.stringify(initialDraft)}\n--- END DRAFT ---\nRewrite the draft now.` },
    ], 2_000)) as SupplierReorderDraft,
    () => safeSupplierReorderFallback(fallbackDetails, country),
  );
  // Language validation must happen before adding the legal signature: its
  // current CMS wording is authoritative and can otherwise affect detection.
  return finalizeSupplierReorderDraft(result.draft, language);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage { role: "user" | "assistant"; content: string; }

// ── POST /api/iroc/tori/extract-pdf ──────────────────────────────────────────
// Accepts a PDF file (multipart/form-data, field name "file"), extracts the
// raw text using pdf-parse, and returns { text: string }.  The file is never
// persisted — parsing happens entirely in memory.

router.post(
  "/iroc/tori/extract-pdf",
  requireIrocAuth,
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) { res.status(400).json({ error: "No file uploaded" }); return; }
    if (!isPdfUpload(file)) {
      res.status(422).json({ error: "Only PDF files are supported" }); return;
    }
    try {
      const result = await pdfParse(file.buffer);
      if (result.text.trim().length < 50) {
        res.status(422).json({ error: "This PDF appears to be image-only — no text could be extracted. Please copy-paste the text manually." });
        return;
      }
      res.json({ text: result.text, pages: result.numpages });
    } catch (err) {
      res.status(422).json({ error: "Could not parse PDF — the file may be encrypted or image-only." });
    }
  },
);

// ── POST /api/iroc/tori/chat ──────────────────────────────────────────────────

router.post(
  "/iroc/tori/chat",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const {
      message, history = [], invoiceText, contractContext, learningLogs,
    } = req.body as {
      message: string;
      history?: ChatMessage[];
      invoiceText?: string;
      contractContext?: string;
      learningLogs?: string;
    };

    if (!message?.trim()) { res.status(400).json({ error: "message is required" }); return; }

    try {
      // Auto-inject learned context from DB unless caller already provided logs
      const autoLogs = learningLogs?.trim() ? "" : await getRecentLearnedContext();
      const systemPrompt = TORI_SYSTEM_PROMPT + autoLogs;

      const contextParts: string[] = [];
      if (invoiceText?.trim())    contextParts.push(`--- RAW INVOICE TEXT ---\n${invoiceText.trim()}\n--- END INVOICE TEXT ---`);
      if (contractContext?.trim()) contextParts.push(`--- DISTRIBUTION CONTRACT RULES ---\n${contractContext.trim()}\n--- END CONTRACT RULES ---`);
      if (learningLogs?.trim())   contextParts.push(`--- ADMIN LEARNING LOGS ---\n${learningLogs.trim()}\n--- END LEARNING LOGS ---`);

      const userContent = contextParts.length > 0
        ? `${contextParts.join("\n\n")}\n\n${message}`
        : message;

      const reply = await callOpenAI([
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userContent },
      ]);
      res.json({ reply });
    } catch (err) {
      req.log?.error({ err }, "Tori chat error");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── POST /api/iroc/tori/learn ─────────────────────────────────────────────────

router.post(
  "/iroc/tori/learn",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { originalOutput, adminCorrection, adminNotes } = req.body as {
      originalOutput?: unknown;
      adminCorrection?: string;
      adminNotes?: string;
    };

    if (!adminCorrection?.trim()) {
      res.status(400).json({ error: "adminCorrection is required" }); return;
    }

    try {
      const userContent = [
        originalOutput ? `ORIGINAL TORI OUTPUT:\n${typeof originalOutput === "string" ? originalOutput : JSON.stringify(originalOutput, null, 2)}` : null,
        `ADMIN CORRECTION:\n${adminCorrection.trim()}`,
        adminNotes?.trim() ? `ADMIN NOTES:\n${adminNotes.trim()}` : null,
      ].filter(Boolean).join("\n\n");

      const reply = await callOpenAI([
        { role: "system", content: LEARNING_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ], 2_000);

      const parsed = parseJsonBlock(reply) as {
        learned_context: string;
        is_universal_rule: boolean;
        vendor_hint: string | null;
        category_hint: string | null;
        tori_reflection: string;
      };

      const { rows } = await pool.query(
        `INSERT INTO tori_learning_logs
           (original_output, admin_correction, admin_notes, learned_context,
            is_universal_rule, vendor_hint, category_hint, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         RETURNING *`,
        [
          originalOutput ? JSON.stringify(originalOutput) : null,
          adminCorrection.trim(),
          adminNotes?.trim() ?? null,
          parsed.learned_context,
          parsed.is_universal_rule ?? false,
          parsed.vendor_hint ?? null,
          parsed.category_hint ?? null,
        ],
      );

      res.status(201).json({ log: rows[0], tori_reflection: parsed.tori_reflection });
    } catch (err) {
      req.log?.error({ err }, "Tori learn error");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── GET /api/iroc/tori/learning-logs ─────────────────────────────────────────

router.get(
  "/iroc/tori/learning-logs",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM tori_learning_logs ORDER BY created_at DESC LIMIT 50`,
      );
      res.json(rows);
    } catch (err) {
      req.log?.error({ err }, "Tori learning-logs fetch error");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── GET /api/iroc/tori/finance-history ───────────────────────────────────────
// Returns committed expenses and invoices in one searchable, date-filterable
// view. Pending Tori analyses intentionally stay in Approvals until approved.

type FinanceHistoryPeriod = "all" | "month" | "quarter" | "year";
type FinanceHistoryRecordType = "all" | "expense" | "invoice";

function financeHistoryDateRange(
  period: FinanceHistoryPeriod,
  value: string | undefined,
): [string, string] | null | "invalid" {
  if (period === "all") return null;

  if (period === "month") {
    const match = value?.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (!match) return "invalid";
    const year = Number(match[1]);
    const month = Number(match[2]);
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    return [`${year}-${match[2]}-01`, `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`];
  }

  if (period === "quarter") {
    const match = value?.match(/^(\d{4})-Q([1-4])$/);
    if (!match) return "invalid";
    const year = Number(match[1]);
    const quarter = Number(match[2]);
    const startMonth = (quarter - 1) * 3 + 1;
    const endYear = quarter === 4 ? year + 1 : year;
    const endMonth = quarter === 4 ? 1 : startMonth + 3;
    return [
      `${year}-${String(startMonth).padStart(2, "0")}-01`,
      `${endYear}-${String(endMonth).padStart(2, "0")}-01`,
    ];
  }

  if (period === "year" && /^\d{4}$/.test(value ?? "")) {
    const year = Number(value);
    return [`${year}-01-01`, `${year + 1}-01-01`];
  }

  return "invalid";
}

router.get(
  "/iroc/tori/finance-history",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const rawPeriod = typeof req.query.period === "string" ? req.query.period : "all";
    const period = rawPeriod as FinanceHistoryPeriod;
    const rawRecordType = typeof req.query.type === "string" ? req.query.type : "all";
    const recordType = rawRecordType as FinanceHistoryRecordType;
    const rawValue = typeof req.query.value === "string" ? req.query.value : undefined;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const rawPage = typeof req.query.page === "string" ? req.query.page : "1";
    const rawPageSize = typeof req.query.page_size === "string" ? req.query.page_size : "50";
    const page = Number(rawPage);
    const pageSize = Number(rawPageSize);

    if (!["all", "month", "quarter", "year"].includes(period)) {
      res.status(400).json({ error: "Invalid history period." });
      return;
    }
    if (!["all", "expense", "invoice"].includes(recordType)) {
      res.status(400).json({ error: "Invalid history record type." });
      return;
    }
    if (search.length > 200) {
      res.status(400).json({ error: "Search text is too long." });
      return;
    }
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      res.status(400).json({ error: "Invalid history pagination." });
      return;
    }

    const dateRange = financeHistoryDateRange(period, rawValue);
    if (dateRange === "invalid") {
      res.status(400).json({ error: "Invalid history period value." });
      return;
    }

    const conditions: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    if (dateRange) {
      conditions.push(`record_date >= $${index++}::date AND record_date < $${index++}::date`);
      values.push(dateRange[0], dateRange[1]);
    }
    if (recordType !== "all") {
      conditions.push(`record_type = $${index++}`);
      values.push(recordType);
    }
    if (search) {
      conditions.push(`(
        LOWER(COALESCE(party_name, '')) = LOWER($${index})
        OR LOWER(COALESCE(document_number, '')) = LOWER($${index})
        OR LOWER(COALESCE(order_number, '')) = LOWER($${index})
        OR LOWER(COALESCE(category, '')) = LOWER($${index})
        OR LOWER(COALESCE(source, '')) = LOWER($${index})
      )`);
      values.push(search);
      index += 1;
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitIndex = index++;
    const offsetIndex = index++;
    values.push(pageSize, (page - 1) * pageSize);

    try {
      const { rows } = await pool.query(
        `WITH finance_history AS (
           SELECT
             e.id AS record_id,
             'expense'::text AS record_type,
             e.vendor_name AS party_name,
             e.invoice_number AS document_number,
             NULL::text AS order_number,
              COALESCE(NULLIF(TRIM(e.invoice_date::text), '')::date, e.created_at::date) AS record_date,
             e.category,
             e.source,
             e.currency,
             e.net_amount,
             e.tax_amount,
             e.gross_amount AS total_amount,
             e.file_object_path,
             e.notes,
             NULL::text AS status,
             e.created_at
           FROM iroc_expenses e

           UNION ALL

           SELECT
             i.id AS record_id,
             'invoice'::text AS record_type,
             COALESCE(
               NULLIF(TRIM(CONCAT_WS(' ', wc.first_name, wc.last_name)), ''),
               NULLIF(wc.institution_name, ''),
               wc.email,
               lc.name,
               lc.company
             ) AS party_name,
             i.invoice_number AS document_number,
             i.order_number,
              COALESCE(NULLIF(TRIM(i.issue_date::text), '')::date, i.created_at::date) AS record_date,
             i.invoice_type AS category,
             'iroc'::text AS source,
             'EUR'::text AS currency,
             i.subtotal AS net_amount,
             i.vat_amount AS tax_amount,
             i.total AS total_amount,
             NULL::text AS file_object_path,
             i.notes,
             i.status,
             i.created_at
           FROM iroc_invoices i
           LEFT JOIN website_customers wc ON wc.id = i.website_customer_id
           LEFT JOIN iroc_customers lc ON lc.id = i.customer_id
         )
         SELECT record_id, record_type, party_name, document_number, order_number,
                record_date AS document_date, category, source, currency,
                net_amount, tax_amount, total_amount, file_object_path, notes,
                 status, created_at, COUNT(*) OVER()::integer AS total_count
         FROM finance_history
         ${where}
         ORDER BY record_date DESC NULLS LAST, created_at DESC, record_id DESC
         LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
        values,
      );
       const total = Number(rows[0]?.total_count ?? 0);
       const items = rows.map(({ total_count: _totalCount, ...row }) => row);
       res.json({ items, count: total, page, page_size: pageSize, total });
    } catch (err) {
      req.log?.error({ err }, "Tori finance-history fetch error");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── POST /api/iroc/tori/reorder ───────────────────────────────────────────────

router.post(
  "/iroc/tori/reorder",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const {
      productId, vendorEmail, vendorCountry, contractPrice, salesMilestoneAchieved,
    } = req.body as {
      productId?: number;
      vendorEmail: string;
      vendorCountry?: string | null;
      contractPrice?: number;
      salesMilestoneAchieved?: boolean;
    };

    if (!vendorEmail?.trim()) {
      res.status(400).json({ error: "vendorEmail is required" }); return;
    }

    try {
      // Look up product details
      let productName = "Unknown Product";
      let productSku: string | null = null;
      let lastOrderedQty = 1;
      let resolvedPrice = contractPrice ?? null;
      let resolvedVendorCountry = vendorCountry?.trim() || null;

      if (productId) {
        const { rows: prodRows } = await pool.query(
          `SELECT name_de, name_en, sku, purchase_price FROM iroc_products WHERE id=$1 LIMIT 1`,
          [productId],
        );
        if (prodRows.length > 0) {
          const p = prodRows[0] as { name_de: string; name_en: string; sku: string; purchase_price: string | null };
          productName = p.name_de || p.name_en || "Unknown Product";
          productSku  = p.sku ?? null;
          if (!resolvedPrice && p.purchase_price) resolvedPrice = parseFloat(p.purchase_price);
        }

        // Last ordered quantity from expense items
        const { rows: lastRows } = await pool.query(
          `SELECT ei.quantity, ei.unit_price, e.vendor_name, e.invoice_date, e.vendor_country
           FROM iroc_expense_items ei
           JOIN iroc_expenses e ON e.id = ei.expense_id
           WHERE ei.proposed_product_id = $1
           ORDER BY e.invoice_date DESC NULLS LAST
           LIMIT 1`,
          [productId],
        );
        if (lastRows.length > 0) {
          const last = lastRows[0] as { quantity: string; unit_price: string; vendor_country: string | null };
          lastOrderedQty = Math.round(parseFloat(last.quantity ?? "1")) || 1;
          if (!resolvedPrice && last.unit_price) resolvedPrice = parseFloat(last.unit_price);
          if (!resolvedVendorCountry) resolvedVendorCountry = last.vendor_country?.trim() || null;
        }
      }

      const milestone = salesMilestoneAchieved ?? false;
      const userPrompt = [
        `Vendor Email: ${vendorEmail}`,
        supplierReorderLanguageContext(resolvedVendorCountry),
        `Product Name: ${productName}`,
        `Product SKU: ${productSku ?? "N/A"}`,
        `Last Ordered Quantity: ${lastOrderedQty}`,
        `Agreed Contract Price: ${resolvedPrice != null ? `EUR ${resolvedPrice}` : "as per contract"}`,
        `Sales Milestone Achieved: ${milestone ? "YES — remind vendor and request milestone pricing" : "NO"}`,
        "",
        "Please draft the reorder email now.",
      ].join("\n");

      const draft = await generateSupplierReorderDraft(userPrompt, resolvedVendorCountry, {
        vendorEmail,
        productName,
        productSku,
        quantity: lastOrderedQty,
        contractPrice: resolvedPrice,
        salesMilestoneAchieved: milestone,
      });

      const { rows } = await pool.query(
        `INSERT INTO tori_reorder_queue
           (product_id, product_name, product_sku, vendor_email, vendor_country,
            quantity_to_order, contract_price, sales_milestone_achieved,
            email_to, email_subject, email_body_markdown, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',NOW(),NOW())
         RETURNING *`,
        [
           productId ?? null, productName, productSku, vendorEmail, resolvedVendorCountry,
          lastOrderedQty, resolvedPrice ?? null, milestone,
          draft.to, draft.subject, draft.email_body_markdown,
        ],
      );

      res.status(201).json(rows[0]);
    } catch (err) {
      req.log?.error({ err }, "Tori reorder error");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── GET /api/iroc/tori/reorder-queue ─────────────────────────────────────────

router.get(
  "/iroc/tori/reorder-queue",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { rows } = await pool.query(
        `SELECT q.*, p.stock_quantity, p.low_stock_threshold
         FROM tori_reorder_queue q
         LEFT JOIN iroc_products p ON p.id = q.product_id
         ORDER BY q.created_at DESC
         LIMIT 100`,
      );
      res.json(rows);
    } catch (err) {
      req.log?.error({ err }, "Tori reorder-queue fetch error");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── PATCH /api/iroc/tori/reorder-queue/:id/approve ───────────────────────────
// Validate configuration first, then durably claim the row before crossing the
// transport boundary. Once sendEmail starts, any thrown result is ambiguous:
// the provider may have accepted the message before the response was lost.

router.patch(
  "/iroc/tori/reorder-queue/:id/approve",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    try {
      const provider = await getEmailDeliveryProvider("tori_ai");
      if (provider === "smtp" && !(await isSmtpConfigured())) {
        await pool.query(
          `UPDATE tori_reorder_queue
              SET email_send_error=$2, updated_at=NOW()
            WHERE id=$1 AND status='pending'`,
          [id, SUPPLIER_REORDER_EMAIL_SEND_ERROR],
        );
        res.status(503).json({
          error: SUPPLIER_REORDER_EMAIL_SEND_ERROR,
          code: "TORI_REORDER_PRE_SEND_FAILED",
          retryable: true,
        });
        return;
      }

      const attemptId = randomUUID();
      const { rows: candidateRows } = await pool.query<{
        email_to: string;
        email_subject: string;
        email_body_markdown: string;
      }>(
        `SELECT email_to, email_subject, email_body_markdown
           FROM tori_reorder_queue
          WHERE id=$1 AND status='pending'
          LIMIT 1`,
        [id],
      );
      const candidate = candidateRows[0];
      if (!candidate) {
        res.status(409).json({
          error: "Not found, already actioned, or delivery requires reconciliation.",
          code: "TORI_REORDER_NOT_SENDABLE",
          retryable: false,
        });
        return;
      }
      const contentFingerprint = createHash("sha256")
        .update(`${candidate.email_to}\n${candidate.email_subject}\n${candidate.email_body_markdown}`)
        .digest("hex");
      const { rows } = await pool.query<{
        id: number;
        vendor_country: string | null;
        email_to: string;
        email_subject: string;
        email_body_markdown: string;
      }>(
        `UPDATE tori_reorder_queue
            SET status='sending',
                send_attempt_id=$2,
                send_claimed_at=NOW(),
                email_last_attempt_at=NOW(),
                send_attempt_count=COALESCE(send_attempt_count, 0) + 1,
                delivery_provider=$3,
                email_content_sha256=$4,
                email_send_error=NULL,
                updated_at=NOW()
          WHERE id=$1 AND status='pending'
          RETURNING id, vendor_country, email_to, email_subject, email_body_markdown`,
        [id, attemptId, provider, contentFingerprint],
      );
      const draft = rows[0];
      if (!draft) {
        res.status(409).json({
          error: "Not found, already actioned, or delivery requires reconciliation.",
          code: "TORI_REORDER_NOT_SENDABLE",
          retryable: false,
        });
        return;
      }

      let sendResult: { messageId: string | undefined };
      try {
        sendResult = await sendEmail({
          to: draft.email_to,
          subject: draft.email_subject,
          text: draft.email_body_markdown,
          signatureGroup: "tori",
          signatureLanguage: recipientLanguageForCountry(draft.vendor_country),
          mailboxPurpose: "tori_ai",
        });
      } catch (err) {
        await pool.query(
          `UPDATE tori_reorder_queue
              SET status='unconfirmed',
                  email_send_error=$3,
                  updated_at=NOW()
            WHERE id=$1 AND status='sending' AND send_attempt_id=$2`,
          [id, attemptId, SUPPLIER_REORDER_DELIVERY_UNCONFIRMED],
        );
        req.log?.error({ err, reorderId: id, attemptId }, "Tori reorder delivery outcome unconfirmed");
        res.status(502).json({
          error: SUPPLIER_REORDER_DELIVERY_UNCONFIRMED,
          code: "TORI_REORDER_DELIVERY_UNCONFIRMED",
          retryable: false,
          attempt_id: attemptId,
        });
        return;
      }

      try {
        const { rows: approvedRows } = await pool.query(
          `UPDATE tori_reorder_queue
              SET status='approved',
                  email_send_error=NULL,
                  email_sent_at=NOW(),
                  email_message_id=$2,
                  updated_at=NOW()
            WHERE id=$1 AND status='sending' AND send_attempt_id=$3
            RETURNING *`,
          [id, sendResult.messageId ?? null, attemptId],
        );
        if (!approvedRows[0]) {
          throw new Error("Tori reorder delivery claim could not be finalized");
        }
        res.json(approvedRows[0]);
      } catch (err) {
        // The provider accepted the message, but the local final transaction
        // did not complete. Keep the durable claim non-retryable: treating this
        // as a pre-send failure could create a duplicate supplier order.
        await pool.query(
          `UPDATE tori_reorder_queue
              SET status='unconfirmed',
                  email_send_error=$3,
                  updated_at=NOW()
            WHERE id=$1 AND status='sending' AND send_attempt_id=$2`,
          [id, attemptId, SUPPLIER_REORDER_DELIVERY_UNCONFIRMED],
        ).catch(updateError => {
          req.log?.error(
            { err: updateError, reorderId: id, attemptId },
            "Tori reorder finalization and quarantine both failed",
          );
        });
        req.log?.error({ err, reorderId: id, attemptId }, "Tori reorder delivery finalization failed");
        res.status(500).json({
          error: SUPPLIER_REORDER_DELIVERY_UNCONFIRMED,
          code: "TORI_REORDER_DELIVERY_UNCONFIRMED",
          retryable: false,
          attempt_id: attemptId,
        });
      }
    } catch (err) {
      req.log?.error({ err, reorderId: id }, "Tori approve reorder email error");
      res.status(503).json({
        error: SUPPLIER_REORDER_EMAIL_SEND_ERROR,
        code: "TORI_REORDER_PRE_SEND_FAILED",
        retryable: true,
      });
    }
  },
);

router.patch(
  "/iroc/tori/reorder-queue/:id/reconcile",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    const { action, acknowledgedDuplicateRisk = false } = req.body as {
      action?: "confirm_delivered" | "retry_confirmed_not_delivered";
      acknowledgedDuplicateRisk?: boolean;
    };
    if (isNaN(id) || !["confirm_delivered", "retry_confirmed_not_delivered"].includes(action ?? "")) {
      res.status(400).json({ error: "Invalid reconciliation request." });
      return;
    }
    if (action === "retry_confirmed_not_delivered" && !acknowledgedDuplicateRisk) {
      res.status(400).json({ error: "Duplicate-delivery risk must be acknowledged." });
      return;
    }
    try {
      const resultingStatus = action === "confirm_delivered" ? "approved" : "pending";
      const { rows } = await pool.query(
        `UPDATE tori_reorder_queue
            SET status=$2,
                email_sent_at=CASE WHEN $2='approved' THEN COALESCE(email_sent_at, NOW()) ELSE NULL END,
                email_send_error=CASE WHEN $2='pending' THEN $3 ELSE NULL END,
                reconciled_at=NOW(),
                reconciliation_action=$4,
                updated_at=NOW()
          WHERE id=$1 AND status IN ('sending', 'unconfirmed')
          RETURNING *`,
        [
          id,
          resultingStatus,
          action === "retry_confirmed_not_delivered"
            ? "Administrator confirmed non-delivery; reorder is ready for an explicit retry."
            : null,
          action,
        ],
      );
      if (!rows[0]) {
        res.status(409).json({ error: "Reorder no longer requires reconciliation." });
        return;
      }
      res.json(rows[0]);
    } catch (err) {
      req.log?.error({ err, reorderId: id }, "Tori reorder reconciliation error");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── DELETE /api/iroc/tori/reorder-queue/:id ───────────────────────────────────

router.delete(
  "/iroc/tori/reorder-queue/:id",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    try {
      await pool.query(`DELETE FROM tori_reorder_queue WHERE id=$1`, [id]);
      res.json({ ok: true });
    } catch (err) {
      req.log?.error({ err }, "Tori delete reorder error");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── New AI Prompts ────────────────────────────────────────────────────────────

const INVOICE_PIPELINE_PROMPT = `You are Tori, iROC GmbH's AI operations agent. Fully analyze a supplier invoice and prepare a structured database proposal for admin approval. NOTHING is committed until the admin approves.

BUSINESS RULES:
1. "service": Intangible expenses (shipping, consulting, utilities, software).
2. "company_usage": Tangible items for our own operations (office supplies, tools, furniture). Expense only — NOT added to resale inventory.
3. "resale": Tangible medical devices / accessories matching our distribution catalog. Must be added to inventory.

YOUR STEPS:
1. Extract ALL line items: name, SKU, quantity, unit_price, currency, line_total, discount_rate.
2. Classify invoice: type (product|service), usage (resale|company_usage|none).
3. Extract: vendor_name, vendor_email, vendor_country, invoice_number, invoice_date, net_amount, tax_amount, gross_amount, currency, shipping_cost.
4. Match each line item against EXISTING PRODUCTS (provided below):
   - Match by SKU first (exact), then name similarity.
   - Matched: set matched_product_id + matched_product_name.
   - No match: set is_new_product=true, fill suggested_product.
5. CONTRACT COMPLIANCE (for resale items): using PURCHASING CONTRACTS + CUMULATIVE HISTORY:
   - Add cumulative qty for the product to the quantity on this invoice.
   - Find the applicable discount tier for that total.
   - Compare invoiced unit_price to expected tier price.
   - compliance.ok=true (correct price), false (overcharged), null (no contract).
6. List ALL missing or ambiguous fields in missing_fields.

Respond with ONLY a JSON block — no prose outside it:
\`\`\`json
{
  "classification": { "type": "product", "usage": "resale" },
  "vendor": { "name": null, "email": null, "country": null },
  "proposed_expense": {
    "vendor_name": null, "vendor_country": null, "invoice_number": null, "invoice_date": null,
    "net_amount": null, "tax_amount": null, "gross_amount": null,
    "currency": "EUR", "shipping_cost": null, "category": null
  },
  "line_items": [{
    "name": "", "sku": null, "quantity": null, "unit_price": null,
    "currency": null, "line_total": null, "discount_rate": null,
    "matched_product_id": null, "matched_product_name": null,
    "is_new_product": false, "suggested_product": null, "lot_number": null,
    "compliance": { "ok": null, "expected_price": null, "tier_description": null, "notes": null }
  }],
  "missing_fields": [],
  "tori_notes": "",
  "compliance_summary": { "has_contract": false, "all_prices_correct": null, "issues": [] }
}
\`\`\``;

const CONTRACT_EXTRACTION_PROMPT = `You are Tori, iROC GmbH's AI operations agent. Extract every operationally relevant fact from a supplier purchasing contract. Do not invent missing values.

Respond with ONLY a JSON block:
\`\`\`json
{
  "vendor_name": "",
  "contract_number": null,
  "parties": [],
  "vendor_contacts": { "email": null, "phone": null, "address": null, "country": null },
  "effective_from": null,
  "effective_until": null,
  "renewal_terms": null,
  "termination_terms": null,
  "discount_tiers": [{
    "from_qty": 0, "to_qty": null, "unit_price": 0,
    "currency": "EUR", "discount_pct": null, "notes": null
  }],
  "products_covered": [],
  "territories": [],
  "minimum_order": null,
  "payment_terms": null,
  "delivery_terms": null,
  "shipping_terms": null,
  "exclusivity": null,
  "warranty_terms": null,
  "compliance_obligations": [],
  "party_obligations": [],
  "milestones": [],
  "exceptions_and_risks": [],
  "notes": ""
}
\`\`\`
Rules:
- from_qty / to_qty: cumulative quantity thresholds.
- to_qty null = this tier applies for all quantities above from_qty.
- If the contract gives percentage discounts rather than absolute prices, set discount_pct. Only set unit_price when the contract states enough information to calculate it reliably.
- Preserve exact currencies, quantities, dates, product names, SKUs, milestones, exceptions, and obligations.
- Include ambiguous or conflicting clauses in exceptions_and_risks.`;

type ContractExtraction = {
  vendor_name?: string;
  effective_from?: string | null;
  discount_tiers?: unknown[];
  products_covered?: string[];
  notes?: string;
  [key: string]: unknown;
};

async function analyzeContractSource(
  contractText: string,
  pdfBuffer: Buffer | null,
): Promise<{ extracted: ContractExtraction; contractText: string; pages: number | null }> {
  let readableText = contractText.trim();
  let pages: number | null = null;

  if (pdfBuffer) {
    try {
      const parsed = await pdfParse(pdfBuffer);
      readableText = parsed.text.trim();
      pages = parsed.numpages;
    } catch {
      readableText = "";
    }
  }

  if (readableText.length >= MINIMUM_EXTRACTED_PDF_TEXT_LENGTH) {
    const reply = await callOpenAI([
      { role: "system", content: CONTRACT_EXTRACTION_PROMPT },
      { role: "user", content: `--- CONTRACT TEXT ---\n${readableText}\n--- END ---\n\nExtract the complete contract information now.` },
    ], 8_192);
    return { extracted: parseJsonBlock(reply) as ContractExtraction, contractText: readableText, pages };
  }

  if (!pdfBuffer) {
    throw new Error("The saved contract has no readable text or PDF source");
  }

  const { ai } = await import("@workspace/integrations-gemini-ai");
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{
      role: "user",
      parts: [
        {
          text: `${CONTRACT_EXTRACTION_PROMPT}\n\nThe attached PDF is a scanned contract. Read every page visually and return the complete JSON analysis.`,
        },
        {
          inlineData: {
            mimeType: "application/pdf",
            data: pdfBuffer.toString("base64"),
          },
        },
      ],
    }],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 8_192,
    },
  });
  const extracted = parseJsonBlock(response.text ?? "") as ContractExtraction;
  return {
    extracted,
    contractText: "[Scanned PDF analyzed visually; original document retained in App Storage]",
    pages,
  };
}

// ── Helper: auto-queue reorder if stock is below threshold ────────────────────

async function autoQueueReorderIfNeeded(
  productId: number,
  vendorEmail: string | null,
  vendorCountry: string | null,
): Promise<boolean> {
  try {
    const { rows } = await pool.query<{
      id: number; name_de: string; name_en: string; sku: string | null;
      purchase_price: string | null; stock_quantity: number | null; low_stock_threshold: number | null;
    }>(
      `SELECT id, name_de, name_en, sku, purchase_price, stock_quantity, low_stock_threshold FROM iroc_products WHERE id=$1 LIMIT 1`,
      [productId],
    );
    const prod = rows[0];
    if (!prod) return false;
    if (prod.stock_quantity == null || prod.low_stock_threshold == null) return false;
    if (prod.stock_quantity > prod.low_stock_threshold) return false;

    const { rows: existing } = await pool.query(
      `SELECT id FROM tori_reorder_queue WHERE product_id=$1 AND status='pending' LIMIT 1`,
      [productId],
    );
    if (existing.length > 0) return false;

    const { rows: lastRows } = await pool.query<{ quantity: string; unit_price: string; vendor_country: string | null }>(
      `SELECT ei.quantity, ei.unit_price, e.vendor_country FROM iroc_expense_items ei
       JOIN iroc_expenses e ON e.id = ei.expense_id
       WHERE ei.proposed_product_id=$1 ORDER BY e.invoice_date DESC NULLS LAST LIMIT 1`,
      [productId],
    );
    const lastQty = lastRows.length > 0 ? (Math.round(parseFloat(lastRows[0].quantity ?? "1")) || 1) : 1;
    const resolvedPrice = lastRows.length > 0
      ? (parseFloat(lastRows[0].unit_price ?? "0") || null)
      : (prod.purchase_price ? parseFloat(prod.purchase_price) : null);
    const productName = prod.name_de || prod.name_en;
    const effectiveEmail = vendorEmail?.trim() || "orders@supplier.com";
    const effectiveCountry = vendorCountry?.trim() || lastRows[0]?.vendor_country?.trim() || null;

    const userPrompt = [
      `Vendor Email: ${effectiveEmail}`,
      supplierReorderLanguageContext(effectiveCountry),
      `Product Name: ${productName}`,
      `Product SKU: ${prod.sku ?? "N/A"}`,
      `Last Ordered Quantity: ${lastQty}`,
      `Agreed Contract Price: ${resolvedPrice != null ? `EUR ${resolvedPrice}` : "as per contract"}`,
      `Sales Milestone Achieved: NO`,
      `NOTE: Stock is now ${prod.stock_quantity} units, below reorder threshold of ${prod.low_stock_threshold}. This is an automatic trigger.`,
      "",
      "Draft the reorder email now.",
    ].join("\n");

    const draft = await generateSupplierReorderDraft(userPrompt, effectiveCountry, {
      vendorEmail: effectiveEmail,
      productName,
      productSku: prod.sku,
      quantity: lastQty,
      contractPrice: resolvedPrice,
      salesMilestoneAchieved: false,
    });

    await pool.query(
      `INSERT INTO tori_reorder_queue
         (product_id, product_name, product_sku, vendor_email, vendor_country, quantity_to_order,
           contract_price, sales_milestone_achieved, email_to, email_subject,
           email_body_markdown, status, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,$9,$10,'pending',NOW(),NOW())`,
       [productId, productName, prod.sku, effectiveEmail, effectiveCountry, lastQty,
       resolvedPrice ?? null, draft.to, draft.subject, draft.email_body_markdown],
    );
    return true;
  } catch {
    return false;
  }
}

interface InvoicePipelineAnalysis {
  classification: { type: string; usage: string };
  proposed_expense: unknown;
  line_items: unknown[];
  missing_fields: string[];
  compliance_summary: unknown;
  tori_notes: string;
}

async function runInvoicePipeline(
  invoiceText: string,
  adminCorrectionContext?: string,
): Promise<InvoicePipelineAnalysis> {
  const [{ rows: products }, { rows: contracts }, { rows: cumulative }] = await Promise.all([
    pool.query(
      `SELECT id, sku, name_de, name_en, category, purchase_price, stock_quantity, low_stock_threshold
       FROM iroc_products ORDER BY name_de LIMIT 300`,
    ),
    pool.query(
      `SELECT vendor_name, discount_tiers, products_covered, effective_from, notes, analysis_json
       FROM tori_contracts ORDER BY created_at DESC LIMIT 20`,
    ),
    pool.query(
      `SELECT ei.proposed_product_id AS product_id, SUM(ei.quantity) AS total_qty
       FROM iroc_expense_items ei WHERE ei.proposed_product_id IS NOT NULL
       GROUP BY ei.proposed_product_id`,
    ),
  ]);

  const productCatalog = (products as Array<{
    id: number; sku: string | null; name_de: string; name_en: string;
    category: string | null; purchase_price: string | null;
    stock_quantity: number; low_stock_threshold: number | null;
  }>).map(p =>
    `ID:${p.id}|SKU:${p.sku ?? "N/A"}|Name:${p.name_de} (${p.name_en})|Cat:${p.category ?? "N/A"}|LastPrice:${p.purchase_price ?? "N/A"}|Stock:${p.stock_quantity}`
  ).join("\n") || "No products in catalog yet.";

  const contractContext = contracts.length > 0
    ? (contracts as Array<{
        vendor_name: string; discount_tiers: unknown;
        products_covered: unknown; effective_from: string | null; notes: string | null; analysis_json: unknown;
      }>).map(c =>
        `VENDOR:${c.vendor_name}|From:${c.effective_from ?? "N/A"}|Tiers:${JSON.stringify(c.discount_tiers)}|Products:${JSON.stringify(c.products_covered)}|FullContractAnalysis:${JSON.stringify(c.analysis_json)}|Notes:${c.notes ?? ""}`
      ).join("\n")
    : "No purchasing contracts stored yet.";

  const cumulativeHistory = cumulative.length > 0
    ? (cumulative as Array<{ product_id: number; total_qty: string }>).map(r =>
        `ProductID:${r.product_id} CumulativeQty:${r.total_qty}`
      ).join("\n")
    : "No purchase history yet.";

  const learnedContext = await getRecentLearnedContext();
  const userContent = [
    `--- INVOICE TEXT ---\n${invoiceText}\n--- END INVOICE TEXT ---`,
    adminCorrectionContext
      ? `--- ADMIN CORRECTIONS ---\n${adminCorrectionContext}\n--- END ADMIN CORRECTIONS ---`
      : null,
    `--- EXISTING PRODUCT CATALOG ---\n${productCatalog}\n--- END CATALOG ---`,
    `--- PURCHASING CONTRACTS ---\n${contractContext}\n--- END CONTRACTS ---`,
    `--- CUMULATIVE PURCHASE HISTORY ---\n${cumulativeHistory}\n--- END HISTORY ---`,
    adminCorrectionContext
      ? "Re-analyze the invoice. Use the administrator's corrections as authoritative context, then return a complete replacement JSON proposal."
      : "Analyze the invoice and return the structured JSON proposal.",
  ].filter(Boolean).join("\n\n");

  const reply = await callOpenAI([
    { role: "system", content: INVOICE_PIPELINE_PROMPT + learnedContext },
    { role: "user", content: userContent },
  ]);

  return parseJsonBlock(reply) as InvoicePipelineAnalysis;
}

// ── POST /api/iroc/tori/analyze-invoice ──────────────────────────────────────
// Full pipeline: PDF → AI → product match → compliance check → pending action

router.post(
  "/iroc/tori/analyze-invoice",
  requireIrocAuth,
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    let invoiceText = (req.body as { invoiceText?: string }).invoiceText?.trim() ?? "";
    const file = (req as Request & { file?: Express.Multer.File }).file;

    if (file) {
      if (!isPdfUpload(file)) {
        res.status(422).json({ error: "Only PDF files are supported" }); return;
      }
      try {
        const result = await pdfParse(file.buffer);
        invoiceText = result.text.trim();
      } catch {
        res.status(422).json({ error: "Could not parse PDF — may be encrypted or image-only." }); return;
      }
      if (invoiceText.length < MINIMUM_EXTRACTED_PDF_TEXT_LENGTH) {
        sendPdfTextWarning(res, invoiceText.length);
        return;
      }
    }

    if (!invoiceText) { res.status(400).json({ error: "invoiceText or PDF file required" }); return; }

    try {
      const analysis = await runInvoicePipeline(invoiceText);

      const { rows: [action] } = await pool.query(
        `INSERT INTO tori_pending_actions
           (invoice_text, analysis_json, proposed_expense, proposed_items,
            missing_fields, compliance_summary, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW(),NOW())
         RETURNING *`,
        [
          invoiceText,
          JSON.stringify(analysis),
          JSON.stringify(analysis.proposed_expense ?? {}),
          JSON.stringify(analysis.line_items ?? []),
          JSON.stringify(analysis.missing_fields ?? []),
          JSON.stringify(analysis.compliance_summary ?? {}),
        ],
      );

      res.status(201).json({ action, analysis });
    } catch (err) {
      req.log?.error({ err }, "Tori analyze-invoice error");
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  },
);

// ── POST /api/iroc/tori/pending-actions/:id/re-analyze ───────────────────────
// Runs the existing invoice text through the pipeline again, using the saved
// admin-edited proposal as context. invoice_text remains the original upload.

router.post(
  "/iroc/tori/pending-actions/:id/re-analyze",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    try {
      const { rows: [action] } = await pool.query<{
        invoice_text: string | null;
        proposed_expense: unknown;
        proposed_items: unknown;
      }>(
        `SELECT invoice_text, proposed_expense, proposed_items
         FROM tori_pending_actions WHERE id=$1 AND status='pending' LIMIT 1`,
        [id],
      );
      if (!action) { res.status(404).json({ error: "Not found or already actioned" }); return; }
      if (!action.invoice_text?.trim()) {
        res.status(422).json({ error: "This pending action has no saved invoice text to re-analyze" });
        return;
      }

      const correctionContext = [
        "The following are administrator corrections to the previous proposal. Incorporate them when producing the new analysis.",
        `Corrected proposed expense:\n${JSON.stringify(action.proposed_expense ?? {})}`,
        `Corrected proposed line items:\n${JSON.stringify(action.proposed_items ?? [])}`,
      ].join("\n\n");
      const analysis = await runInvoicePipeline(action.invoice_text, correctionContext);

      const { rows: [updatedAction] } = await pool.query(
        `UPDATE tori_pending_actions
         SET analysis_json=$1, proposed_expense=$2, proposed_items=$3,
             missing_fields=$4, compliance_summary=$5, updated_at=NOW()
         WHERE id=$6 AND status='pending'
         RETURNING *`,
        [
          JSON.stringify(analysis),
          JSON.stringify(analysis.proposed_expense ?? {}),
          JSON.stringify(analysis.line_items ?? []),
          JSON.stringify(analysis.missing_fields ?? []),
          JSON.stringify(analysis.compliance_summary ?? {}),
          id,
        ],
      );
      if (!updatedAction) {
        res.status(409).json({ error: "This action was already processed while re-analysis was running" });
        return;
      }

      res.json({ action: updatedAction, analysis });
    } catch (err) {
      req.log?.error({ err, actionId: id }, "Tori re-analyze pending-action error");
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  },
);

// ── GET /api/iroc/tori/pending-actions ───────────────────────────────────────

router.get(
  "/iroc/tori/pending-actions",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { status } = req.query as { status?: string };
    try {
      const where = status ? `WHERE status=$1` : `WHERE status != 'rejected'`;
      const params = status ? [status] : [];
      const { rows } = await pool.query(
        `SELECT * FROM tori_pending_actions ${where} ORDER BY created_at DESC LIMIT 100`,
        params,
      );
      res.json(rows);
    } catch (err) {
      req.log?.error({ err }, "Tori pending-actions fetch error");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── PATCH /api/iroc/tori/pending-actions/:id ─────────────────────────────────

router.patch(
  "/iroc/tori/pending-actions/:id",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { admin_notes, proposed_expense, proposed_items } = req.body as {
      admin_notes?: string; proposed_expense?: unknown; proposed_items?: unknown;
    };
    try {
      const sets: string[] = ["updated_at=NOW()"];
      const vals: unknown[] = [];
      let idx = 1;
      if (admin_notes !== undefined) { sets.push(`admin_notes=$${idx++}`); vals.push(admin_notes); }
      if (proposed_expense !== undefined) { sets.push(`proposed_expense=$${idx++}`); vals.push(JSON.stringify(proposed_expense)); }
      if (proposed_items !== undefined) { sets.push(`proposed_items=$${idx++}`); vals.push(JSON.stringify(proposed_items)); }
      vals.push(id);
      const { rows } = await pool.query(
        `UPDATE tori_pending_actions SET ${sets.join(",")} WHERE id=$${idx} AND status='pending' RETURNING *`,
        vals,
      );
      if (rows.length === 0) { res.status(404).json({ error: "Not found or already actioned" }); return; }
      res.json(rows[0]);
    } catch (err) {
      req.log?.error({ err }, "Tori patch pending-action error");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── POST /api/iroc/tori/pending-actions/:id/approve ──────────────────────────

router.post(
  "/iroc/tori/pending-actions/:id/approve",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { proposed_expense: expOverride, proposed_items: itemsOverride } = req.body as {
      proposed_expense?: Record<string, unknown>;
      proposed_items?: Array<Record<string, unknown>>;
    };

    const client = await pool.connect();
    let expenseId: number | undefined;
    let vendorEmail: string | null = null;
    let vendorCountry: string | null = null;
    let committed = false;
    const lotsCreated: number[] = [];
    const touchedProductIds: number[] = [];

    try {
      await client.query("BEGIN");

      // Lock the row so concurrent requests cannot both approve the same action
      const { rows: [action] } = await client.query(
        `SELECT * FROM tori_pending_actions WHERE id=$1 AND status='pending' LIMIT 1 FOR UPDATE`,
        [id],
      );
      if (!action) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Not found or already actioned" });
        return; // finally releases the client; return exits the handler
      }

      // analysis_json stores the full AI response; it is the authoritative classification source
      const analysis = action.analysis_json as {
        classification?: { type?: string | null; usage?: string | null };
        vendor?: { email?: string | null; country?: string | null };
      } | null;

      const classType  = analysis?.classification?.type  ?? null;
      const classUsage = analysis?.classification?.usage ?? null;
      // isResale is derived from analysis.classification, not from the nullable proposed_expense.category
      const isResale = classType === "product" && classUsage === "resale";

      const expBase = action.proposed_expense as Record<string, unknown> ?? {};
      // Backfill category from classification so the expense record is written correctly
      const derivedCategory = expBase.category ?? (classType ?? null);
      const expense: Record<string, unknown> = { ...expBase, category: derivedCategory, ...(expOverride ?? {}) };
      const items    = (itemsOverride ?? (action.proposed_items as Array<Record<string, unknown>> ?? [])) as Array<Record<string, unknown>>;
      // Prefer the AI-extracted vendor email from the analysis; caller override takes precedence
      vendorEmail = (expOverride?.vendor_email as string | null)
        ?? (analysis?.vendor?.email ?? null)
        ?? null;
      vendorCountry = (expOverride?.vendor_country as string | null)
        ?? (analysis?.vendor?.country ?? null)
        ?? (expense.vendor_country as string | null)
        ?? null;

      // 1. Create expense record
      const { rows: [expRow] } = await client.query<{ id: number }>(
        `INSERT INTO iroc_expenses
           (vendor_name, vendor_country, invoice_date, invoice_number, category, net_amount,
            tax_amount, gross_amount, currency, shipping_cost, source, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'tori',NOW(),NOW()) RETURNING id`,
        [
          expense.vendor_name ?? null,
          vendorCountry,
          expense.invoice_date ?? null,
          expense.invoice_number ?? null,
          expense.category ?? null,
          expense.net_amount != null ? String(expense.net_amount) : null,
          expense.tax_amount != null ? String(expense.tax_amount) : null,
          expense.gross_amount != null ? String(expense.gross_amount) : null,
          expense.currency ?? "EUR",
          expense.shipping_cost != null ? String(expense.shipping_cost) : null,
        ],
      );
      expenseId = expRow.id;

      // 2. Process each line item
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        let productId = (item.matched_product_id as number | null) ?? null;

        // Create new product if flagged and no product_id assigned
        if (!productId && item.is_new_product) {
          const sp = item.suggested_product as Record<string, unknown> | null;
          const newNameDe = (sp?.name_de as string) || (item.name as string) || "Unbekanntes Produkt";
          // Generate a non-null SKU fallback: use suggested sku or a unique placeholder
          const fallbackSku = ((sp?.sku as string) || (item.sku as string) || "").trim() || `TORI-${expenseId}-${i}`;
          const { rows: [np] } = await client.query<{ id: number }>(
            `INSERT INTO iroc_products
               (name_de, name_en, sku, category, purchase_price, stock_quantity,
                instrument, unit_price, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,0,'other',0,NOW(),NOW()) RETURNING id`,
            [
              newNameDe,
              (sp?.name_en as string) || newNameDe,
              fallbackSku,
              (sp?.category as string) || "other",   // category is NOT NULL in iroc_products
              item.unit_price != null ? String(item.unit_price) : null,
            ],
          );
          productId = np.id;
        }

        // Insert expense item (lot_number is nullable in iroc_expense_items)
        const { rows: [itemRow] } = await client.query<{ id: number }>(
          `INSERT INTO iroc_expense_items
             (expense_id, product_name_raw, proposed_product_id, lot_number,
              quantity, unit_price, discount_rate, line_total, sort_order, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW()) RETURNING id`,
          [
            expenseId,
            item.name ?? null,
            productId ?? null,
            (item.lot_number as string | null) ?? null,
            item.quantity != null ? String(item.quantity) : null,
            item.unit_price != null ? String(item.unit_price) : null,
            item.discount_rate != null ? String(item.discount_rate) : null,
            item.line_total != null ? String(item.line_total) : null,
            i,
          ],
        );

        // Create inventory lot for resale items
        if (isResale && productId && item.quantity != null) {
          const qty = Math.round(Number(item.quantity));
          if (qty > 0) {
            // Use AI-provided lot number if present; otherwise generate EXP-{expenseId}-{itemId} fallback
            const lotNum = ((item.lot_number as string | null) ?? "").trim() || `EXP-${expenseId}-${itemRow.id}`;
            // purchase_date is NOT NULL — fall back to today if invoice date is missing
            const purchaseDate = (expense.invoice_date as string | null) ?? new Date().toISOString().slice(0, 10);
            const { rows: [lotRow] } = await client.query<{ id: number }>(
              `INSERT INTO iroc_inventory_lots
                 (product_id, lot_number, purchase_date, quantity_received, quantity_used,
                  description, status, created_at, updated_at)
               VALUES ($1,$2,$3,$4,0,$5,'active',NOW(),NOW()) RETURNING id`,
              [
                productId, lotNum, purchaseDate, qty,
                `From Tori: ${expense.vendor_name ?? ""} ${expense.invoice_number ?? ""}`.trim(),
              ],
            );
            lotsCreated.push(lotRow.id);

            // Back-link expense item → inventory lot
            await client.query(
              `UPDATE iroc_expense_items SET inventory_lot_id=$1 WHERE id=$2`,
              [lotRow.id, itemRow.id],
            );

            await client.query(
              `UPDATE iroc_products
               SET stock_quantity = stock_quantity + $1,
                   purchase_price = COALESCE($2::numeric, purchase_price),
                   updated_at = NOW()
               WHERE id = $3`,
              [qty, item.unit_price != null ? String(item.unit_price) : null, productId],
            );
            if (!touchedProductIds.includes(productId)) touchedProductIds.push(productId);
          }
        }
      }

      // Mark action approved
      await client.query(
        `UPDATE tori_pending_actions SET status='approved', executed_expense_id=$1, updated_at=NOW() WHERE id=$2`,
        [expenseId, id],
      );

      await client.query("COMMIT");
    } catch (txErr) {
      try { await client.query("ROLLBACK"); } catch { /* ignore rollback errors */ }
      req.log?.error({ err: txErr }, "Tori approve pending-action error");
      res.status(500).json({ error: txErr instanceof Error ? txErr.message : "Internal error" });
      return;
    } finally {
      // Always release the client — covers not-found early-return, catch, and success paths
      client.release();
    }

    // Post-commit: auto-queue reorders for below-threshold products
    // Supplier contact and country were read from the extracted invoice data.
    const reordersQueued: string[] = [];
    for (const pid of touchedProductIds) {
      const queued = await autoQueueReorderIfNeeded(pid, vendorEmail, vendorCountry);
      if (queued) {
        const { rows: [p] } = await pool.query<{ name_de: string }>(`SELECT name_de FROM iroc_products WHERE id=$1`, [pid]);
        if (p) reordersQueued.push(p.name_de);
      }
    }

    res.json({ expense_id: expenseId!, lots_created: lotsCreated, reorders_queued: reordersQueued });
  },
);

// ── POST /api/iroc/tori/pending-actions/:id/reject ───────────────────────────

router.post(
  "/iroc/tori/pending-actions/:id/reject",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { admin_notes } = req.body as { admin_notes?: string };
    try {
      const { rows } = await pool.query(
        `UPDATE tori_pending_actions SET status='rejected', admin_notes=$1, updated_at=NOW()
         WHERE id=$2 AND status='pending' RETURNING *`,
        [admin_notes ?? null, id],
      );
      if (rows.length === 0) { res.status(404).json({ error: "Not found or already actioned" }); return; }
      res.json(rows[0]);
    } catch (err) {
      req.log?.error({ err }, "Tori reject pending-action error");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── POST /api/iroc/tori/contracts ────────────────────────────────────────────

router.post(
  "/iroc/tori/contracts",
  requireIrocAuth,
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as {
      contractText?: string;
      sourceObjectPath?: string;
      sourceFileName?: string;
      sourceFileSize?: number;
      sourcePageCount?: number;
    };
    let contractText = body.contractText?.trim() ?? "";
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (file) {
      if (!isPdfUpload(file)) {
        res.status(422).json({ error: "Only PDF files are supported" }); return;
      }
      try {
        const result = await pdfParse(file.buffer);
        contractText = result.text.trim();
      } catch {
        res.status(422).json({ error: "Could not parse PDF" }); return;
      }
      if (contractText.length < MINIMUM_EXTRACTED_PDF_TEXT_LENGTH) {
        sendPdfTextWarning(res, contractText.length);
        return;
      }
    }
    if (!contractText && !body.sourceObjectPath) {
      res.status(400).json({ error: "Stored PDF path or contract text required" }); return;
    }
    if (body.sourceObjectPath && !/^\/objects\/uploads\/[0-9a-f-]+$/i.test(body.sourceObjectPath)) {
      res.status(400).json({ error: "Invalid stored PDF path" }); return;
    }

    try {
      const { rows: [contract] } = await pool.query(
        `INSERT INTO tori_contracts
           (vendor_name, contract_text, discount_tiers, products_covered, effective_from, notes,
            source_object_path, source_file_name, source_file_size, source_page_count,
            analysis_json, analyzed_at, analysis_status, analysis_error, created_at)
         VALUES ($1,$2,'[]'::jsonb,'[]'::jsonb,NULL,NULL,$3,$4,$5,$6,NULL,NULL,'pending',NULL,NOW())
         RETURNING *`,
        [
          body.sourceFileName?.replace(/\.pdf$/i, "") || "Uploaded contract",
          contractText,
          body.sourceObjectPath ?? null,
          body.sourceFileName?.slice(0, 255) ?? null,
          Number.isFinite(body.sourceFileSize) ? body.sourceFileSize : null,
          Number.isInteger(body.sourcePageCount) ? body.sourcePageCount : null,
        ],
      );
      res.status(201).json(contract);
    } catch (err) {
      req.log?.error({ err }, "Tori contracts POST error");
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  },
);

router.post(
  "/iroc/tori/contracts/:id/analyze",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" }); return;
    }

    const claimed = await pool.query<{
      id: number;
      contract_text: string;
      source_object_path: string | null;
    }>(
      `UPDATE tori_contracts
       SET analysis_status='analyzing', analysis_error=NULL
       WHERE id=$1 AND analysis_status <> 'analyzed'
       RETURNING id, contract_text, source_object_path`,
      [id],
    );
    if (claimed.rows.length === 0) {
      const existing = await pool.query(`SELECT * FROM tori_contracts WHERE id=$1`, [id]);
      if (existing.rows.length === 0) res.status(404).json({ error: "Contract not found" });
      else res.status(409).json({ error: "Contract is already being analyzed or has been analyzed", contract: existing.rows[0] });
      return;
    }

    try {
      const row = claimed.rows[0];
      let pdfBuffer: Buffer | null = null;
      if (row.source_object_path) {
        const storedFile = await new ObjectStorageService().getObjectEntityFile(row.source_object_path);
        [pdfBuffer] = await storedFile.download();
      }
      const result = await analyzeContractSource(row.contract_text, pdfBuffer);
      const extracted = result.extracted;
      const { rows: [contract] } = await pool.query(
        `UPDATE tori_contracts
         SET vendor_name=$2, contract_text=$3, discount_tiers=$4, products_covered=$5,
             effective_from=$6, notes=$7, source_page_count=COALESCE(source_page_count,$8),
             analysis_json=$9, analyzed_at=NOW(), analysis_status='analyzed',
             analysis_error=NULL
         WHERE id=$1
         RETURNING *`,
        [
          id,
          String(extracted.vendor_name || "Unknown Vendor"),
          result.contractText,
          JSON.stringify(extracted.discount_tiers ?? []),
          JSON.stringify(extracted.products_covered ?? []),
          extracted.effective_from ?? null,
          extracted.notes ?? null,
          result.pages,
          JSON.stringify(extracted),
        ],
      );
      res.json(contract);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Contract analysis failed";
      await pool.query(
        `UPDATE tori_contracts
         SET analysis_status='failed', analysis_error=$2
         WHERE id=$1`,
        [id, message.slice(0, 2_000)],
      );
      req.log?.error({ err, contractId: id }, "Tori contract analysis error");
      res.status(500).json({ error: message });
    }
  },
);

// ── GET /api/iroc/tori/contracts ─────────────────────────────────────────────

router.get(
  "/iroc/tori/contracts",
  requireIrocAuth,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const { rows } = await pool.query(
        `SELECT id, vendor_name, discount_tiers, products_covered, effective_from, notes,
                source_object_path, source_file_name, source_file_size, source_page_count,
                analysis_json, analyzed_at, analysis_status, analysis_error, created_at
         FROM tori_contracts ORDER BY created_at DESC LIMIT 50`,
      );
      res.json(rows);
    } catch {
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ── DELETE /api/iroc/tori/contracts/:id ──────────────────────────────────────

router.delete(
  "/iroc/tori/contracts/:id",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    try {
      await pool.query(`DELETE FROM tori_contracts WHERE id=$1`, [id]);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Internal error" });
    }
  },
);

export default router;
