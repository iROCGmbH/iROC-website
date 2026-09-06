import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { trainingDatesTable, trainingRegistrationsTable, irocNotifications } from "@workspace/db";
import { RegisterForTrainingBody } from "@workspace/api-zod";
import { sendEmail, getEmailDest } from "../lib/email";
import { publicBaseUrl } from "../lib/public-url";
import {
  confirmTrainingRegistration,
  TrainingRegistrationConfirmationError,
} from "../lib/training-registration-lead.js";
import { and, eq, sql } from "drizzle-orm";
import { recipientLanguageForCountry } from "../lib/recipient-language";
import { appendImpressumSignature } from "../lib/impressum-signature";

const router: IRouter = Router();

function htmlPage(title: string, body: string, success: boolean): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} – iROC GmbH</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f4f6f8; margin: 0; padding: 24px; }
  .card { max-width: 560px; margin: 48px auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08); padding: 40px 32px; text-align: center; }
  .icon { font-size: 48px; }
  h1 { font-size: 22px; color: #0f2a4a; margin: 16px 0 8px; }
  p { color: #444; line-height: 1.6; margin: 8px 0; }
  .brand { margin-top: 28px; color: #888; font-size: 13px; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? "✅" : "⚠️"}</div>
    <h1>${title}</h1>
    ${body}
    <p class="brand">iROC GmbH</p>
  </div>
</body>
</html>`;
}

// GET /training/dates — return all active upcoming training dates
router.get("/training/dates", async (_req, res) => {
  const rows = await db
    .select()
    .from(trainingDatesTable)
    .where(and(eq(trainingDatesTable.isActive, true)));

  const result = rows.map((r) => ({
    id: r.id,
    instrument: r.instrument,
    date: r.date,
    time: r.time ?? null,
    location: r.location,
    locationDetail: r.locationDetail ?? null,
    maxParticipants: r.maxParticipants,
    availableSpots: Math.max(0, r.maxParticipants - r.registeredCount),
    isActive: r.isActive,
    notes: r.notes ?? null,
  }));

  res.json(result);
});

// POST /training/register
router.post("/training/register", async (req, res) => {
  const parsed = RegisterForTrainingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid training registration data" });
    return;
  }

  const d = parsed.data;

  if (d.privacyConsent !== true || d.marketingConsent !== true) {
    res.status(400).json({ error: "Required consent is missing" });
    return;
  }

  // Fetch the training date info
  const [trainingDate] = await db
    .select()
    .from(trainingDatesTable)
    .where(eq(trainingDatesTable.id, d.trainingDateId));

  if (!trainingDate) {
    res.status(400).json({ error: "Training date not found" });
    return;
  }

  // Check if within 3 weeks
  const threeWeeksFromNow = new Date();
  threeWeeksFromNow.setDate(threeWeeksFromNow.getDate() + 21);
  const trainingDateObj = new Date(trainingDate.date);
  if (trainingDateObj < threeWeeksFromNow) {
    res.status(400).json({ error: "Registration is closed for this training date (within 3 weeks)" });
    return;
  }

  // Persist registration + count atomically (pending until the doctor confirms via email link)
  const trainingDateInfo = `${trainingDate.date}${trainingDate.time ? ` ${trainingDate.time}` : ""} – ${trainingDate.location}`;
  const confirmationToken = crypto.randomBytes(24).toString("hex");
  const registration = await db.transaction(async (tx) => {
    await tx
      .update(trainingDatesTable)
      .set({ registeredCount: sql`${trainingDatesTable.registeredCount} + 1` })
      .where(eq(trainingDatesTable.id, d.trainingDateId));
    const [row] = await tx.insert(trainingRegistrationsTable).values({
    salutation: d.salutation,
    medicalDegree: d.medicalDegree,
    firstName: d.firstName,
    lastName: d.lastName,
    specialty: d.specialty ?? null,
    institutionName: d.institutionName ?? null,
    address: d.address ?? null,
    street: d.street ?? null,
    houseNumber: d.houseNumber ?? null,
    postalCode: d.postalCode ?? null,
    city: d.city ?? null,
    country: d.country ?? null,
    phone: d.phone ?? null,
    fax: (d as { fax?: string | null }).fax ?? null,
    email: d.email,
    instrument: d.instrument,
    trainingDateId: d.trainingDateId,
    trainingDateInfo,
    websiteUrl: (d as { websiteUrl?: string | null }).websiteUrl ?? null,
    notes: (d as { notes?: string | null }).notes ?? null,
      privacyConsent: d.privacyConsent,
       marketingConsent: d.marketingConsent,
      status: "pending",
      confirmationToken,
    }).returning();
    return row;
  });

  // ── Confirmation email to the doctor (double opt-in) ─────────────────────
  // Admin notification/email fire only AFTER the doctor confirms.
  const confirmUrl = `${publicBaseUrl()}/api/training/confirm/${confirmationToken}`;
  const instrumentLabel = d.instrument === "spirecut" ? "Spirecut" : "MiniStem";
  const language = recipientLanguageForCountry(d.country);
  try {
    await sendEmail({
      to: d.email,
      subject: language === "de"
        ? "Bitte bestätigen Sie Ihre Schulungsanmeldung – iROC GmbH"
        : "Please confirm your training registration – iROC GmbH",
      text: await appendImpressumSignature(language === "de" ? `
Sehr geehrte/r ${d.medicalDegree ?? ""} ${d.firstName} ${d.lastName},

vielen Dank für Ihre Anmeldung zur ${instrumentLabel}-Schulung:

Termin: ${trainingDateInfo}

Bitte bestätigen Sie Ihre Anmeldung über den folgenden Link. Erst nach Ihrer Bestätigung wird Ihre Anmeldung bearbeitet:

${confirmUrl}

Nach Prüfung Ihrer Anmeldung erhalten Sie von uns eine Bestätigung mit der Rechnung für den Schulungstag.

      `.trim() : `
Dear ${d.medicalDegree ?? ""} ${d.firstName} ${d.lastName},

thank you for registering for the ${instrumentLabel} training:

Date: ${trainingDateInfo}

Please confirm your registration using the link below. Your registration will only be processed after confirmation:

${confirmUrl}

After review, you will receive a confirmation with the invoice for the training day.

      `.trim(), language),
      mailboxPurpose: d.instrument === "spirecut" ? "training_spirecut" : "training_ministem",
    });
  } catch (err) {
    // Roll back atomically so the doctor can retry and the spot isn't lost
    console.error("[training] Failed to send confirmation email:", err);
    await db.transaction(async (tx) => {
      await tx.delete(trainingRegistrationsTable).where(eq(trainingRegistrationsTable.id, registration.id));
      await tx.update(trainingDatesTable)
        .set({ registeredCount: sql`GREATEST(${trainingDatesTable.registeredCount} - 1, 0)` })
        .where(eq(trainingDatesTable.id, d.trainingDateId));
    });
    res.status(502).json({ error: "EMAIL_SEND_FAILED" });
    return;
  }

  res.status(201).json({ message: "Training registration submitted. Please confirm via the link in your email." });
});

// GET /training/confirm/:token — doctor confirms the registration via email link
router.get("/training/confirm/:token", async (req, res) => {
  const token = String(req.params.token ?? "").trim();
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (!token) {
    res.status(400).send(htmlPage("Link ungültig / Invalid link", `<p>Dieser Bestätigungslink ist ungültig.</p><p>This confirmation link is invalid.</p>`, false));
    return;
  }

  const [registration] = await db
    .select()
    .from(trainingRegistrationsTable)
    .where(eq(trainingRegistrationsTable.confirmationToken, token));

  if (!registration) {
    res.status(404).send(htmlPage("Link ungültig / Invalid link", `<p>Dieser Bestätigungslink ist ungültig oder abgelaufen.</p><p>This confirmation link is invalid or has expired.</p>`, false));
    return;
  }

  let confirmation;
  try {
    confirmation = await confirmTrainingRegistration(registration.id);
  } catch (err) {
    if (err instanceof TrainingRegistrationConfirmationError) {
      res.status(err.statusCode).send(htmlPage(
        "Bestätigung nicht möglich / Confirmation unavailable",
        `<p>${err.message}</p><p>Die Anmeldung wurde nicht verändert. / The registration was not changed.</p>`,
        false,
      ));
      return;
    }
    throw err;
  }

  if (!confirmation.didConfirm) {
    res.send(htmlPage(
      "Bereits bestätigt / Already confirmed",
      `<p>Ihre Anmeldung wurde bereits bestätigt.</p><p>Your registration has already been confirmed.</p>`,
      true,
    ));
    return;
  }

  const r = confirmation.registration;

  // ── Admin email (only after doctor confirmation) ──────────────────────────
  try {
    const subject = `Schulungsanmeldung (bestätigt): ${r.medicalDegree ?? ""} ${r.firstName} ${r.lastName} – ${r.trainingDateInfo ?? ""}`.trim();
    const text = `
Bestätigte Schulungsanmeldung bei iROC GmbH

Der/die Teilnehmer/in hat die Anmeldung per E-Mail-Link bestätigt.

Anrede: ${r.salutation ?? "–"}
Akademischer Grad: ${r.medicalDegree ?? "–"}
Vorname: ${r.firstName}
Nachname: ${r.lastName}
Fachgebiet: ${r.specialty ?? "–"}
Institution: ${r.institutionName ?? "–"}
Adresse: ${r.address ?? "–"}
PLZ: ${r.postalCode ?? "–"}
Stadt: ${r.city ?? "–"}
Land: ${r.country ?? "–"}
Telefon: ${r.phone ?? "–"}
Fax: ${r.fax ?? "–"}
E-Mail: ${r.email}
Instrument: ${r.instrument}
Schulungstermin: ${r.trainingDateInfo ?? "–"}
Anmerkungen: ${r.notes ?? "–"}

Nächster Schritt: Bitte prüfen Sie die Anmeldung, erstellen Sie die Rechnung für den Schulungstag in der iROC App
und senden Sie die Bestätigung mit der Rechnung manuell an den/die Teilnehmer/in.
Die Rechnung wird NICHT automatisch versendet.
    `.trim();
    const mailboxPurpose = r.instrument === "spirecut" ? "training_spirecut" : "training_ministem";
    const to = await getEmailDest(`email_dest_training_${r.instrument}`, { mailboxPurpose });
    await sendEmail({
      to,
      subject,
      text,
      replyTo: r.email,
      mailboxPurpose,
    });
  } catch (err) {
    console.error("[training] Failed to send admin email:", err);
    try {
      await db.insert(irocNotifications).values({
        type: "email_delivery_failed",
        message: JSON.stringify({
          de: `Bestätigte Schulungsanmeldung: E-Mail-Versand fehlgeschlagen. ${err instanceof Error ? err.message : "Bitte die E-Mail-Konfiguration prüfen."}`,
          en: `Confirmed training registration: email delivery failed. ${err instanceof Error ? err.message : "Please check the email configuration."}`,
        }),
      });
    } catch (notificationErr) {
      console.error("[training] Failed to create email failure notification:", notificationErr);
    }
  }

  // Notify iROC Interface App dashboard
  try {
    await db.insert(irocNotifications).values({
      type: "new_training_registration",
      message: JSON.stringify({
        de: `Schulungsanmeldung: ${r.medicalDegree ?? ""} ${r.firstName} ${r.lastName} – ${r.trainingDateInfo ?? ""}`.trim(),
        en: `Training registration: ${r.medicalDegree ?? ""} ${r.firstName} ${r.lastName} – ${r.trainingDateInfo ?? ""}`.trim(),
      }),
    });
  } catch { /* non-critical */ }

  res.send(htmlPage(
    "Anmeldung bestätigt / Registration confirmed",
    `<p>Vielen Dank! Ihre Schulungsanmeldung wurde bestätigt.</p>
     <p>Nach Prüfung durch iROC GmbH erhalten Sie eine Bestätigung mit der Rechnung für den Schulungstag.</p>
     <p>Thank you! Your training registration has been confirmed.</p>
     <p>After review by iROC GmbH you will receive a confirmation with the invoice for the training day.</p>`,
    true,
  ));
});

export default router;
