/**
 * Expense & Invoice Reader routes
 *
 * POST   /api/admin/expenses/extract          – AI extraction from a GCS-stored file
 * GET    /api/admin/expenses/datev-settings   – get category → DATEV Konto mapping
 * POST   /api/admin/expenses/datev-settings   – save category → DATEV Konto mapping
 * GET    /api/admin/expenses/datev-export     – download DATEV Buchungsstapel CSV
 * GET    /api/admin/expenses                  – list with optional filters
 * POST   /api/admin/expenses                  – create a record
 * PUT    /api/admin/expenses/:id              – update a record
 * DELETE /api/admin/expenses/:id              – delete a record
 * GET    /api/admin/expenses/:id/file         – download the source document (auth-gated)
 */

import { Readable } from "stream";
import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requireIrocAuth } from "./iroc.js";
import { ai } from "@workspace/integrations-gemini-ai/image";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage.js";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

// ── DATEV Buchungsstapel helpers ───────────────────────────────────────────────

import {
  DEFAULT_KONTO_MAP,
  DEFAULT_GEGEN_KONTO,
  buildDatevBuchungsstapelCsv,
} from "../lib/datev-buchungsstapel.js";

const SETTINGS_KEY_MAP   = "datev_expense_konto_mapping";
const SETTINGS_KEY_GEGEN = "datev_expense_gegen_konto";
const SETTINGS_KEY_SPIKE = "expense_orphan_spike_threshold";

const DEFAULT_SPIKE_THRESHOLD = 5;

async function getSetting(key: string): Promise<string | null> {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key=$1", [key]);
  return rows[0]?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
    [key, value],
  );
}

// ── Allowed values ─────────────────────────────────────────────────────────────

const ALLOWED_CATEGORIES = new Set([
  "Office Supplies", "Software", "Travel", "Medical Equipment",
  "Consulting", "Utilities", "Advertising", "Other",
]);

// Accept any ISO-4217-style 3-letter code; client constrains to a subset.
const CURRENCY_RE = /^[A-Z]{3}$/;
const DATE_RE     = /^\d{4}-\d{2}-\d{2}$/;
const RECURRING_UNITS = new Set(["day", "week", "month", "quarter", "year"]);

export function nextRecurringDueDate(date: string, intervalCount: number, intervalUnit: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  const addDays = (count: number) => value.setUTCDate(value.getUTCDate() + count);
  const addMonths = (count: number) => {
    const targetMonth = value.getUTCMonth() + count;
    const targetYear = value.getUTCFullYear() + Math.floor(targetMonth / 12);
    const normalizedMonth = ((targetMonth % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
    value.setUTCFullYear(targetYear, normalizedMonth, Math.min(day, lastDay));
  };
  if (intervalUnit === "day") addDays(intervalCount);
  else if (intervalUnit === "week") addDays(intervalCount * 7);
  else if (intervalUnit === "month") addMonths(intervalCount);
  else if (intervalUnit === "quarter") addMonths(intervalCount * 3);
  else if (intervalUnit === "year") addMonths(intervalCount * 12);
  return value.toISOString().slice(0, 10);
}

// ── Extraction system prompt ───────────────────────────────────────────────────

const EXTRACT_SYSTEM_PROMPT = `You are an expert invoice and receipt data extractor.
Extract the following fields from the document and return ONLY valid JSON:
{
  "vendor_name": string or null,
  "invoice_date": "YYYY-MM-DD" or null,
  "invoice_date_original": string or null,
  "date_ambiguous": boolean,
  "invoice_number": string or null,
  "category": string or null,
  "net_amount": number or null,
  "tax_amount": number or null,
  "gross_amount": number or null,
  "currency": string (e.g. "EUR", "USD") or null,
  "shipping_cost": number or null,
  "confidence": "high" or "low",
  "items": [
    {
      "product_name": string or null,
      "lot_number": string or null,
      "quantity": number or null,
      "unit_price": number or null,
      "discount_rate": number or null,
      "line_total": number or null,
      "measurement_original": string or null,
      "weight_value": number or null,
      "weight_unit": string or null,
      "length_value": number or null,
      "width_value": number or null,
      "height_value": number or null,
      "dimension_unit": string or null
    }
  ]
}

For category, pick the most fitting from: Office Supplies, Software, Travel, Medical Equipment, Consulting, Utilities, Advertising, Other.
For dates: return the source date text in "invoice_date_original" and a canonical "invoice_date". Treat dates such as 04/05/2026 as ambiguous when both possible day and month are 12 or lower; set "date_ambiguous" to true so an administrator reviews it. Do not guess an ambiguous date.
For items: extract every line item from the invoice. "discount_rate" is the percentage discount (e.g. 10 for 10%). "lot_number" is the batch/lot/LOT number if present. "shipping_cost" is a separate freight/shipping charge on the invoice (not a line item). Preserve the source measurement text and extract any weight or dimensions with their original unit. Use lb/oz/kg/g for weight and in/cm/mm/m for dimensions.
If no line items are present, return items as an empty array [].
If a field is unclear, missing, or the document image is unclear/blurry, set its value to null and set confidence to "low".
If you can extract most fields with reasonable confidence, set confidence to "high".
Return ONLY the JSON object, no markdown, no explanations.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function toPositiveFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    if (!isFinite(v) || v < 0) return null;
    return Math.round(v * 100) / 100;
  }
  if (typeof v === "string") {
    // Reject anything that isn't a plain decimal number ("12abc", "1e2" etc.)
    if (!/^\d+(\.\d+)?$/.test(v.trim())) return null;
    const n = parseFloat(v.trim());
    if (!isFinite(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
  }
  return null;
}

function isValidCalendarDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth()    === m - 1 &&
    dt.getUTCDate()     === d
  );
}

export interface ExtractedItem {
  product_name:    string | null;
  lot_number:      string | null;
  quantity:        number | null;
  unit_price:      number | null;
  discount_rate:   number | null;
  line_total:      number | null;
  measurement_original: string | null;
  weight_kg:       number | null;
  length_cm:       number | null;
  width_cm:        number | null;
  height_cm:       number | null;
}

function toMeasurementFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number"
    ? v
    : (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : NaN);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1000) / 1000;
}

/** FX rates are audit data, not physical measurements: retain schema precision. */
function toExchangeRate(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number"
    ? v
    : (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : NaN);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100_000_000) / 100_000_000;
}

function normalizeWeight(value: unknown, unit: unknown): number | null {
  const n = toMeasurementFloat(value);
  if (n === null || typeof unit !== "string") return null;
  switch (unit.trim().toLowerCase()) {
    case "kg": case "kilogram": case "kilograms": return n;
    case "g": case "gram": case "grams": return Math.round((n / 1000) * 1000) / 1000;
    case "lb": case "lbs": case "pound": case "pounds": return Math.round((n * 0.45359237) * 1000) / 1000;
    case "oz": case "ounce": case "ounces": return Math.round((n * 0.028349523125) * 1000) / 1000;
    default: return null;
  }
}

function normalizeLength(value: unknown, unit: unknown): number | null {
  const n = toMeasurementFloat(value);
  if (n === null || typeof unit !== "string") return null;
  switch (unit.trim().toLowerCase()) {
    case "cm": case "centimeter": case "centimeters": return Math.round(n * 100) / 100;
    case "mm": case "millimeter": case "millimeters": return Math.round((n / 10) * 100) / 100;
    case "m": case "meter": case "meters": return Math.round((n * 100) * 100) / 100;
    case "in": case "inch": case "inches": case "\"": return Math.round((n * 2.54) * 100) / 100;
    default: return null;
  }
}

export interface MatchedItem extends ExtractedItem {
  proposed_product_id:   number  | null;
  proposed_product_name: string  | null;
  proposed_sku:          string  | null;
}

interface CatalogProduct {
  id:      number;
  sku:     string;
  name_de: string;
  name_en: string;
}

function sanitizeItem(raw: unknown): ExtractedItem {
  if (!raw || typeof raw !== "object") {
    return {
      product_name: null, lot_number: null, quantity: null, unit_price: null, discount_rate: null, line_total: null,
      measurement_original: null, weight_kg: null, length_cm: null, width_cm: null, height_cm: null,
    };
  }
  const r = raw as Record<string, unknown>;
  return {
    product_name:  typeof r.product_name === "string" ? r.product_name.trim().slice(0, 500) || null : null,
    lot_number:    typeof r.lot_number   === "string" ? r.lot_number.trim().slice(0, 100)   || null : null,
    quantity:      toPositiveFloat(r.quantity),
    unit_price:    toPositiveFloat(r.unit_price),
    discount_rate: r.discount_rate != null ? toPositiveFloat(r.discount_rate) : null,
    line_total:    toPositiveFloat(r.line_total),
    measurement_original: typeof r.measurement_original === "string"
      ? r.measurement_original.trim().slice(0, 300) || null
      : null,
    weight_kg: normalizeWeight(r.weight_value, r.weight_unit),
    length_cm: normalizeLength(r.length_value, r.dimension_unit),
    width_cm: normalizeLength(r.width_value, r.dimension_unit),
    height_cm: normalizeLength(r.height_value, r.dimension_unit),
  };
}

/** Fuzzy-match extracted product names against the product catalog.
 *  Matching order: exact SKU → exact name (DE/EN) → substring containment.
 *  Returns the matched product's id, local name_de, and SKU, or nulls.
 */
function matchProductToItems(items: ExtractedItem[], catalog: CatalogProduct[]): MatchedItem[] {
  return items.map(item => {
    if (!item.product_name) {
      return { ...item, proposed_product_id: null, proposed_product_name: null, proposed_sku: null };
    }
    const needle = item.product_name.toLowerCase().trim();

    // 1. Exact SKU match
    let match = catalog.find(p => p.sku.toLowerCase() === needle);
    // 2. Exact name match (DE or EN)
    if (!match) match = catalog.find(p =>
      p.name_de.toLowerCase() === needle || p.name_en.toLowerCase() === needle,
    );
    // 3. Catalog name contains needle
    if (!match) match = catalog.find(p =>
      p.name_de.toLowerCase().includes(needle) || p.name_en.toLowerCase().includes(needle),
    );
    // 4. Needle contains catalog name (invoice uses a longer description)
    if (!match) match = catalog.find(p =>
      needle.includes(p.name_de.toLowerCase()) || needle.includes(p.name_en.toLowerCase()),
    );

    return {
      ...item,
      proposed_product_id:   match?.id    ?? null,
      proposed_product_name: match?.name_de ?? null,
      proposed_sku:          match?.sku   ?? null,
    };
  });
}

function sanitizeExtracted(raw: Record<string, unknown>) {
  const currency = typeof raw.currency === "string"
    ? raw.currency.trim().toUpperCase()
    : "EUR";

  const rawItems = Array.isArray(raw.items) ? raw.items : [];

  return {
    vendor_name:    typeof raw.vendor_name    === "string" ? raw.vendor_name.trim().slice(0, 500) || null : null,
    invoice_date:   typeof raw.invoice_date   === "string" && DATE_RE.test(raw.invoice_date) ? raw.invoice_date : null,
    invoice_date_original: typeof raw.invoice_date_original === "string"
      ? raw.invoice_date_original.trim().slice(0, 100) || null
      : null,
    date_ambiguous: raw.date_ambiguous === true,
    invoice_number: typeof raw.invoice_number === "string" ? raw.invoice_number.trim().slice(0, 200) || null : null,
    category:       typeof raw.category       === "string" && ALLOWED_CATEGORIES.has(raw.category) ? raw.category : null,
    net_amount:     toPositiveFloat(raw.net_amount),
    tax_amount:     toPositiveFloat(raw.tax_amount),
    gross_amount:   toPositiveFloat(raw.gross_amount),
    shipping_cost:  raw.shipping_cost != null ? toPositiveFloat(raw.shipping_cost) : null,
    currency:       CURRENCY_RE.test(currency) ? currency : "EUR",
    confidence:     raw.confidence === "high" ? "high" : "low",
    items:          rawItems.map(sanitizeItem),
  };
}

interface NormalizedItem {
  product_name_raw:    string | null;
  product_name_local:  string | null;
  proposed_product_id: number | null;
  lot_number:          string | null;
  quantity:            number | null;
  unit_price:          number | null;
  discount_rate:       number | null;
  line_total:          number | null;
  measurement_original: string | null;
  weight_kg:           number | null;
  length_cm:           number | null;
  width_cm:            number | null;
  height_cm:           number | null;
  sort_order:          number;
}

function normalizeItems(rawItems: unknown): NormalizedItem[] {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.slice(0, 200).map((raw, idx) => {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    return {
      product_name_raw:    typeof r.product_name_raw   === "string" ? r.product_name_raw.trim().slice(0, 500)   || null : null,
      product_name_local:  typeof r.product_name_local === "string" ? r.product_name_local.trim().slice(0, 500) || null : null,
      proposed_product_id: typeof r.proposed_product_id === "number" ? r.proposed_product_id : null,
      lot_number:          typeof r.lot_number          === "string" ? r.lot_number.trim().slice(0, 100)         || null : null,
      quantity:            r.quantity    != null ? toPositiveFloat(r.quantity)    : null,
      unit_price:          r.unit_price  != null ? toPositiveFloat(r.unit_price)  : null,
      discount_rate:       r.discount_rate != null ? toPositiveFloat(r.discount_rate) : null,
      line_total:          r.line_total  != null ? toPositiveFloat(r.line_total)  : null,
      measurement_original: typeof r.measurement_original === "string"
        ? r.measurement_original.trim().slice(0, 300) || null
        : null,
      weight_kg:           r.weight_kg != null ? toMeasurementFloat(r.weight_kg) : null,
      length_cm:           r.length_cm != null ? toMeasurementFloat(r.length_cm) : null,
      width_cm:            r.width_cm != null ? toMeasurementFloat(r.width_cm) : null,
      height_cm:           r.height_cm != null ? toMeasurementFloat(r.height_cm) : null,
      sort_order:          idx,
    };
  }).filter(Boolean) as NormalizedItem[];
}

function validateAndNormalizeBody(body: Record<string, unknown>): {
  error?: string;
  status?: number;
  data?: {
    vendor_name:      string | null;
    invoice_date:     string | null;
    invoice_number:   string | null;
    category:         string | null;
    net_amount:       number | null;
    tax_amount:       number | null;
    gross_amount:     number | null;
    shipping_cost:    number | null;
    currency:         string;
    invoice_date_original: string | null;
    date_ambiguous: boolean;
    date_reviewed: boolean;
    net_amount_eur:   number | null;
    tax_amount_eur:   number | null;
    gross_amount_eur: number | null;
    shipping_cost_eur: number | null;
    exchange_rate:    number | null;
    exchange_rate_date: string | null;
    conversion_status: "not_needed" | "converted" | "manual" | "unavailable";
    notes:            string | null;
    source?:          string;
    file_object_path?: string | null;
    extraction_raw?:  unknown;
    items:            NormalizedItem[];
  };
} {
  const currency = typeof body.currency === "string"
    ? body.currency.trim().toUpperCase()
    : "EUR";

  if (!CURRENCY_RE.test(currency)) {
    return { error: `Invalid currency "${currency}". Must be a 3-letter ISO code (e.g. EUR, USD).` };
  }

  const invoice_date = body.invoice_date
    ? String(body.invoice_date).trim()
    : null;
  if (invoice_date && !isValidCalendarDate(invoice_date)) {
    return { error: `Invalid invoice_date "${invoice_date}". Must be a real calendar date in YYYY-MM-DD format.` };
  }

  const category = body.category ? String(body.category).trim() : null;
  if (category && !ALLOWED_CATEGORIES.has(category)) {
    return { error: `Invalid category "${category}".` };
  }

  const net_amount    = body.net_amount    != null ? toPositiveFloat(body.net_amount)    : null;
  const tax_amount    = body.tax_amount    != null ? toPositiveFloat(body.tax_amount)    : null;
  const gross_amount  = body.gross_amount  != null ? toPositiveFloat(body.gross_amount)  : null;
  const shipping_cost = body.shipping_cost != null ? toPositiveFloat(body.shipping_cost) : null;
  const net_amount_eur = body.net_amount_eur != null ? toPositiveFloat(body.net_amount_eur) : null;
  const tax_amount_eur = body.tax_amount_eur != null ? toPositiveFloat(body.tax_amount_eur) : null;
  const gross_amount_eur = body.gross_amount_eur != null ? toPositiveFloat(body.gross_amount_eur) : null;
  const shipping_cost_eur = body.shipping_cost_eur != null ? toPositiveFloat(body.shipping_cost_eur) : null;
  const exchange_rate = body.exchange_rate != null ? toExchangeRate(body.exchange_rate) : null;
  const exchangeRateDate = body.exchange_rate_date ? String(body.exchange_rate_date).trim() : null;
  const conversionStatus = body.conversion_status === "converted"
    || body.conversion_status === "manual"
    || body.conversion_status === "unavailable"
    ? body.conversion_status
    : "not_needed";
  const date_ambiguous = body.date_ambiguous === true;
  const date_reviewed = body.date_reviewed === true;

  if (body.net_amount    != null && body.net_amount    !== "" && net_amount    === null) return { error: "net_amount must be a non-negative finite number." };
  if (body.tax_amount    != null && body.tax_amount    !== "" && tax_amount    === null) return { error: "tax_amount must be a non-negative finite number." };
  if (body.gross_amount  != null && body.gross_amount  !== "" && gross_amount  === null) return { error: "gross_amount must be a non-negative finite number." };
  if (body.shipping_cost != null && body.shipping_cost !== "" && shipping_cost === null) return { error: "shipping_cost must be a non-negative finite number." };
  if (body.net_amount_eur != null && body.net_amount_eur !== "" && net_amount_eur === null) return { error: "net_amount_eur must be a non-negative finite number." };
  if (body.tax_amount_eur != null && body.tax_amount_eur !== "" && tax_amount_eur === null) return { error: "tax_amount_eur must be a non-negative finite number." };
  if (body.gross_amount_eur != null && body.gross_amount_eur !== "" && gross_amount_eur === null) return { error: "gross_amount_eur must be a non-negative finite number." };
  if (body.shipping_cost_eur != null && body.shipping_cost_eur !== "" && shipping_cost_eur === null) return { error: "shipping_cost_eur must be a non-negative finite number." };
  if (body.exchange_rate != null && body.exchange_rate !== "" && exchange_rate === null) return { error: "exchange_rate must be a non-negative finite number." };
  if (exchangeRateDate && !isValidCalendarDate(exchangeRateDate)) return { error: "exchange_rate_date must be a real calendar date in YYYY-MM-DD format." };
  if (date_ambiguous && !date_reviewed) return { error: "Ambiguous invoice dates must be reviewed before saving." };
  if (currency !== "EUR" && conversionStatus !== "unavailable") {
    const sourceAmounts = [
      ["net_amount", net_amount, net_amount_eur],
      ["tax_amount", tax_amount, tax_amount_eur],
      ["gross_amount", gross_amount, gross_amount_eur],
      ["shipping_cost", shipping_cost, shipping_cost_eur],
    ] as const;
    if (!exchange_rate || !exchangeRateDate || sourceAmounts.some(([, source, eur]) => source !== null && eur === null)) {
      return { error: "Foreign-currency expenses need a complete EUR snapshot, rate, and rate date before they can be marked converted." };
    }
  }

  const vendor_name    = typeof body.vendor_name    === "string" ? body.vendor_name.trim().slice(0, 500)    || null : null;
  const invoice_number = typeof body.invoice_number === "string" ? body.invoice_number.trim().slice(0, 200) || null : null;

  // Require at least one identifying field so blank records cannot be saved.
  const hasIdentifier = vendor_name !== null || invoice_date !== null
    || net_amount !== null || tax_amount !== null || gross_amount !== null;
  if (!hasIdentifier) {
    return { error: "At least one of vendor, date, or a monetary amount is required." };
  }

  // Cross-field amount consistency: when all three monetary fields are supplied,
  // gross must equal net + tax within ±0.02 EUR rounding tolerance.
  if (net_amount !== null && tax_amount !== null && gross_amount !== null) {
    if (Math.round(Math.abs(gross_amount - (net_amount + tax_amount)) * 100) > 2) {
      return {
        status: 422,
        error: `Amount mismatch: net (${net_amount}) + tax (${tax_amount}) = ${(net_amount + tax_amount).toFixed(2)}, but gross is ${gross_amount}. Please correct the amounts.`,
      };
    }
  }

  return {
    data: {
      vendor_name,
      invoice_date,
      invoice_number,
      category,
      net_amount,
      tax_amount,
      gross_amount,
      shipping_cost,
      currency,
      invoice_date_original: typeof body.invoice_date_original === "string"
        ? body.invoice_date_original.trim().slice(0, 100) || null
        : null,
      date_ambiguous,
      date_reviewed,
      net_amount_eur,
      tax_amount_eur,
      gross_amount_eur,
      shipping_cost_eur,
      exchange_rate,
      exchange_rate_date: exchangeRateDate,
      conversion_status: conversionStatus,
      notes:            typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) || null : null,
      source:           typeof body.source === "string" ? body.source : undefined,
      file_object_path: body.file_object_path != null ? String(body.file_object_path) : null,
      extraction_raw:   body.extraction_raw,
      items:            normalizeItems(body.items),
    },
  };
}

// ── POST /api/admin/expenses/upload-url ──────────────────────────────────────
// Issues a presigned GCS PUT URL exclusively for expense-receipt uploads.
// Objects are written under the "expense-receipts/<uuid>" subdir — a prefix
// owned entirely by this flow — so the cleanup endpoint can safely scope
// deletion to that namespace without touching unrelated uploads.
router.post(
  "/admin/expenses/upload-url",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const uploadURL = await objectStorage.getObjectEntityUploadURLWithSubdir("expense-receipts");
      const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
      res.json({ uploadURL, objectPath });
    } catch (err) {
      req.log?.error({ err }, "Failed to generate expense upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

// ── POST /api/admin/expenses/extract ──────────────────────────────────────────
// Must be registered BEFORE /:id routes.
router.post(
  "/admin/expenses/extract",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { fileObjectPath, mimeType } = req.body as {
      fileObjectPath?: string;
      mimeType?: string;
    };

    if (!fileObjectPath || !mimeType) {
      res.status(400).json({ error: "fileObjectPath and mimeType are required" });
      return;
    }

    const allowedMimes = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
    ];
    const normalizedMime = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
    if (!allowedMimes.includes(normalizedMime)) {
      res.status(400).json({ error: "Unsupported file type. Use PDF, PNG, or JPEG." });
      return;
    }

    // ── 1. Download the file from object storage ──────────────────────────────
    let fileBuffer: Buffer;
    try {
      const objectFile = await objectStorage.getObjectEntityFile(fileObjectPath);
      [fileBuffer] = await objectFile.download();
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        res.status(422).json({
          error: "The uploaded file could not be found in storage. Please upload the file again.",
        });
        return;
      }
      req.log?.error({ err }, "GCS download failed during expense extraction");
      res.status(422).json({
        error: "Could not retrieve the file from storage. Please try uploading again.",
      });
      return;
    }

    try {
      // Reject obviously unreadable files before sending to the AI model.
      // A valid PDF is at minimum a few hundred bytes; anything shorter is
      // either a zero-byte upload or a truncated/corrupt transfer.
      const MIN_FILE_BYTES = 64;
      if (fileBuffer.length === 0 || fileBuffer.length < MIN_FILE_BYTES) {
        res.status(422).json({
          error: "The file appears to be empty or unreadable. Please check the file and upload it again.",
        });
        return;
      }

      if (fileBuffer.length > 20 * 1024 * 1024) {
        res.status(400).json({ error: "File too large (max 20 MB)" });
        return;
      }

      // ── 2b. PDF integrity pre-check ──────────────────────────────────────────
      // A valid PDF must begin with the "%PDF-" signature.  If it doesn't,
      // the upload is corrupt or not actually a PDF — reject before the AI call.
      // Additionally, scan the trailer area for the /Encrypt dictionary entry,
      // which indicates the file is password-protected.
      if (normalizedMime === "application/pdf") {
        const header = fileBuffer.slice(0, 5).toString("latin1");
        if (header !== "%PDF-") {
          res.status(422).json({
            error: "The file appears to be empty or unreadable. Please check the file and upload it again.",
          });
          return;
        }

        // The /Encrypt dict appears near the start or end (trailer area).
        // Check both ends to handle large and small files efficiently.
        const CHECK_BYTES = 4096;
        const tailStart   = Math.max(0, fileBuffer.length - CHECK_BYTES);
        const searchZone  = Buffer.concat([
          fileBuffer.slice(0, CHECK_BYTES),
          fileBuffer.slice(tailStart),
        ]).toString("latin1");

        if (searchZone.includes("/Encrypt")) {
          res.json({
            fileObjectPath,
            extracted: {
              vendor_name: null, invoice_date: null, invoice_number: null,
              category: null, net_amount: null, tax_amount: null,
              gross_amount: null, shipping_cost: null, currency: "EUR",
              confidence: "low", items: [],
            },
            parseError:
              "The document appears to be password-protected. Please unlock the PDF and try again, or fill in the fields manually.",
          });
          return;
        }
      }

      const b64 = fileBuffer.toString("base64");

      // ── 3. Load product catalog for matching (parallel with file prep) ────────
      let catalog: CatalogProduct[] = [];
      try {
        const { rows } = await pool.query<CatalogProduct>(
          `SELECT id, sku, name_de, name_en FROM iroc_products ORDER BY sku`,
        );
        catalog = rows;
      } catch {
        // Non-fatal — extraction still works without matching
      }

      // ── 4. Call AI model — classify document-level errors separately ─────────
      // Some PDFs that pass the /Encrypt check are still unreadable (corrupt
      // cross-reference tables, unsupported encryption, etc.).  The AI model
      // may throw or return a textual explanation rather than JSON.
      // Intercept model-level errors so they get a helpful message, not a 500.
      let response: Awaited<ReturnType<typeof ai.models.generateContent>>;
      try {
        response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: normalizedMime, data: b64 } },
                { text: EXTRACT_SYSTEM_PROMPT },
              ],
            },
          ],
        });
      } catch (aiErr) {
        // Classify known document-processing failures into the targeted error.
        const aiMsg = aiErr instanceof Error ? aiErr.message : "";
        if (/password|encrypt|protect|cannot (process|read|open)|unable to (process|read)|corrupt|invalid pdf/i.test(aiMsg)) {
          res.json({
            fileObjectPath,
            extracted: {
              vendor_name: null, invoice_date: null, invoice_number: null,
              category: null, net_amount: null, tax_amount: null,
              gross_amount: null, shipping_cost: null, currency: "EUR",
              confidence: "low", items: [],
            },
            parseError:
              "The document may be password-protected or corrupt — no text could be extracted. Please unlock or repair the file and try again, or fill in the fields manually.",
          });
          return;
        }
        // Unknown AI error — propagate to the outer catch for a 500.
        throw aiErr;
      }

      const rawText = response.candidates?.[0]?.content?.parts
        ?.filter((p: { text?: string }) => p.text)
        .map((p: { text?: string }) => p.text)
        .join("") ?? "";

      // If the AI returned no text at all the document is likely password-protected
      // or too corrupt for the model to read — surface a targeted message.
      if (!rawText.trim()) {
        res.json({
          fileObjectPath,
          extracted: {
            vendor_name: null, invoice_date: null, invoice_number: null,
            category: null, net_amount: null, tax_amount: null,
            gross_amount: null, shipping_cost: null, currency: "EUR",
            confidence: "low", items: [],
          },
          parseError:
            "The document may be password-protected or corrupt — no text could be extracted. Please unlock or repair the file and try again, or fill in the fields manually.",
        });
        return;
      }

      const jsonText = rawText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();

      let extracted: Record<string, unknown>;
      try {
        extracted = JSON.parse(jsonText);
      } catch {
        // If the model returned a natural-language explanation about the document
        // being unreadable (e.g. "I cannot read this password-protected PDF"),
        // surface the targeted message instead of the generic parse-error fallback.
        const looksUnreadable =
          /password|encrypt|protect|cannot (read|process|extract)|corrupt|unable to/i.test(rawText);
        res.json({
          fileObjectPath,
          extracted: {
            vendor_name: null, invoice_date: null, invoice_number: null,
            category: null, net_amount: null, tax_amount: null,
            gross_amount: null, shipping_cost: null, currency: "EUR",
            confidence: "low", items: [],
          },
          parseError: looksUnreadable
            ? "The document may be password-protected or corrupt — no text could be extracted. Please unlock or repair the file and try again, or fill in the fields manually."
            : "Could not parse AI response. Please fill in the fields manually.",
        });
        return;
      }

      const sanitized = sanitizeExtracted(extracted);
      // Run product-name matching against the catalog
      const matchedItems = matchProductToItems(sanitized.items, catalog);

      res.json({
        fileObjectPath,
        extracted: { ...sanitized, items: matchedItems },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      req.log?.error({ err }, "Expense AI extraction failed");
      res.status(500).json({ error: `AI extraction failed: ${msg}` });
    }
  },
);

// ── GET /api/admin/expenses/orphan-sweep-stats ────────────────────────────────
// Returns the result of the last orphan sweep run (scanned, deleted, errors,
// last_run ISO timestamp).  Returns 204 when no sweep has run yet.
router.get(
  "/admin/expenses/orphan-sweep-stats",
  requireIrocAuth,
  async (_req: Request, res: Response): Promise<void> => {
    const raw = await getSetting("expense_orphan_sweep_last_result");
    if (!raw) { res.status(204).end(); return; }
    try {
      const stats = JSON.parse(raw) as {
        scanned: number;
        deleted: number;
        errors:  number;
        last_run: string;
      };
      res.json(stats);
    } catch {
      res.status(204).end();
    }
  },
);

// ── GET /api/admin/expenses/orphan-spike-settings ────────────────────────────
// Returns the configured spike-alert threshold for orphaned file deletions.
// Default is 5 when no admin has yet saved a custom value.
router.get(
  "/admin/expenses/orphan-spike-settings",
  requireIrocAuth,
  async (_req: Request, res: Response): Promise<void> => {
    const raw = await getSetting(SETTINGS_KEY_SPIKE);
    const threshold = raw !== null ? parseInt(raw, 10) : DEFAULT_SPIKE_THRESHOLD;
    res.json({ threshold: isNaN(threshold) ? DEFAULT_SPIKE_THRESHOLD : threshold });
  },
);

// ── POST /api/admin/expenses/orphan-spike-settings ───────────────────────────
// Saves the spike-alert threshold.  Must be a non-negative integer.
router.post(
  "/admin/expenses/orphan-spike-settings",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { threshold } = req.body as { threshold?: unknown };
    if (threshold === undefined || threshold === null) {
      res.status(400).json({ error: "threshold is required" });
      return;
    }
    const n = parseInt(String(threshold), 10);
    if (isNaN(n) || n < 0) {
      res.status(400).json({ error: "threshold must be a non-negative integer" });
      return;
    }
    await setSetting(SETTINGS_KEY_SPIKE, String(n));
    res.json({ threshold: n });
  },
);

// ── GET /api/admin/expenses/datev-settings ────────────────────────────────────
router.get(
  "/admin/expenses/datev-settings",
  requireIrocAuth,
  async (_req: Request, res: Response): Promise<void> => {
    const [rawMap, rawGegen] = await Promise.all([
      getSetting(SETTINGS_KEY_MAP),
      getSetting(SETTINGS_KEY_GEGEN),
    ]);
    let kontoMap = { ...DEFAULT_KONTO_MAP };
    if (rawMap) {
      try { kontoMap = { ...kontoMap, ...JSON.parse(rawMap) }; } catch { /* ignore */ }
    }
    res.json({ kontoMap, gegenKonto: rawGegen ?? DEFAULT_GEGEN_KONTO });
  },
);

// ── POST /api/admin/expenses/datev-settings ───────────────────────────────────
router.post(
  "/admin/expenses/datev-settings",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { kontoMap, gegenKonto } = req.body as {
      kontoMap?: Record<string, string>;
      gegenKonto?: string;
    };
    if (kontoMap) await setSetting(SETTINGS_KEY_MAP, JSON.stringify(kontoMap));
    if (gegenKonto) await setSetting(SETTINGS_KEY_GEGEN, gegenKonto.trim());
    res.json({ ok: true });
  },
);

// ── Shared: resolve settings + build DATEV CSV ────────────────────────────────

async function buildExpenseDatevCsv(rows: unknown[]): Promise<Buffer> {
  const unsafeExpense = (rows as Array<Record<string, unknown>>).find((row) => {
    if (row.currency === "EUR") return row.date_ambiguous === true && row.date_reviewed !== true;
    const hasSnapshot = (row.conversion_status === "converted" || row.conversion_status === "manual")
      && typeof row.exchange_rate === "string" && Number(row.exchange_rate) > 0
      && typeof row.exchange_rate_date === "string"
      && ["net_amount", "tax_amount", "gross_amount", "shipping_cost"].every((sourceKey) => {
        const eurKey = `${sourceKey}_eur`;
        return row[sourceKey] == null || row[eurKey] != null;
      });
    return !hasSnapshot || (row.date_ambiguous === true && row.date_reviewed !== true);
  });
  if (unsafeExpense) {
    throw new Error("Every foreign-currency expense needs a reviewed EUR conversion snapshot before DATEV export.");
  }
  const [rawMap, rawGegen] = await Promise.all([
    getSetting(SETTINGS_KEY_MAP),
    getSetting(SETTINGS_KEY_GEGEN),
  ]);
  let kontoMap = { ...DEFAULT_KONTO_MAP };
  if (rawMap) {
    try { kontoMap = { ...kontoMap, ...JSON.parse(rawMap) }; } catch { /* ignore */ }
  }
  const gegenKonto = rawGegen ?? DEFAULT_GEGEN_KONTO;

  // DATEV expects Windows-1252 encoding; we output UTF-8 with a BOM so modern
  // DATEV versions and Excel handle it correctly.
  const csv = buildDatevBuchungsstapelCsv(
    rows as Parameters<typeof buildDatevBuchungsstapelCsv>[0],
    kontoMap,
    gegenKonto,
  );
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  return Buffer.concat([bom, Buffer.from(csv, "utf8")]);
}

function datevCsvResponse(res: Response, body: Buffer): void {
  const filename = `DATEV_Ausgaben_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

// ── GET /api/admin/expenses/datev-export  (filter-based) ──────────────────────
router.get(
  "/admin/expenses/datev-export",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { from, to, category, vendor } = req.query as Record<string, string | undefined>;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (from)     { conditions.push(`invoice_date >= $${idx++}`); values.push(from); }
    if (to)       { conditions.push(`invoice_date <= $${idx++}`); values.push(to); }
    if (category && category !== "all") {
      conditions.push(`category = $${idx++}`);
      values.push(category);
    }
    if (vendor) {
      conditions.push(`vendor_name ILIKE $${idx++}`);
      values.push(`%${vendor}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    try {
      const { rows } = await pool.query(
        `SELECT vendor_name, invoice_date, invoice_number, category,
                net_amount, tax_amount, gross_amount, currency, notes,
                net_amount_eur, tax_amount_eur, gross_amount_eur, conversion_status, exchange_rate,
                exchange_rate_date, date_ambiguous, date_reviewed
         FROM iroc_expenses
         ${where}
         ORDER BY invoice_date ASC NULLS LAST, id ASC`,
        values,
      );
      const body = await buildExpenseDatevCsv(rows);
      datevCsvResponse(res, body);
    } catch (err) {
      req.log?.error({ err }, "Failed to build DATEV expense export (GET)");
      res.status(err instanceof Error && err.message.includes("EUR conversion snapshot") ? 422 : 500)
        .json({ error: err instanceof Error ? err.message : "Failed to build DATEV export" });
    }
  },
);

// ── POST /api/admin/expenses/datev-export  (selection-based) ─────────────────
// Used by the DATEV Export page when the admin picks individual expenses.
router.post(
  "/admin/expenses/datev-export",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { expenseIds } = req.body as { expenseIds?: unknown };

    if (!Array.isArray(expenseIds) || expenseIds.length === 0) {
      res.status(400).json({ error: "Select at least one expense." });
      return;
    }

    // Only accept integer IDs to prevent injection
    const ids = (expenseIds as unknown[]).map(id => parseInt(String(id), 10)).filter(n => !isNaN(n));
    if (ids.length === 0) {
      res.status(400).json({ error: "No valid expense IDs provided." });
      return;
    }

    try {
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await pool.query(
        `SELECT vendor_name, invoice_date, invoice_number, category,
                net_amount, tax_amount, gross_amount, currency, notes,
                net_amount_eur, tax_amount_eur, gross_amount_eur, conversion_status, exchange_rate,
                exchange_rate_date, date_ambiguous, date_reviewed
         FROM iroc_expenses
         WHERE id IN (${placeholders})
         ORDER BY invoice_date ASC NULLS LAST, id ASC`,
        ids,
      );

      if (rows.length === 0) {
        res.status(404).json({ error: "No expenses found for the given IDs." });
        return;
      }

      const body = await buildExpenseDatevCsv(rows);
      datevCsvResponse(res, body);
    } catch (err) {
      req.log?.error({ err }, "Failed to build DATEV expense export (POST)");
      res.status(err instanceof Error && err.message.includes("EUR conversion snapshot") ? 422 : 500)
        .json({ error: err instanceof Error ? err.message : "Failed to build DATEV export" });
    }
  },
);

// ── GET /api/admin/expenses ───────────────────────────────────────────────────
router.get(
  "/admin/expenses/recurring-schedules",
  requireIrocAuth,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const { rows } = await pool.query(
        `SELECT id, source_expense_id, interval_count, interval_unit, next_due_date, enabled, template, created_at
         FROM iroc_recurring_expense_schedules
         ORDER BY enabled DESC, next_due_date ASC, id ASC`,
      );
      res.json(rows);
    } catch (err) {
      _req.log?.error({ err }, "Failed to list recurring expense schedules");
      res.status(500).json({ error: "Failed to list recurring expense schedules" });
    }
  },
);

router.post(
  "/admin/expenses/recurring-schedules",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const sourceExpenseId = parseInt(String(req.body?.sourceExpenseId), 10);
    const intervalCount = Number(req.body?.intervalCount);
    const intervalUnit = typeof req.body?.intervalUnit === "string" ? req.body.intervalUnit : "";
    const firstDueDate = typeof req.body?.firstDueDate === "string" ? req.body.firstDueDate : "";
    if (!Number.isInteger(sourceExpenseId) || !Number.isInteger(intervalCount) || intervalCount < 1 || intervalCount > 999 || !RECURRING_UNITS.has(intervalUnit) || !isValidCalendarDate(firstDueDate)) {
      res.status(400).json({ error: "A valid source expense, interval, unit, and first due date are required." });
      return;
    }
    try {
      const { rows: sourceRows } = await pool.query(
        `SELECT vendor_name, category, net_amount, tax_amount, gross_amount, shipping_cost,
                currency, notes
         FROM iroc_expenses WHERE id=$1`,
        [sourceExpenseId],
      );
      if (!sourceRows[0]) { res.status(404).json({ error: "Source expense not found." }); return; }
      const source = sourceRows[0];
      // Do not carry invoice IDs, files, item/stock data, or foreign-currency
      // snapshots forward; every confirmed occurrence must be reviewed anew.
      const template = {
        vendor_name: source.vendor_name, category: source.category,
        net_amount: source.net_amount, tax_amount: source.tax_amount,
        gross_amount: source.gross_amount, shipping_cost: source.shipping_cost,
        currency: source.currency, notes: source.notes,
      };
      const { rows } = await pool.query(
        `INSERT INTO iroc_recurring_expense_schedules
           (source_expense_id, cadence, interval_count, interval_unit, template, next_due_date, enabled, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,true,NOW(),NOW())
         RETURNING id, source_expense_id, interval_count, interval_unit, next_due_date, enabled, template, created_at`,
        [sourceExpenseId, `${intervalCount}_${intervalUnit}`, intervalCount, intervalUnit, JSON.stringify(template), firstDueDate],
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      req.log?.error({ err }, "Failed to create recurring expense schedule");
      res.status(500).json({ error: "Failed to create recurring expense schedule" });
    }
  },
);

router.put(
  "/admin/expenses/recurring-schedules/:id",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    const enabled = req.body?.enabled;
    const nextDueDate = req.body?.nextDueDate;
    const intervalCount = req.body?.intervalCount;
    const intervalUnit = req.body?.intervalUnit;
    if (!Number.isInteger(id) || (enabled !== undefined && typeof enabled !== "boolean")
      || (nextDueDate !== undefined && (!isValidCalendarDate(String(nextDueDate))))
      || (intervalCount !== undefined && (!Number.isInteger(intervalCount) || intervalCount < 1 || intervalCount > 999))
      || (intervalUnit !== undefined && (typeof intervalUnit !== "string" || !RECURRING_UNITS.has(intervalUnit)))) {
      res.status(400).json({ error: "Invalid recurring schedule update." }); return;
    }
    const { rows } = await pool.query(
      `UPDATE iroc_recurring_expense_schedules
       SET enabled=COALESCE($1, enabled), next_due_date=COALESCE($2, next_due_date),
           interval_count=COALESCE($3, interval_count), interval_unit=COALESCE($4, interval_unit),
           cadence=CONCAT(COALESCE($3, interval_count), '_', COALESCE($4, interval_unit)), updated_at=NOW()
       WHERE id=$5
       RETURNING id, source_expense_id, interval_count, interval_unit, next_due_date, enabled, template, created_at`,
      [enabled ?? null, nextDueDate ?? null, intervalCount ?? null, intervalUnit ?? null, id],
    );
    if (!rows[0]) { res.status(404).json({ error: "Recurring schedule not found." }); return; }
    res.json(rows[0]);
  },
);

router.delete(
  "/admin/expenses/recurring-schedules/:id",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id." }); return; }
    const result = await pool.query("DELETE FROM iroc_recurring_expense_schedules WHERE id=$1", [id]);
    if (result.rowCount === 0) { res.status(404).json({ error: "Recurring schedule not found." }); return; }
    res.status(204).end();
  },
);

router.post(
  "/admin/expenses/recurring-schedules/:id/confirm",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id." }); return; }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT id, interval_count, interval_unit, next_due_date, template FROM iroc_recurring_expense_schedules
         WHERE id=$1 AND enabled=true FOR UPDATE`,
        [id],
      );
      const schedule = rows[0];
      if (!schedule) { await client.query("ROLLBACK"); res.status(404).json({ error: "Active recurring schedule not found." }); return; }
      const dueDate = String(schedule.next_due_date).slice(0, 10);
      const nextDueDate = nextRecurringDueDate(dueDate, Number(schedule.interval_count), schedule.interval_unit);
      await client.query(
        "UPDATE iroc_recurring_expense_schedules SET next_due_date=$1, updated_at=NOW() WHERE id=$2",
        [nextDueDate, id],
      );
      await client.query("COMMIT");
      res.json({ template: { ...schedule.template, invoice_date: dueDate, invoice_number: "", source: "manual" }, nextDueDate });
    } catch (err) {
      await client.query("ROLLBACK");
      req.log?.error({ err }, "Failed to confirm recurring expense");
      res.status(500).json({ error: "Failed to confirm recurring expense" });
    } finally { client.release(); }
  },
);

router.get(
  "/admin/expenses",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { from, to, category, vendor } = req.query as Record<string, string | undefined>;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (from) { conditions.push(`invoice_date >= $${idx++}`); values.push(from); }
    if (to)   { conditions.push(`invoice_date <= $${idx++}`); values.push(to); }
    if (category && category !== "all") {
      conditions.push(`category = $${idx++}`);
      values.push(category);
    }
    if (vendor) {
      conditions.push(`vendor_name ILIKE $${idx++}`);
      values.push(`%${vendor}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    try {
      const { rows } = await pool.query(
        `SELECT id, vendor_name, invoice_date, invoice_number, category,
                net_amount, tax_amount, gross_amount, shipping_cost, currency,
                invoice_date_original, date_ambiguous, date_reviewed, net_amount_eur, tax_amount_eur, gross_amount_eur,
                shipping_cost_eur, exchange_rate, exchange_rate_date, conversion_status,
                source, file_object_path, notes, created_at, updated_at
         FROM iroc_expenses
         ${where}
         ORDER BY invoice_date DESC NULLS LAST, created_at DESC`,
        values,
      );
      res.json(rows);
    } catch (err) {
      req.log?.error({ err }, "Failed to list expenses");
      res.status(500).json({ error: "Failed to list expenses" });
    }
  },
);

// ── GET /api/admin/expenses/:id/items ────────────────────────────────────────
router.get(
  "/admin/expenses/:id/items",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    try {
      const { rows } = await pool.query(
        `SELECT i.id, i.expense_id, i.product_name_raw, i.product_name_local,
                i.proposed_product_id, i.lot_number, i.quantity, i.unit_price,
                 i.discount_rate, i.line_total, i.measurement_original, i.weight_kg,
                 i.length_cm, i.width_cm, i.height_cm, i.sort_order,
                p.sku AS proposed_sku, p.name_de AS proposed_name_de
         FROM iroc_expense_items i
         LEFT JOIN iroc_products p ON p.id = i.proposed_product_id
         WHERE i.expense_id = $1
         ORDER BY i.sort_order, i.id`,
        [id],
      );
      res.json(rows);
    } catch (err) {
      req.log?.error({ err }, "Failed to list expense items");
      res.status(500).json({ error: "Failed to list expense items" });
    }
  },
);

// ── POST /api/admin/expenses ──────────────────────────────────────────────────
router.post(
  "/admin/expenses",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as Record<string, unknown>;
    const skipDuplicateCheck = body.skipDuplicateCheck === true;

    const v = validateAndNormalizeBody(body);
    if (v.error) { res.status(v.status ?? 400).json({ error: v.error }); return; }
    const d = v.data!;

    try {
      // ── Duplicate check ─────────────────────────────────────────────────────
      // When all three key fields are present and the caller has not explicitly
      // opted out, look for an existing row with the same combination.  The
      // partial index iroc_expenses_dedup_idx makes this lookup cheap.
      if (!skipDuplicateCheck && d.invoice_number && d.vendor_name && d.invoice_date) {
        const { rows: dupRows } = await pool.query(
          `SELECT id, vendor_name, invoice_date, invoice_number, gross_amount, currency
           FROM iroc_expenses
           WHERE invoice_number = $1
             AND vendor_name    = $2
             AND invoice_date   = $3
           LIMIT 1`,
          [d.invoice_number, d.vendor_name, d.invoice_date],
        );
        if (dupRows.length > 0) {
          res.status(409).json({
            error: "duplicate",
            message: "An expense with this invoice number, vendor, and date already exists.",
            duplicate: dupRows[0],
          });
          return;
        }
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          `INSERT INTO iroc_expenses
              (vendor_name, invoice_date, invoice_date_original, date_ambiguous, date_reviewed, invoice_number, category,
               net_amount, tax_amount, gross_amount, shipping_cost, currency,
               net_amount_eur, tax_amount_eur, gross_amount_eur, shipping_cost_eur,
               exchange_rate, exchange_rate_date, conversion_status,
                conversion_checked_at,
               source, file_object_path, extraction_raw, notes,
              created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                    CASE WHEN $19 IN ('converted','manual','not_needed') THEN NOW() ELSE NULL END,
                    $20,$21,$22,$23,NOW(),NOW())
           RETURNING id, vendor_name, invoice_date, invoice_number, category,
                      net_amount, tax_amount, gross_amount, shipping_cost, currency,
                      invoice_date_original, date_ambiguous, date_reviewed, net_amount_eur, tax_amount_eur, gross_amount_eur,
                      shipping_cost_eur, exchange_rate, exchange_rate_date, conversion_status,
                     source, file_object_path, notes, created_at, updated_at`,
          [
            d.vendor_name, d.invoice_date, d.invoice_date_original, d.date_ambiguous, d.date_reviewed, d.invoice_number, d.category,
            d.net_amount, d.tax_amount, d.gross_amount, d.shipping_cost,
            d.currency,
            d.net_amount_eur, d.tax_amount_eur, d.gross_amount_eur, d.shipping_cost_eur,
            d.exchange_rate, d.exchange_rate_date, d.conversion_status,
            d.source ?? "manual",
            d.file_object_path ?? null,
            d.extraction_raw ? JSON.stringify(d.extraction_raw) : null,
            d.notes,
          ],
        );
        const expenseId = rows[0].id as number;

        if (d.items.length > 0) {
          for (const item of d.items) {
            const { rows: itemRows } = await client.query(
              `INSERT INTO iroc_expense_items
                 (expense_id, product_name_raw, product_name_local, proposed_product_id,
                 lot_number, quantity, unit_price, discount_rate, line_total,
                 measurement_original, weight_kg, length_cm, width_cm, height_cm, sort_order,
                  created_at, updated_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
               RETURNING id`,
              [
                expenseId, item.product_name_raw, item.product_name_local,
                item.proposed_product_id, item.lot_number, item.quantity,
                item.unit_price, item.discount_rate, item.line_total,
                item.measurement_original, item.weight_kg, item.length_cm, item.width_cm, item.height_cm,
                item.sort_order,
              ],
            );
            // Auto-create a pending inventory lot for matched items
            if (item.proposed_product_id) {
              const lotNum = item.lot_number?.trim() || `EXP-${expenseId}-${itemRows[0].id}`;
              const purchaseDate = d.invoice_date ?? new Date().toISOString().slice(0, 10);
              const { rows: lotRows } = await client.query(
                `INSERT INTO iroc_inventory_lots
                   (product_id, lot_number, purchase_date, quantity_received,
                    description, status, created_at, updated_at)
                 VALUES ($1,$2,$3,$4,$5,'pending',NOW(),NOW())
                 RETURNING id`,
                [
                  item.proposed_product_id,
                  lotNum,
                  purchaseDate,
                  Math.round(Number(item.quantity ?? 0)),
                  `From expense: ${d.vendor_name ?? ""} ${d.invoice_number ?? ""}`.trim(),
                ],
              );
              await client.query(
                `UPDATE iroc_expense_items SET inventory_lot_id=$1 WHERE id=$2`,
                [lotRows[0].id, itemRows[0].id],
              );
            }
          }
        }

        await client.query("COMMIT");
        res.status(201).json({ ...rows[0], items: d.items });
      } catch (innerErr) {
        await client.query("ROLLBACK");
        throw innerErr;
      } finally {
        client.release();
      }
    } catch (err) {
      req.log?.error({ err }, "Failed to create expense");
      res.status(500).json({ error: "Failed to create expense" });
    }
  },
);

// ── PUT /api/admin/expenses/:id ───────────────────────────────────────────────
router.put(
  "/admin/expenses/:id",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const v = validateAndNormalizeBody(req.body as Record<string, unknown>);
    if (v.error) { res.status(v.status ?? 400).json({ error: v.error }); return; }
    const d = v.data!;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `UPDATE iroc_expenses
          SET vendor_name=$1, invoice_date=$2, invoice_date_original=$3, date_ambiguous=$4, date_reviewed=$5, invoice_number=$6,
              category=$7, net_amount=$8, tax_amount=$9, gross_amount=$10,
              shipping_cost=$11, currency=$12, net_amount_eur=$13, tax_amount_eur=$14,
              gross_amount_eur=$15, shipping_cost_eur=$16, exchange_rate=$17,
              exchange_rate_date=$18, conversion_status=$19,
              conversion_checked_at=CASE WHEN $19 IN ('converted','manual','not_needed') THEN NOW() ELSE NULL END,
              notes=$20, updated_at=NOW()
          WHERE id=$21
         RETURNING id, vendor_name, invoice_date, invoice_number, category,
                    net_amount, tax_amount, gross_amount, shipping_cost, currency,
                    invoice_date_original, date_ambiguous, date_reviewed, net_amount_eur, tax_amount_eur, gross_amount_eur,
                    shipping_cost_eur, exchange_rate, exchange_rate_date, conversion_status,
                   source, file_object_path, notes, created_at, updated_at`,
        [
          d.vendor_name, d.invoice_date, d.invoice_date_original, d.date_ambiguous, d.date_reviewed, d.invoice_number, d.category,
          d.net_amount, d.tax_amount, d.gross_amount, d.shipping_cost,
          d.currency, d.net_amount_eur, d.tax_amount_eur, d.gross_amount_eur,
          d.shipping_cost_eur, d.exchange_rate, d.exchange_rate_date, d.conversion_status,
          d.notes, id,
        ],
      );
      if (rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Not found" });
        return;
      }

      // Drop pending inventory lots that belonged to the old items, then replace
      const { rows: oldItems } = await client.query(
        `SELECT inventory_lot_id FROM iroc_expense_items
         WHERE expense_id=$1 AND inventory_lot_id IS NOT NULL`,
        [id],
      );
      if (oldItems.length > 0) {
        const lotIds = oldItems.map((r: { inventory_lot_id: number }) => r.inventory_lot_id);
        await client.query(
          `DELETE FROM iroc_inventory_lots WHERE id = ANY($1) AND status = 'pending'`,
          [lotIds],
        );
      }
      await client.query("DELETE FROM iroc_expense_items WHERE expense_id=$1", [id]);

      for (const item of d.items) {
        const { rows: itemRows } = await client.query(
          `INSERT INTO iroc_expense_items
             (expense_id, product_name_raw, product_name_local, proposed_product_id,
               lot_number, quantity, unit_price, discount_rate, line_total,
               measurement_original, weight_kg, length_cm, width_cm, height_cm, sort_order,
              created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
           RETURNING id`,
          [
            id, item.product_name_raw, item.product_name_local,
            item.proposed_product_id, item.lot_number, item.quantity,
            item.unit_price, item.discount_rate, item.line_total,
            item.measurement_original, item.weight_kg, item.length_cm, item.width_cm, item.height_cm,
            item.sort_order,
          ],
        );
        if (item.proposed_product_id) {
          const lotNum = item.lot_number?.trim() || `EXP-${id}-${itemRows[0].id}`;
          const purchaseDate = d.invoice_date ?? new Date().toISOString().slice(0, 10);
          const { rows: lotRows } = await client.query(
            `INSERT INTO iroc_inventory_lots
               (product_id, lot_number, purchase_date, quantity_received,
                description, status, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,'pending',NOW(),NOW())
             RETURNING id`,
            [
              item.proposed_product_id,
              lotNum,
              purchaseDate,
              Math.round(Number(item.quantity ?? 0)),
              `From expense: ${d.vendor_name ?? ""} ${d.invoice_number ?? ""}`.trim(),
            ],
          );
          await client.query(
            `UPDATE iroc_expense_items SET inventory_lot_id=$1 WHERE id=$2`,
            [lotRows[0].id, itemRows[0].id],
          );
        }
      }

      await client.query("COMMIT");
      res.json({ ...rows[0], items: d.items });
    } catch (err) {
      await client.query("ROLLBACK");
      req.log?.error({ err }, "Failed to update expense");
      res.status(500).json({ error: "Failed to update expense" });
    } finally {
      client.release();
    }
  },
);

// ── DELETE /api/admin/expenses/file ──────────────────────────────────────────
// Cleanup endpoint: deletes an orphaned GCS file when the admin closes the
// confirmation modal without saving.  Must be registered BEFORE /:id so that
// Express does not try to parse "file" as an integer expense id.
//
// Security guards:
//   1. Path must start with /objects/uploads/ — the prefix written by the
//      expense presigned-URL flow.  Unrelated private objects are rejected.
//   2. Path must NOT be referenced by any saved iroc_expenses row — prevents
//      deleting source documents that are already linked to an expense record.
router.delete(
  "/admin/expenses/file",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { fileObjectPath } = req.body as { fileObjectPath?: string };

    if (!fileObjectPath || typeof fileObjectPath !== "string") {
      res.status(400).json({ error: "fileObjectPath is required" });
      return;
    }

    // Guard 1: only paths under the expense-receipts prefix are eligible.
    // This prefix is exclusively created by POST /api/admin/expenses/upload-url,
    // so it cannot be confused with generic uploads or other domain objects.
    if (!fileObjectPath.startsWith("/objects/expense-receipts/")) {
      res.status(403).json({
        error: "Only paths under /objects/expense-receipts/ may be deleted via this endpoint.",
      });
      return;
    }

    // Guard 2: reject deletion of any file already saved to an expense record.
    const { rows: linked } = await pool.query(
      "SELECT id FROM iroc_expenses WHERE file_object_path = $1 LIMIT 1",
      [fileObjectPath],
    );
    if (linked.length > 0) {
      res.status(409).json({
        error: "This file is already linked to a saved expense and cannot be deleted here.",
      });
      return;
    }

    try {
      const objectFile = await objectStorage.getObjectEntityFile(fileObjectPath);
      await objectFile.delete();
      res.status(204).end();
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        // Already gone — treat as success so the UI can clear cleanly.
        res.status(204).end();
        return;
      }
      req.log?.error({ err }, "Failed to delete orphaned expense file");
      res.status(500).json({ error: "Failed to delete file" });
    }
  },
);

// ── DELETE /api/admin/expenses/:id ────────────────────────────────────────────
router.delete(
  "/admin/expenses/:id",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    try {
      await pool.query("DELETE FROM iroc_expenses WHERE id=$1", [id]);
      res.status(204).end();
    } catch (err) {
      req.log?.error({ err }, "Failed to delete expense");
      res.status(500).json({ error: "Failed to delete expense" });
    }
  },
);

// ── GET /api/admin/expenses/:id/file ─────────────────────────────────────────
// Auth-gated download of the source invoice/receipt document.
// Never redirects to a public GCS URL — always proxied through this handler.
router.get(
  "/admin/expenses/:id/file",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    try {
      const { rows } = await pool.query(
        "SELECT file_object_path FROM iroc_expenses WHERE id=$1",
        [id],
      );
      if (rows.length === 0) { res.status(404).json({ error: "Expense not found" }); return; }

      const filePath: string | null = rows[0].file_object_path;
      if (!filePath) { res.status(404).json({ error: "No source file for this expense" }); return; }

      const objectFile = await objectStorage.getObjectEntityFile(filePath);
      const response   = await objectStorage.downloadObject(objectFile, 0); // no public cache

      // Force no-store so the authenticated stream is never cached by a shared proxy
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Disposition", "inline");
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "cache-control") res.setHeader(key, value);
      });
      res.status(response.status);

      if (response.body) {
        Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
      } else {
        res.end();
      }
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "File not found in storage" }); return;
      }
      req.log?.error({ err }, "Failed to serve expense file");
      res.status(500).json({ error: "Failed to serve expense file" });
    }
  },
);

// ── GET /api/admin/inventory-lots/pending ─────────────────────────────────────
// Returns all pending inventory lots (status='pending') with product and
// expense context so the dashboard can show what is still in transit.
router.get(
  "/admin/inventory-lots/pending",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { rows } = await pool.query(`
        SELECT
          il.id           AS lot_id,
          il.product_id,
          il.lot_number,
          il.purchase_date,
          il.quantity_received,
          il.description,
          il.status,
          il.created_at,
          p.sku           AS product_sku,
          p.name_de       AS product_name_de,
          p.name_en       AS product_name_en,
          ei.id           AS expense_item_id,
          ei.unit_price,
          ei.line_total,
          e.id            AS expense_id,
          e.vendor_name,
          e.invoice_number,
          e.invoice_date
        FROM iroc_inventory_lots il
        JOIN iroc_products p ON p.id = il.product_id
        LEFT JOIN iroc_expense_items ei ON ei.inventory_lot_id = il.id
        LEFT JOIN iroc_expenses e ON e.id = ei.expense_id
        WHERE il.status = 'pending'
        ORDER BY il.created_at DESC
      `);
      res.json(rows);
    } catch (err) {
      req.log?.error({ err }, "Failed to fetch pending inventory lots");
      res.status(500).json({ error: "Failed to fetch pending inventory lots" });
    }
  },
);

// ── PATCH /api/admin/inventory-lots/:id/receive ───────────────────────────────
// Marks a pending lot as 'in_house' and increments the product's stock_quantity.
router.patch(
  "/admin/inventory-lots/:id/receive",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const lotId = parseInt(String(req.params.id), 10);
    if (isNaN(lotId)) { res.status(400).json({ error: "Invalid id" }); return; }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: lotRows } = await client.query(
        `UPDATE iroc_inventory_lots
         SET status='in_house', updated_at=NOW()
         WHERE id=$1 AND status='pending'
         RETURNING id, product_id, quantity_received, lot_number`,
        [lotId],
      );
      if (lotRows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Lot not found or already received" });
        return;
      }

      const { product_id, quantity_received } = lotRows[0] as {
        product_id: number;
        quantity_received: number;
        lot_number: string;
      };

      await client.query(
        `UPDATE iroc_products
         SET stock_quantity = stock_quantity + $1, updated_at=NOW()
         WHERE id=$2`,
        [quantity_received, product_id],
      );

      await client.query("COMMIT");
      res.json({ ok: true, lot: lotRows[0] });
    } catch (err) {
      await client.query("ROLLBACK");
      req.log?.error({ err }, "Failed to receive inventory lot");
      res.status(500).json({ error: "Failed to receive inventory lot" });
    } finally {
      client.release();
    }
  },
);

export default router;
