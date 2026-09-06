/**
 * spirecut-settings-persistence.test.ts — Task #91
 *
 * Verifies that values saved via POST /api/admin/spirecut-settings are
 * actually persisted so that a subsequent GET /api/patient-settings
 * (simulating a cold page load / page reload) returns the updated values.
 *
 * Covers all four core Spirecut setting keys, the upsert (second write wins)
 * behaviour, and the defaults-fallback when no overrides are stored.
 *
 * Strategy: the db mock uses a shared in-memory Map so that values written
 * by insert().values().onConflictDoUpdate() are visible to subsequent
 * select().from() calls — exactly as a real database would behave.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";
import { CHATBOT_SYSTEM_PROMPT_MAX_LENGTH } from "@workspace/spirecut-shared";

// ── Stateful in-memory DB mock ────────────────────────────────────────────────
//
// vi.hoisted() runs before any imports so the mock is in place before
// @workspace/db is resolved.

const {
  store,
  queueRepairClaims,
  synchronizeNextSelects,
  mockInsert,
  mockSelect,
  mockUpdate,
} = vi.hoisted(() => {
  // Shared key→value store simulating the `settings` table.
  const store = new Map<string, string>();
  const practicalTitleKeys = [
    "sp_video_praktisch_1_title",
    "sp_video_praktisch_2_title",
  ];
  let repairClaims: Array<string | undefined> = [];
  let selectsToSynchronize = 0;
  let releaseSynchronizedSelects: (() => void) | undefined;
  let synchronizedSelects: Promise<void> | undefined;

  // Make independently-started reads observe the same pre-repair snapshot.
  // This lets the regression test exercise competing repair claims rather
  // than relying on the HTTP server's incidental request scheduling.
  const synchronizeNextSelects = (count: number) => {
    selectsToSynchronize = count;
    synchronizedSelects = new Promise<void>((resolve) => {
      releaseSynchronizedSelects = resolve;
    });
  };

  // The configured claims model PostgreSQL receiving title UPDATE statements
  // from two requests in an interleaved order.
  const queueRepairClaims = (...claims: Array<string | undefined>) => {
    repairClaims = claims;
  };

  // insert(table).values({ key, value }).onConflictDoUpdate(…)
  // We capture the written value in the values() call.
  const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);

  const mockValues = vi.fn().mockImplementation((row: { key: string; value: string }) => {
    if (row.key === "sp_internal_praktisch_title_repair_count" && store.has(row.key)) {
      return {
        onConflictDoUpdate: vi.fn().mockImplementation(({ set }: {
          set: { value: unknown };
        }) => {
          // A literal conflict value recreates the former read-then-write
          // behavior. The SQL expression used by the route is an atomic
          // increment, so model it as adding this request's claimed repairs.
          if (typeof set.value === "string") {
            store.set(row.key, set.value);
          } else {
            const current = Number.parseInt(store.get(row.key) ?? "", 10);
            const increment = Number.parseInt(row.value, 10);
            store.set(row.key, String(
              (Number.isSafeInteger(current) && current >= 0 ? current : 0) +
              (Number.isSafeInteger(increment) && increment >= 0 ? increment : 0),
            ));
          }
          return Promise.resolve(undefined);
        }),
      };
    }
    store.set(row.key, row.value);
    return { onConflictDoUpdate: mockOnConflictDoUpdate };
  });

  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

  // select().from(table) — returns all rows currently in the store.
  const mockFrom = vi.fn().mockImplementation(() => {
    const rows = Array.from(store.entries()).map(([key, value]) => ({ key, value }));
    if (selectsToSynchronize > 0 && synchronizedSelects) {
      selectsToSynchronize -= 1;
      if (selectsToSynchronize === 0) releaseSynchronizedSelects?.();
      return synchronizedSelects.then(() => rows);
    }
    return Promise.resolve(rows);
  });

  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  // A conditional legacy-title update changes only rows that are still
  // whitespace-only. It returns the rows it actually claimed, mirroring the
  // PostgreSQL UPDATE … RETURNING used by the route.
  const mockUpdate = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockImplementation(() => {
            if (repairClaims.length > 0) {
              const claimedKey = repairClaims.shift();
              if (claimedKey === undefined) return Promise.resolve([]);
              const value = store.get(claimedKey);
              if (value?.trim() === "" && value !== "") {
                store.set(claimedKey, "");
                return Promise.resolve([{ key: claimedKey }]);
              }
              return Promise.resolve([]);
            }
          const repaired = Array.from(store.entries())
            .filter(([key, value]) =>
              practicalTitleKeys.includes(key) &&
              value.trim() === "" &&
              value !== "",
            )
            .map(([key]) => ({ key }));
          for (const { key } of repaired) store.set(key, "");
          return Promise.resolve(repaired);
        }),
      }),
    }),
  });

  return {
    store,
    queueRepairClaims,
    synchronizeNextSelects,
    mockInsert,
    mockSelect,
    mockUpdate,
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
    update: mockUpdate,
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  },
  settingsTable: { key: "key" },
  // Other tables referenced by the broader router
  trainingDatesTable: {},
  trainedDoctorsTable: {},
  doctorCertificationsTable: {},
  resourcesTable: {},
  trainingRegistrationsTable: {},
  websiteCustomersTable: {},
  irocAppUsers: {},
  irocCustomers: {},
  irocProducts: {},
  irocInventoryLots: {},
  irocInvoices: {},
  irocInvoiceItems: {},
  irocNotifications: {},
}));

// ── Import app AFTER mocks ────────────────────────────────────────────────────
import app from "../app";

// ── Auth helper (mirrors iroc.ts signToken) ───────────────────────────────────

function makeValidJwt(payload: { userId: number; username: string }): string {
  const secret = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const data = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const JWT_AUTH = `Bearer ${makeValidJwt({ userId: 1, username: "admin" })}`;

// Valid YouTube embed URLs used for video key tests
const YT_CT = "https://www.youtube.com/embed/aaaaabbbbbcc?rel=0";
const YT_TF = "https://www.youtube.com/embed/dddddeeeeeff?rel=0";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("spirecut-settings persistence — cold-load round-trip", () => {
  beforeEach(() => {
    // Reset the in-memory store before each test so tests are independent.
    store.clear();
    queueRepairClaims();
  });

  // ── sp_contact_email_de ─────────────────────────────────────────────────────

  it("GET /api/patient-settings returns the updated sp_contact_email_de after a POST", async () => {
    const newEmail = "kontakt@spirecut.de";

    const postRes = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_contact_email_de", value: newEmail });

    expect(postRes.status).toBe(200);
    expect(postRes.body).toMatchObject({ ok: true });

    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_contact_email_de).toBe(newEmail);
  });

  // ── sp_contact_email_com ────────────────────────────────────────────────────

  it("GET /api/patient-settings returns the updated sp_contact_email_com after a POST", async () => {
    const newEmail = "hello@spirecut.com";

    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_contact_email_com", value: newEmail });

    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_contact_email_com).toBe(newEmail);
  });

  it("GET /api/patient-settings returns the saved patient-gate link after a POST", async () => {
    const savedGateUrl = "https://spirecut.com/medical-professionals";

    const postRes = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_gate_link_url", value: savedGateUrl });

    expect(postRes.status).toBe(200);

    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_gate_link_url).toBe(savedGateUrl);
  });

  // ── sp_video_ct_url ─────────────────────────────────────────────────────────

  it("GET /api/patient-settings returns the updated sp_video_ct_url after a POST", async () => {
    const postRes = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_video_ct_url", value: YT_CT });

    expect(postRes.status).toBe(200);

    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_video_ct_url).toBe(YT_CT);
  });

  // ── sp_video_tf_url ─────────────────────────────────────────────────────────

  it("GET /api/patient-settings returns the updated sp_video_tf_url after a POST", async () => {
    const postRes = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_video_tf_url", value: YT_TF });

    expect(postRes.status).toBe(200);

    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_video_tf_url).toBe(YT_TF);
  });

  // ── Multi-field: two email keys persisted independently ─────────────────────

  it("persists multiple keys independently and returns all via GET", async () => {
    const newDe = "de-updated@spirecut.de";
    const newCom = "com-updated@spirecut.com";

    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_contact_email_de", value: newDe });

    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_contact_email_com", value: newCom });

    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_contact_email_de).toBe(newDe);
    expect(getRes.body.sp_contact_email_com).toBe(newCom);
  });

  // ── onConflictDoUpdate: second write wins ───────────────────────────────────

  it("a second POST to the same key overwrites the first (simulates DB upsert)", async () => {
    const firstEmail = "first@spirecut.de";
    const secondEmail = "second@spirecut.de";

    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_contact_email_de", value: firstEmail });

    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_contact_email_de", value: secondEmail });

    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    // The second write must win, matching real onConflictDoUpdate semantics
    expect(getRes.body.sp_contact_email_de).toBe(secondEmail);
  });

  // ── Default fallback when no overrides are stored ───────────────────────────

  it("GET /api/patient-settings returns SP_DEFAULTS when the store is empty", async () => {
    // store.clear() already called in beforeEach — no POSTs in this test
    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    // Spot-check defaults from SP_DEFAULTS
    expect(getRes.body.sp_contact_email_de).toBe("info@spirecut.de");
    expect(getRes.body.sp_contact_email_com).toBe("info@spirecut.com");
    expect(getRes.body.sp_video_ct_url).toBe("https://www.youtube.com/embed/jDStbSFduO8?rel=0");
    expect(getRes.body.sp_video_tf_url).toBe("https://www.youtube.com/embed/QbOlsFMTbJo?rel=0");
  });

  it("repairs legacy practical video titles and reports only the repair count", async () => {
    store.set("sp_video_praktisch_1_title", " \t");
    store.set("sp_video_praktisch_2_title", "\n ");

    const getRes = await request(app).get("/api/patient-settings");

    expect(getRes.status).toBe(200);
    expect(getRes.body.sp_video_praktisch_1_title).toBe("");
    expect(getRes.body.sp_video_praktisch_2_title).toBe("");
    expect(getRes.body._meta).toEqual({
      repair: {
        legacyPracticalVideoTitlesRepaired: 2,
        legacyPracticalVideoTitlesAcknowledged: 0,
      },
    });
    expect(getRes.body._meta.repair).not.toHaveProperty("keys");

    const subsequentRes = await request(app).get("/api/patient-settings");
    expect(subsequentRes.body._meta.repair.legacyPracticalVideoTitlesRepaired).toBe(2);
  });

  it("counts titles claimed by simultaneous settings loads exactly once", async () => {
    store.set("sp_video_praktisch_1_title", " \t");
    store.set("sp_video_praktisch_2_title", "\n ");
    // Both requests read the legacy values. Their conditional UPDATEs then
    // split the claims, as can happen when PostgreSQL schedules them
    // concurrently. This specifically catches a non-atomic count upsert:
    // each request contributes one repair, so a literal conflict write would
    // leave the stored count at one.
    synchronizeNextSelects(2);
    queueRepairClaims(
      "sp_video_praktisch_1_title",
      undefined,
      undefined,
      "sp_video_praktisch_2_title",
    );

    const [first, second] = await Promise.all([
      request(app).get("/api/patient-settings"),
      request(app).get("/api/patient-settings"),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(store.get("sp_video_praktisch_1_title")).toBe("");
    expect(store.get("sp_video_praktisch_2_title")).toBe("");

    const subsequentRes = await request(app).get("/api/patient-settings");
    expect(subsequentRes.body._meta.repair).toEqual({
      legacyPracticalVideoTitlesRepaired: 2,
      legacyPracticalVideoTitlesAcknowledged: 0,
    });
  });

  it("lets admins see the practical-title repair count without exposing title values in the status", async () => {
    store.set("sp_video_praktisch_1_title", "  ");

    const adminRes = await request(app)
      .get("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH);

    expect(adminRes.status).toBe(200);
    expect(adminRes.body.repair).toEqual({
      legacyPracticalVideoTitlesRepaired: 1,
      legacyPracticalVideoTitlesAcknowledged: 0,
    });
    expect(adminRes.body.repair).not.toHaveProperty("keys");
    expect(adminRes.body.settings.sp_video_praktisch_1_title).toBe("");
  });

  it("acknowledges the current repair count and shows a later repair as unacknowledged", async () => {
    store.set("sp_video_praktisch_1_title", " ");
    await request(app)
      .get("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH);

    const acknowledgement = await request(app)
      .post("/api/admin/spirecut-settings/acknowledge-title-repairs")
      .set("Authorization", JWT_AUTH)
      .send({});
    expect(acknowledgement.status).toBe(200);
    expect(acknowledgement.body).toEqual({ ok: true, acknowledged: 1 });

    store.set("sp_video_praktisch_2_title", "\t");
    const later = await request(app)
      .get("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH);
    expect(later.body.repair).toEqual({
      legacyPracticalVideoTitlesRepaired: 2,
      legacyPracticalVideoTitlesAcknowledged: 1,
    });
    expect(later.body.repair).not.toHaveProperty("keys");
  });

  // ── Rejection: unknown key is never written ─────────────────────────────────

  it("POST with an unknown key returns 400 and does not pollute GET response", async () => {
    const postRes = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_unknown_field", value: "should-not-persist" });

    expect(postRes.status).toBe(400);

    const getRes = await request(app).get("/api/patient-settings");
    expect(getRes.status).toBe(200);
    // The unknown key must not appear in the public response
    expect((getRes.body as Record<string, unknown>)["sp_unknown_field"]).toBeUndefined();
  });

  // ── Chatbot system prompt length guard ───────────────────────────────────────

  it("returns 422 and does not persist a chatbot prompt over the shared limit", async () => {
    const oversizedPrompt = "x".repeat(CHATBOT_SYSTEM_PROMPT_MAX_LENGTH + 1);

    const postRes = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_chatbot_system_prompt", value: oversizedPrompt });

    expect(postRes.status).toBe(422);
    expect(postRes.body).toMatchObject({
      error: `Chatbot system prompt must not exceed ${CHATBOT_SYSTEM_PROMPT_MAX_LENGTH} characters`,
    });
    expect(store.has("sp_chatbot_system_prompt")).toBe(false);
  });

  it("accepts and persists a chatbot prompt under the shared limit", async () => {
    const prompt = "x".repeat(CHATBOT_SYSTEM_PROMPT_MAX_LENGTH - 1);

    const postRes = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_chatbot_system_prompt", value: prompt });

    expect(postRes.status).toBe(200);
    expect(postRes.body).toMatchObject({ ok: true });
    expect(store.get("sp_chatbot_system_prompt")).toBe(prompt);
  });

  it.each([
    ["sp_chatbot_system_prompt", {}],
    ["sp_chatbot_starters_de", 42],
    ["sp_chatbot_starters_en", null],
  ] as const)("returns 400 and preserves %s when the chatbot value is not a string", async (key, value) => {
    const originalValue = "saved chatbot content";
    store.set(key, originalValue);

    const postRes = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key, value });

    expect(postRes.status).toBe(400);
    expect(postRes.body).toMatchObject({
      error: "Chatbot setting value must be a string",
    });
    expect(store.get(key)).toBe(originalValue);
  });

  it("accepts an intentional empty chatbot prompt and persists the clear", async () => {
    await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_chatbot_system_prompt", value: "custom prompt" });

    const clearRes = await request(app)
      .post("/api/admin/spirecut-settings")
      .set("Authorization", JWT_AUTH)
      .send({ key: "sp_chatbot_system_prompt", value: "" });

    expect(clearRes.status).toBe(200);
    expect(clearRes.body).toMatchObject({ ok: true });
    expect(store.get("sp_chatbot_system_prompt")).toBe("");
  });
});
