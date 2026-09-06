import { db, irocLeads, trainingRegistrationsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const REGISTERED_LEAD_STATUSES = new Set(["new", "contacted", "registered"]);

export class TrainingRegistrationConfirmationError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "TrainingRegistrationConfirmationError";
  }
}

function trimmed(value: string | null | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

function fillIfMissing(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): string | undefined {
  if (trimmed(existing) || !trimmed(incoming)) return undefined;
  return trimmed(incoming) ?? undefined;
}

function leadSalutation(value: string | null | undefined): string | null {
  const normalized = trimmed(value);
  if (!normalized) return null;
  if (normalized === "Mann") return "Herr";
  if (normalized === "Diverse") return "Divers";
  if (normalized === "Andere") return "Divers";
  return normalized;
}

function registrationNotes(
  trainingDateInfo: string | null | undefined,
  notes: string | null | undefined,
): string | null {
  const details = [
    trainingDateInfo ? `Training registration: ${trainingDateInfo}` : "Training registration",
    trimmed(notes),
  ].filter(Boolean);
  return details.length > 0 ? details.join("\n") : null;
}

/**
 * Confirm a registration and synchronize its person into iROC Leads.
 *
 * The transaction is intentionally shared by the admin and email-confirmation
 * paths. A registration lock makes repeated requests safe, while the
 * email-based advisory lock prevents two registrations with the same email
 * from creating duplicate leads concurrently.
 */
export async function confirmTrainingRegistration(registrationId: number) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${registrationId})`);

    const [registration] = await tx
      .select()
      .from(trainingRegistrationsTable)
      .where(eq(trainingRegistrationsTable.id, registrationId));

    if (!registration) {
      throw new TrainingRegistrationConfirmationError("Registration not found", 404);
    }

    const email = trimmed(registration.email);
    if (!email) {
      throw new TrainingRegistrationConfirmationError(
        "Registration has no email address / Anmeldung hat keine E-Mail-Adresse",
        422,
      );
    }

    if (registration.status !== "pending" && registration.status !== "confirmed") {
      throw new TrainingRegistrationConfirmationError(
        "Registration cannot be confirmed from its current status",
        409,
      );
    }

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${email.toLowerCase()}, 0))`);

    const confirmedAt = registration.confirmedAt ?? new Date();
    let confirmed = registration;
    const didConfirm = registration.status === "pending";
    if (didConfirm) {
      const [updatedRegistration] = await tx
        .update(trainingRegistrationsTable)
        .set({ status: "confirmed", confirmedAt })
        .where(eq(trainingRegistrationsTable.id, registration.id))
        .returning();
      confirmed = updatedRegistration;
    }

    const [existingLead] = await tx
      .select()
      .from(irocLeads)
      .where(sql`lower(btrim(${irocLeads.email})) = ${email.toLowerCase()}`)
      .orderBy(irocLeads.id)
      .limit(1)
      // Read the latest lead state while holding its row lock. This makes a
      // concurrent qualification/conversion either finish before this read or
      // wait until the registration sync has safely completed.
      .for("update");

    if (!existingLead) {
      const [lead] = await tx
        .insert(irocLeads)
        .values({
          salutation: leadSalutation(confirmed.salutation) ?? "Herr",
          medicalTitle: trimmed(confirmed.medicalDegree),
          firstName: trimmed(confirmed.firstName) ?? "",
          lastName: trimmed(confirmed.lastName) ?? "",
          specialty: trimmed(confirmed.specialty),
          institutionName: trimmed(confirmed.institutionName),
          zipCode: trimmed(confirmed.postalCode),
          street: trimmed(confirmed.street),
          houseNumber: trimmed(confirmed.houseNumber),
          city: trimmed(confirmed.city),
          country: trimmed(confirmed.country),
          email,
          phone: trimmed(confirmed.phone),
          website: trimmed(confirmed.websiteUrl),
          contactWhere: "Training registration",
          notes: registrationNotes(confirmed.trainingDateInfo, confirmed.notes),
          status: "registered",
        })
        .returning();

      return {
        registration: confirmed,
        lead,
        leadCreated: true,
        didConfirm,
      };
    }

    const leadUpdate: Partial<typeof irocLeads.$inferInsert> = {
      updatedAt: new Date(),
    };

    const fields: Array<[
      keyof typeof leadUpdate,
      string | null | undefined,
    ]> = [
      ["medicalTitle", confirmed.medicalDegree],
      ["firstName", confirmed.firstName],
      ["lastName", confirmed.lastName],
      ["specialty", confirmed.specialty],
      ["institutionName", confirmed.institutionName],
      ["zipCode", confirmed.postalCode],
      ["street", confirmed.street],
      ["houseNumber", confirmed.houseNumber],
      ["city", confirmed.city],
      ["country", confirmed.country],
      ["phone", confirmed.phone],
      ["website", confirmed.websiteUrl],
    ];
    for (const [field, value] of fields) {
      const valueToFill = fillIfMissing(existingLead[field] as string | null | undefined, value);
      if (valueToFill !== undefined) Object.assign(leadUpdate, { [field]: valueToFill });
    }

    const salutationToFill = fillIfMissing(existingLead.salutation, leadSalutation(confirmed.salutation));
    if (salutationToFill !== undefined) leadUpdate.salutation = salutationToFill;

    const notesToFill = fillIfMissing(
      existingLead.notes,
      registrationNotes(confirmed.trainingDateInfo, confirmed.notes),
    );
    if (notesToFill !== undefined) leadUpdate.notes = notesToFill;

    // Registered is an automatic milestone, but never downgrade a lead that
    // has already progressed to Qualified or Converted.
    if (REGISTERED_LEAD_STATUSES.has(existingLead.status)) {
      leadUpdate.status = "registered";
    }

    const [lead] = await tx
      .update(irocLeads)
      .set(leadUpdate)
      .where(eq(irocLeads.id, existingLead.id))
      .returning();

    return {
      registration: confirmed,
      lead,
      leadCreated: false,
      didConfirm,
    };
  });
}