/**
 * One-time script: reclassify all pending Sally emails that still use raw
 * specialty strings (e.g. "Orthopädie, Handchirurgie") to the correct
 * brand-group taxonomy introduced by the sally-groups change.
 *
 * Run with:
 *   cd artifacts/api-server
 *   npx tsx src/scripts/reclassify-pending-queue.ts
 *
 * Safe to run multiple times (idempotent – only touches rows whose subject
 * does NOT already contain a canonical brand-group marker).
 */
import { pool } from "@workspace/db";
import {
  firstContactEmail,
  weekFollowupEmail,
  monthlyReminderEmail,
  type SallyLang,
} from "../lib/sally-cron.js";
import {
  specialtyToProductGroup,
  type ProductGroup,
} from "../lib/sally-groups.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Canonical brand-group markers — any pending email that already contains one
 *  of these in its subject is already up to date. */
const CANONICAL_MARKERS = [
  "Spirecut (Handchirurgie)",
  "Spirecut (hand surgery)",
  "MiniStem / Jointechlabs",
  "Cellenis / Estar Medical",
  "iROC Produkte",
  "iROC products",
];

function isAlreadyClassified(subject: string): boolean {
  return CANONICAL_MARKERS.some(m => subject.includes(m));
}

/** Best-effort: extract doctor name from the first line of the DE body. */
function extractName(body: string): string {
  const m = body.match(/(?:Sehr geehrte\/r|Dear)\s+(.+?),/);
  return m?.[1]?.trim() ?? "Doctor";
}

/** Detect the template language from the body ("both" if it contains ---). */
function detectLang(body: string): SallyLang {
  if (body.includes("\n\n---\n\n")) return "both";
  if (/Dear /.test(body)) return "en";
  return "de";
}

/** Reverse-map: derive the old raw specialty from the subject so we can
 *  run it through specialtyToProductGroup.
 *
 *  Handles two patterns:
 *   a) "Information über <GROUP> – iROC GmbH / …"  → extract between "über " and " –"
 *   b) "Erinnerung: Schulungsanmeldung – <GROUP> / …" → extract between "– " and " /"
 *   c) "Freundliche Erinnerung: Schulung <GROUP> / …" → extract between "Schulung " and " /"
 */
function extractOldGroup(subject: string): string {
  // Pattern a: "Information über X – iROC" (extract X between "über " and " –")
  let m = subject.match(/Information (?:über|about) (.+?) [–—]/);
  if (m) return m[1].trim();

  // Pattern b: "Schulungsanmeldung – X /" (extract X between "– " and " /")
  m = subject.match(/Schulungsanmeldung [–—] (.+?) \//);
  if (m) return m[1].trim();

  // Pattern c: "Schulung X /" (extract X between "Schulung " and " /")
  m = subject.match(/Schulung (.+?) \//);
  if (m) return m[1].trim();

  return "";
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Read Sally sender settings (fall back to defaults if not configured)
  const { rows: settingRows } = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE key IN ('sally_from_name','sally_from_email','sally_language')`,
  );
  const settings: Record<string, string> = {};
  for (const r of settingRows) settings[r.key] = r.value;
  const sallyName  = settings["sally_from_name"]?.trim()  || "Sally";
  const sallyEmail = settings["sally_from_email"]?.trim()  || "";

  // Fetch all pending emails that might need updating
  const { rows: emails } = await pool.query<{
    id: number; trigger_type: string; subject: string; body: string;
  }>(
    `SELECT id, trigger_type, subject, body
     FROM sally_email_queue
     WHERE status = 'pending'
     ORDER BY id`,
  );

  let updated = 0;
  for (const email of emails) {
    if (isAlreadyClassified(email.subject)) {
      console.log(`  ✓ id=${email.id} already classified — skip`);
      continue;
    }

    const oldGroup = extractOldGroup(email.subject);
    const group    = specialtyToProductGroup(oldGroup) as ProductGroup;
    const name     = extractName(email.body);
    const lang     = detectLang(email.body);

    console.log(`  → id=${email.id} (${email.trigger_type}) | old="${oldGroup}" → group="${group || "(general)"}" | name="${name}"`);

    let result: { subject: string; body: string };
    if (email.trigger_type === "first_contact") {
      result = firstContactEmail(name, group, lang, sallyName, sallyEmail);
    } else if (email.trigger_type === "4_week_followup") {
      result = weekFollowupEmail(name, group, lang, sallyName, sallyEmail);
    } else if (email.trigger_type === "2_month_reminder") {
      result = monthlyReminderEmail(name, group, lang, sallyName, sallyEmail);
    } else {
      console.log(`    ↳ unknown trigger_type "${email.trigger_type}" — skip`);
      continue;
    }

    await pool.query(
      `UPDATE sally_email_queue SET subject = $1, body = $2, updated_at = NOW() WHERE id = $3`,
      [result.subject, result.body, email.id],
    );
    console.log(`    ↳ updated subject: "${result.subject}"`);
    updated++;
  }

  console.log(`\nDone — updated ${updated} of ${emails.length} pending emails.`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
