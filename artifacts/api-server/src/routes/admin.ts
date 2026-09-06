import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { pool } from "@workspace/db";
import { trainingDatesTable, trainedDoctorsTable, doctorCertificationsTable, resourcesTable, settingsTable, trainingRegistrationsTable, websiteCustomersTable, irocInvoices } from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage.js";
import {
  CreateTrainingDateBody,
  DeleteTrainingDateParams,
  CreateTrainedDoctorBody,
  DeleteTrainedDoctorParams,
  CreateResourceBody,
  DeleteResourceParams,
} from "@workspace/api-zod";
import { eq, desc, isNotNull, sql } from "drizzle-orm";
import { sendEmail, sendEmailConfigurationTest } from "../lib/email";
import { normalizeWebsiteCustomerNameFields } from "../lib/website-customer-name";
import {
  confirmTrainingRegistration,
  TrainingRegistrationConfirmationError,
} from "../lib/training-registration-lead.js";
import cookieParser from "cookie-parser";
import { requireAdmin } from "./admin-auth.js";
import { verifyToken } from "./iroc.js";
import { recipientLanguageForCountry } from "../lib/recipient-language";
import { appendImpressumSignature } from "../lib/impressum-signature";
import {
  buildMicrosoftAuthorizationUrl,
  decryptMicrosoftToken,
  encryptMicrosoftToken,
  exchangeMicrosoftCode,
  getMicrosoftIdentity,
  getMicrosoftRedirectUri,
  microsoftGraphRequest,
  refreshMicrosoftAccessToken,
  MicrosoftGraphAuthorizationError,
  MicrosoftOAuthConfigError,
  MicrosoftOAuthError,
  MICROSOFT_EMAIL_PURPOSES,
  type EmailDeliveryProvider,
  type MicrosoftOAuthTokens,
} from "../lib/microsoft-365.js";
import { CHATBOT_SYSTEM_PROMPT_MAX_LENGTH } from "@workspace/spirecut-shared";
import {
  listEmailSignatureAddresses,
  saveEmailSignatureProfile,
  validateEmailSignatureLogo,
  validateEmailSignatureProfile,
} from "../lib/email-signatures.js";
import { geocodeDoctorLocation } from "../lib/geocode.js";
import { readPatientSettings } from "./settings.js";

const router: IRouter = Router();
router.use(cookieParser());

const objectStorageService = new ObjectStorageService();

router.get("/admin/email-signatures", requireAdmin, async (_req, res) => {
  try {
    const addresses = await listEmailSignatureAddresses();
    const rows = await db.select().from(settingsTable);
    const signatures = rows.filter(row => row.key.startsWith("iroc.email_signature.")).map(row => {
      try { return validateEmailSignatureProfile(JSON.parse(row.value)); }
      catch { throw new Error(`Saved email signature '${row.key}' is malformed. Please correct it before using email signatures.`); }
    });
    res.json({ addresses, signatures });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load email signatures." });
  }
});
router.put("/admin/email-signatures/:group", requireAdmin, async (req, res) => {
  const group = req.params.group;
  if (group !== "admin" && group !== "sally" && group !== "tori") { res.status(400).json({ error: "group must be admin, sally, or tori." }); return; }
  try {
    const profile = validateEmailSignatureProfile(req.body, group);
    if (profile.logoPath) {
      const logoFile = await objectStorageService.getObjectEntityFile(profile.logoPath);
      const logoResponse = await objectStorageService.downloadObject(logoFile);
      if (!logoResponse.ok) throw new Error("Unable to verify the signature logo. / Das Signaturlogo konnte nicht überprüft werden.");
      const contentType = logoResponse.headers.get("content-type") || "application/octet-stream";
      const content = Buffer.from(await logoResponse.arrayBuffer());
      validateEmailSignatureLogo(content, contentType);
    }
    if (profile.addressId) {
      const addresses = await listEmailSignatureAddresses();
      if (!addresses.some(address => address.id === profile.addressId)) {
        res.status(400).json({ error: "addressId must identify a currently configured sender address." });
        return;
      }
    }
    await saveEmailSignatureProfile(profile);
    res.json(profile);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid email signature profile." }); }
});

// Token verification endpoint
router.get("/admin/verify", requireAdmin, (_req, res) => {
  res.json({ ok: true });
});

// Training dates
router.post("/admin/training-dates", requireAdmin, async (req, res) => {
  const parsed = CreateTrainingDateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid training date data" });
    return;
  }

  const [row] = await db.insert(trainingDatesTable).values({
    instrument: parsed.data.instrument,
    date: parsed.data.date,
    time: parsed.data.time ?? null,
    location: parsed.data.location,
    locationDetail: parsed.data.locationDetail ?? null,
    maxParticipants: parsed.data.maxParticipants,
    notes: parsed.data.notes ?? null,
    isActive: true,
  }).returning();

  res.status(201).json({
    id: row.id,
    instrument: row.instrument,
    date: row.date,
    time: row.time ?? null,
    location: row.location,
    locationDetail: row.locationDetail ?? null,
    maxParticipants: row.maxParticipants,
    availableSpots: row.maxParticipants,
    isActive: row.isActive,
    notes: row.notes ?? null,
  });
});

router.delete("/admin/training-dates/:id", requireAdmin, async (req, res) => {
  const parsed = DeleteTrainingDateParams.safeParse({ id: parseInt(req.params.id as string) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }
  await db.delete(trainingDatesTable).where(eq(trainingDatesTable.id, parsed.data.id));
  res.json({ message: "Training date deleted" });
});

router.patch("/admin/training-dates/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const body = req.body as Record<string, unknown>;
  const update: Record<string, unknown> = {};
  if ("instrument" in body) update.instrument = body.instrument;
  if ("date" in body) update.date = body.date;
  if ("time" in body) update.time = (body.time as string) || null;
  if ("location" in body) update.location = body.location;
  if ("locationDetail" in body) update.locationDetail = (body.locationDetail as string) || null;
  if ("maxParticipants" in body) update.maxParticipants = parseInt(String(body.maxParticipants));
  if ("notes" in body) update.notes = (body.notes as string) || null;
  if (Object.keys(update).length === 0) { res.status(400).json({ error: "No fields provided" }); return; }
  const [row] = await db.update(trainingDatesTable).set(update as Parameters<ReturnType<typeof db.update>["set"]>[0]).where(eq(trainingDatesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ id: row.id, instrument: row.instrument, date: row.date, time: row.time ?? null, location: row.location, locationDetail: row.locationDetail ?? null, maxParticipants: row.maxParticipants, notes: row.notes ?? null, isActive: row.isActive });
});

// Trained doctors
router.post("/admin/doctors/:id/geocode", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [doctor] = await db
    .select({
      id: trainedDoctorsTable.id,
      postalCode: trainedDoctorsTable.postalCode,
      city: trainedDoctorsTable.city,
      country: trainedDoctorsTable.country,
    })
    .from(trainedDoctorsTable)
    .where(eq(trainedDoctorsTable.id, id));
  if (!doctor) {
    res.status(404).json({ error: "Doctor not found" });
    return;
  }

  if (!doctor.postalCode?.trim() || !doctor.city?.trim() || !doctor.country?.trim()) {
    res.status(422).json({
      code: "INCOMPLETE_ADDRESS",
      error: "Postal code, city, and country are required. Check the address and enter coordinates manually if needed.",
    });
    return;
  }

  const result = await geocodeDoctorLocation(doctor.postalCode, doctor.city, doctor.country);
  res.json(result);
});

router.post("/admin/doctors", requireAdmin, async (req, res) => {
  const parsed = CreateTrainedDoctorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid doctor data" });
    return;
  }

  const _websiteUrl = (parsed.data as { websiteUrl?: string | null }).websiteUrl ?? "";
  if (!isValidOptionalUrl(_websiteUrl)) {
    res.status(400).json({ error: "websiteUrl must be a valid http or https URL" });
    return;
  }

  const { lat, lon } = parsed.data;
  const certifications = parsed.data.certifications as { instrument: string; certifiedDate: string }[];
  if (!certifications || certifications.length === 0) {
    res.status(400).json({ error: "At least one certification is required" });
    return;
  }

  const [row] = await db.insert(trainedDoctorsTable).values({
    title: parsed.data.title ?? null,
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    specialty: parsed.data.specialty ?? null,
    institutionName: parsed.data.institutionName ?? null,
    city: parsed.data.city,
    postalCode: parsed.data.postalCode ?? null,
    country: parsed.data.country,
    phone: (parsed.data as { phone?: string | null }).phone ?? null,
    email: (parsed.data as { email?: string | null }).email ?? null,
    websiteUrl: (parsed.data as { websiteUrl?: string | null }).websiteUrl ?? null,
    lat: lat ?? null,
    lon: lon ?? null,
  }).returning();

  const certRows = await db.insert(doctorCertificationsTable)
    .values(certifications.map((c) => ({
      doctorId: row.id,
      instrument: c.instrument,
      certifiedDate: c.certifiedDate,
    })))
    .returning();

  res.status(201).json({
    id: row.id,
    title: row.title ?? null,
    firstName: row.firstName,
    lastName: row.lastName,
    specialty: row.specialty ?? null,
    institutionName: row.institutionName ?? null,
    city: row.city,
    postalCode: row.postalCode ?? null,
    country: row.country,
    phone: row.phone ?? null,
    email: row.email ?? null,
    websiteUrl: row.websiteUrl ?? null,
    lat: row.lat ?? null,
    lon: row.lon ?? null,
    certifications: certRows.map((c) => ({ instrument: c.instrument, certifiedDate: c.certifiedDate })),
  });
});

// Update certifications for an existing doctor
router.put("/admin/doctors/:id/certifications", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const certifications = req.body.certifications as { instrument: string; certifiedDate: string }[] | undefined;
  if (!Array.isArray(certifications) || certifications.length === 0) {
    res.status(400).json({ error: "certifications array required" });
    return;
  }

  // Replace all certifications for this doctor
  await db.delete(doctorCertificationsTable).where(eq(doctorCertificationsTable.doctorId, id));
  const certRows = await db.insert(doctorCertificationsTable)
    .values(certifications.map((c) => ({ doctorId: id, instrument: c.instrument, certifiedDate: c.certifiedDate })))
    .returning();

  res.json({ certifications: certRows.map((c) => ({ instrument: c.instrument, certifiedDate: c.certifiedDate })) });
});

// Full update of a doctor (fields + certifications)
router.patch("/admin/doctors/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = CreateTrainedDoctorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid doctor data" });
    return;
  }

  const _websiteUrlPatch = (parsed.data as { websiteUrl?: string | null }).websiteUrl ?? "";
  if (!isValidOptionalUrl(_websiteUrlPatch)) {
    res.status(400).json({ error: "websiteUrl must be a valid http or https URL" });
    return;
  }

  const { lat, lon } = parsed.data;
  const certifications = parsed.data.certifications as { instrument: string; certifiedDate: string }[];
  if (!certifications || certifications.length === 0) {
    res.status(400).json({ error: "At least one certification is required" });
    return;
  }

  const [row] = await db.update(trainedDoctorsTable)
    .set({
      title: parsed.data.title ?? null,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      specialty: parsed.data.specialty ?? null,
      institutionName: parsed.data.institutionName ?? null,
      city: parsed.data.city,
      postalCode: parsed.data.postalCode ?? null,
      country: parsed.data.country,
      phone: (parsed.data as { phone?: string | null }).phone ?? null,
      email: (parsed.data as { email?: string | null }).email ?? null,
      websiteUrl: (parsed.data as { websiteUrl?: string | null }).websiteUrl ?? null,
      lat: lat ?? null,
      lon: lon ?? null,
    })
    .where(eq(trainedDoctorsTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Doctor not found" }); return; }

  // Replace certifications
  await db.delete(doctorCertificationsTable).where(eq(doctorCertificationsTable.doctorId, id));
  const certRows = await db.insert(doctorCertificationsTable)
    .values(certifications.map((c) => ({ doctorId: id, instrument: c.instrument, certifiedDate: c.certifiedDate })))
    .returning();

  res.json({
    id: row.id,
    title: row.title ?? null,
    firstName: row.firstName,
    lastName: row.lastName,
    specialty: row.specialty ?? null,
    institutionName: row.institutionName ?? null,
    city: row.city,
    postalCode: row.postalCode ?? null,
    country: row.country,
    phone: row.phone ?? null,
    email: row.email ?? null,
    websiteUrl: row.websiteUrl ?? null,
    lat: row.lat ?? null,
    lon: row.lon ?? null,
    certifications: certRows.map((c) => ({ instrument: c.instrument, certifiedDate: c.certifiedDate })),
  });
});

router.post("/admin/doctors/:id/email-certificate", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [doctor] = await db.select().from(trainedDoctorsTable).where(eq(trainedDoctorsTable.id, id));
  if (!doctor) { res.status(404).json({ error: "Doctor not found" }); return; }
  const { to, subject, body, pdfBase64, filename, instrument } = req.body;
  if (!to || !subject || !body || !pdfBase64) {
    res.status(400).json({ error: "to, subject, body, pdfBase64 are required" }); return;
  }
  if (typeof to !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    res.status(400).json({ error: "to must be a valid email address" }); return;
  }
  // Validate pdfBase64 type and canonical base64 grammar.
  // Round-trip decode→re-encode: if the result differs, the input was malformed
  // (illegal characters, wrong padding count, incomplete quartet, etc.).
  if (typeof pdfBase64 !== "string") {
    res.status(400).json({ error: "pdfBase64 must be a string" }); return;
  }
  if (Buffer.from(pdfBase64, "base64").toString("base64") !== pdfBase64) {
    res.status(400).json({ error: "pdfBase64 is not a valid base64 string" }); return;
  }

  // Look up portal credentials for this instrument and append to the email body
  const language = recipientLanguageForCountry(doctor.country);
  let fullBody = body as string;
  if (instrument && ["spirecut", "ministem"].includes(instrument)) {
    const [pwRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, `portal_password_${instrument}`));
    const [urlRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, `portal_url_${instrument}`));
    const portalPassword = pwRow?.value || (instrument === "spirecut" ? (process.env.SPIRECUT_PORTAL_PASSWORD ?? "spirecut2024") : (process.env.MINISTEM_PORTAL_PASSWORD ?? "ministem2024"));
    const portalUrl = urlRow?.value || null;
    const portalName = instrument === "spirecut" ? "Spirecut®" : "MiniStem®";
    const separator = "\n\n──────────────────────────────\n";
    const credBlock = language === "de"
      ? [
        `Portal-Zugang (${portalName})`,
        portalUrl ? `Login-URL: ${portalUrl}` : null,
        `Passwort: ${portalPassword}`,
      ].filter(Boolean).join("\n")
      : [
        `Portal Access (${portalName})`,
        portalUrl ? `Login URL: ${portalUrl}` : null,
        `Password: ${portalPassword}`,
      ].filter(Boolean).join("\n");
    fullBody = `${body}${separator}${credBlock}\n──────────────────────────────`;
  }

  try {
    const pdfBuffer = Buffer.from(pdfBase64, "base64");
    await sendEmail({
      to,
      subject,
      text: await appendImpressumSignature(fullBody, language),
      attachments: [{ filename: filename || "zertifikat.pdf", content: pdfBuffer, contentType: "application/pdf" }],
      signatureGroup: "admin",
      signatureLanguage: language,
      mailboxPurpose: "notifications",
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Send failed" });
  }
});

router.delete("/admin/doctors/:id", requireAdmin, async (req, res) => {
  const parsed = DeleteTrainedDoctorParams.safeParse({ id: parseInt(req.params.id as string) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }
  // Certifications are deleted via ON DELETE CASCADE
  await db.delete(trainedDoctorsTable).where(eq(trainedDoctorsTable.id, parsed.data.id));
  res.json({ message: "Doctor removed" });
});

// Training registrations
router.get("/admin/training-registrations", requireAdmin, async (_req, res) => {
  const rows = await db
    .select({
      id: trainingRegistrationsTable.id,
      salutation: trainingRegistrationsTable.salutation,
      medicalDegree: trainingRegistrationsTable.medicalDegree,
      firstName: trainingRegistrationsTable.firstName,
      lastName: trainingRegistrationsTable.lastName,
      specialty: trainingRegistrationsTable.specialty,
      institutionName: trainingRegistrationsTable.institutionName,
      address: trainingRegistrationsTable.address,
      postalCode: trainingRegistrationsTable.postalCode,
      city: trainingRegistrationsTable.city,
      country: trainingRegistrationsTable.country,
      phone: trainingRegistrationsTable.phone,
      fax: trainingRegistrationsTable.fax,
      email: trainingRegistrationsTable.email,
      instrument: trainingRegistrationsTable.instrument,
      trainingDateId: trainingRegistrationsTable.trainingDateId,
      trainingDateInfo: trainingRegistrationsTable.trainingDateInfo,
      websiteUrl: trainingRegistrationsTable.websiteUrl,
      notes: trainingRegistrationsTable.notes,
      privacyConsent: trainingRegistrationsTable.privacyConsent,
      certifiedDoctorId: trainingRegistrationsTable.certifiedDoctorId,
      status: trainingRegistrationsTable.status,
      confirmedAt: trainingRegistrationsTable.confirmedAt,
      createdAt: trainingRegistrationsTable.createdAt,
      customerId: websiteCustomersTable.id,
    })
    .from(trainingRegistrationsTable)
    .leftJoin(
      websiteCustomersTable,
      sql`lower(${trainingRegistrationsTable.email}) = lower(${websiteCustomersTable.email})`
    )
    .orderBy(desc(trainingRegistrationsTable.createdAt));

  res.json(rows.map((r) => ({
    id: r.id,
    salutation: r.salutation ?? null,
    medicalDegree: r.medicalDegree ?? null,
    firstName: r.firstName,
    lastName: r.lastName,
    specialty: r.specialty ?? null,
    institutionName: r.institutionName ?? null,
    address: r.address ?? null,
    postalCode: r.postalCode ?? null,
    city: r.city ?? null,
    country: r.country ?? null,
    phone: r.phone ?? null,
    fax: r.fax ?? null,
    email: r.email,
    instrument: r.instrument,
    trainingDateId: r.trainingDateId ?? null,
    trainingDateInfo: r.trainingDateInfo ?? null,
    websiteUrl: r.websiteUrl ?? null,
    notes: r.notes ?? null,
    privacyConsent: r.privacyConsent,
    certifiedDoctorId: r.certifiedDoctorId ?? null,
    status: r.status,
    confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    isCustomer: r.customerId != null,
    customerId: r.customerId ?? null,
  })));
});

// Import certified doctors into the training registrations list
router.post("/admin/training-registrations/import-from-doctors", requireAdmin, async (req, res) => {
  // Load all doctors with their certifications
  const doctors = await db.select().from(trainedDoctorsTable);
  const certs = await db.select().from(doctorCertificationsTable);

  // Load existing registrations that already point at a doctor, keyed by "doctorId:instrument"
  const existing = await db
    .select({ certifiedDoctorId: trainingRegistrationsTable.certifiedDoctorId, instrument: trainingRegistrationsTable.instrument })
    .from(trainingRegistrationsTable)
    .where(isNotNull(trainingRegistrationsTable.certifiedDoctorId));

  const existingKeys = new Set(
    existing
      .filter((r) => r.certifiedDoctorId != null)
      .map((r) => `${r.certifiedDoctorId}:${r.instrument}`)
  );

  const toInsert: (typeof trainingRegistrationsTable.$inferInsert)[] = [];

  for (const cert of certs) {
    const key = `${cert.doctorId}:${cert.instrument}`;
    if (existingKeys.has(key)) continue;

    const doctor = doctors.find((d) => d.id === cert.doctorId);
    if (!doctor) continue;

    toInsert.push({
      medicalDegree: doctor.title ?? null,
      firstName: doctor.firstName,
      lastName: doctor.lastName,
      specialty: doctor.specialty ?? null,
      institutionName: doctor.institutionName ?? null,
      city: doctor.city ?? null,
      postalCode: doctor.postalCode ?? null,
      country: doctor.country ?? null,
      phone: doctor.phone ?? null,
      websiteUrl: doctor.websiteUrl ?? null,
      email: "",
      instrument: cert.instrument,
      trainingDateInfo: cert.certifiedDate,
      certifiedDoctorId: cert.doctorId,
      privacyConsent: false,
      // Imported certified doctors are historical records, not unconfirmed signups
      status: "confirmed",
      confirmedAt: new Date(),
    });

    // Mark this pair as handled so we don't double-insert within this run
    existingKeys.add(key);
  }

  if (toInsert.length > 0) {
    await db.insert(trainingRegistrationsTable).values(toInsert);
  }

  res.json({ imported: toInsert.length, skipped: certs.length - toInsert.length });
});

// Confirm a registration and synchronize it into iROC Leads
router.post("/admin/training-registrations/:id/confirm", requireAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const result = await confirmTrainingRegistration(id);
    res.json({
      registrationId: result.registration.id,
      status: result.registration.status,
      confirmedAt: result.registration.confirmedAt?.toISOString() ?? null,
      leadId: result.lead.id,
      leadCreated: result.leadCreated,
    });
  } catch (err) {
    if (err instanceof TrainingRegistrationConfirmationError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// Certify a training registrant → promote to trained doctors list
router.delete("/admin/training-registrations/:id", requireAdmin, async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(trainingRegistrationsTable).where(eq(trainingRegistrationsTable.id, id));
  res.json({ ok: true });
});

router.patch("/admin/training-registrations/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const allowed = ["salutation","medicalDegree","firstName","lastName","specialty","institutionName","city","country","phone","fax","email","instrument","notes","address","postalCode","websiteUrl"] as const;
  const body = req.body as Record<string, unknown>;
  if ("websiteUrl" in body) {
    const websiteUrl = body.websiteUrl;
    if (
      (websiteUrl !== null && websiteUrl !== undefined && typeof websiteUrl !== "string") ||
      !isValidOptionalUrl(typeof websiteUrl === "string" ? websiteUrl : "")
    ) {
      res.status(400).json({ error: "websiteUrl must be a valid http or https URL" });
      return;
    }
  }
  const update: Record<string, unknown> = {};
  for (const f of allowed) { if (f in body) update[f] = body[f] ?? null; }
  if (Object.keys(update).length === 0) { res.status(400).json({ error: "No fields provided" }); return; }
  const [row] = await db.update(trainingRegistrationsTable).set(update as Parameters<ReturnType<typeof db.update>["set"]>[0]).where(eq(trainingRegistrationsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ id: row.id, firstName: row.firstName, lastName: row.lastName, email: row.email, instrument: row.instrument, specialty: row.specialty ?? null, institutionName: row.institutionName ?? null, city: row.city ?? null, country: row.country ?? null, phone: row.phone ?? null });
});

router.post("/admin/training-registrations/:id/certify", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { instrument, certifiedDate } = req.body as { instrument?: string; certifiedDate?: string };
  if (!instrument || !certifiedDate) {
    res.status(400).json({ error: "instrument and certifiedDate are required" });
    return;
  }

  // Fetch the registration
  const [reg] = await db
    .select()
    .from(trainingRegistrationsTable)
    .where(eq(trainingRegistrationsTable.id, id));

  if (!reg) { res.status(404).json({ error: "Registration not found" }); return; }

  if (!isValidOptionalUrl(reg.websiteUrl ?? "")) {
    res.status(400).json({ error: "Registration websiteUrl is not a valid http or https URL; update it before certifying" });
    return;
  }

  // Create the certified doctor record
  const [doctor] = await db.insert(trainedDoctorsTable).values({
    title: reg.medicalDegree ?? null,
    firstName: reg.firstName,
    lastName: reg.lastName,
    specialty: reg.specialty ?? null,
    institutionName: reg.institutionName ?? null,
    city: reg.city ?? "–",
    postalCode: reg.postalCode ?? null,
    country: reg.country ?? "Deutschland",
    phone: reg.phone ?? null,
    websiteUrl: reg.websiteUrl ?? null,
  }).returning();

  // Insert certification
  const [cert] = await db.insert(doctorCertificationsTable).values({
    doctorId: doctor.id,
    instrument,
    certifiedDate,
  }).returning();

  // Mark registration as certified
  await db
    .update(trainingRegistrationsTable)
    .set({ certifiedDoctorId: doctor.id })
    .where(eq(trainingRegistrationsTable.id, id));

  res.status(201).json({
    id: doctor.id,
    title: doctor.title ?? null,
    firstName: doctor.firstName,
    lastName: doctor.lastName,
    specialty: doctor.specialty ?? null,
    institutionName: doctor.institutionName ?? null,
    city: doctor.city,
    postalCode: doctor.postalCode ?? null,
    country: doctor.country,
    websiteUrl: doctor.websiteUrl ?? null,
    certifications: [{ instrument: cert.instrument, certifiedDate: cert.certifiedDate }],
  });
});

// Resources
router.post("/admin/resources", requireAdmin, async (req, res) => {
  const parsed = CreateResourceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid resource data" });
    return;
  }

  if (!isValidResourceUrl(parsed.data.url ?? "")) {
    res.status(400).json({ error: "url must be a valid http/https URL or an uploaded file path" });
    return;
  }
  if (!isValidResourceUrl(parsed.data.thumbnailUrl ?? "")) {
    res.status(400).json({ error: "thumbnailUrl must be a valid http/https URL or an uploaded file path" });
    return;
  }

  const [row] = await db.insert(resourcesTable).values({
    title: parsed.data.title,
    titleDe: parsed.data.titleDe ?? null,
    description: parsed.data.description ?? null,
    descriptionDe: parsed.data.descriptionDe ?? null,
    type: parsed.data.type,
    instrument: parsed.data.instrument,
    url: parsed.data.url,
    thumbnailUrl: parsed.data.thumbnailUrl ?? null,
  }).returning();

  res.status(201).json({
    id: row.id,
    title: row.title,
    titleDe: row.titleDe ?? null,
    description: row.description ?? null,
    descriptionDe: row.descriptionDe ?? null,
    type: row.type,
    instrument: row.instrument,
    url: row.url,
    thumbnailUrl: row.thumbnailUrl ?? null,
  });
});

router.delete("/admin/resources/:id", requireAdmin, async (req, res) => {
  const parsed = DeleteResourceParams.safeParse({ id: parseInt(req.params.id as string) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }
  await db.delete(resourcesTable).where(eq(resourcesTable.id, parsed.data.id));
  res.json({ message: "Resource deleted" });
});

router.patch("/admin/resources/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const body = req.body as Record<string, unknown>;
  if ("url" in body && !isValidResourceUrl((body.url as string) ?? "")) {
    res.status(400).json({ error: "url must be a valid http/https URL or an uploaded file path" });
    return;
  }
  if ("thumbnailUrl" in body && !isValidResourceUrl((body.thumbnailUrl as string) ?? "")) {
    res.status(400).json({ error: "thumbnailUrl must be a valid http/https URL or an uploaded file path" });
    return;
  }
  const update: Record<string, unknown> = {};
  if ("title" in body) update.title = body.title;
  if ("titleDe" in body) update.titleDe = (body.titleDe as string) || null;
  if ("description" in body) update.description = (body.description as string) || null;
  if ("descriptionDe" in body) update.descriptionDe = (body.descriptionDe as string) || null;
  if ("type" in body) update.type = body.type;
  if ("instrument" in body) update.instrument = body.instrument;
  if ("url" in body) update.url = body.url;
  if ("thumbnailUrl" in body) update.thumbnailUrl = (body.thumbnailUrl as string) || null;
  if (Object.keys(update).length === 0) { res.status(400).json({ error: "No fields provided" }); return; }
  const [row] = await db.update(resourcesTable).set(update as Parameters<ReturnType<typeof db.update>["set"]>[0]).where(eq(resourcesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ id: row.id, title: row.title, titleDe: row.titleDe ?? null, description: row.description ?? null, descriptionDe: row.descriptionDe ?? null, type: row.type, instrument: row.instrument, url: row.url, thumbnailUrl: row.thumbnailUrl ?? null });
});

// Video URLs
router.get("/admin/video-urls", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(settingsTable);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json({
    spirecut: map["video_url_spirecut"] ?? "https://www.youtube.com/embed/mjPCpa427go",
    ministem: map["video_url_ministem"] ?? "",
  });
});

router.post("/admin/video-urls", requireAdmin, async (req, res) => {
  const { instrument, url } = req.body as { instrument?: string; url?: string };
  if (!instrument || !["spirecut", "ministem"].includes(instrument)) {
    res.status(400).json({ error: "instrument must be 'spirecut' or 'ministem'" });
    return;
  }
  if (!isValidYouTubeUrl(url ?? "")) {
    res.status(422).json({ error: "Video URL must be a YouTube URL (embed, watch, or youtu.be link)" });
    return;
  }
  const key = `video_url_${instrument}`;
  await db
    .insert(settingsTable)
    .values({ key, value: url ?? "" })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: url ?? "", updatedAt: new Date() } });
  res.json({ message: "Updated" });
});

// Portal passwords + URLs
router.get("/admin/portal-passwords", requireAdmin, async (_req, res) => {
  const [pwSC] = await db.select().from(settingsTable).where(eq(settingsTable.key, "portal_password_spirecut"));
  const [pwMS] = await db.select().from(settingsTable).where(eq(settingsTable.key, "portal_password_ministem"));
  const [urlSC] = await db.select().from(settingsTable).where(eq(settingsTable.key, "portal_url_spirecut"));
  const [urlMS] = await db.select().from(settingsTable).where(eq(settingsTable.key, "portal_url_ministem"));

  res.json({
    spirecut: pwSC ? "••••••••" : "(env default)",
    ministem: pwMS ? "••••••••" : "(env default)",
    spirecutSet: !!pwSC,
    ministemSet: !!pwMS,
    spirecutUrl: urlSC?.value ?? "",
    ministemUrl: urlMS?.value ?? "",
  });
});

router.post("/admin/portal-passwords", requireAdmin, async (req, res) => {
  const { instrument, password } = req.body as { instrument?: string; password?: string };

  if (!instrument || !["spirecut", "ministem"].includes(instrument)) {
    res.status(400).json({ error: "instrument must be 'spirecut' or 'ministem'" });
    return;
  }
  if (!password || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const key = `portal_password_${instrument}`;
  await db
    .insert(settingsTable)
    .values({ key, value: password })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: password, updatedAt: new Date() } });

  res.json({ message: "Password updated" });
});

// Return actual portal credentials (URL + real password) — admin-only, used for email preview
router.get("/admin/portal-credentials/:instrument", requireAdmin, async (req, res) => {
  const instrument = req.params.instrument as string;
  if (!["spirecut", "ministem"].includes(instrument)) {
    res.status(400).json({ error: "instrument must be 'spirecut' or 'ministem'" }); return;
  }
  const [pwRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, `portal_password_${instrument}`));
  const [urlRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, `portal_url_${instrument}`));
  const password = pwRow?.value || (instrument === "spirecut" ? (process.env.SPIRECUT_PORTAL_PASSWORD ?? "spirecut2024") : (process.env.MINISTEM_PORTAL_PASSWORD ?? "ministem2024"));
  const url = urlRow?.value ?? "";
  res.json({ url, password });
});

router.post("/admin/portal-urls", requireAdmin, async (req, res) => {
  const { instrument, url } = req.body as { instrument?: string; url?: string };
  if (!instrument || !["spirecut", "ministem"].includes(instrument)) {
    res.status(400).json({ error: "instrument must be 'spirecut' or 'ministem'" });
    return;
  }
  const key = `portal_url_${instrument}`;
  await db
    .insert(settingsTable)
    .values({ key, value: url ?? "" })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: url ?? "", updatedAt: new Date() } });
  res.json({ message: "URL updated" });
});

// ─── Email destination settings ───────────────────────────────────────────────

const EMAIL_DEST_KEYS = [
  { key: "email_dest_order_existing",    label: "Bestellungen (Bestandskunden)" },
  { key: "email_dest_order_new",         label: "Registrierungen (Neukunden)" },
  { key: "email_dest_training_spirecut", label: "Schulungsanmeldungen Spirecut®" },
  { key: "email_dest_training_ministem", label: "Schulungsanmeldungen MiniStem®" },
  { key: "email_dest_contact",           label: "Kontaktformular" },
];

const DEFAULT_EMAIL = "info@i-roc.de";

router.get("/admin/email-settings", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(settingsTable);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const result = EMAIL_DEST_KEYS.map(({ key, label }) => ({
    key,
    label,
    email: map[key] ?? "",
    defaultEmail: DEFAULT_EMAIL,
  }));
  res.json(result);
});

router.post("/admin/email-settings", requireAdmin, async (req, res) => {
  const { key, email } = req.body as { key?: string; email?: string };

  if (!key || !EMAIL_DEST_KEYS.find((k) => k.key === key)) {
    res.status(400).json({ error: "Invalid key" });
    return;
  }
  const normalizedEmail = typeof email === "string" ? email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }

  await db
    .insert(settingsTable)
    .values({ key, value: normalizedEmail })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: normalizedEmail, updatedAt: new Date() } });

  res.json({ message: "Updated" });
});

router.get("/admin/email-delivery-settings", requireAdmin, async (_req, res) => {
  const settings = await db.select().from(settingsTable);
  const configured = new Map(settings.map((row) => [row.key, row.value]));
  const { rows: mailboxes } = await pool.query<{
    id: number;
    email: string;
    display_name: string | null;
    purpose: string;
    authorization_status: string;
    access_level: "read" | "read_write";
    enabled: boolean;
  }>(
    `SELECT id, email, display_name, purpose, authorization_status,
            access_level, enabled
       FROM iroc_microsoft_mailboxes
      WHERE purpose = ANY($1::text[])
      ORDER BY CASE
                 WHEN authorization_status='connected' AND access_level='read_write' THEN 0
                 WHEN authorization_status='connected' THEN 1
                 ELSE 2
               END,
               created_at ASC`,
    [MICROSOFT_EMAIL_PURPOSES],
  );

  res.json(MICROSOFT_EMAIL_PURPOSES.map((purpose) => {
    const mailbox = mailboxes.find((item) => item.purpose === purpose);
    return {
      purpose,
      provider: configured.get(`email_transport_${purpose}`) === "microsoft365"
        ? "microsoft365"
        : "smtp",
      microsoftMailbox: mailbox
        ? {
            id: mailbox.id,
            email: mailbox.email,
            displayName: mailbox.display_name,
            authorizationStatus: mailbox.authorization_status,
            accessLevel: mailbox.access_level,
            enabled: mailbox.enabled,
          }
        : null,
    };
  }));
});

router.post("/admin/email-delivery-settings", requireAdmin, async (req, res) => {
  const purpose = typeof req.body?.purpose === "string" ? req.body.purpose : "";
  const provider = typeof req.body?.provider === "string" ? req.body.provider : "";
  if (!MICROSOFT_EMAIL_PURPOSES.includes(purpose as typeof MICROSOFT_EMAIL_PURPOSES[number])) {
    res.status(400).json({ error: "Invalid email role." });
    return;
  }
  if (provider !== "smtp" && provider !== "microsoft365") {
    res.status(400).json({ error: "Provider must be smtp or microsoft365." });
    return;
  }

  await db
    .insert(settingsTable)
    .values({ key: `email_transport_${purpose}`, value: provider })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: provider, updatedAt: new Date() },
    });
  res.json({ purpose, provider: provider as EmailDeliveryProvider });
});

const EMAIL_TEST_RECIPIENT_BLOCKED_ERROR =
  "Test messages may only be sent to an administrator-controlled address, not to a customer, patient, lead, or supplier.";

/**
 * Test sends must never become an alternate customer/lead/supplier mail action.
 * Compare against every persisted recipient identity used by automated flows,
 * including historical queue entries and both billing/shipping addresses.
 */
async function isKnownExternalRecipient(email: string): Promise<boolean> {
  const { rows } = await pool.query<{ blocked: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM website_customers
        WHERE lower(email) = $1 OR lower(shipping_email) = $1
       UNION ALL
       SELECT 1 FROM iroc_customers
        WHERE lower(email) = $1
       UNION ALL
       SELECT 1 FROM iroc_leads
        WHERE lower(email) = $1
       UNION ALL
       SELECT 1 FROM trained_doctors
        WHERE lower(email) = $1
       UNION ALL
       SELECT 1 FROM training_registrations
        WHERE lower(email) = $1
       UNION ALL
       SELECT 1 FROM iroc_orders
        WHERE lower(contact_email) = $1
       UNION ALL
       SELECT 1 FROM sally_leads
        WHERE lower(email) = $1
       UNION ALL
       SELECT 1 FROM sally_certified_doctors
        WHERE lower(email) = $1
       UNION ALL
       SELECT 1 FROM sally_email_queue
        WHERE lower(recipient_email) = $1
       UNION ALL
       SELECT 1 FROM tori_reorder_queue
        WHERE lower(vendor_email) = $1 OR lower(email_to) = $1
     ) AS blocked`,
    [email.toLowerCase()],
  );
  return rows[0]?.blocked === true;
}

router.post("/admin/email-delivery-test", requireMailboxAdmin, async (req, res) => {
  const purpose = typeof req.body?.purpose === "string" ? req.body.purpose.trim() : "";
  const to = typeof req.body?.to === "string" ? req.body.to.trim().toLowerCase() : "";

  if (!MICROSOFT_EMAIL_PURPOSES.includes(purpose as typeof MICROSOFT_EMAIL_PURPOSES[number])) {
    res.status(400).json({ error: "Invalid email role." });
    return;
  }
  if (!EMAIL_RE.test(to) || to.includes(",") || to.includes(";")) {
    res.status(400).json({ error: "A single valid test recipient address is required." });
    return;
  }
  if (await isKnownExternalRecipient(to)) {
    res.status(400).json({ error: EMAIL_TEST_RECIPIENT_BLOCKED_ERROR, code: "email_test_recipient_blocked" });
    return;
  }

  try {
    await sendEmailConfigurationTest({ to, mailboxPurpose: purpose as typeof MICROSOFT_EMAIL_PURPOSES[number] });
    res.json({ ok: true, purpose, to });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Email test failed.",
      code: "email_test_failed",
    });
  }
});

// ─── Microsoft 365 mailbox registry ───────────────────────────────────────────
// OAuth tokens are encrypted at rest and never included in mailbox API
// responses. Exchange passwords are never accepted or stored.
const MAILBOX_PURPOSES = new Set([
  "general",
  "website_contact",
  "order_new",
  "order_existing",
  "training_spirecut",
  "training_ministem",
  "invoice",
  "invoice_ai",
  "datev",
  "announcement",
  "smtp",
  "tori_ai",
  "sally_ai",
  "notifications",
]);
const MAILBOX_ACCESS = new Set(["read", "read_write"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mailbox metadata exposes operational email addresses and future delegated
// authorization state. Until roles are added to iroc_app_users, restrict these
// high-impact routes to the seeded administrator identity or the server secret.
function requireMailboxAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  const configuredAdminPassword = process.env.ADMIN_PASSWORD?.trim();
  if (configuredAdminPassword && auth === `Bearer ${configuredAdminPassword}`) { next(); return; }
  if (auth?.startsWith("Bearer ")) {
    const token = verifyToken(auth.slice(7));
    if (token?.username === "admin") { next(); return; }
  }
  res.status(auth ? 403 : 401).json({ error: auth ? "Administrator access required." : "Unauthorized" });
}

function mailboxPayload(body: Record<string, unknown>) {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const displayName = typeof body.display_name === "string" ? body.display_name.trim().slice(0, 120) : "";
  const purpose = typeof body.purpose === "string" ? body.purpose : "general";
  const accessLevel = typeof body.access_level === "string" ? body.access_level : "read";
  if (!EMAIL_RE.test(email)) return { error: "A valid mailbox email address is required." };
  if (!MAILBOX_PURPOSES.has(purpose)) return { error: "Invalid mailbox purpose." };
  if (!MAILBOX_ACCESS.has(accessLevel)) return { error: "Invalid mailbox access level." };
  return {
    data: {
      email,
      displayName: displayName || null,
      purpose,
      accessLevel,
      enabled: body.enabled !== false,
    },
  };
}

router.get("/admin/microsoft-365-mailboxes", requireMailboxAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, email, display_name, purpose, access_level, enabled,
            authorization_status, authorization_error, last_authorized_at,
            created_at, updated_at
       FROM iroc_microsoft_mailboxes
      ORDER BY created_at ASC`,
  );
  res.json(rows);
});

router.post("/admin/microsoft-365-mailboxes", requireMailboxAdmin, async (req, res) => {
  const parsed = mailboxPayload(req.body as Record<string, unknown>);
  if ("error" in parsed) { res.status(400).json(parsed); return; }
  try {
    const { data } = parsed;
    const { rows } = await pool.query(
      `INSERT INTO iroc_microsoft_mailboxes
        (email, display_name, purpose, access_level, enabled, authorization_status)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN 'awaiting_authorization' ELSE 'disabled' END)
       RETURNING id, email, display_name, purpose, access_level, enabled, authorization_status,
                 authorization_error, last_authorized_at, created_at, updated_at`,
      [data.email, data.displayName, data.purpose, data.accessLevel, data.enabled],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      res.status(409).json({ error: "This mailbox is already configured for the selected purpose." });
      return;
    }
    throw err;
  }
});

router.put("/admin/microsoft-365-mailboxes/:id", requireMailboxAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "Invalid mailbox id." }); return; }
  const parsed = mailboxPayload(req.body as Record<string, unknown>);
  if ("error" in parsed) { res.status(400).json(parsed); return; }
  try {
    const { data } = parsed;
    const { rows } = await pool.query(
      `UPDATE iroc_microsoft_mailboxes
          SET email=$1, display_name=$2, purpose=$3, access_level=$4, enabled=$5,
              authorization_status=CASE
                WHEN $5 = false THEN 'disabled'
                WHEN authorization_status = 'disabled' THEN 'awaiting_authorization'
                 WHEN email <> $1 OR access_level <> $4 THEN 'awaiting_authorization'
                ELSE authorization_status
              END,
               oauth_access_token=CASE
                 WHEN $5 = false OR email <> $1 OR access_level <> $4 THEN NULL
                 ELSE oauth_access_token
               END,
               oauth_refresh_token=CASE
                 WHEN $5 = false OR email <> $1 OR access_level <> $4 THEN NULL
                 ELSE oauth_refresh_token
               END,
               oauth_expires_at=CASE
                 WHEN $5 = false OR email <> $1 OR access_level <> $4 THEN NULL
                 ELSE oauth_expires_at
               END,
               authorization_error=CASE
                 WHEN $5 = false OR email <> $1 OR access_level <> $4 THEN NULL
                 ELSE authorization_error
               END,
              updated_at=NOW()
        WHERE id=$6
      RETURNING id, email, display_name, purpose, access_level, enabled, authorization_status,
                authorization_error, last_authorized_at, created_at, updated_at`,
      [data.email, data.displayName, data.purpose, data.accessLevel, data.enabled, id],
    );
    if (!rows[0]) { res.status(404).json({ error: "Mailbox not found." }); return; }
    res.json(rows[0]);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      res.status(409).json({ error: "This mailbox is already configured for the selected purpose." });
      return;
    }
    throw err;
  }
});

router.delete("/admin/microsoft-365-mailboxes/:id", requireMailboxAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "Invalid mailbox id." }); return; }
  const { rowCount } = await pool.query("DELETE FROM iroc_microsoft_mailboxes WHERE id=$1", [id]);
  if (!rowCount) { res.status(404).json({ error: "Mailbox not found." }); return; }
  res.status(204).end();
});

router.post("/admin/microsoft-365-mailboxes/:id/connect", requireMailboxAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "Invalid mailbox id." }); return; }
  const { rows } = await pool.query(
    "SELECT id, enabled, access_level FROM iroc_microsoft_mailboxes WHERE id=$1",
    [id],
  );
  if (!rows[0]) { res.status(404).json({ error: "Mailbox not found." }); return; }
  if (!rows[0].enabled) { res.status(409).json({ error: "Enable this mailbox before connecting it." }); return; }
  try {
    const state = crypto.randomBytes(32).toString("base64url");
    const stateHash = crypto.createHash("sha256").update(state).digest("hex");
    const authorizationUrl = buildMicrosoftAuthorizationUrl(
      state,
      rows[0].access_level as "read" | "read_write",
    );
    await pool.query(
      `DELETE FROM iroc_microsoft_oauth_states
        WHERE expires_at < NOW() OR mailbox_id=$1`,
      [id],
    );
    await pool.query(
      `INSERT INTO iroc_microsoft_oauth_states (state_hash, mailbox_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`,
      [stateHash, id],
    );
    res.json({
      authorization_url: authorizationUrl,
    });
  } catch (err) {
    if (err instanceof MicrosoftOAuthConfigError) {
      res.status(503).json({
        error: "Microsoft 365 OAuth is not configured for this workspace.",
        code: "microsoft_oauth_not_configured",
      });
      return;
    }
    throw err;
  }
});

function microsoftAuthErrorMessage(err: unknown): string {
  if (err instanceof MicrosoftGraphAuthorizationError) {
    return "Microsoft 365 authorization was revoked or has expired. Connect this mailbox again.";
  }
  if (err instanceof MicrosoftOAuthError) {
    return "Microsoft 365 authorization could not be completed. Connect this mailbox again.";
  }
  return "Microsoft 365 authorization failed. Connect this mailbox again.";
}

function microsoftPostAuthRedirect(): string {
  const configured = process.env.MICROSOFT_POST_AUTH_REDIRECT_URI?.trim();
  if (configured) return configured;
  const origin = new URL(getMicrosoftRedirectUri()).origin;
  return `${origin}/iroc-app/email-config`;
}

function redirectFromMicrosoftCallback(
  result: "connected" | "error",
  mailboxId?: number,
): string {
  const url = new URL(microsoftPostAuthRedirect());
  url.searchParams.set("microsoft", result);
  if (mailboxId) url.searchParams.set("mailbox", String(mailboxId));
  return url.toString();
}

function normalizedMailboxEmail(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function tokensForDatabase(tokens: MicrosoftOAuthTokens) {
  return {
    accessToken: encryptMicrosoftToken(tokens.accessToken),
    refreshToken: encryptMicrosoftToken(tokens.refreshToken),
    expiresAt: tokens.expiresAt,
  };
}

router.get("/admin/microsoft-365/oauth/callback", async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!state) {
    res.status(400).send("Missing Microsoft OAuth state.");
    return;
  }

  const stateHash = crypto.createHash("sha256").update(state).digest("hex");
  const { rows } = await pool.query(
    `DELETE FROM iroc_microsoft_oauth_states
      WHERE state_hash=$1 AND expires_at > NOW()
      RETURNING mailbox_id`,
    [stateHash],
  );
  const mailboxId = Number(rows[0]?.mailbox_id);
  if (!Number.isInteger(mailboxId) || mailboxId < 1) {
    res.status(400).send("This Microsoft authorization request is invalid or expired.");
    return;
  }

  const oauthError = typeof req.query.error === "string" ? req.query.error : "";
  if (oauthError || !code) {
    const message = oauthError === "access_denied"
      ? "Microsoft authorization was cancelled."
      : "Microsoft authorization was not completed.";
    await pool.query(
      `UPDATE iroc_microsoft_mailboxes
          SET authorization_status=CASE WHEN enabled THEN 'error' ELSE 'disabled' END,
              authorization_error=$1, updated_at=NOW()
        WHERE id=$2`,
      [message, mailboxId],
    );
    res.redirect(redirectFromMicrosoftCallback("error", mailboxId));
    return;
  }

  try {
    const { rows: mailboxRows } = await pool.query(
      `SELECT id, email, enabled, access_level
         FROM iroc_microsoft_mailboxes
        WHERE id=$1`,
      [mailboxId],
    );
    const mailbox = mailboxRows[0];
    if (!mailbox || !mailbox.enabled) {
      res.redirect(redirectFromMicrosoftCallback("error", mailboxId));
      return;
    }

    const tokens = await exchangeMicrosoftCode(
      code,
      mailbox.access_level as "read" | "read_write",
    );
    const identity = await getMicrosoftIdentity(tokens.accessToken);
    const authorizedEmail = normalizedMailboxEmail(identity.mail ?? identity.userPrincipalName);
    if (!authorizedEmail || authorizedEmail !== normalizedMailboxEmail(mailbox.email)) {
      await pool.query(
        `UPDATE iroc_microsoft_mailboxes
            SET authorization_status='error',
                authorization_error=$1, updated_at=NOW()
          WHERE id=$2`,
        ["The Microsoft account does not match the configured mailbox.", mailboxId],
      );
      res.redirect(redirectFromMicrosoftCallback("error", mailboxId));
      return;
    }

    const stored = tokensForDatabase(tokens);
    await pool.query(
      `UPDATE iroc_microsoft_mailboxes
          SET authorization_status='connected',
              authorization_error=NULL,
              oauth_access_token=$1,
              oauth_refresh_token=$2,
              oauth_expires_at=$3,
              last_authorized_at=NOW(),
              updated_at=NOW()
        WHERE id=$4 AND enabled=true`,
      [stored.accessToken, stored.refreshToken, stored.expiresAt, mailboxId],
    );
    res.redirect(redirectFromMicrosoftCallback("connected", mailboxId));
  } catch (err) {
    await pool.query(
      `UPDATE iroc_microsoft_mailboxes
          SET authorization_status=CASE WHEN enabled THEN 'error' ELSE 'disabled' END,
              authorization_error=$1, updated_at=NOW()
        WHERE id=$2`,
      [microsoftAuthErrorMessage(err), mailboxId],
    );
    res.redirect(redirectFromMicrosoftCallback("error", mailboxId));
  }
});

type MailboxGraphRow = {
  id: number;
  email: string;
  enabled: boolean;
  access_level: "read" | "read_write";
  authorization_status: string;
  authorization_error: string | null;
  oauth_access_token: string | null;
  oauth_refresh_token: string | null;
  oauth_expires_at: Date | string | null;
};

class MailboxAuthorizationInvalidError extends Error {
  constructor() {
    super("Microsoft 365 authorization is no longer valid.");
    this.name = "MailboxAuthorizationInvalidError";
  }
}

async function getMailboxForGraphAction(
  id: number,
  res: Response,
  requiredAccess: "read" | "read_write",
): Promise<MailboxGraphRow | null> {
  const { rows } = await pool.query<MailboxGraphRow>(
    `SELECT id, email, enabled, access_level, authorization_status,
            authorization_error, oauth_access_token, oauth_refresh_token,
            oauth_expires_at
       FROM iroc_microsoft_mailboxes
      WHERE id=$1`,
    [id],
  );
  const mailbox = rows[0];
  if (!mailbox) {
    res.status(404).json({ error: "Mailbox not found.", code: "mailbox_not_found" });
    return null;
  }
  if (!mailbox.enabled || mailbox.authorization_status === "disabled") {
    res.status(409).json({ error: "This mailbox is disabled.", code: "mailbox_disabled" });
    return null;
  }
  if (mailbox.authorization_status !== "connected") {
    res.status(409).json({
      error: mailbox.authorization_error
        ?? "Authorize this mailbox before using Microsoft 365 mail actions.",
      code: "mailbox_not_connected",
    });
    return null;
  }
  if (requiredAccess === "read_write" && mailbox.access_level !== "read_write") {
    res.status(403).json({
      error: "This mailbox is configured as read-only.",
      code: "mailbox_read_only",
    });
    return null;
  }
  return mailbox;
}

async function mailboxGraphToken(mailbox: MailboxGraphRow): Promise<string> {
  try {
    if (
      mailbox.oauth_access_token &&
      mailbox.oauth_expires_at &&
      new Date(mailbox.oauth_expires_at).getTime() > Date.now() + 60_000
    ) {
      return decryptMicrosoftToken(mailbox.oauth_access_token);
    }
    if (!mailbox.oauth_refresh_token) {
      throw new MicrosoftOAuthError("Mailbox has no refresh authorization.");
    }
    const refreshToken = decryptMicrosoftToken(mailbox.oauth_refresh_token);
    const refreshed = await refreshMicrosoftAccessToken(refreshToken, mailbox.access_level);
    const stored = tokensForDatabase(refreshed);
    await pool.query(
      `UPDATE iroc_microsoft_mailboxes
          SET oauth_access_token=$1, oauth_refresh_token=$2,
              oauth_expires_at=$3, authorization_error=NULL, updated_at=NOW()
        WHERE id=$4 AND enabled=true AND authorization_status='connected'`,
      [stored.accessToken, stored.refreshToken, stored.expiresAt, mailbox.id],
    );
    return refreshed.accessToken;
  } catch (err) {
    await pool.query(
      `UPDATE iroc_microsoft_mailboxes
          SET authorization_status=CASE WHEN enabled THEN 'error' ELSE 'disabled' END,
              authorization_error=$1, updated_at=NOW()
        WHERE id=$2`,
      [microsoftAuthErrorMessage(err), mailbox.id],
    );
    throw new MailboxAuthorizationInvalidError();
  }
}

async function runMailboxGraphAction(
  mailbox: MailboxGraphRow,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  try {
    return await microsoftGraphRequest(await mailboxGraphToken(mailbox), path, init);
  } catch (err) {
    if (err instanceof MicrosoftGraphAuthorizationError) {
      await pool.query(
        `UPDATE iroc_microsoft_mailboxes
            SET authorization_status=CASE WHEN enabled THEN 'error' ELSE 'disabled' END,
                authorization_error=$1, updated_at=NOW()
          WHERE id=$2`,
        [microsoftAuthErrorMessage(err), mailbox.id],
      );
    }
    throw err;
  }
}

router.get("/admin/microsoft-365-mailboxes/:id/messages", requireMailboxAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid mailbox id." });
    return;
  }
  const mailbox = await getMailboxForGraphAction(id, res, "read");
  if (!mailbox) return;
  const requestedTop = Number(req.query.top ?? 25);
  const top = Number.isInteger(requestedTop) ? Math.min(50, Math.max(1, requestedTop)) : 25;
  try {
    const result = await runMailboxGraphAction(
      mailbox,
      `/me/mailFolders/inbox/messages?$top=${top}&$select=id,receivedDateTime,subject,from,isRead,bodyPreview&$orderby=receivedDateTime%20DESC`,
    );
    res.json(result);
  } catch (err) {
    if (
      err instanceof MicrosoftGraphAuthorizationError ||
      err instanceof MailboxAuthorizationInvalidError
    ) {
      res.status(409).json({
        error: microsoftAuthErrorMessage(err),
        code: "microsoft_authorization_invalid",
      });
      return;
    }
    res.status(502).json({ error: "Microsoft Graph could not read this mailbox.", code: "graph_request_failed" });
  }
});

router.post("/admin/microsoft-365-mailboxes/:id/send", requireMailboxAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid mailbox id." });
    return;
  }
  const mailbox = await getMailboxForGraphAction(id, res, "read_write");
  if (!mailbox) return;
  const body = req.body as { to?: unknown; subject?: unknown; text?: unknown };
  const to = typeof body.to === "string" ? body.to.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!EMAIL_RE.test(to) || !subject || !text.trim()) {
    res.status(400).json({ error: "to, subject, and text are required." });
    return;
  }
  if (subject.length > 500 || text.length > 200_000) {
    res.status(400).json({ error: "The message is too large." });
    return;
  }
  try {
    await runMailboxGraphAction(mailbox, "/me/sendMail", {
      method: "POST",
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "Text", content: text },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
    });
    res.status(202).json({ ok: true });
  } catch (err) {
    if (
      err instanceof MicrosoftGraphAuthorizationError ||
      err instanceof MailboxAuthorizationInvalidError
    ) {
      res.status(409).json({
        error: microsoftAuthErrorMessage(err),
        code: "microsoft_authorization_invalid",
      });
      return;
    }
    res.status(502).json({ error: "Microsoft Graph could not send this message.", code: "graph_request_failed" });
  }
});

// ─── iROC Website global settings ────────────────────────────────────────────
const WS_ALLOWED_KEYS = new Set([
  "ws_logo_url",
  "ws_contact_email","ws_contact_phone","ws_contact_fax",
  "invoice_contact_email","invoice_contact_phone",
  "ws_address_street","ws_address_postal","ws_address_city",
  "ws_address_country_de","ws_address_country_en",
  "ws_hero_image_url","ws_maps_embed_url","ws_maps_directions_url",
  "ws_social_linkedin","ws_social_facebook","ws_social_instagram","ws_social_youtube",
  "ws_spirecut_company_url","ws_ministem_company_url",
  "ws_webapp_url",
  "config_iroc_website_url","config_spirecut_website_url",
  "iroc_announcement_from",
  "datev_bookkeeper_email",
  "smtp_host","smtp_port","smtp_user","smtp_pass","smtp_from",
  // Medical-professional gate
  "ws_gate_enabled","ws_gate_title_de","ws_gate_title_en","ws_gate_body_de","ws_gate_body_en","ws_gate_link_url",
]);

/** Keys whose values must be a safe http/https URL (or empty). */
const WS_URL_KEYS = new Set([
  "ws_logo_url",
  "ws_hero_image_url","ws_maps_embed_url","ws_maps_directions_url",
  "ws_social_linkedin","ws_social_facebook","ws_social_instagram","ws_social_youtube",
  "ws_spirecut_company_url","ws_ministem_company_url",
  "ws_webapp_url",
  "config_iroc_website_url","config_spirecut_website_url",
]);

/** Optional email settings accept an empty value so admins can restore defaults. */
const WS_EMAIL_KEYS = new Set(["invoice_contact_email"]);

/** Returns true when value is empty or a syntactically valid http/https URL. */
function isValidOptionalUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  try {
    const { protocol } = new URL(v);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function isValidOptionalEmail(value: string): boolean {
  const v = value.trim();
  return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/**
 * Like isValidOptionalUrl but also accepts server-issued object-storage paths
 * (/api/storage/objects/…) so that uploaded files can be used as resource URLs.
 */
function isValidResourceUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (v.startsWith("/api/storage/objects/")) return true;
  return isValidOptionalUrl(v);
}

/** Returns true for empty/blank strings (field cleared) and valid YouTube URLs. */
function isValidYouTubeUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  // Accepted patterns:
  //   https://www.youtube.com/embed/<id>[?...]
  //   https://youtube.com/embed/<id>[?...]
  //   https://www.youtube.com/watch?v=<id>[&...]
  //   https://youtu.be/<id>[?...]
  return /^https:\/\/(www\.)?youtube\.com\/(embed\/|watch\?v=)[A-Za-z0-9_-]/.test(v)
    || /^https:\/\/youtu\.be\/[A-Za-z0-9_-]/.test(v);
}

/**
 * Internal DB key that stores the server-issued Object Storage path for the
 * current hero image (e.g. `/objects/<uuid>`).  NOT in WS_ALLOWED_KEYS, so
 * admins cannot set it directly via the website-settings endpoint.
 */
const HERO_OBJECT_PATH_KEY = '_ws_hero_object_path';
const LOGO_OBJECT_PATH_KEY = '_ws_logo_object_path';

/** UUID v4 pattern — the only format this server issues for uploaded objects. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns true when `path` is a safe, server-issued hero object storage path.
 * Hero images are uploaded through a dedicated endpoint that writes to the
 * `hero-images` subdir, so only `/objects/hero-images/<uuid>` is accepted.
 * This prevents cleanup from targeting generic uploads (e.g. team photos)
 * even if an admin provides a crafted path.
 */
function isValidHeroObjectPath(path: string): boolean {
  const PREFIX = '/objects/hero-images/';
  if (!path.startsWith(PREFIX)) return false;
  const entityId = path.slice(PREFIX.length);
  return UUID_RE.test(entityId);
}

function isValidLogoObjectPath(path: string): boolean {
  const PREFIX = '/objects/logos/';
  if (!path.startsWith(PREFIX)) return false;
  const entityId = path.slice(PREFIX.length);
  return UUID_RE.test(entityId);
}

/**
 * Extracts the object-storage path from a URL that was stored before
 * `_ws_hero_object_path` was introduced. Legacy heroes were uploaded via the
 * generic endpoint (path: `/objects/uploads/<uuid>`) and their URLs look like
 * `https://host/api/storage/objects/uploads/<uuid>`. New hero-images URLs look
 * like `https://host/api/storage/objects/hero-images/<uuid>`.
 *
 * Only matches our own `/api/storage/` namespace, so external CDN URLs return
 * null and are never touched.
 */
const STORAGE_PATH_RE =
  /\/api\/storage(\/objects\/(?:uploads|hero-images|logos)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/;

function tryExtractStorageObjectPath(url: string): string | null {
  if (!url) return null;
  const m = url.match(STORAGE_PATH_RE);
  return m ? m[1] : null;
}

/**
 * Reads only enough of the stored object to identify a supported raster image.
 * Upload metadata is supplied by the browser and can be forged, so hero
 * activation must inspect the bytes that were actually written to storage.
 */
async function hasSupportedHeroImageSignature(objectPath: string): Promise<boolean> {
  const file = await objectStorageService.getObjectEntityFile(objectPath);
  const response = await objectStorageService.downloadObject(file);
  if (!response.body) return false;
  const reader = response.body.getReader();
  let bytes = new Uint8Array(0);
  try {
    while (bytes.length < 32) {
      const { done, value } = await reader.read();
      if (done) break;
      const next = new Uint8Array(Math.min(32, bytes.length + value.length));
      next.set(bytes);
      next.set(value.subarray(0, next.length - bytes.length), bytes.length);
      bytes = next;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const startsWith = (...signature: number[]) =>
    bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
  const ascii = (start: number, value: string) =>
    bytes.length >= start + value.length && value.split("").every((char, index) => bytes[start + index] === char.charCodeAt(0));
  return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) // PNG
    || startsWith(0xff, 0xd8, 0xff) // JPEG
    || ascii(0, "GIF87a") || ascii(0, "GIF89a") // GIF
    || (ascii(0, "RIFF") && ascii(8, "WEBP")) // WebP
    || (ascii(4, "ftyp") && (ascii(8, "avif") || ascii(8, "avis"))); // AVIF
}


router.post("/admin/website-settings", requireAdmin, async (req, res) => {
  const { key, value, objectPath } = req.body as { key?: string; value?: string; objectPath?: string };
  if (!key || !WS_ALLOWED_KEYS.has(key)) {
    res.status(400).json({ error: "Invalid key" });
    return;
  }
  if (WS_URL_KEYS.has(key) && !isValidOptionalUrl(value ?? "")) {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }
  if (WS_EMAIL_KEYS.has(key) && !isValidOptionalEmail(value ?? "")) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }

  if (key === 'ws_logo_url') {
    const newObjectPath = (objectPath ?? '').trim();
    if (newObjectPath && !isValidLogoObjectPath(newObjectPath)) {
      res.status(400).json({ error: "Invalid objectPath format" });
      return;
    }
    const allSettings = await db.select().from(settingsTable);
    const currentUrl = allSettings.find(r => r.key === key)?.value ?? '';
    const oldObjectPath = allSettings.find(r => r.key === LOGO_OBJECT_PATH_KEY)?.value ?? '';
    const isActualChange = currentUrl !== (value ?? '');

    await db
      .insert(settingsTable)
      .values({ key, value: value ?? "" })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: value ?? "", updatedAt: new Date() } });

    if (isActualChange) {
      await db
        .insert(settingsTable)
        .values({ key: LOGO_OBJECT_PATH_KEY, value: newObjectPath })
        .onConflictDoUpdate({ target: settingsTable.key, set: { value: newObjectPath, updatedAt: new Date() } });
    }

    if (isActualChange) {
      const pathToDelete = oldObjectPath || tryExtractStorageObjectPath(currentUrl);
      if (pathToDelete) {
        try {
          await objectStorageService.deleteObjectEntity(pathToDelete);
        } catch (err) {
          req.log.warn({ err, pathToDelete }, 'logo cleanup: failed to delete old storage object');
        }
      }
    }

    res.json({ ok: true });
    return;
  }

  if (key === 'ws_hero_image_url') {
    // Validate the server-issued object path when one is provided.
    // Reject the request if objectPath is present but malformed, so the caller
    // cannot bypass the UUID format check by omitting objectPath on purpose.
    const newObjectPath = (objectPath ?? '').trim();
    if (newObjectPath && !isValidHeroObjectPath(newObjectPath)) {
      res.status(400).json({ error: "Invalid objectPath format" });
      return;
    }
    if ((value ?? '').trim() && !newObjectPath) {
      res.status(400).json({ error: "Hero images must be uploaded through the verified image uploader" });
      return;
    }
    if (newObjectPath && tryExtractStorageObjectPath(value ?? '') !== newObjectPath) {
      res.status(400).json({ error: "Hero image URL does not match its uploaded object" });
      return;
    }
    if (newObjectPath) {
      try {
        if (!(await hasSupportedHeroImageSignature(newObjectPath))) {
          res.status(400).json({ error: "Uploaded hero file is not a supported image" });
          return;
        }
      } catch (err) {
        req.log.warn({ err, objectPath: newObjectPath }, "hero image validation failed");
        res.status(400).json({ error: "Uploaded hero image could not be verified" });
        return;
      }
    }

    // Read the current URL AND the old stored object path BEFORE any mutation.
    // The object path is read now so it is still available after the new URL
    // is committed (we cannot re-read it after the upsert below).
    const allSettings = await db.select().from(settingsTable);
    const currentUrl = allSettings.find(r => r.key === key)?.value ?? '';
    const oldObjectPath = allSettings.find(r => r.key === HERO_OBJECT_PATH_KEY)?.value ?? '';
    // Never persist the caller's origin. The verified object path is
    // server-owned, while an absolute URL (including its host) is not.
    const canonicalValue = newObjectPath ? `/api/storage${newObjectPath}` : '';

    const isActualChange = currentUrl !== canonicalValue;

    // ── Step 1: persist the new URL (or empty string to clear it) ──────────
    // Do this BEFORE cleanup so that if the DB write fails the old object
    // is still intact and the URL still resolves correctly.
    await db
      .insert(settingsTable)
      .values({ key, value: canonicalValue })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: canonicalValue, updatedAt: new Date() } });

    // ── Step 2: update the stored object path (only on real changes) ────────
    if (isActualChange) {
      await db
        .insert(settingsTable)
        .values({ key: HERO_OBJECT_PATH_KEY, value: newObjectPath })
        .onConflictDoUpdate({ target: settingsTable.key, set: { value: newObjectPath, updatedAt: new Date() } });
    }

    // ── Step 3: best-effort cleanup of the old object (after both writes) ──
    // Errors are logged and swallowed; the new URL is already live so cleanup
    // failure is safe and logged for manual reconciliation if needed.
    //
    // pathToDelete prefers the stored _ws_hero_object_path (set by the new
    // dedicated upload flow). When that is absent — e.g. a hero that was
    // uploaded before this feature was introduced — we fall back to extracting
    // the object path from the stored URL itself. The regex only matches URLs
    // that point at this server's /api/storage/ namespace, so externally-hosted
    // heroes (plain https:// CDN URLs) never trigger a delete.
    if (isActualChange) {
      const pathToDelete = oldObjectPath || tryExtractStorageObjectPath(currentUrl);
      if (pathToDelete) {
        try {
          await objectStorageService.deleteObjectEntity(pathToDelete);
        } catch (err) {
          req.log.warn({ err, pathToDelete }, 'hero-image cleanup: failed to delete old storage object');
        }
      }
    }

    res.json({ ok: true });
    return;
  }

  await db
    .insert(settingsTable)
    .values({ key, value: value ?? "" })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: value ?? "", updatedAt: new Date() } });

  res.json({ ok: true });
});

/**
 * POST /admin/hero-upload-cleanup
 *
 * Best-effort server-side deletion of a hero image that was successfully
 * uploaded to GCS but whose subsequent settings-save POST failed (leaving the
 * object unreferenced). The frontend calls this endpoint in its catch block so
 * the orphan is removed without leaving residual storage clutter.
 *
 * Accepts only hero-images-namespace paths to prevent cross-asset deletion.
 * Auth: same requireAdmin guard as the upload and settings routes.
 */
router.post("/admin/logo-upload-cleanup", requireAdmin, async (req, res) => {
  const { objectPath } = req.body as { objectPath?: string };
  const path = (objectPath ?? '').trim();
  if (!path || !isValidLogoObjectPath(path)) {
    res.status(400).json({ error: "Invalid objectPath" });
    return;
  }
  try {
    await objectStorageService.deleteObjectEntity(path);
  } catch (err) {
    req.log.warn({ err, path }, 'logo-upload-cleanup: failed to delete orphaned object');
  }
  res.json({ ok: true });
});

router.post("/admin/hero-upload-cleanup", requireAdmin, async (req, res) => {
  const { objectPath } = req.body as { objectPath?: string };
  const path = (objectPath ?? '').trim();
  if (!path || !isValidHeroObjectPath(path)) {
    res.status(400).json({ error: "Invalid objectPath" });
    return;
  }
  try {
    await objectStorageService.deleteObjectEntity(path);
  } catch (err) {
    req.log.warn({ err, path }, 'hero-upload-cleanup: failed to delete orphaned object');
  }
  res.json({ ok: true });
});

// ─── Spirecut patient settings ────────────────────────────────────────────────
const SP_ALLOWED_KEYS = new Set([
  "sp_video_ct_url","sp_video_tf_url",
  "sp_contact_email_de","sp_contact_email_com",
  "sp_video_praktisch_1_url","sp_video_praktisch_2_url",
  "sp_video_praktisch_1_title","sp_video_praktisch_2_title",
  "sp_chatbot_system_prompt","sp_chatbot_starters_de","sp_chatbot_starters_en",
  "sp_webapp_url",
  // Patient gate
  "sp_gate_enabled","sp_gate_title_de","sp_gate_title_en","sp_gate_body_de","sp_gate_body_en","sp_gate_link_url",
]);

/** Chatbot settings must receive strings so malformed requests cannot clear saved content. */
const SP_CHATBOT_KEYS = new Set([
  "sp_chatbot_system_prompt",
  "sp_chatbot_starters_de",
  "sp_chatbot_starters_en",
]);

/** All URL-typed Spirecut keys — must pass basic http/https check. */
const SP_URL_KEYS = new Set(["sp_video_ct_url","sp_video_tf_url","sp_video_praktisch_1_url","sp_video_praktisch_2_url","sp_webapp_url","sp_gate_link_url"]);

/** Video URL keys that must be YouTube URLs specifically. */
const SP_VIDEO_KEYS = new Set(["sp_video_ct_url","sp_video_tf_url","sp_video_praktisch_1_url","sp_video_praktisch_2_url"]);

/** Practical video titles use an empty setting when the submitted value is blank. */
const SP_PRAKTISCH_TITLE_KEYS = new Set(["sp_video_praktisch_1_title", "sp_video_praktisch_2_title"]);

router.get("/admin/spirecut-settings", requireAdmin, async (_req, res) => {
  try {
    const { settings, repair } = await readPatientSettings();
    res.json({ settings, repair });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load Spirecut settings",
    });
  }
});

router.post("/admin/spirecut-settings/acknowledge-title-repairs", requireAdmin, async (_req, res) => {
  const { repair } = await readPatientSettings();
  const acknowledged = repair.legacyPracticalVideoTitlesRepaired;
  await db
    .insert(settingsTable)
    .values({ key: "sp_internal_praktisch_title_repair_acknowledged", value: String(acknowledged) })
    .onConflictDoUpdate({
      target: settingsTable.key,
      set: { value: String(acknowledged), updatedAt: new Date() },
    });
  res.json({ ok: true, acknowledged });
});

router.post("/admin/spirecut-settings", requireAdmin, async (req, res) => {
  const { key, value } = req.body as { key?: string; value?: unknown };
  if (!key || !SP_ALLOWED_KEYS.has(key)) {
    res.status(400).json({ error: "Invalid key" });
    return;
  }
  if (SP_CHATBOT_KEYS.has(key) && typeof value !== "string") {
    res.status(400).json({ error: "Chatbot setting value must be a string" });
    return;
  }
  const submittedValue = typeof value === "string" ? value : "";
  if (key === "sp_chatbot_system_prompt" && submittedValue.length > CHATBOT_SYSTEM_PROMPT_MAX_LENGTH) {
    res.status(422).json({
      error: `Chatbot system prompt must not exceed ${CHATBOT_SYSTEM_PROMPT_MAX_LENGTH} characters`,
    });
    return;
  }
  if (SP_URL_KEYS.has(key) && !isValidOptionalUrl(submittedValue)) {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }
  if (SP_VIDEO_KEYS.has(key) && !isValidYouTubeUrl(submittedValue)) {
    res.status(422).json({ error: "Video URL must be a YouTube URL (embed, watch, or youtu.be link)" });
    return;
  }
  const settingValue = SP_PRAKTISCH_TITLE_KEYS.has(key) && !submittedValue.trim()
    ? ""
    : submittedValue;
  await db
    .insert(settingsTable)
    .values({ key, value: settingValue })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: settingValue, updatedAt: new Date() } });
  res.json({ ok: true });
});

// ─── Website Customers (New Customer order form registrations) ────────────────

function serializeCustomer(r: typeof websiteCustomersTable.$inferSelect) {
  return {
    id:                  r.id,
    customerNr:          r.customerNr ?? null,
    reorderCode:         r.reorderCode ?? null,
    salutation:          r.salutation ?? null,
    title:               r.title ?? null,
    firstName:           r.firstName ?? null,
    lastName:            r.lastName ?? null,
    specialty:           r.specialty ?? null,
    institutionName:     r.institutionName ?? null,
    institutionType:     r.institutionType ?? null,
    address:             r.address ?? null,
    postalCode:          r.postalCode ?? null,
    city:                r.city ?? null,
    country:             r.country ?? null,
    phone:               r.phone ?? null,
    fax:                 r.fax ?? null,
    email:               r.email,
    website:             r.website ?? null,
    referenceNumber:     r.referenceNumber ?? null,
    isPublicAuthority:   r.isPublicAuthority,
    defaultBuyerReference: r.defaultBuyerReference ?? null,
    ustIdNr:             r.ustIdNr ?? null,
    instrument:          r.instrument,
    certifications:      r.certifications,
    notes:               r.notes ?? null,
    privacyConsent:      r.privacyConsent,
    shippingFirstName:       r.shippingFirstName ?? null,
    shippingLastName:        r.shippingLastName ?? null,
    shippingInstitutionName: r.shippingInstitutionName ?? null,
    shippingAddress:         r.shippingAddress ?? null,
    shippingPostalCode:      r.shippingPostalCode ?? null,
    shippingCity:            r.shippingCity ?? null,
    shippingCountry:         r.shippingCountry ?? null,
    shippingPhone:           r.shippingPhone ?? null,
    shippingEmail:           r.shippingEmail ?? null,
    createdAt:           r.createdAt.toISOString(),
  };
}

function normalizeCustomerCertifications(
  certifications: unknown,
  instrument: unknown,
): string[] {
  const source = Array.isArray(certifications)
    ? certifications
    : typeof certifications === "string"
      ? [certifications]
      : typeof instrument === "string"
        ? [instrument]
        : [];

  return [...new Set(
    source
      .filter((value): value is string => typeof value === "string")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim().toLowerCase())
      .flatMap((value) => value === "both" ? ["spirecut", "ministem"] : [value])
      .filter(Boolean),
  )];
}

router.get("/admin/customers", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(websiteCustomersTable)
    .orderBy(desc(websiteCustomersTable.createdAt));
  res.json(rows.map(serializeCustomer));
});

router.patch("/admin/customers/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const allowed = [
    "customerNr","salutation","title","firstName","lastName","specialty",
    "institutionName","institutionType","address","postalCode",
    "city","country","phone","fax","email","website",
    "referenceNumber","isPublicAuthority","defaultBuyerReference","ustIdNr","instrument","certifications","notes",
    "shippingFirstName","shippingLastName","shippingInstitutionName",
    "shippingAddress","shippingPostalCode","shippingCity",
    "shippingCountry","shippingPhone","shippingEmail",
  ] as const;

  const body = req.body as Record<string, unknown>;
  const update: Record<string, unknown> = {};
  for (const f of allowed) {
    if (f in body) update[f] = body[f] ?? null;
  }
  const hasNameUpdate = "firstName" in body || "lastName" in body;
  let titleForNameUpdate = body.title;
  if (hasNameUpdate && !("title" in body)) {
    const [existing] = await db
      .select({ title: websiteCustomersTable.title })
      .from(websiteCustomersTable)
      .where(eq(websiteCustomersTable.id, id));
    if (!existing) { res.status(404).json({ error: "Customer not found" }); return; }
    titleForNameUpdate = existing.title;
  }
  if (hasNameUpdate) {
    Object.assign(
      update,
      normalizeWebsiteCustomerNameFields({
        title: titleForNameUpdate,
        firstName: body.firstName,
        lastName: body.lastName,
      }),
    );
  }

  if ("certifications" in body) {
    if (!Array.isArray(body.certifications) ||
      body.certifications.some((value) => typeof value !== "string")) {
      res.status(400).json({ error: "Certifications must be a list of product systems" });
      return;
    }
    const certifications = normalizeCustomerCertifications(
      body.certifications,
      body.instrument,
    );
    if (certifications.length === 0) {
      res.status(400).json({ error: "At least one certification is required" });
      return;
    }
    update.certifications = certifications;
  } else if ("instrument" in body) {
    // Preserve behavior for older admin clients that only edit `instrument`.
    update.certifications = normalizeCustomerCertifications(
      undefined,
      body.instrument,
    );
  }

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "No updatable fields provided" });
    return;
  }

  const [row] = await db
    .update(websiteCustomersTable)
    .set(update as Parameters<ReturnType<typeof db.update>["set"]>[0])
    .where(eq(websiteCustomersTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Customer not found" }); return; }
  res.json(serializeCustomer(row));
});

router.delete("/admin/customers/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(websiteCustomersTable).where(eq(websiteCustomersTable.id, id));
  res.json({ message: "Customer deleted" });
});

// Merge two customers: copy missing fields from secondary → primary, re-point all invoices, delete secondary
router.post("/admin/customers/merge", requireAdmin, async (req, res) => {
  const { primaryId, secondaryId } = req.body as { primaryId: unknown; secondaryId: unknown };
  const pid = typeof primaryId === "number" ? primaryId : parseInt(String(primaryId));
  const sid = typeof secondaryId === "number" ? secondaryId : parseInt(String(secondaryId));
  if (isNaN(pid) || isNaN(sid) || pid === sid) {
    res.status(400).json({ error: "primaryId and secondaryId must be different valid integers" });
    return;
  }
  const [primary] = await db.select().from(websiteCustomersTable).where(eq(websiteCustomersTable.id, pid));
  const [secondary] = await db.select().from(websiteCustomersTable).where(eq(websiteCustomersTable.id, sid));
  if (!primary || !secondary) { res.status(404).json({ error: "One or both customers not found" }); return; }

  // Build a patch: for every nullable field, fill primary's gaps from secondary
  const nullableFields = [
    "customerNr","salutation","title","firstName","lastName","specialty",
    "institutionName","institutionType","address","postalCode","city","country",
    "phone","fax","website","referenceNumber","ustIdNr","notes",
    "shippingFirstName","shippingLastName","shippingInstitutionName",
    "shippingAddress","shippingPostalCode","shippingCity",
    "shippingCountry","shippingPhone","shippingEmail",
  ] as const;
  const patch: Record<string, unknown> = {};
  for (const f of nullableFields) {
    const pv = primary[f as keyof typeof primary];
    const sv = secondary[f as keyof typeof secondary];
    if ((pv === null || pv === undefined || pv === "") && sv !== null && sv !== undefined && sv !== "") {
      patch[f] = sv;
    }
  }

  // Apply the patch if there's anything to fill in
  if (Object.keys(patch).length > 0) {
    await db.update(websiteCustomersTable)
      .set(patch as Parameters<ReturnType<typeof db.update>["set"]>[0])
      .where(eq(websiteCustomersTable.id, pid));
  }

  // Re-point invoices from secondary → primary
  await db.update(irocInvoices).set({ websiteCustomerId: pid }).where(eq(irocInvoices.websiteCustomerId, sid));
  // Delete the duplicate
  await db.delete(websiteCustomersTable).where(eq(websiteCustomersTable.id, sid));

  const [updated] = await db.select().from(websiteCustomersTable).where(eq(websiteCustomersTable.id, pid));
  res.json({ message: "Merged", primary: serializeCustomer(updated!) });
});

// ── Portal app settings ───────────────────────────────────────────────────────
// Stores portal-specific configuration (welcome message, nav config, etc.)
// in the shared settings table using portal_* key prefix.

const PORTAL_ALLOWED_KEYS = new Set([
  "portal_welcome_de",
  "portal_welcome_en",
  "portal_subtitle_de",
  "portal_subtitle_en",
  "portal_nav_config",
]);

router.get("/admin/portal-settings", requireAdmin, async (_req, res) => {
  try {
    const rows = await db.select().from(settingsTable);
    const out: Record<string, string> = {};
    for (const row of rows) {
      if (PORTAL_ALLOWED_KEYS.has(row.key)) out[row.key] = row.value;
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: "Failed to load portal settings" });
  }
});

router.post("/admin/portal-settings", requireAdmin, async (req, res) => {
  const { key, value } = req.body as { key?: string; value?: string };
  if (!key || !PORTAL_ALLOWED_KEYS.has(key)) {
    res.status(400).json({ error: "Invalid key" });
    return;
  }
  try {
    await db
      .insert(settingsTable)
      .values({ key, value: value ?? "" })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: value ?? "", updatedAt: new Date() } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save portal setting" });
  }
});

export default router;
