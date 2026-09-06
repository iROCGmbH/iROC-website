import crypto from "node:crypto";
import { db, websiteCustomersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/** Unambiguous alphabet: no I, O, 0, 1 to avoid confusion on printed invoices */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Generate a random 8-character reorder code */
export function generateReorderCode(): string {
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

/** Generate a reorder code that is unique across website_customers. */
export async function generateUniqueReorderCode(
  additionallyTakenCodes: ReadonlySet<string> = new Set(),
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateReorderCode();
    if (additionallyTakenCodes.has(code)) continue;
    const [existing] = await db
      .select({ id: websiteCustomersTable.id })
      .from(websiteCustomersTable)
      .where(eq(websiteCustomersTable.reorderCode, code));
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique reorder code");
}

/** Normalize user input for comparison (trim, uppercase) */
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase();
}
