import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

const router: IRouter = Router();

// ── iROC Website product video URLs (used by product pages) ──────────────────
router.get("/video-urls", async (_req, res) => {
  const rows = await db.select().from(settingsTable);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json({
    spirecut: map["video_url_spirecut"] ?? "https://www.youtube.com/embed/mjPCpa427go",
    ministem: map["video_url_ministem"] ?? "",
  });
});

// ── iROC Website global settings (contact info, hero, maps, social links) ────
export const WS_DEFAULTS: Record<string, string> = {
  ws_contact_email:       "info@i-roc.de",
  ws_contact_phone:       "+49 89 4625993 70",
  invoice_contact_email:  "info@i-roc.de",
  invoice_contact_phone:  "+49 (0)89 600 60 805",
  ws_contact_fax:         "+49 89 21530 334",
  ws_address_street:      "St.-Emmeram-Str. 26",
  ws_address_postal:      "85609",
  ws_address_city:        "Aschheim",
  ws_address_country_de:  "Deutschland",
  ws_address_country_en:  "Germany",
  ws_logo_url:            "",
  ws_hero_image_url:      "https://images.unsplash.com/photo-1551076805-e1869043e560?q=80&w=2574&auto=format&fit=crop",
  ws_maps_embed_url:      "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2662.4!2d11.7!3d48.17!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2sSt.-Emmeram-Str.+26%2C+85609+Aschheim!5e0!3m2!1sde!2sde!4v1",
  ws_maps_directions_url: "https://maps.google.com/?q=St.-Emmeram-Str.+26,+85609+Aschheim",
  ws_social_linkedin:     "",
  ws_social_facebook:     "",
  ws_social_instagram:    "",
  ws_social_youtube:      "",
  ws_spirecut_company_url: "https://www.spirecut.com",
  ws_ministem_company_url: "https://www.jointechlabs.com",
  // Browser web-app / QR destination
  ws_webapp_url: "https://portal.i-roc.de",
  // Medical-professional gate
  ws_gate_enabled:   "true",
  ws_gate_title_de:  "Diese Website richtet sich ausschließlich an Ärzte und medizinische Fachkräfte.",
  ws_gate_title_en:  "This website is intended exclusively for medical doctors and healthcare professionals.",
  ws_gate_body_de:   "Sind Sie kein Arzt oder keine medizinische Fachkraft? Dann besuchen Sie bitte unsere Patientenwebsite.",
  ws_gate_body_en:   "Are you not a medical doctor or healthcare professional? Please visit our patient website instead.",
  ws_gate_link_url:  "https://www.spirecut.de",
};

router.get("/website-settings", async (_req, res) => {
  const rows = await db.select().from(settingsTable);
  const db_map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const result: Record<string, string> = { ...WS_DEFAULTS };
  for (const key of Object.keys(WS_DEFAULTS)) {
    if (db_map[key] !== undefined) result[key] = db_map[key];
  }
  // ws_logo_url is allowed to be blank (means "use built-in static logo")
  if (db_map["ws_logo_url"] !== undefined) result["ws_logo_url"] = db_map["ws_logo_url"];
  res.json(result);
});

// ── Spirecut patient settings (video URLs, contact emails) ───────────────────
export const SP_DEFAULTS: Record<string, string> = {
  sp_video_ct_url:            "https://www.youtube.com/embed/jDStbSFduO8?rel=0",
  sp_video_tf_url:            "https://www.youtube.com/embed/QbOlsFMTbJo?rel=0",
  sp_contact_email_de:        "info@spirecut.de",
  sp_contact_email_com:       "info@spirecut.com",
  sp_video_praktisch_1_url:   "",
  sp_video_praktisch_2_url:   "",
  sp_video_praktisch_1_title: "",
  sp_video_praktisch_2_title: "",
  // Patient gate
  sp_gate_enabled:  "true",
  sp_gate_title_de: "Diese Website richtet sich an Patienten und Interessierte.",
  sp_gate_title_en: "This website is intended for patients and interested individuals.",
  sp_gate_body_de:  "Sind Sie Arzt oder medizinisches Fachpersonal? Dann besuchen Sie bitte die iROC GmbH Website.",
  sp_gate_body_en:  "Are you a medical doctor or healthcare professional? Please visit the iROC GmbH website instead.",
  sp_gate_link_url: "https://www.i-roc.de",
  // Browser PWA / QR destination; blank uses the current deployment base URL
  sp_webapp_url: "",
};

const SP_PRAKTISCH_TITLE_KEYS = [
  "sp_video_praktisch_1_title",
  "sp_video_praktisch_2_title",
] as const;
const SP_PRAKTISCH_TITLE_REPAIR_COUNT_KEY = "sp_internal_praktisch_title_repair_count";
const SP_PRAKTISCH_TITLE_REPAIR_ACK_KEY = "sp_internal_praktisch_title_repair_acknowledged";

// Chatbot keys have no defaults — empty string means "use hardcoded fallback"
const SP_CHATBOT_KEYS = ["sp_chatbot_system_prompt", "sp_chatbot_starters_de", "sp_chatbot_starters_en"];

export interface PatientSettingsRepairStatus {
  legacyPracticalVideoTitlesRepaired: number;
  legacyPracticalVideoTitlesAcknowledged: number;
}

export interface PatientSettingsRead {
  settings: Record<string, string>;
  repair: PatientSettingsRepairStatus;
}

export async function readPatientSettings(): Promise<PatientSettingsRead> {
  let rows = await db.select().from(settingsTable);
  let db_map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  // Repair legacy rows saved before whitespace-only practical video titles were
  // normalized on write. Restrict this to the two title keys so unrelated
  // settings are never altered, and persist the canonical empty value so the
  // repair is durable for every subsequent consumer.
  const legacyBlankTitleKeys = SP_PRAKTISCH_TITLE_KEYS.filter(
    (key) => typeof db_map[key] === "string" && db_map[key].trim() === "" && db_map[key] !== "",
  );
  if (legacyBlankTitleKeys.length > 0) {
    // Only the request that changes a legacy value may increment the history.
    // The predicate is evaluated by PostgreSQL at update time, rather than
    // against the potentially stale snapshot above, so concurrent reads cannot
    // each claim the same repair.
    const repaired = await Promise.all(legacyBlankTitleKeys.map((key) =>
      db
        .update(settingsTable)
        .set({ value: "", updatedAt: new Date() })
        .where(and(
          eq(settingsTable.key, key),
          sql`${settingsTable.value} <> '' AND btrim(${settingsTable.value}) = ''`,
        ))
        .returning({ key: settingsTable.key }),
    ));
    const repairedCount = repaired.reduce((count, repairedRows) => count + repairedRows.length, 0);

    if (repairedCount > 0) {
      // This is deliberately an in-database increment. A read-then-write here
      // loses increments when independently handled settings requests repair
      // different titles at the same time.
      const countIncrement = sql<string>`
        CASE
          WHEN ${settingsTable.value} ~ '^[0-9]+$'
            THEN (${settingsTable.value})::bigint + ${repairedCount}
          ELSE ${repairedCount}
        END
      `;
      await db
        .insert(settingsTable)
        .values({ key: SP_PRAKTISCH_TITLE_REPAIR_COUNT_KEY, value: String(repairedCount) })
        .onConflictDoUpdate({
          target: settingsTable.key,
          set: { value: countIncrement, updatedAt: new Date() },
        });
    }

    // Reload after the conditional writes. This makes the response reflect the
    // authoritative cumulative count (including another request's increment)
    // and keeps acknowledgement comparisons correct.
    rows = await db.select().from(settingsTable);
    db_map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  const storedRepairCount = Number.parseInt(db_map[SP_PRAKTISCH_TITLE_REPAIR_COUNT_KEY] ?? "", 10);
  const repairCount = Number.isSafeInteger(storedRepairCount) && storedRepairCount >= 0
    ? storedRepairCount
    : 0;
  const storedAcknowledgedCount = Number.parseInt(db_map[SP_PRAKTISCH_TITLE_REPAIR_ACK_KEY] ?? "", 10);
  const acknowledgedCount = Number.isSafeInteger(storedAcknowledgedCount) && storedAcknowledgedCount >= 0
    ? Math.min(storedAcknowledgedCount, repairCount)
    : 0;

  const result: Record<string, string> = { ...SP_DEFAULTS };
  for (const key of Object.keys(SP_DEFAULTS)) {
    if (db_map[key] !== undefined) result[key] = db_map[key];
  }
  // Include chatbot overrides (empty string if not yet set)
  for (const key of SP_CHATBOT_KEYS) {
    result[key] = db_map[key] ?? "";
  }

  return {
    settings: result,
    repair: {
      legacyPracticalVideoTitlesRepaired: repairCount,
      legacyPracticalVideoTitlesAcknowledged: acknowledgedCount,
    },
  };
}

router.get("/patient-settings", async (_req, res) => {
  const { settings, repair } = await readPatientSettings();
  res.json({
    ...settings,
    _meta: { repair },
  });
});

export default router;
