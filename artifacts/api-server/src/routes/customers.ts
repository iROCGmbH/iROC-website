import { Router, type IRouter } from "express";
import { RegisterCustomerBody } from "@workspace/api-zod";
import { sendEmail } from "../lib/email";
import { publicBaseUrl } from "../lib/public-url";
import { db, pool } from "@workspace/db";
import { websiteCustomersTable, irocOrders, irocNotifications } from "@workspace/db";
import { like, max, eq } from "drizzle-orm";
import crypto from "node:crypto";
import { generateUniqueReorderCode } from "../lib/reorder-code";
import { normalizeWebsiteCustomerNameFields } from "../lib/website-customer-name";
import { recipientLanguageForCountry } from "../lib/recipient-language";
import { appendImpressumSignature } from "../lib/impressum-signature";

const router: IRouter = Router();

// ── Public: list certified doctors for the treating-doctor dropdown ─────────────
// Sources (merged, deduplicated by display name):
//  1. trained_doctors — doctors who attended iROC training (the primary source)
//  2. sally_certified_doctors — doctors added manually via Sally CRM
// Optional ?instrument=spirecut&instrument=ministem filter narrows results to
// doctors certified for those product groups (via doctor_certifications).
// Falls back to all trained doctors when no certifications exist for the filter.
router.get("/certified-doctors", async (req, res) => {
  try {
    const instruments = [req.query.instrument]
      .flat()
      .filter((v): v is string => typeof v === "string" && v.trim() !== "");

    let rows: { id: number; name: string; institutionName: string | null }[];

    if (instruments.length > 0) {
      // Try filtered: doctors with a certification in one of the requested instruments
      const filtered = await pool.query<{ id: number; name: string; institutionName: string | null }>(
        `SELECT DISTINCT td.id,
                TRIM(CONCAT_WS(' ', td.title, td.first_name, td.last_name)) AS name,
                td.institution_name AS "institutionName"
           FROM trained_doctors td
           JOIN doctor_certifications dc ON dc.doctor_id = td.id
          WHERE TRIM(td.last_name) <> ''
            AND dc.instrument = ANY($1::text[])
          UNION
           SELECT id * -1, name, NULL::text AS "institutionName"
            FROM sally_certified_doctors
           WHERE deleted_at IS NULL AND is_cancelled = false
          ORDER BY name`,
        [instruments],
      );
      // Fallback to all trained doctors if certifications table has no matches
      if (filtered.rows.length > 0) {
        rows = filtered.rows;
      } else {
        const all = await pool.query<{ id: number; name: string; institutionName: string | null }>(
          `SELECT id,
                  TRIM(CONCAT_WS(' ', title, first_name, last_name)) AS name,
                  institution_name AS "institutionName"
             FROM trained_doctors
            WHERE TRIM(last_name) <> ''
            UNION
             SELECT id * -1, name, NULL::text AS "institutionName"
              FROM sally_certified_doctors
             WHERE deleted_at IS NULL AND is_cancelled = false
            ORDER BY name`,
        );
        rows = all.rows;
      }
    } else {
      // No filter — return everyone
      const all = await pool.query<{ id: number; name: string; institutionName: string | null }>(
        `SELECT id,
                TRIM(CONCAT_WS(' ', title, first_name, last_name)) AS name,
                institution_name AS "institutionName"
           FROM trained_doctors
          WHERE TRIM(last_name) <> ''
          UNION
          SELECT id * -1, name, NULL::text AS "institutionName"
            FROM sally_certified_doctors
           WHERE deleted_at IS NULL AND is_cancelled = false
          ORDER BY name`,
      );
      rows = all.rows;
    }

    res.json(rows);
  } catch (err) {
    console.error("[certified-doctors] query failed:", err);
    res.json([]); // non-fatal; form degrades gracefully
  }
});

// ── Register a new customer ────────────────────────────────────────────────────
router.post("/customers/register", async (req, res) => {
  const parsed = RegisterCustomerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid registration data" });
    return;
  }

  const d = parsed.data;
  const normalizedNames = normalizeWebsiteCustomerNameFields({
    title: d.title,
    firstName: d.firstName,
    lastName: d.lastName,
  });
  const firstName = normalizedNames.firstName;
  const lastName = normalizedNames.lastName;

  // Either personal name (firstName + lastName) or institution name is required
  const hasPersonName = !!(firstName?.trim() && lastName?.trim());
  const hasInstitution = !!d.institutionName?.trim();
  if (!hasPersonName && !hasInstitution) {
    res.status(400).json({ error: "Either a personal name (first + last) or institution name is required" });
    return;
  }

  // Salutation is required only when a personal name is given
  if (hasPersonName && !d.salutation?.trim()) {
    res.status(400).json({ error: "Salutation is required when a personal name is provided" });
    return;
  }

  // Treating doctor name from body (optional free-text / dropdown selection)
  const treatingDoctorName = (req.body as Record<string, unknown>).treatingDoctorName as string | null | undefined;

  // ── Auto-generate customer number (yyyy-####) ──────────────────────────────
  const year = new Date().getFullYear();
  const prefix = `${year}-`;
  const [maxRow] = await db
    .select({ maxNr: max(websiteCustomersTable.customerNr) })
    .from(websiteCustomersTable)
    .where(like(websiteCustomersTable.customerNr, `${prefix}%`));

  let nextSeq = 1;
  if (maxRow?.maxNr) {
    const seq = parseInt(maxRow.maxNr.slice(prefix.length), 10);
    if (!isNaN(seq)) nextSeq = seq + 1;
  }
  const customerNr = `${prefix}${String(nextSeq).padStart(4, "0")}`;

  // ── Generate a unique reorder code ────────────────────────────────────────
  const reorderCode = await generateUniqueReorderCode();

  // ── Persist customer to database (always — even if email later fails) ──────
  const displayName = hasPersonName
    ? [firstName, lastName].filter(Boolean).join(" ")
    : (d.institutionName ?? d.email);

  const [newCustomer] = await db.insert(websiteCustomersTable).values({
    customerNr,
    reorderCode,
    salutation:      d.salutation,
    title:           d.title ?? null,
    firstName:       firstName ?? null,
    lastName:        lastName ?? null,
    specialty:       d.specialty ?? null,
    institutionName: d.institutionName ?? null,
    institutionType: (d as { institutionType?: string }).institutionType ?? null,
    address:         d.address ?? null,
    postalCode:      d.postalCode ?? null,
    city:            d.city ?? null,
    country:         d.country ?? null,
    phone:           d.phone ?? null,
    fax:             d.fax ?? null,
    email:           d.email,
    website:         (d as { website?: string }).website ?? null,
    referenceNumber: (d as { referenceNumber?: string }).referenceNumber ?? null,
    ustIdNr:         (d as { ustIdNr?: string }).ustIdNr ?? null,
    instrument:          d.instrument,
    notes:               d.notes ?? null,
    privacyConsent:      d.privacyConsent,
    treatingDoctorName:  treatingDoctorName ?? null,
    shippingFirstName:       d.shippingFirstName ?? null,
    shippingLastName:        d.shippingLastName ?? null,
    shippingInstitutionName: d.shippingInstitutionName ?? null,
    shippingAddress:         d.shippingAddress ?? null,
    shippingPostalCode:      d.shippingPostalCode ?? null,
    shippingCity:            d.shippingCity ?? null,
    shippingCountry:         d.shippingCountry ?? null,
    shippingPhone:           d.shippingPhone ?? null,
    shippingEmail:           d.shippingEmail ?? null,
  }).returning();

  // ── Treating doctor: notify admin if the name isn't a certified doctor ─────
  if (treatingDoctorName?.trim()) {
    try {
      const { rows: doctorRows } = await pool.query<{ id: number }>(
        `SELECT id FROM sally_certified_doctors
         WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL AND is_cancelled = false`,
        [treatingDoctorName.trim()],
      );
      if (doctorRows.length === 0) {
        await db.insert(irocNotifications).values({
          type: "unknown_treating_doctor",
          message: JSON.stringify({
            de: `Neuer Kunde ${displayName} hat einen unbekannten behandelnden Arzt angegeben: ${treatingDoctorName}`,
            en: `New customer ${displayName} specified a treating doctor not in the certified list: ${treatingDoctorName}`,
          }),
        });
      }
    } catch (err) {
      console.error("[customers] Treating-doctor check failed:", err);
    }
  }

  // ── Create a pending order only if products were included ──────────────────
  const productStr = (d.notes ?? "").includes("Produkte") || (d.notes ?? "").includes("Products");
  let approvalToken: string | null = null;
  if (productStr || d.notes) {
    approvalToken = crypto.randomBytes(24).toString("hex");
    await db.insert(irocOrders).values({
      websiteCustomerId: newCustomer.id,
      customerType: "new",
      customerNr,
      companyName: d.institutionName ?? displayName,
      contactName: displayName,
      contactEmail: d.email,
      contactPhone: d.phone ?? null,
      instrument: d.instrument,
      products: null,
      deliveryAddress: null,
      notes: d.notes ?? null,
      approvalToken,
      status: "pending",
    });
  }

  // ── Send email (non-fatal — customer is already saved) ────────────────────
  try {
    const language = recipientLanguageForCountry(d.country);
    if (approvalToken) {
      const approveUrl = `${publicBaseUrl()}/api/orders/approve/${approvalToken}`;
      await sendEmail({
        to: d.email,
        subject: language === "de"
          ? "Bitte bestätigen Sie Ihre Registrierung & Bestellung — iROC GmbH"
          : "Please confirm your registration & order — iROC GmbH",
        text: await appendImpressumSignature(language === "de" ? `
Guten Tag ${displayName},

vielen Dank für Ihre Registrierung und Bestellung bei iROC GmbH. Ihre Kundennummer lautet: ${customerNr}

Bitte bestätigen Sie Ihre Bestellung über den folgenden Link. Erst nach Ihrer Bestätigung wird die Bestellung bearbeitet:

${approveUrl}

        `.trim() : `
Hello,

thank you for registering and ordering with iROC GmbH. Your customer number is: ${customerNr}

Please confirm your order using the link below. Your order will only be processed after confirmation:

${approveUrl}

        `.trim(), language),
        mailboxPurpose: "order_new",
      });
    } else {
      // Registration only (no products) — send a simple welcome email
      await sendEmail({
        to: d.email,
        subject: language === "de"
          ? "Ihre Registrierung bei iROC GmbH"
          : "Your registration with iROC GmbH",
        text: await appendImpressumSignature(language === "de" ? `
Guten Tag ${displayName},

vielen Dank für Ihre Registrierung bei iROC GmbH. Ihre Kundennummer lautet: ${customerNr}

Wir werden uns in Kürze bei Ihnen melden.

        `.trim() : `
Hello,

thank you for registering with iROC GmbH. Your customer number is: ${customerNr}

We will be in touch with you shortly.

        `.trim(), language),
        mailboxPurpose: "order_new",
      });
    }
  } catch (err) {
    // Email failure is logged but does NOT roll back the customer record
    console.error("[customers] Failed to send confirmation email:", err);
    try {
      await pool.query(
        `INSERT INTO iroc_notifications (type, message)
         VALUES ('email_delivery_failed', $1)`,
        [JSON.stringify({
          de: `Kundenregistrierung: E-Mail-Versand fehlgeschlagen. ${err instanceof Error ? err.message : "Bitte die E-Mail-Konfiguration prüfen."}`,
          en: `Customer registration: email delivery failed. ${err instanceof Error ? err.message : "Please check the email configuration."}`,
        })],
      );
    } catch (notificationErr) {
      console.error("[customers] Failed to create email failure notification:", notificationErr);
    }
  }

  res.status(201).json({ message: "Registration received. Please check your email." });
});

export default router;
