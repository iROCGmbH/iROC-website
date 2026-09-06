import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { SubmitOrderBody } from "@workspace/api-zod";
import { sendEmail, getEmailDest } from "../lib/email";
import { normalizeCode } from "../lib/reorder-code";
import { publicBaseUrl } from "../lib/public-url";
import { db, websiteCustomersTable, irocOrders, irocNotifications } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { resolveRecipientLanguage } from "../lib/recipient-language";
import { appendImpressumSignature } from "../lib/impressum-signature";

const router: IRouter = Router();

// ── In-memory lockout for failed reorder-code attempts ───────────────────────
// Business rule: 3 wrong customerNr+code guesses → blocked for 24 hours.
// Only FAILED attempts count; a successful order resets the counter.
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILED_ATTEMPTS = 3;
const BLOCK_WINDOW_MS = 24 * 60 * 60 * 1000;

function isBlocked(key: string): boolean {
  const entry = failedAttempts.get(key);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    failedAttempts.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const entry = failedAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    failedAttempts.set(key, { count: 1, resetAt: now + BLOCK_WINDOW_MS });
  } else {
    entry.count++;
  }
  if (failedAttempts.size > 10000) {
    for (const [k, v] of failedAttempts) if (now > v.resetAt) failedAttempts.delete(k);
  }
}

function clearFailures(...keys: string[]): void {
  for (const k of keys) failedAttempts.delete(k);
}

function orderSummaryText(o: {
  customerType: string; customerNr?: string | null; companyName?: string | null;
  contactName?: string | null; contactEmail: string; contactPhone?: string | null;
  instrument: string; products?: string | null; deliveryAddress?: string | null; street?: string | null; houseNumber?: string | null; notes?: string | null;
}): string {
  return `
Kundentyp: ${o.customerType === "existing" ? "Bestandskunde" : "Neukunde"}
${o.customerNr ? `Kundennummer: ${o.customerNr}\n` : ""}Firma / Institution: ${o.companyName ?? "–"}
Ansprechpartner: ${o.contactName ?? "–"}
E-Mail: ${o.contactEmail}
Telefon: ${o.contactPhone ?? "–"}
Instrument: ${o.instrument}
Bestellte Produkte: ${o.products ?? "–"}
Lieferadresse: ${[o.street, o.houseNumber].filter(Boolean).join(" ") || o.deliveryAddress || "–"}
Anmerkungen: ${o.notes ?? "–"}`.trim();
}

function orderConfirmationSummaryText(
  o: Parameters<typeof orderSummaryText>[0],
  language: "de" | "en",
): string {
  if (language === "de") return orderSummaryText(o);
  return `
Customer type: ${o.customerType === "existing" ? "Existing customer" : "New customer"}
${o.customerNr ? `Customer number: ${o.customerNr}\n` : ""}Company / institution: ${o.companyName ?? "–"}
Contact person: ${o.contactName ?? "–"}
Email: ${o.contactEmail}
Phone: ${o.contactPhone ?? "–"}
Instrument: ${o.instrument}
Ordered products: ${o.products ?? "–"}
Delivery address: ${[o.street, o.houseNumber].filter(Boolean).join(" ") || o.deliveryAddress || "–"}
Notes: ${o.notes ?? "–"}`.trim();
}

// ── Submit an order (creates a PENDING order + sends approval email) ──────────
router.post("/orders", async (req, res) => {
  const parsed = SubmitOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid order data" });
    return;
  }
  const d = parsed.data;

  let websiteCustomerId: number | null = null;
  let customerNr: string | null = null;
  let companyName: string | null = d.companyName || null;

  // ── Existing customers must authenticate with customer number + reorder code ─
  if (d.customerType === "existing") {
    const enteredNr = (d.customerNr ?? "").trim();
    const enteredCode = normalizeCode(d.reorderCode ?? "");
    if (!enteredNr || !enteredCode || enteredCode.length !== 8) {
      res.status(400).json({ error: "CUSTOMER_CODE_REQUIRED" });
      return;
    }
    const ip = (req.get("x-forwarded-for") ?? req.ip ?? "").split(",")[0].trim();
    const ipKey = `ip:${ip}`;
    const nrKey = `nr:${enteredNr}`;
    if (isBlocked(ipKey) || isBlocked(nrKey)) {
      res.status(429).json({ error: "TOO_MANY_ATTEMPTS" });
      return;
    }
    const [customer] = await db
      .select()
      .from(websiteCustomersTable)
      .where(and(
        eq(websiteCustomersTable.customerNr, enteredNr),
        eq(websiteCustomersTable.reorderCode, enteredCode),
      ));
    if (!customer) {
      recordFailure(ipKey);
      recordFailure(nrKey);
      if (isBlocked(ipKey) || isBlocked(nrKey)) {
        res.status(429).json({ error: "TOO_MANY_ATTEMPTS" });
        return;
      }
      res.status(400).json({ error: "CUSTOMER_CODE_INVALID" });
      return;
    }
    clearFailures(ipKey, nrKey);
    websiteCustomerId = customer.id;
    customerNr = customer.customerNr;
    companyName = customer.institutionName
      ?? [customer.firstName, customer.lastName].filter(Boolean).join(" ")
      ?? null;
  }

  // ── Create pending order with a one-time approval token ─────────────────────
  const approvalToken = crypto.randomBytes(24).toString("hex");
  const [order] = await db.insert(irocOrders).values({
    websiteCustomerId,
    customerType: d.customerType,
    customerNr,
    companyName,
    contactName: d.contactName ?? null,
    contactEmail: d.contactEmail,
    contactPhone: d.contactPhone ?? null,
    instrument: d.instrument,
    products: d.products ?? null,
    deliveryAddress: d.deliveryAddress ?? null,
    // Keep the legacy free-text field for existing orders while retaining a
    // structured address for Sendcloud and future customer conversion.
    ...(d.street || d.houseNumber ? { deliveryAddress: [d.street, d.houseNumber].filter(Boolean).join(" ") } : {}),
    notes: d.notes ?? null,
    approvalToken,
    status: "pending",
  }).returning();

  // ── Approval email to the customer ──────────────────────────────────────────
  const approveUrl = `${publicBaseUrl()}/api/orders/approve/${approvalToken}`;
  // The public order contract currently has no country. Resolve it from the
  // stored website customer for existing orders, or contact-email records for
  // new orders; unknown recipients intentionally receive English.
  const language = await resolveRecipientLanguage({
    email: d.contactEmail,
    websiteCustomerId,
  });
  const summary = orderConfirmationSummaryText({ ...order, contactEmail: d.contactEmail }, language);

  try {
    await sendEmail({
      to: d.contactEmail,
      subject: language === "de"
        ? "Bitte bestätigen Sie Ihre Bestellung — iROC GmbH"
        : "Please confirm your order — iROC GmbH",
    text: await appendImpressumSignature(language === "de" ? `
Guten Tag,

vielen Dank für Ihre Bestellung bei iROC GmbH. Bitte prüfen Sie die folgenden Bestelldetails und bestätigen Sie die Bestellung über den Link unten. Erst nach Ihrer Bestätigung wird die Bestellung bearbeitet.

${summary}

Bestellung bestätigen:
${approveUrl}

      `.trim() : `
Hello,

thank you for your order with iROC GmbH. Please review the order details below and confirm your order using the link. Your order will only be processed after confirmation.

${summary}

Confirm order:
${approveUrl}

      `.trim(), language),
      mailboxPurpose: d.customerType === "existing" ? "order_existing" : "order_new",
    });
  } catch (err) {
    // Without the approval email the order could never be confirmed — remove it
    // and surface a clear error instead of leaving an orphaned pending order.
    console.error("[orders] Failed to send approval email:", err);
    await db.delete(irocOrders).where(eq(irocOrders.id, order.id));
    res.status(502).json({ error: "EMAIL_SEND_FAILED" });
    return;
  }

  res.status(201).json({ message: "Order submitted. Please check your email to confirm the order." });
});

// ── Approval link (opened from email) ─────────────────────────────────────────
router.get("/orders/approve/:token", async (req, res) => {
  const token = String(req.params.token);
  const [order] = await db.select().from(irocOrders).where(eq(irocOrders.approvalToken, token));

  const page = (title: string, body: string, ok: boolean) => `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — iROC GmbH</title>
<style>
body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6f8;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);padding:48px 40px;max-width:480px;text-align:center;margin:16px}
.icon{font-size:48px;margin-bottom:16px}
h1{font-size:22px;margin:0 0 12px;color:#0a2540}
p{color:#556;line-height:1.6;margin:0 0 8px;font-size:15px}
</style></head><body><div class="card">
<div class="icon">${ok ? "✅" : "⚠️"}</div><h1>${title}</h1>${body}
</div></body></html>`;

  if (!order) {
    res.status(404).send(page(
      "Link ungültig / Invalid link",
      `<p>Dieser Bestätigungslink ist ungültig oder abgelaufen.</p><p>This confirmation link is invalid or has expired.</p>`,
      false,
    ));
    return;
  }

  if (order.status === "approved") {
    res.send(page(
      "Bereits bestätigt / Already confirmed",
      `<p>Diese Bestellung wurde bereits bestätigt und wird bearbeitet.</p><p>This order has already been confirmed and is being processed.</p>`,
      true,
    ));
    return;
  }

  // Atomic pending → approved transition: concurrent requests can't double-approve
  const [approved] = await db.update(irocOrders)
    .set({ status: "approved", approvedAt: new Date() })
    .where(and(eq(irocOrders.id, order.id), eq(irocOrders.status, "pending")))
    .returning();
  if (!approved) {
    res.send(page(
      "Bereits bestätigt / Already confirmed",
      `<p>Diese Bestellung wurde bereits bestätigt und wird bearbeitet.</p><p>This order has already been confirmed and is being processed.</p>`,
      true,
    ));
    return;
  }

  // ── Now that the customer approved: notify iROC admins ────────────────────
  const summary = orderSummaryText(order);
  const destKey = order.customerType === "existing" ? "email_dest_order_existing" : "email_dest_order_new";
  try {
    const mailboxPurpose = order.customerType === "existing" ? "order_existing" : "order_new";
    const to = await getEmailDest(destKey, { mailboxPurpose });
    await sendEmail({
      to,
      subject: `Bestätigte Bestellung: ${order.companyName ?? order.contactEmail} – ${order.instrument}`,
      text: `Eine Bestellung wurde vom Kunden per E-Mail-Link bestätigt und kann jetzt bearbeitet werden.\n\n${summary}`,
      replyTo: order.contactEmail,
      mailboxPurpose,
    });
  } catch (err) {
    // The order is already confirmed, but silently losing the internal
    // notification would hide a mailbox configuration problem from admins.
    console.error("[orders] Failed to send admin notification:", err);
    try {
      await db.insert(irocNotifications).values({
        type: "email_delivery_failed",
        message: JSON.stringify({
          de: `Bestätigte Bestellung: E-Mail-Versand fehlgeschlagen. ${err instanceof Error ? err.message : "Bitte die E-Mail-Konfiguration prüfen."}`,
          en: `Confirmed order: email delivery failed. ${err instanceof Error ? err.message : "Please check the email configuration."}`,
        }),
      });
    } catch (notificationErr) {
      console.error("[orders] Failed to create email failure notification:", notificationErr);
    }
  }

  // Kick off Sally's order review in the background (non-blocking, non-critical)
  setImmediate(() => {
    import("../lib/sally-order-review.js")
      .then(m => m.reviewOrder(approved.id))
      .catch(err => console.error("[orders] Sally review failed:", err));
  });

  try {
    await db.insert(irocNotifications).values({
      type: "new_order",
      message: JSON.stringify({
        de: `Neue Bestellung: ${order.companyName ?? order.contactEmail}${order.customerNr ? ` (Kd-Nr. ${order.customerNr})` : ""} – ${order.instrument}`,
        en: `New order: ${order.companyName ?? order.contactEmail}${order.customerNr ? ` (Customer no. ${order.customerNr})` : ""} – ${order.instrument}`,
      }),
    });
  } catch { /* non-critical */ }

  res.send(page(
    "Bestellung bestätigt / Order confirmed",
    `<p>Vielen Dank! Ihre Bestellung wurde bestätigt und wird nun von uns bearbeitet.</p>
     <p>Thank you! Your order has been confirmed and will now be processed by our team.</p>`,
    true,
  ));
});

export default router;
