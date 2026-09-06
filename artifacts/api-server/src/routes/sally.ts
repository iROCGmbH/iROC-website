/**
 * Sally CRM routes — all under /api/admin/sally/ (requireAdmin protected).
 */
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getAdminAuthContext, requireAdmin } from "./admin-auth.js";
import { specialtyToProductGroup } from "../lib/sally-groups.js";
import {
  queueFirstContactEmail,
  approveAndSendEmail,
  SallyEmailContentValidationError,
  invalidSallyEmailContentField,
  runSallyCronNow,
} from "../lib/sally-cron.js";
import {
  SALLY_AUTO_INVOICE_KEY,
  SALLY_AUTOMATION_MASTER_KEY,
} from "../lib/sally-controls.js";
import {
  confirmEscalationDelivery,
  getEscalationReconciliationHistory,
  resendUnconfirmedEscalation,
  retryFailedEscalation,
} from "../lib/sally-reply.js";

const router: IRouter = Router();

const RECONCILIATION_ACTION_EXPORT_LABELS: Record<string, { de: string; en: string }> = {
  confirm_delivery: { de: "Zustellung bestätigt", en: "Delivery confirmed" },
  confirm_conflict: { de: "Bestätigung abgelehnt", en: "Confirmation conflict" },
  resend_requested: { de: "Erneuter Versand angefordert", en: "Resend requested" },
  resend_succeeded: { de: "Erneuter Versand erfolgreich", en: "Resend succeeded" },
  resend_failed: { de: "Erneuter Versand fehlgeschlagen", en: "Resend failed" },
  resend_unconfirmed: { de: "Erneuter Versand unbestätigt", en: "Resend remains unconfirmed" },
  resend_conflict: { de: "Erneuter Versand abgelehnt", en: "Resend conflict" },
  retry_succeeded: { de: "Wiederholungsversuch erfolgreich", en: "Retry succeeded" },
  retry_failed: { de: "Wiederholungsversuch fehlgeschlagen", en: "Retry failed" },
  retry_unconfirmed: { de: "Wiederholungsversuch unbestätigt", en: "Retry remains unconfirmed" },
};

const RECONCILIATION_STATUS_EXPORT_LABELS: Record<string, { de: string; en: string }> = {
  forwarding: { de: "Weiterleitung läuft", en: "Forwarding" },
  unconfirmed: { de: "Unbestätigt", en: "Unconfirmed" },
  resending: { de: "Erneuter Versand läuft", en: "Resending" },
  succeeded: { de: "Erfolgreich", en: "Succeeded" },
  confirmed: { de: "Bestätigt", en: "Confirmed" },
  failed: { de: "Fehlgeschlagen", en: "Failed" },
};

const SALLY_TRIGGER_EXPORT_LABELS: Record<string, { de: string; en: string }> = {
  first_contact: { de: "Erstkontakt", en: "First Contact" },
  "4_week_followup": { de: "4-Wochen-Follow-up", en: "4-Week Follow-up" },
  "2_month_reminder": { de: "2-Monats-Erinnerung", en: "2-Month Reminder" },
  doctor_checkin: { de: "Arzt-Check-in", en: "Doctor Check-in" },
  doctor_promo: { de: "6-Monats-Promo", en: "6-Month Promo" },
  inbound_reply: { de: "Antwort-Entwurf", en: "Reply Draft" },
  order_missing_info: { de: "Bestellung: Rückfrage", en: "Order: Missing Info" },
  invoice_dispatch: { de: "Versandbestätigung", en: "Dispatch Notice" },
  invoice_dispatch_shipping: {
    de: "Versandbestätigung (Lieferadresse)",
    en: "Dispatch Notice (Shipping)",
  },
};

function reconciliationExportLabel(
  labels: Record<string, { de: string; en: string }>,
  value: string | null,
): string {
  if (!value) return "—";
  const label = labels[value];
  return label ? `${label.de} / ${label.en}` : value;
}

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  // Keep audit values from being interpreted as spreadsheet formulas on import.
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

type ReconciliationExportContext = {
  id: number;
  recipient_email: string;
  subject: string;
  trigger_type: string;
  status: string;
  escalation_forward_status: string | null;
};

function reconciliationHistoryCsv(
  context: ReconciliationExportContext,
  history: Awaited<ReturnType<typeof getEscalationReconciliationHistory>>,
): string {
  const contextRows: Array<Array<string | number | boolean>> = [
    ["Lieferkontext / Delivery context", ""],
    ["Queue-ID / Queue item ID", context.id],
    ["Empfänger / Recipient", context.recipient_email],
    ["Betreff / Subject", context.subject],
    [
      "Auslöser / Trigger source",
      reconciliationExportLabel(SALLY_TRIGGER_EXPORT_LABELS, context.trigger_type),
    ],
    ["Finaler Queue-Status / Final queue status", reconciliationExportLabel({
      pending: { de: "Ausstehend", en: "Pending" },
      sent: { de: "Gesendet", en: "Sent" },
      cancelled: { de: "Abgebrochen", en: "Cancelled" },
    }, context.status)],
    ["Finaler Eskalationsstatus / Final escalation status",
      reconciliationExportLabel(RECONCILIATION_STATUS_EXPORT_LABELS, context.escalation_forward_status)],
  ];
  const header: Array<string | number | boolean> = [
    "ID",
    "Aktion (DE) / Action (EN)",
    "Akteur / Actor",
    "Vorheriger Status / Previous status",
    "Resultierender Status / Resulting status",
    "Duplikatrisiko bestätigt / Duplicate risk acknowledged",
    "Zeitstempel / Timestamp",
  ];
  const rows: Array<Array<string | number | boolean>> = history.map((entry) => [
    entry.id,
    reconciliationExportLabel(RECONCILIATION_ACTION_EXPORT_LABELS, entry.action),
    entry.actor,
    reconciliationExportLabel(RECONCILIATION_STATUS_EXPORT_LABELS, entry.previous_status),
    reconciliationExportLabel(RECONCILIATION_STATUS_EXPORT_LABELS, entry.resulting_status),
    entry.acknowledged_duplicate_risk ? "Ja / Yes" : "Nein / No",
    new Date(entry.created_at).toISOString(),
  ]);
  return `${[...contextRows, [], header, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")}\r\n`;
}

// ── Leads ─────────────────────────────────────────────────────────────────────

router.get("/admin/sally/leads", requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM sally_leads WHERE deleted_at IS NULL ORDER BY created_at DESC",
  );
  res.json(rows);
});

router.post("/admin/sally/leads", requireAdmin, async (req, res) => {
  const {
    name,
    email,
    productInterestGroup,
    product_interest_group: productInterestGroupSnakeCase,
    firstContactDate,
    first_contact_date: firstContactDateSnakeCase,
  } = req.body as {
    name: string;
    email: string;
    productInterestGroup?: string;
    product_interest_group?: string;
    firstContactDate?: string;
    first_contact_date?: string;
  };
  if (!name?.trim() || !email?.trim()) {
    res.status(400).json({ error: "name and email are required" });
    return;
  }

  const firstContactDateValue = firstContactDate ?? firstContactDateSnakeCase;
  const productInterestGroupValue = productInterestGroup ?? productInterestGroupSnakeCase;
  const today = firstContactDateValue ?? new Date().toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `INSERT INTO sally_leads (name, email, product_interest_group, first_contact_date)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name.trim(), email.trim(), (productInterestGroupValue ?? "").trim(), today],
  );
  const lead = rows[0];

  // Automatically queue a first-contact email
  try {
    await queueFirstContactEmail(lead.id, lead.name, lead.email, lead.product_interest_group);
  } catch (err) {
    // Don't fail the request if email queuing fails
    console.error("Failed to queue first-contact email", err);
  }

  res.status(201).json(lead);
});

router.put("/admin/sally/leads/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const {
    name,
    email,
    productInterestGroup,
    product_interest_group: productInterestGroupSnakeCase,
    firstContactDate,
    first_contact_date: firstContactDateSnakeCase,
    trainingRegistered,
    training_registered: trainingRegisteredSnakeCase,
    isCancelled,
    is_cancelled: isCancelledSnakeCase,
  } = req.body as {
    name?: string;
    email?: string;
    productInterestGroup?: string;
    product_interest_group?: string;
    firstContactDate?: string;
    first_contact_date?: string;
    trainingRegistered?: boolean;
    training_registered?: boolean;
    isCancelled?: boolean;
    is_cancelled?: boolean;
  };
  const productInterestGroupValue = productInterestGroup ?? productInterestGroupSnakeCase;
  const firstContactDateValue = firstContactDate ?? firstContactDateSnakeCase;
  const trainingRegisteredValue = trainingRegistered ?? trainingRegisteredSnakeCase;
  const isCancelledValue = isCancelled ?? isCancelledSnakeCase;

  const { rows } = await pool.query(
    `UPDATE sally_leads SET
       name = COALESCE($1, name),
       email = COALESCE($2, email),
       product_interest_group = COALESCE($3, product_interest_group),
       first_contact_date = COALESCE($4, first_contact_date),
       training_registered = COALESCE($5, training_registered),
       is_cancelled = COALESCE($6, is_cancelled),
       updated_at = NOW()
     WHERE id = $7 RETURNING *`,
    [name?.trim() ?? null, email?.trim() ?? null, productInterestGroupValue?.trim() ?? null,
      firstContactDateValue ?? null, trainingRegisteredValue ?? null, isCancelledValue ?? null, id],
  );
  if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }

  // When a lead is cancelled, also cancel any outstanding pending emails so
  // they are not sent or approved after the lead is no longer active.
  if (isCancelledValue === true) {
    await pool.query(
      `UPDATE sally_email_queue
         SET status = 'cancelled', updated_at = NOW()
       WHERE related_lead_id = $1 AND status = 'pending'`,
      [id],
    );
  }

  res.json(rows[0]);
});

router.delete("/admin/sally/leads/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  // Soft-delete: keeps the email in the table so the entry cannot be re-imported.
  await pool.query("UPDATE sally_leads SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1", [id]);
  // Also cancel any pending queue entries so the admin does not accidentally
  // approve an email for a lead they just deleted.
  await pool.query(
    `UPDATE sally_email_queue
       SET status = 'cancelled', updated_at = NOW()
     WHERE related_lead_id = $1 AND status = 'pending'`,
    [id],
  );
  res.json({ ok: true });
});

// ── Certified Doctors ─────────────────────────────────────────────────────────

router.get("/admin/sally/doctors", requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM sally_certified_doctors WHERE deleted_at IS NULL ORDER BY created_at DESC",
  );
  res.json(rows);
});

router.post("/admin/sally/doctors", requireAdmin, async (req, res) => {
  const { name, email, lastPurchaseDate, avgItemsPerOrder } = req.body as {
    name: string; email: string; lastPurchaseDate?: string; avgItemsPerOrder?: number;
  };
  if (!name?.trim() || !email?.trim()) {
    res.status(400).json({ error: "name and email are required" });
    return;
  }

  const { rows } = await pool.query(
    `INSERT INTO sally_certified_doctors (name, email, last_purchase_date, avg_items_per_order)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name.trim(), email.trim(), lastPurchaseDate ?? null, avgItemsPerOrder ?? 0],
  );
  res.status(201).json(rows[0]);
});

router.put("/admin/sally/doctors/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { name, email, lastPurchaseDate, avgItemsPerOrder, isCancelled } = req.body as {
    name?: string; email?: string; lastPurchaseDate?: string;
    avgItemsPerOrder?: number; isCancelled?: boolean;
  };

  const { rows } = await pool.query(
    `UPDATE sally_certified_doctors SET
       name = COALESCE($1, name),
       email = COALESCE($2, email),
       last_purchase_date = COALESCE($3, last_purchase_date),
       avg_items_per_order = COALESCE($4, avg_items_per_order),
       is_cancelled = COALESCE($5, is_cancelled),
       portal_sessions_revoked_at = CASE
         WHEN $5 IS TRUE THEN NOW()
         WHEN $5 IS FALSE THEN NULL
         ELSE portal_sessions_revoked_at
       END,
       updated_at = NOW()
     WHERE id = $6 RETURNING *`,
    [name?.trim() ?? null, email?.trim() ?? null, lastPurchaseDate ?? null,
     avgItemsPerOrder ?? null, isCancelled ?? null, id],
  );
  if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }

  // When a doctor is cancelled, also cancel any outstanding pending emails so
  // they are not sent or approved after the doctor is no longer active.
  if (isCancelled === true) {
    await pool.query(
      `UPDATE sally_email_queue
         SET status = 'cancelled', updated_at = NOW()
       WHERE related_doctor_id = $1 AND status = 'pending'`,
      [id],
    );
  }

  res.json(rows[0]);
});

router.delete("/admin/sally/doctors/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  // Soft-delete: keeps the email in the table so the entry cannot be re-imported.
  // The revocation timestamp invalidates portal JWTs issued before removal.
  await pool.query(
    `UPDATE sally_certified_doctors
        SET deleted_at = NOW(),
            portal_sessions_revoked_at = NOW(),
            updated_at = NOW()
      WHERE id = $1`,
    [id],
  );
  // Also cancel any pending queue entries so the admin does not accidentally
  // approve an email for a doctor they just deleted.
  await pool.query(
    `UPDATE sally_email_queue
       SET status = 'cancelled', updated_at = NOW()
     WHERE related_doctor_id = $1 AND status = 'pending'`,
    [id],
  );
  res.json({ ok: true });
});

// ── Email Queue ───────────────────────────────────────────────────────────────

router.get("/admin/sally/email-queue/reconciliation-actors", requireAdmin, async (_req, res) => {
  const { rows } = await pool.query<{ actor: string }>(
    `SELECT DISTINCT ON (LOWER(BTRIM(actor)))
            BTRIM(actor) AS actor
       FROM sally_escalation_reconciliation_audit
      WHERE BTRIM(actor) <> ''
      ORDER BY LOWER(BTRIM(actor)), BTRIM(actor)`,
  );
  res.json(rows.map(row => row.actor));
});

router.get("/admin/sally/email-queue", requireAdmin, async (req, res) => {
  const status = req.query["status"] as string | undefined;
  const reconciliationOutcome = (
    req.query["reconciliationOutcome"]
      ?? req.query["reconciliationStatus"]
      ?? req.query["outcome"]
  ) as string | undefined;
  const reconciliationActor = (
    req.query["reconciliationActor"]
      ?? req.query["actor"]
  ) as string | undefined;
  const validOutcomes = new Set([
    "unresolved",
    "confirmed",
    "succeeded",
    "failed",
    "handled",
  ]);

  if (reconciliationOutcome && reconciliationOutcome !== "all" && !validOutcomes.has(reconciliationOutcome)) {
    res.status(400).json({ error: "Invalid reconciliation outcome" });
    return;
  }

  const conditions: string[] = [];
  const params: string[] = [];
  if (status && status !== "all") {
    params.push(status);
    conditions.push(`q.status = $${params.length}`);
  }

  if (reconciliationOutcome && reconciliationOutcome !== "all") {
    if (reconciliationOutcome === "unresolved") {
      conditions.push(
        "q.escalation_forward_status IN ('forwarding', 'unconfirmed', 'resending')",
      );
    } else if (reconciliationOutcome === "handled") {
      conditions.push(
        `EXISTS (
           SELECT 1
             FROM sally_escalation_reconciliation_audit handled_audit
            WHERE handled_audit.queue_item_id = q.id
         )`,
      );
    } else {
      params.push(reconciliationOutcome);
      conditions.push(`q.escalation_forward_status = $${params.length}`);
    }
  }

  const actor = reconciliationActor?.trim();
  if (actor) {
    params.push(actor);
    conditions.push(
      `EXISTS (
         SELECT 1
           FROM sally_escalation_reconciliation_audit actor_audit
          WHERE actor_audit.queue_item_id = q.id
            AND actor_audit.actor ILIKE '%' || $${params.length} || '%'
       )`,
    );
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT q.* FROM sally_email_queue q ${where} ORDER BY q.created_at DESC`,
    params,
  );
  res.json(rows);
});

router.post("/admin/sally/email-queue/reconciliation-history/export", requireAdmin, async (req, res) => {
  const rawIds = (req.body as { ids?: unknown })?.ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > 50) {
    res.status(400).json({ error: "Provide between 1 and 50 queue item IDs" });
    return;
  }
  const ids = [...new Set(rawIds.map(value =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : NaN,
  ))];
  if (ids.some(Number.isNaN)) {
    res.status(400).json({ error: "Queue item IDs must be positive integers" });
    return;
  }

  const { rows: queueItems } = await pool.query<ReconciliationExportContext>(
    `SELECT id, recipient_email, subject, trigger_type, status, escalation_forward_status
       FROM sally_email_queue
      WHERE id = ANY($1::int[])
      ORDER BY id`,
    [ids],
  );
  if (queueItems.length !== ids.length) {
    res.status(404).json({ error: "One or more queue items were not found" });
    return;
  }
  const { rows: auditCounts } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM sally_escalation_reconciliation_audit
      WHERE queue_item_id = ANY($1::int[])`,
    [ids],
  );
  if (Number(auditCounts[0]?.count ?? 0) > 5_000) {
    res.status(413).json({ error: "Export exceeds the safe limit of 5,000 audit entries" });
    return;
  }

  const sections: string[] = [];
  for (const item of queueItems) {
    sections.push(reconciliationHistoryCsv(
      item,
      await getEscalationReconciliationHistory(item.id),
    ).trimEnd());
  }
  const csv = `\uFEFF${sections.join("\r\n\r\n")}\r\n`;
  if (Buffer.byteLength(csv, "utf8") > 5 * 1024 * 1024) {
    res.status(413).json({ error: "Export exceeds the safe size limit of 5 MB" });
    return;
  }
  res
    .status(200)
    .set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sally-reconciliation-export.csv"',
      "Cache-Control": "no-store",
    })
    .send(csv);
});

router.get("/admin/sally/email-queue/:id/reconciliation-history", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { rows: queueItems } = await pool.query(
    "SELECT id FROM sally_email_queue WHERE id = $1",
    [id],
  );
  if (!queueItems[0]) { res.status(404).json({ error: "Not found" }); return; }

  const history = await getEscalationReconciliationHistory(id);
  res.json(history);
});

router.get("/admin/sally/email-queue/:id/reconciliation-history/export", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { rows: queueItems } = await pool.query<ReconciliationExportContext>(
    `SELECT id, recipient_email, subject, trigger_type, status, escalation_forward_status
       FROM sally_email_queue
      WHERE id = $1`,
    [id],
  );
  if (!queueItems[0]) { res.status(404).json({ error: "Not found" }); return; }

  const history = await getEscalationReconciliationHistory(id);
  res
    .status(200)
    .set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sally-reconciliation-${id}.csv"`,
      "Cache-Control": "no-store",
    })
    // UTF-8 BOM keeps German labels readable in spreadsheet applications.
    .send(`\uFEFF${reconciliationHistoryCsv(queueItems[0], history)}`);
});

router.put("/admin/sally/email-queue/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { subject, body } = req.body as { subject?: string; body?: string };
  if (subject === undefined && body === undefined) {
    res.status(400).json({ error: "Provide at least subject or body" });
    return;
  }
  const invalidField = invalidSallyEmailContentField(subject, body);
  if (invalidField) {
    const error = new SallyEmailContentValidationError(invalidField);
    res.status(error.statusCode).json({ error: error.message });
    return;
  }

  // Snapshot the original so the correction can be learned from
  const { rows: beforeRows } = await pool.query<{ subject: string; body: string; trigger_type: string }>(
    "SELECT subject, body, trigger_type FROM sally_email_queue WHERE id = $1 AND status = 'pending'",
    [id],
  );
  const before = beforeRows[0];

  // Only allow editing items that are still pending
  const { rows } = await pool.query(
    `UPDATE sally_email_queue
       SET subject    = COALESCE($1, subject),
           body       = COALESCE($2, body),
           updated_at = NOW()
     WHERE id = $3 AND status = 'pending'
     RETURNING *`,
    [subject ?? null, body ?? null, id],
  );
  if (!rows[0]) {
    res.status(404).json({ error: "Not found or not pending" });
    return;
  }

  // Learn from the correction in the background (never blocks the response)
  if (before) {
    const after = rows[0] as { subject: string; body: string };
    setImmediate(() => {
      import("../lib/sally-lessons.js")
        .then(m => m.recordCorrectionLesson({
          context: before.trigger_type,
          originalSubject: before.subject,
          originalBody: before.body,
          correctedSubject: after.subject,
          correctedBody: after.body,
        }))
        .catch(() => {});
    });
  }

  res.json(rows[0]);
});

router.post("/admin/sally/email-queue/:id/approve", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await approveAndSendEmail(id);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof SallyEmailContentValidationError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: String(err) });
  }
});

router.post("/admin/sally/email-queue/:id/cancel", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // If there's a related lead or doctor, mark them as cancelled too
  const { rows } = await pool.query<{
    related_lead_id: number | null;
    related_doctor_id: number | null;
    related_invoice_id: number | null;
    trigger_type: string;
  }>(
    "SELECT related_lead_id, related_doctor_id, related_invoice_id, trigger_type FROM sally_email_queue WHERE id = $1",
    [id],
  );
  const item = rows[0];
  if (!item) { res.status(404).json({ error: "Not found" }); return; }

  await pool.query("UPDATE sally_email_queue SET status = 'cancelled', updated_at = NOW() WHERE id = $1", [id]);

  if (item.related_lead_id != null) {
    await pool.query("UPDATE sally_leads SET is_cancelled = true, updated_at = NOW() WHERE id = $1", [item.related_lead_id]);
  }
  if (item.related_doctor_id != null) {
    await pool.query(
      `UPDATE sally_certified_doctors
          SET is_cancelled = true,
              portal_sessions_revoked_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [item.related_doctor_id],
    );
  }

  // Suppress future payment reminders for this invoice — the admin explicitly
  // cancelled this reminder, so the cron must not re-queue one automatically.
  // The admin can re-enable reminders via the toggle in the invoice detail view.
  if (item.trigger_type === "payment_reminder" && item.related_invoice_id != null) {
    await pool.query(
      "UPDATE iroc_invoices SET reminder_suppressed = true, updated_at = NOW() WHERE id = $1",
      [item.related_invoice_id],
    );
  }

  res.json({ ok: true });
});

router.post("/admin/sally/email-queue/:id/retry-escalation", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const result = await retryFailedEscalation(id, reconciliationActor(req));
    if (result === "not_found") { res.status(404).json({ error: "Not found" }); return; }
    if (result === "not_retryable") {
      res.status(409).json({ error: "Escalation is not eligible for retry" });
      return;
    }
    if (result === "failed") {
      res.status(502).json({ error: "Escalation forwarding failed; it can be retried again" });
      return;
    }
    if (result === "unconfirmed") {
      res.status(502).json({ error: "Escalation delivery is unconfirmed; review manually before any resend" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

function reconciliationActor(req: Parameters<typeof requireAdmin>[0]): string {
  return getAdminAuthContext(req)?.actor ?? "admin";
}

router.post("/admin/sally/email-queue/:id/confirm-escalation", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const result = await confirmEscalationDelivery(id, reconciliationActor(req));
    if (result === "not_found") { res.status(404).json({ error: "Not found" }); return; }
    if (result === "conflict") {
      res.status(409).json({ error: "Escalation was already reconciled by another administrator" });
      return;
    }
    res.json({ ok: true, escalationForwardStatus: "confirmed" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/admin/sally/email-queue/:id/resend-escalation", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (req.body?.acknowledgeDuplicateRisk !== true) {
    res.status(400).json({ error: "Explicit duplicate-delivery acknowledgement is required" });
    return;
  }
  try {
    const result = await resendUnconfirmedEscalation(id, reconciliationActor(req));
    if (result === "not_found") { res.status(404).json({ error: "Not found" }); return; }
    if (result === "conflict") {
      res.status(409).json({ error: "Escalation was already reconciled by another administrator" });
      return;
    }
    if (result === "failed") {
      res.status(502).json({ error: "Escalation resend failed; it can be retried again" });
      return;
    }
    if (result === "unconfirmed") {
      res.status(202).json({ ok: false, escalationForwardStatus: "resending" });
      return;
    }
    res.json({ ok: true, escalationForwardStatus: "succeeded" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────

const SALLY_SETTINGS_DEFAULTS: Record<string, string> = {
  [SALLY_AUTOMATION_MASTER_KEY]: "true",
  [SALLY_AUTO_INVOICE_KEY]: "true",
  // Email content
  sally_bulk_discount_pct:   "10",
  // Sally's sender identity
  sally_from_name:           "Sally",
  sally_from_email:          "",
  // Customer-service inbox for inquiries Sally can't answer (escalation forwarding)
  sally_escalation_email:    "",
  // Per-template language: "de" | "en" | "both"
  sally_lang_first_contact:  "both",
  sally_lang_followup:       "both",
  // IMAP inbox polling for inbound replies
  sally_imap_enabled:        "false",
  sally_imap_host:           "outlook.office365.com",
  sally_imap_port:           "993",
  sally_imap_user:           "",
  sally_imap_pass:           "",
  // OAuth2 / Modern Auth (optional — overrides password when all three are set)
  sally_imap_oauth_client_id:     "",
  sally_imap_oauth_tenant_id:     "",
  sally_imap_oauth_client_secret: "",
};

router.get("/admin/sally/settings", requireAdmin, async (_req, res) => {
  const keys = Object.keys(SALLY_SETTINGS_DEFAULTS);
  const { rows } = await pool.query(
    `SELECT key, value FROM settings WHERE key = ANY($1)`,
    [keys],
  );
  const map: Record<string, string> = { ...SALLY_SETTINGS_DEFAULTS };
  for (const row of rows) map[row.key] = row.value;
  res.json(map);
});

router.put("/admin/sally/settings", requireAdmin, async (req, res) => {
  const body = req.body as Record<string, string>;
  const allowed = new Set(Object.keys(SALLY_SETTINGS_DEFAULTS));
  for (const [key, rawValue] of Object.entries(body)) {
    if (!allowed.has(key)) continue;
    let value = String(rawValue);
    // Validate email-typed settings at the write boundary
    if (key === "sally_escalation_email") {
      value = value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        res.status(400).json({ error: "Invalid escalation email address" });
        return;
      }
    }
    if (key === SALLY_AUTOMATION_MASTER_KEY || key === SALLY_AUTO_INVOICE_KEY) {
      value = value.trim().toLowerCase();
      if (value !== "true" && value !== "false") {
        res.status(400).json({ error: "Automation controls must be true or false" });
        return;
      }
    }
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, value],
    );
  }
  res.json({ ok: true });
});

// ── Import: iroc_leads → sally_leads ─────────────────────────────────────────

/** Returns iroc_leads rows whose email is not yet tracked in sally_leads. */
router.get("/admin/sally/import/leads", requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT il.id,
           TRIM(CONCAT_WS(' ', il.medical_title, il.first_name, il.last_name)) AS full_name,
           il.email,
           il.specialty,
           il.first_contact_date,
           il.status
    FROM iroc_leads il
    WHERE il.email IS NOT NULL AND il.email <> ''
      AND NOT EXISTS (
        SELECT 1 FROM sally_leads sl WHERE LOWER(sl.email) = LOWER(il.email)
      )
    ORDER BY il.created_at DESC
  `);
  res.json(rows);
});

router.post("/admin/sally/import/leads", requireAdmin, async (req, res) => {
  const { ids } = req.body as { ids: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array" });
    return;
  }

  const { rows: source } = await pool.query<{
    id: number; medical_title: string | null; first_name: string;
    last_name: string; email: string; specialty: string | null; first_contact_date: string | null;
  }>(
    `SELECT id, medical_title, first_name, last_name, email, specialty, first_contact_date
     FROM iroc_leads WHERE id = ANY($1) AND email IS NOT NULL AND email <> ''`,
    [ids],
  );

  let imported = 0;
  for (const row of source) {
    // Double-check for duplicates (race safety)
    const { rows: exists } = await pool.query(
      "SELECT id FROM sally_leads WHERE LOWER(email) = LOWER($1) LIMIT 1",
      [row.email],
    );
    if (exists.length > 0) continue;

    const name = [row.medical_title, row.first_name, row.last_name].filter(Boolean).join(" ");
    const contactDate = row.first_contact_date ?? new Date().toISOString().slice(0, 10);

    const { rows: newRows } = await pool.query(
      `INSERT INTO sally_leads (name, email, product_interest_group, specialty, first_contact_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, row.email, specialtyToProductGroup(row.specialty), row.specialty ?? null, contactDate],
    );
    const lead = newRows[0];

    try {
      await queueFirstContactEmail(lead.id, lead.name, lead.email, lead.product_interest_group);
    } catch { /* don't fail the import if email queuing fails */ }

    imported++;
  }

  res.json({ ok: true, imported });
});

// ── Import: trained_doctors + website_customers → sally_certified_doctors ─────
//
// Both tables are doctor sources: trained_doctors is the public certificate
// registry (mostly missing emails); website_customers are actual ordering
// customers who are medical professionals (email NOT NULL). We UNION both,
// deduplicating by email, and skip any already present in sally_certified_doctors.

router.get("/admin/sally/import/doctors", requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (LOWER(email))
           source,
           table_id AS "tableId",
           full_name AS "fullName",
           email,
           specialty,
           institution_name AS "institutionName",
           city
    FROM (
      SELECT 'trained_doctor'   AS source,
             td.id              AS table_id,
             TRIM(CONCAT_WS(' ', td.title, td.first_name, td.last_name)) AS full_name,
             td.email, td.specialty, td.institution_name, td.city
      FROM trained_doctors td
      WHERE td.email IS NOT NULL AND td.email <> ''

      UNION ALL

      SELECT 'website_customer' AS source,
             wc.id              AS table_id,
             TRIM(CONCAT_WS(' ', wc.title, wc.first_name, wc.last_name)) AS full_name,
             wc.email, wc.specialty, wc.institution_name, wc.city
      FROM website_customers wc
      WHERE wc.email IS NOT NULL AND wc.email <> ''
    ) combined
    WHERE NOT EXISTS (
      SELECT 1 FROM sally_certified_doctors sc WHERE LOWER(sc.email) = LOWER(combined.email)
    )
    ORDER BY LOWER(email)
  `);
  res.json(rows);
});

router.post("/admin/sally/import/doctors", requireAdmin, async (req, res) => {
  const { items } = req.body as { items: Array<{ tableId: number; source: string }> };
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "items must be a non-empty array" });
    return;
  }

  // Separate by source table so we can query each in one round-trip
  const trainedIds  = items.filter(i => i.source === "trained_doctor").map(i => i.tableId);
  const customerIds = items.filter(i => i.source === "website_customer").map(i => i.tableId);

  type DoctorRow = { title: string | null; first_name: string; last_name: string; email: string };

  const [trainedRows, customerRows] = await Promise.all([
    trainedIds.length > 0
      ? pool.query<DoctorRow>(
          "SELECT title, first_name, last_name, email FROM trained_doctors WHERE id = ANY($1) AND email IS NOT NULL AND email <> ''",
          [trainedIds],
        )
      : { rows: [] as DoctorRow[] },
    customerIds.length > 0
      ? pool.query<DoctorRow>(
          "SELECT title, first_name, last_name, email FROM website_customers WHERE id = ANY($1) AND email IS NOT NULL AND email <> ''",
          [customerIds],
        )
      : { rows: [] as DoctorRow[] },
  ]);

  const allRows: DoctorRow[] = [...trainedRows.rows, ...customerRows.rows];

  let imported = 0;
  for (const row of allRows) {
    const { rows: exists } = await pool.query(
      "SELECT id FROM sally_certified_doctors WHERE LOWER(email) = LOWER($1) LIMIT 1",
      [row.email],
    );
    if (exists.length > 0) continue;

    const name = [row.title, row.first_name, row.last_name].filter(Boolean).join(" ");
    await pool.query(
      "INSERT INTO sally_certified_doctors (name, email, avg_items_per_order) VALUES ($1, $2, 0)",
      [name, row.email],
    );
    imported++;
  }

  res.json({ ok: true, imported });
});

// ── Bulk re-classify leads ────────────────────────────────────────────────────
//
// Runs specialtyToProductGroup() over every lead whose product_interest_group
// is not already one of the four canonical values (spirecut / ministem /
// cellenis / ""). Email history in sally_email_queue is never touched.

router.post("/admin/sally/leads/reclassify", requireAdmin, async (_req, res) => {
  const CANONICAL = new Set(["spirecut", "ministem", "cellenis", ""]);

  // Fetch all non-deleted leads that haven't been canonically classified yet.
  const { rows: stale } = await pool.query<{ id: number; product_interest_group: string }>(
    `SELECT id, product_interest_group FROM sally_leads
     WHERE deleted_at IS NULL
       AND product_interest_group NOT IN ('spirecut', 'ministem', 'cellenis', '')`,
  );

  let updated = 0;
  for (const lead of stale) {
    const canonical = specialtyToProductGroup(lead.product_interest_group);
    // Only write if the value actually changes (avoids unnecessary writes)
    if (!CANONICAL.has(lead.product_interest_group) || lead.product_interest_group !== canonical) {
      await pool.query(
        "UPDATE sally_leads SET product_interest_group = $1, updated_at = NOW() WHERE id = $2",
        [canonical, lead.id],
      );
      updated++;
    }
  }

  res.json({ ok: true, updated });
});

// ── Force re-classify ALL leads (including canonical rows) ────────────────────
//
// Unlike POST /admin/sally/leads/reclassify (which skips rows whose
// product_interest_group is already one of the four canonical values), this
// endpoint re-evaluates every non-deleted lead against the current keyword set.
//
// Use case: a keyword was removed from SPIRECUT_KEYWORDS / MINISTEM_KEYWORDS /
// CELLENIS_KEYWORDS after leads had already been classified. The stored canonical
// group is now "stale" and the regular reclassify endpoint would skip it. This
// endpoint corrects those rows.
//
// Re-evaluation uses the stored specialty column (original free-text) when
// available. Rows without a specialty are left unchanged because there is no
// source text to re-classify against.

router.post("/admin/sally/leads/reclassify/all", requireAdmin, async (_req, res) => {
  const { rows: all } = await pool.query<{
    id: number;
    product_interest_group: string;
    specialty: string | null;
  }>(
    `SELECT id, product_interest_group, specialty FROM sally_leads WHERE deleted_at IS NULL`,
  );

  let updated = 0;
  for (const lead of all) {
    // Only re-evaluate rows that have a stored specialty — rows without one
    // lack the original classification source text and cannot be corrected.
    if (lead.specialty == null) continue;

    const recalculated = specialtyToProductGroup(lead.specialty);
    if (recalculated !== lead.product_interest_group) {
      await pool.query(
        "UPDATE sally_leads SET product_interest_group = $1, updated_at = NOW() WHERE id = $2",
        [recalculated, lead.id],
      );
      updated++;
    }
  }

  res.json({ ok: true, updated });
});

// ── Lessons (learning loop) ───────────────────────────────────────────────────

router.get("/admin/sally/lessons", requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT id, context, lesson, original_text, corrected_text, created_at FROM sally_lessons ORDER BY created_at DESC",
  );
  res.json(rows);
});

router.delete("/admin/sally/lessons/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await pool.query("DELETE FROM sally_lessons WHERE id = $1", [id]);
  res.json({ ok: true });
});

// ── Order review ──────────────────────────────────────────────────────────────

/** Update an order's contact language (admin override). */
router.put("/admin/sally/orders/:id/language", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { language } = req.body as { language: string };
  if (!language || !/^[a-z]{2}$/.test(language)) {
    res.status(400).json({ error: "language must be a 2-letter ISO code" });
    return;
  }
  const { rows } = await pool.query(
    "UPDATE iroc_orders SET contact_language = $1 WHERE id = $2 RETURNING id, contact_language",
    [language, id],
  );
  if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
  res.json(rows[0]);
});

/** Re-run Sally's review for one order (resets previous review). */
router.post("/admin/sally/orders/:id/review", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  // Reset only if no other worker holds a live review lease
  const { rowCount } = await pool.query(
    `UPDATE iroc_orders
       SET sally_review_status = NULL, sally_review_result = NULL, sally_review_claimed_at = NULL
     WHERE id = $1 AND status = 'approved'
       AND (sally_review_status IS DISTINCT FROM 'reviewing'
            OR sally_review_claimed_at IS NULL
            OR sally_review_claimed_at < NOW() - INTERVAL '10 minutes')`,
    [id],
  );
  if (!rowCount) {
    const { rows: check } = await pool.query("SELECT sally_review_status FROM iroc_orders WHERE id = $1 AND status = 'approved'", [id]);
    if (check[0]?.sally_review_status === "reviewing") {
      res.status(409).json({ error: "Review already in progress" });
      return;
    }
    res.status(404).json({ error: "Order not found or not approved" });
    return;
  }
  try {
    const { reviewOrder } = await import("../lib/sally-order-review.js");
    const result = await reviewOrder(id);
    if (!result) { res.status(404).json({ error: "Order not found or not approved" }); return; }
    res.json({ ok: true, status: result });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── IMAP connection test ──────────────────────────────────────────────────────

router.post("/admin/sally/imap/test", requireAdmin, async (req, res) => {
  const { host, port, user, pass, oauthClientId, oauthTenantId, oauthClientSecret } = req.body as {
    host: string; port?: number; user: string; pass: string;
    oauthClientId?: string; oauthTenantId?: string; oauthClientSecret?: string;
  };
  if (!host || !user) {
    res.status(400).json({ error: "host and user are required" });
    return;
  }
  const hasOAuth = !!(oauthClientId && oauthTenantId && oauthClientSecret);
  if (!hasOAuth && !pass) {
    res.status(400).json({ error: "Either pass or all three OAuth2 fields (oauthClientId, oauthTenantId, oauthClientSecret) are required" });
    return;
  }
  const { testImapConnection } = await import("../lib/sally-imap.js");
  const result = await testImapConnection({
    host, port: port ?? 993, user, pass: pass ?? "",
    oauthClientId, oauthTenantId, oauthClientSecret,
  });
  res.json(result);
});

// ── Manual cron trigger ───────────────────────────────────────────────────────

router.post("/admin/sally/cron/run", requireAdmin, async (_req, res) => {
  try {
    const results = await runSallyCronNow();
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
