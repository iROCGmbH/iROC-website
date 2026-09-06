/**
 * DATEV Export routes
 *
 * GET  /iroc/datev/invoices   — list sent/paid invoices for a date range
 * POST /iroc/datev/export     — build ZIP (XML + PDFs), send via email
 */
import { Router, type Request, type Response } from "express";
import { db, pool } from "@workspace/db";
import {
  irocInvoices,
  irocInvoiceItems,
  irocCustomers,
  websiteCustomersTable,
  settingsTable,
  datevExports,
  datevExportItems,
} from "@workspace/db";
import { and, eq, gte, ilike, inArray, lt, lte, desc, ne } from "drizzle-orm";
import { sql } from "drizzle-orm";
import JSZip from "jszip";
import { buildDatevXml, type DatevInvoice } from "../lib/datev-xml";
import { sendEmail } from "../lib/email";
import {
  InvoiceComplianceValidationError,
  getInvoiceContactSettings,
  renderHybridInvoicePdf,
  requireIrocAuth,
  wcToCustomerShape,
  type PdfCustomer,
} from "./iroc";

const router = Router();

// ── Sentinel error for rolling back a transaction on a duplicate-guard conflict ─
// Throwing inside a Drizzle transaction guarantees a real ROLLBACK (a normal
// return would commit).  We catch this specific type outside the transaction
// and convert it to a 409 response; all other errors propagate as 500.
class ConflictError extends Error {
  constructor(public readonly invoiceNumbers: string[]) {
    super("already_exported");
    this.name = "ConflictError";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fetch a setting value, returning empty string when not set. */
async function getSetting(key: string): Promise<string> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value?.trim() ?? "";
}

/** Upsert a setting value. */
async function setSetting(key: string, value: string): Promise<void> {
  const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  if (existing) {
    await db.update(settingsTable).set({ value, updatedAt: new Date() }).where(eq(settingsTable.key, key));
  } else {
    await db.insert(settingsTable).values({ key, value, updatedAt: new Date() });
  }
}

// ── GET /iroc/datev/invoices?from=YYYY-MM-DD&to=YYYY-MM-DD ───────────────────
router.get(
  "/iroc/datev/invoices",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const from = req.query.from as string | undefined;
    const to   = req.query.to   as string | undefined;

    const conditions = [
      inArray(irocInvoices.status, ["sent", "paid"]),
      ne(irocInvoices.invoiceType, "delivery-note"),
      from ? gte(irocInvoices.issueDate, from) : undefined,
      to   ? lte(irocInvoices.issueDate, to)   : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);

    const rows = await db
      .select({
        invoice:     irocInvoices,
        wcFirstName: websiteCustomersTable.firstName,
        wcLastName:  websiteCustomersTable.lastName,
        wcEmail:     websiteCustomersTable.email,
        legacyName:  irocCustomers.name,
      })
      .from(irocInvoices)
      .leftJoin(websiteCustomersTable, eq(irocInvoices.websiteCustomerId, websiteCustomersTable.id))
      .leftJoin(irocCustomers, eq(irocInvoices.customerId, irocCustomers.id))
      .where(and(...conditions))
      .orderBy(irocInvoices.issueDate);

    res.json(
      rows.map((r) => ({
        id:            r.invoice.id,
        invoiceNumber: r.invoice.invoiceNumber,
        issueDate:     r.invoice.issueDate,
        total:         r.invoice.total.toString(),
        vatRate:       r.invoice.vatRate.toString(),
        status:        r.invoice.status,
        invoiceType:   r.invoice.invoiceType,
        customerName:
          [r.wcFirstName, r.wcLastName].filter(Boolean).join(" ") ||
          r.wcEmail ||
          r.legacyName ||
          "Unknown",
      })),
    );
  },
);

// ── GET /iroc/datev/settings ─────────────────────────────────────────────────
router.get(
  "/iroc/datev/settings",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const email = await getSetting("datev_bookkeeper_email");
    res.json({ bookkeeperEmail: email });
  },
);

// ── POST /iroc/datev/settings ────────────────────────────────────────────────
router.post(
  "/iroc/datev/settings",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const { bookkeeperEmail } = req.body as { bookkeeperEmail?: string };
    if (bookkeeperEmail !== undefined) {
      await setSetting("datev_bookkeeper_email", bookkeeperEmail.trim());
    }
    res.json({ ok: true });
  },
);

// ── Shared: build DATEV ZIP from invoice IDs ─────────────────────────────────

interface BuildZipResult {
  zipBuffer: Buffer;
  datevInvoices: DatevInvoice[];
  exportedInvoiceIds: number[];
  skipped: string[];
  zipFilename: string;
}

async function buildDatevZip(
  invoiceIds: number[],
  exemptionReasons?: Record<number, string>,
): Promise<BuildZipResult | { error: string; status: number; details?: string[] }> {
  // Fetch invoices
  const invoiceRows = await db
    .select({
      invoice:     irocInvoices,
      wcFirstName: websiteCustomersTable.firstName,
      wcLastName:  websiteCustomersTable.lastName,
      wcEmail:     websiteCustomersTable.email,
      wcUstIdNr:   websiteCustomersTable.ustIdNr,
      legacyName:  irocCustomers.name,
      legacyVatId: irocCustomers.vatId,
    })
    .from(irocInvoices)
    .leftJoin(websiteCustomersTable, eq(irocInvoices.websiteCustomerId, websiteCustomersTable.id))
    .leftJoin(irocCustomers, eq(irocInvoices.customerId, irocCustomers.id))
    .where(inArray(irocInvoices.id, invoiceIds));

  if (invoiceRows.length === 0) {
    return { error: "No invoices found for the given IDs.", status: 404 };
  }

  // Unconditionally exclude delivery-note invoices.
  // This filter runs regardless of the force flag — delivery notes must never
  // appear in the accounting ZIP even when the duplicate guard is bypassed.
  const accountingRows = invoiceRows.filter(
    (r) => r.invoice.invoiceType !== "delivery-note",
  );

  // Validate each accounting invoice
  const validationErrors: string[] = [];
  for (const r of accountingRows) {
    const inv = r.invoice;
    if (!inv.issueDate)  validationErrors.push(`${inv.invoiceNumber}: missing issue date.`);
    if (!inv.vatRate)    validationErrors.push(`${inv.invoiceNumber}: missing VAT rate.`);
    const vatRate = parseFloat(inv.vatRate.toString());
    const exemptionReason = exemptionReasons?.[inv.id];
    if (
      vatRate === 0 &&
      (typeof exemptionReason !== "string" || !exemptionReason.trim())
    ) {
      validationErrors.push(
        `${inv.invoiceNumber}: 0 % VAT invoices require a DATEV exemption reason. ` +
        `/ Rechnungen mit 0 % MwSt. benötigen einen DATEV-Steuerbefreiungsgrund.`,
      );
    }
  }
  if (validationErrors.length > 0) {
    return { error: "Validation failed", status: 422, details: validationErrors };
  }

  // Build ZIP in memory
  const zip = new JSZip();
  const datevInvoices: DatevInvoice[] = [];
  const exportedInvoiceIds: number[] = [];
  const skipped: string[] = [];
  // Resolve the configured contact once for the whole archive.  Every PDF uses
  // the same saved invoice contact without issuing one settings query per row.
  const invoiceContact = await getInvoiceContactSettings(async () => {
    const result = await pool.query<{ key: string; value: string | null }>(
      "SELECT key, value FROM settings WHERE key = ANY($1::text[])",
      [["invoice_contact_email", "invoice_contact_phone"]],
    );
    return result.rows;
  });

  for (const r of accountingRows) {
    const inv = r.invoice;

    // Resolve customer
    let customer: PdfCustomer | undefined;
    // A correction intentionally has no mutable customer foreign key. Its
    // normalized buyer snapshot is the legal record and must travel with the
    // credit document into DATEV, even after the original customer changes.
    if (inv.correctionOfInvoiceId != null && inv.customerSnapshot && typeof inv.customerSnapshot === "object") {
      customer = inv.customerSnapshot as PdfCustomer;
    } else if (inv.websiteCustomerId) {
      const [wc] = await db
        .select()
        .from(websiteCustomersTable)
        .where(eq(websiteCustomersTable.id, inv.websiteCustomerId));
      if (wc) customer = wcToCustomerShape(wc);
    }
    if (!customer && inv.customerId) {
      const [ic] = await db
        .select()
        .from(irocCustomers)
        .where(eq(irocCustomers.id, inv.customerId));
      if (ic) customer = ic;
    }

    // Fetch line items
    const items = await db
      .select()
      .from(irocInvoiceItems)
      .where(eq(irocInvoiceItems.invoiceId, inv.id));

    if (items.length === 0) {
      // A selected batch has historically been best-effort: one incomplete
      // invoice must not prevent the remaining valid invoices from reaching
      // DATEV.  It is never rendered as a visual-only PDF.
      skipped.push(`${inv.invoiceNumber}: an EN 16931 invoice requires at least one line item.`);
      continue;
    }

    // Every PDF in a DATEV archive is an official invoice and therefore must
    // be the same PDF/A-3 Factur-X/EN 16931 document used by the invoice route.
    // Never fall back to the visual-only renderer here.
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderHybridInvoicePdf(inv, customer, items, invoiceContact);
    } catch (error) {
      if (error instanceof InvoiceComplianceValidationError) {
        skipped.push(`${inv.invoiceNumber}: ${error.message}`);
        continue;
      }
      throw error;
    }
    const pdfFilename = `${inv.invoiceNumber}.pdf`;
    zip.file(pdfFilename, pdfBuffer);

    // Resolve customer display name and VAT ID
    const snapshot = customer && inv.correctionOfInvoiceId != null
      ? customer as PdfCustomer & { name?: string | null; vatId?: string | null }
      : undefined;
    const customerName =
      snapshot?.name ||
      [r.wcFirstName, r.wcLastName].filter(Boolean).join(" ") ||
      r.wcEmail ||
      r.legacyName ||
      "Unknown";
    const customerVatId = snapshot?.vatId || r.wcUstIdNr || r.legacyVatId || null;

    exportedInvoiceIds.push(inv.id);
    const vatRate = parseFloat(inv.vatRate.toString());
    const exemptionReason = vatRate === 0
      ? (
        typeof exemptionReasons?.[inv.id] === "string"
          ? (exemptionReasons[inv.id].trim() || undefined)
          : undefined
      )
      : undefined;
    datevInvoices.push({
      invoiceNumber:  inv.invoiceNumber,
      issueDate:      inv.issueDate,
      totalGross:     parseFloat(inv.total.toString()),
      vatRate,
      customerName,
      customerVatId,
      pdfFilename,
      exemptionReason,
      items: items.map((li) => ({
        productName: li.productName,
        quantity:    li.quantity,
        lineTotal:   parseFloat(li.lineTotal.toString()),
      })),
    });
  }

  if (datevInvoices.length === 0) {
    const complianceFailures = skipped.filter(
      entry => !entry.includes("requires at least one line item."),
    );
    if (complianceFailures.length > 0) {
      return {
        error: "Invoice compliance validation failed",
        status: 422,
        details: complianceFailures,
      };
    }
    return { error: "No exportable invoices.", status: 422, details: skipped };
  }

  // Add the DATEV XML manifest.
  // buildDatevXml throws a RangeError when any invoice carries a vatRate
  // outside [0, 100].  Map that to a 422 so the caller gets a clear error
  // instead of an unhandled 500.
  let xmlContent: string;
  try {
    xmlContent = buildDatevXml(datevInvoices);
  } catch (err) {
    if (err instanceof RangeError) {
      return {
        error: err.message,
        status: 422,
      };
    }
    throw err;
  }
  zip.file("document_data.xml", xmlContent);

  // Generate ZIP buffer
  const now = new Date();
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const zipFilename = `DATEV_Export_${now.toISOString().slice(0, 10)}.zip`;

  return { zipBuffer, datevInvoices, exportedInvoiceIds, skipped, zipFilename };
}

// ── POST /iroc/datev/export ───────────────────────────────────────────────────
//
// Duplicate-export prevention design:
//
//   States:
//     pending — claimed before email send; status unknown if process crashed
//     sent    — email confirmed delivered by the mail provider
//     failed  — email provider explicitly rejected the message
//
//   Dedup rule (without force=true):
//     Block on 'pending' AND 'sent' — both mean the invoice is claimed.
//     Allow on 'failed' only — explicit rejection is safe to retry.
//     'pending' records that are never resolved (process crash after delivery
//     but before DB update) are surfaced in the badge and history so admins
//     can inspect them and use force=true to override deliberately.
//
//   Concurrency:
//     An advisory lock (pg_advisory_xact_lock) serializes the check+claim
//     transaction so two simultaneous requests cannot both observe "no claim"
//     and both proceed. The lock releases on commit; the second request then
//     reads the first request's pending items and returns 409.
//
//   Email failure:
//     On confirmed send failure the record is marked 'failed' (items kept).
//     The guard allows 'failed' records to be retried without force because
//     the mail provider explicitly rejected — no ambiguous delivery.
//     'pending' records that timed out or reflect a crash are NOT auto-cleared;
//     they require force=true to avoid assuming a non-delivered email.
//
router.post(
  "/iroc/datev/export",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const { invoiceIds, bookkeeperEmail, saveEmail, force, exemptionReasons } = req.body as {
      invoiceIds: number[];
      bookkeeperEmail: string;
      saveEmail?: boolean;
      /** Set true to override the duplicate guard for pending/sent invoices. */
      force?: boolean;
      /** Map of invoiceId → DATEV exemption reason; only used for 0 % VAT invoices. */
      exemptionReasons?: Record<number, string>;
    };

    // ── 1. Input validation ───────────────────────────────────────────────────
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      res.status(400).json({ error: "Select at least one invoice." });
      return;
    }
    if (!bookkeeperEmail?.trim()) {
      res.status(400).json({ error: "Bookkeeper email address is required." });
      return;
    }

    // ── 2. Save email as default if requested ─────────────────────────────────
    if (saveEmail) {
      await setSetting("datev_bookkeeper_email", bookkeeperEmail.trim());
    }

    // ── 3. Build ZIP (outside the claim transaction — avoids long-held locks) ─
    const zipResult = await buildDatevZip(invoiceIds, exemptionReasons);
    if ("error" in zipResult) {
      res.status(zipResult.status).json({ error: zipResult.error, details: zipResult.details });
      return;
    }
    const { zipBuffer, datevInvoices, exportedInvoiceIds, skipped, zipFilename } = zipResult;

    // ── 4. Atomic claim: advisory lock → duplicate check → insert (pending) ───
    //
    // Using explicit typed variables instead of inferring a union from the
    // transaction return avoids TypeScript narrowing issues.
    //
    let exportRecordId = 0;

    try {
      await db.transaction(async (tx) => {
        // Serialize all concurrent export requests at the DB level.
        // Lock key 8675309 is an arbitrary application-specific constant.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(8675309)`);

        // Duplicate guard: block on 'sent' and 'pending'; allow 'failed' retry.
        // Throwing ConflictError guarantees a real ROLLBACK (a normal return
        // would commit, leaving the transaction in an unexpected committed state).
        if (!force) {
          const conflicts = await tx
            .select({
              invoiceId:     datevExportItems.invoiceId,
              invoiceNumber: irocInvoices.invoiceNumber,
            })
            .from(datevExportItems)
            .innerJoin(irocInvoices, eq(datevExportItems.invoiceId, irocInvoices.id))
            .innerJoin(datevExports, eq(datevExportItems.exportId, datevExports.id))
            .where(
              and(
                inArray(datevExportItems.invoiceId, exportedInvoiceIds),
                ne(datevExports.status, "failed"),
              ),
            );

          if (conflicts.length > 0) {
            throw new ConflictError(conflicts.map((c) => c.invoiceNumber));
          }
        }

        // Claim this export slot before sending email.
        const [record] = await tx
          .insert(datevExports)
          .values({
            bookkeeperEmail: bookkeeperEmail.trim(),
            invoiceCount: datevInvoices.length,
            status: "pending",
          })
          .returning();

        if (exportedInvoiceIds.length > 0) {
          await tx.insert(datevExportItems).values(
            exportedInvoiceIds.map((invoiceId) => ({ exportId: record.id, invoiceId })),
          );
        }

        exportRecordId = record.id;
      });
    } catch (err) {
      if (err instanceof ConflictError) {
        res.status(409).json({
          error: "already_exported",
          invoiceNumbers: err.invoiceNumbers,
        });
        return;
      }
      res.status(500).json({ error: "Failed to reserve export slot.", details: String(err) });
      return;
    }

    // ── 5. Send email ─────────────────────────────────────────────────────────
    const now = new Date();
    const monthYear = now.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
    const subject = `iROC Interface App – DATEV Rechnungsexport ${monthYear}`;
    const text = [
      `DATEV-Export vom ${now.toLocaleDateString("de-DE")}`,
      "",
      `Enthaltene Rechnungen: ${datevInvoices.length}`,
      datevInvoices.map((i) => `  • ${i.invoiceNumber}  (${i.issueDate})  ${i.customerName}`).join("\n"),
      "",
      "Der Export enthält die Datei document_data.xml (DATEV v5.0 konform) sowie alle zugehörigen Rechnungs-PDFs.",
      "",
      "— iROC Interface App",
    ].join("\n");

    try {
      await sendEmail({
        to: bookkeeperEmail.trim(),
        subject,
        text,
        attachments: [
          {
            filename: zipFilename,
            content:  zipBuffer,
            contentType: "application/zip",
          },
        ],
        mailboxPurpose: "datev",
      });
    } catch (emailErr) {
      // Any send exception is treated conservatively: the record remains
      // 'pending' because a transport error (timeout, disconnect, etc.) can
      // occur AFTER the SMTP server has already accepted the message.
      // Marking it 'failed' and excluding it from the guard would allow a
      // retry that silently sends a duplicate.
      // The admin will see the 'pending' entry in the history badge and must
      // use force=true to override once they have confirmed non-delivery.
      res.status(502).json({
        error: "Email delivery failed — the export is marked as pending. Use 'Export anyway' to override after confirming the email was not delivered.",
        details: String(emailErr),
      });
      return;
    }

    // ── 6. Mark export as sent ────────────────────────────────────────────────
    const [exportRecord] = await db
      .update(datevExports)
      .set({ status: "sent" })
      .where(eq(datevExports.id, exportRecordId))
      .returning();

    res.json({
      ok: true,
      exported: datevInvoices.length,
      skipped,
      // Return the finalized database row so the frontend can show the new
      // history entry immediately instead of depending on a follow-up GET.
      exportRecord,
    });
  },
);

// ── GET /iroc/datev/exported-ids ──────────────────────────────────────────────
// Returns invoice IDs from all exports regardless of status.
// Both 'sent' and 'pending' records trigger the badge — 'pending' means the
// email outcome is uncertain (process crash / send exception) and must be
// treated as potentially delivered until the admin confirms otherwise.
// Email errors never create 'failed' records; any ambiguous send exception
// leaves the record as 'pending' so the guard conservatively blocks retries.
router.get(
  "/iroc/datev/exported-ids",
  requireIrocAuth,
  async (_req: Request, res: Response) => {
    const items = await db
      .select({ invoiceId: datevExportItems.invoiceId })
      .from(datevExportItems);
    const ids = [...new Set(items.map((i) => i.invoiceId))];
    res.json({ ids });
  },
);

// ── GET /iroc/datev/exports ───────────────────────────────────────────────────
// Query parameters:
//   from, to — inclusive calendar dates (YYYY-MM-DD)
//   email    — case-insensitive recipient search
//   limit, offset — pagination (default 20, maximum 100)
//
// Returns all exports (sent, pending, failed) so admins can see pending/failed
// records and decide whether to force-override or investigate. Invoice numbers
// are included for each page so the history can explain exactly what was sent.
router.get(
  "/iroc/datev/exports",
  requireIrocAuth,
  async (req: Request, res: Response): Promise<void> => {
    const queryValue = (value: unknown): string | undefined =>
      typeof value === "string" ? value : undefined;
    const from = queryValue(req.query.from);
    const to = queryValue(req.query.to);
    const email = queryValue(req.query.email)?.trim();
    const rawLimit = queryValue(req.query.limit);
    const rawOffset = queryValue(req.query.offset);
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    const parseDate = (value: string | undefined): Date | undefined | null => {
      if (!value) return undefined;
      if (!datePattern.test(value)) return null;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
        ? null
        : parsed;
    };

    const fromDate = parseDate(from);
    const toDate = parseDate(to);
    if (fromDate === null || toDate === null) {
      res.status(400).json({ error: "from and to must use the YYYY-MM-DD format." });
      return;
    }
    if (fromDate && toDate && fromDate > toDate) {
      res.status(400).json({ error: "from must be on or before to." });
      return;
    }

    const parseInteger = (value: string | undefined, fallback: number): number | null => {
      if (value === undefined) return fallback;
      if (!/^\d+$/.test(value)) return null;
      return Number(value);
    };
    const requestedLimit = parseInteger(rawLimit, 20);
    const offset = parseInteger(rawOffset, 0);
    if (requestedLimit === null || requestedLimit < 1 || requestedLimit > 100 || offset === null || offset < 0) {
      res.status(400).json({ error: "limit must be 1–100 and offset must be a non-negative integer." });
      return;
    }

    const toExclusive = toDate ? new Date(toDate) : undefined;
    toExclusive?.setUTCDate(toExclusive.getUTCDate() + 1);
    const conditions = [
      fromDate ? gte(datevExports.exportedAt, fromDate) : undefined,
      toExclusive ? lt(datevExports.exportedAt, toExclusive) : undefined,
      email ? ilike(datevExports.bookkeeperEmail, `%${email}%`) : undefined,
    ].filter((condition): condition is NonNullable<typeof condition> => condition !== undefined);

    const rows = await db
      .select()
      .from(datevExports)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(datevExports.exportedAt))
      .limit(requestedLimit + 1)
      .offset(offset);
    const exportsPage = rows.slice(0, requestedLimit);

    const invoiceRows = exportsPage.length === 0
      ? []
      : await db
        .select({
          exportId: datevExportItems.exportId,
          invoiceNumber: irocInvoices.invoiceNumber,
        })
        .from(datevExportItems)
        .innerJoin(irocInvoices, eq(datevExportItems.invoiceId, irocInvoices.id))
        .where(inArray(datevExportItems.exportId, exportsPage.map((record) => record.id)));
    const invoiceNumbersByExport = new Map<number, string[]>();
    for (const item of invoiceRows) {
      const invoiceNumbers = invoiceNumbersByExport.get(item.exportId) ?? [];
      invoiceNumbers.push(item.invoiceNumber);
      invoiceNumbersByExport.set(item.exportId, invoiceNumbers);
    }

    res.json({
      exports: exportsPage.map((record) => ({
        ...record,
        invoiceNumbers: invoiceNumbersByExport.get(record.id) ?? [],
      })),
      hasMore: rows.length > requestedLimit,
    });
  },
);

// ── POST /iroc/datev/download ─────────────────────────────────────────────────
//
// PREVIEW ONLY — does NOT create a claim or history record.
//
// This endpoint lets the admin download the ZIP locally for inspection before
// deciding to email it to the bookkeeper. Existing email-export claims still
// require an explicit force=true confirmation, matching POST /iroc/datev/export,
// but a successful download never creates a new claim of its own.
//
router.post(
  "/iroc/datev/download",
  requireIrocAuth,
  async (req: Request, res: Response) => {
    const { invoiceIds, exemptionReasons, force } = req.body as {
      invoiceIds: number[];
      /** Map of invoiceId → DATEV exemption reason; only used for 0 % VAT invoices. */
      exemptionReasons?: Record<number, string>;
      /** Set true after the admin confirms downloading an already exported batch. */
      force?: boolean;
    };

    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      res.status(400).json({ error: "Select at least one invoice." });
      return;
    }

    const result = await buildDatevZip(invoiceIds, exemptionReasons);
    if ("error" in result) {
      res.status(result.status).json({ error: result.error, details: result.details });
      return;
    }
    const { zipBuffer, zipFilename, exportedInvoiceIds, skipped } = result;

    // ZIP downloads do not create a claim, but they must honor existing email
    // export claims so the admin receives the same deliberate re-export
    // confirmation as on the email-export path.
    if (!force) {
      const conflicts = await db
        .select({
          invoiceId:     datevExportItems.invoiceId,
          invoiceNumber: irocInvoices.invoiceNumber,
        })
        .from(datevExportItems)
        .innerJoin(irocInvoices, eq(datevExportItems.invoiceId, irocInvoices.id))
        .innerJoin(datevExports, eq(datevExportItems.exportId, datevExports.id))
        .where(
          and(
            inArray(datevExportItems.invoiceId, exportedInvoiceIds),
            ne(datevExports.status, "failed"),
          ),
        );

      if (conflicts.length > 0) {
        res.status(409).json({
          error: "already_exported",
          invoiceNumbers: conflicts.map((conflict) => conflict.invoiceNumber),
        });
        return;
      }
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipFilename}"`);
    res.setHeader("Content-Length", zipBuffer.length);
    if (skipped.length > 0) {
      // Keep the binary download contract intact while telling the caller
      // exactly which invoices were omitted from the preview ZIP.
      const skippedInvoiceNumbers = skipped.map((entry) => entry.split(":")[0].trim());
      res.setHeader("X-DATEV-Skipped", skippedInvoiceNumbers.join(", "));
    }
    res.send(zipBuffer);
  },
);

export default router;
