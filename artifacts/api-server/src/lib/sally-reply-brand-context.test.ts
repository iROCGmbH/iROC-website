/**
 * sally-reply-brand-context.test.ts — Tasks #507, #511 & #512
 *
 * Verifies that processInboundEmail injects the correct brand context block
 * into the Gemini prompt based on the lead's product_interest_group.
 *
 * Scenarios (Task #507 — email-fallback path):
 *   1. Lead with product_interest_group = "spirecut" → prompt contains the
 *      Spirecut brand context block.
 *   2. No matching lead row → prompt contains no brand context block at all.
 *
 * Scenarios (Task #511 — thread-ID path):
 *   3. inReplyToMessageId resolves to a sally_email_queue row whose
 *      related_lead_id points to a spirecut lead → Spirecut brand block appears
 *      even though the email-fallback would have returned no lead.
 *   4. inReplyToMessageId is supplied but the thread lookup returns no matching
 *      row → function falls back to the email lookup and still picks up a
 *      spirecut lead via that path.
 *
 * Strategy:
 *   - Mock @workspace/db (pool) so DB round-trips are controlled.
 *   - Mock @workspace/integrations-gemini-ai to capture the exact prompt text
 *     passed to generateContent.
 *   - Mock ./sally-lessons.js to return a predictable empty string.
 *   - Mock ./email.js to prevent any actual email dispatch.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";

// ── Captured prompt holder ────────────────────────────────────────────────────
// vi.hoisted() runs before any import so mocks are in place before the module
// under test is resolved.

const { getCapturedPrompt, mockPoolQuery } = vi.hoisted(() => {
  let capturedPrompt = "";

  const getCapturedPrompt = () => capturedPrompt;

  // Simulate pool.query responses for the sequence of queries made inside
  // processInboundEmail:
  //   1. Dedupe check     → no existing draft (empty rows)
  //   2. Thread lookup    → configurable (controls whether lead is resolved by thread)
  //   3. Lead lookup by id → configurable (used when thread lookup returns a lead id)
  //   4. Lead lookup by email → configurable (email-fallback path)
  //   5. INSERT           → rowCount = 1  (draft saved)
  //
  // We use a factory that reads the SQL text to decide which response to return,
  // so each call gets the right shape regardless of call order.

  let leadRows: Array<{ product_interest_group: string | null }> = [];
  // threadRows controls what the "SELECT related_lead_id, related_doctor_id …
  // WHERE message_id = $1" query returns.
  let threadRows: Array<{ related_lead_id: number | null; related_doctor_id: number | null }> = [];
  // leadByIdRows controls the "SELECT product_interest_group FROM sally_leads WHERE id = $1" response.
  // When null, falls back to leadRows (so simple tests that don't care about the distinction
  // can keep using setLeadRows for both paths).
  let leadByIdRows: Array<{ product_interest_group: string | null }> | null = null;

  const mockPoolQuery = vi.fn(async (sql: string, _params?: unknown[]) => {
    const s = sql.trim().toLowerCase();

    // Dedupe check
    if (s.startsWith("select id from sally_email_queue")) {
      return { rows: [], rowCount: 0 };
    }

    // Thread lookup (in_reply_to match)
    if (s.startsWith("select related_lead_id")) {
      return { rows: threadRows, rowCount: threadRows.length };
    }

    // Lead lookup by id
    if (s.includes("from sally_leads where id")) {
      const rows = leadByIdRows ?? leadRows;
      return { rows, rowCount: rows.length };
    }

    // Lead lookup by email
    if (s.includes("from sally_leads where email")) {
      return { rows: leadRows, rowCount: leadRows.length };
    }

    // INSERT into sally_email_queue
    if (s.startsWith("insert into sally_email_queue")) {
      return { rows: [], rowCount: 1 };
    }

    // Settings lookup (escalation email)
    if (s.includes("from settings")) {
      return { rows: [], rowCount: 0 };
    }

    // Notifications insert (escalation)
    if (s.startsWith("insert into iroc_notifications")) {
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  });

  // Expose helpers so individual tests can configure which rows are returned.
  (mockPoolQuery as unknown as { setLeadRows: (r: typeof leadRows) => void }).setLeadRows =
    (r: typeof leadRows) => { leadRows = r; };

  (mockPoolQuery as unknown as { setThreadRows: (r: typeof threadRows) => void }).setThreadRows =
    (r: typeof threadRows) => { threadRows = r; };

  (mockPoolQuery as unknown as { setLeadByIdRows: (r: typeof leadRows | null) => void }).setLeadByIdRows =
    (r: typeof leadRows | null) => { leadByIdRows = r; };

  // Also expose the prompt capture setter.
  (getCapturedPrompt as unknown as { set: (p: string) => void }).set = (p: string) => {
    capturedPrompt = p;
  };

  return { getCapturedPrompt, mockPoolQuery };
});

// ── DB mock ───────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery },
}));

// ── Gemini AI mock — captures the prompt ──────────────────────────────────────

vi.mock("@workspace/integrations-gemini-ai", () => {
  return {
    ai: {
      models: {
        generateContent: vi.fn(async (opts: {
          model: string;
          contents: Array<{ role: string; parts: Array<{ text: string }> }>;
        }) => {
          const prompt = opts.contents?.[0]?.parts?.[0]?.text ?? "";
          // Store the original drafting prompt for assertion. Country-language
          // enforcement may make a second Gemini call with a rewrite prompt,
          // but these tests specifically verify the brand context supplied to
          // the initial draft.
          if (!getCapturedPrompt()) {
            (getCapturedPrompt as unknown as { set: (p: string) => void }).set(prompt);
          }

          // Return a minimal valid JSON reply so processInboundEmail can finish
          const reply = JSON.stringify({
            language: "en",
            formality: "formal",
            can_answer: true,
            escalation_summary: "",
            reply_subject: "Re: Test",
            reply_body: "Dear Sir,\n\nThank you.\n\nKind regards,\n\nSally\nSales Manager | iROC GmbH\nsally@i-roc.de",
          });
          return {
            candidates: [{ content: { parts: [{ text: reply }] } }],
          };
        }),
      },
    },
  };
});

// ── Lessons mock — returns empty string so the prompt is predictable ──────────

vi.mock("./sally-lessons.js", () => ({
  getLessonsPromptBlock: vi.fn(async () => ""),
}));

// ── Email mock — prevents actual SMTP dispatch ────────────────────────────────

vi.mock("./email.js", () => ({
  sendEmail: vi.fn(async () => undefined),
}));

// ── Import the function under test (AFTER mocks) ──────────────────────────────

import { processInboundEmail } from "./sally-reply.js";

// ── Env-var setup: ensure the Gemini guard never bails out in tests ───────────
// geminiDraftReply returns null immediately when these vars are absent.
// Setting non-secret placeholder values guarantees every test reaches
// generateContent regardless of the CI environment.

let _origBaseUrl: string | undefined;
let _origApiKey: string | undefined;

beforeAll(() => {
  _origBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  _origApiKey  = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  process.env.AI_INTEGRATIONS_GEMINI_BASE_URL = "https://test-gemini.example.com";
  process.env.AI_INTEGRATIONS_GEMINI_API_KEY  = "test-api-key-placeholder";
});

afterAll(() => {
  process.env.AI_INTEGRATIONS_GEMINI_BASE_URL = _origBaseUrl;
  process.env.AI_INTEGRATIONS_GEMINI_API_KEY  = _origApiKey;
});

// ── Shared call args ──────────────────────────────────────────────────────────

const BASE_OPTS = {
  inboundFrom: "doctor@example.com",
  inboundSubject: "Inquiry about your products",
  rawSource: "From: doctor@example.com\n\nHello, I would like more information.",
  sallyName: "Sally",
  sallyEmail: "sally@i-roc.de",
} as const;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("processInboundEmail — brand context injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset captured prompt
    (getCapturedPrompt as unknown as { set: (p: string) => void }).set("");
    // Reset all configurable mock state to empty / null defaults
    (mockPoolQuery as unknown as { setLeadRows: (r: Array<{ product_interest_group: string | null }>) => void })
      .setLeadRows([]);
    (mockPoolQuery as unknown as { setThreadRows: (r: Array<{ related_lead_id: number | null; related_doctor_id: number | null }>) => void })
      .setThreadRows([]);
    (mockPoolQuery as unknown as { setLeadByIdRows: (r: Array<{ product_interest_group: string | null }> | null) => void })
      .setLeadByIdRows(null);
  });

  // ── Test 1: Spirecut lead → Spirecut brand block is in the prompt ─────────

  it("includes the Spirecut brand context block when the matching lead has product_interest_group = 'spirecut'", async () => {
    // Arrange: DB returns a spirecut lead for the email address
    (mockPoolQuery as unknown as { setLeadRows: (r: Array<{ product_interest_group: string | null }>) => void })
      .setLeadRows([{ product_interest_group: "spirecut" }]);

    // Act
    await processInboundEmail(BASE_OPTS);

    // Assert: the captured prompt must contain the Spirecut brand block
    const prompt = getCapturedPrompt();
    expect(prompt).toContain("Spirecut");
    expect(prompt).toContain("hand surgery");
    expect(prompt).toContain("spirecut.com");
    // And must NOT contain unrelated brand blocks
    expect(prompt).not.toContain("MiniStem");
    expect(prompt).not.toContain("Cellenis");
  });

  // ── Test 2: No matching lead → no brand context block ─────────────────────

  it("omits any brand context block when no sally_leads row matches the sender's email", async () => {
    // Arrange: DB returns no lead rows (default from beforeEach)

    // Act
    await processInboundEmail(BASE_OPTS);

    // Assert: the prompt must not contain any brand context block
    const prompt = getCapturedPrompt();
    expect(prompt).not.toContain("Brand context:");
    expect(prompt).not.toContain("spirecut.com");
    expect(prompt).not.toContain("ministem.com");
    expect(prompt).not.toContain("cellenis.com");
  });

  // ── Bonus: MiniStem lead → MiniStem brand block ───────────────────────────

  it("includes the MiniStem brand context block when the matching lead has product_interest_group = 'ministem'", async () => {
    (mockPoolQuery as unknown as { setLeadRows: (r: Array<{ product_interest_group: string | null }>) => void })
      .setLeadRows([{ product_interest_group: "ministem" }]);

    await processInboundEmail(BASE_OPTS);

    const prompt = getCapturedPrompt();
    expect(prompt).toContain("MiniStem");
    expect(prompt).toContain("MFAT");
    expect(prompt).toContain("ministem.com");
    expect(prompt).not.toContain("spirecut.com");
    expect(prompt).not.toContain("cellenis.com");
  });

  // ── Bonus: Cellenis lead → Cellenis brand block ───────────────────────────

  it("includes the Cellenis brand context block when the matching lead has product_interest_group = 'cellenis'", async () => {
    (mockPoolQuery as unknown as { setLeadRows: (r: Array<{ product_interest_group: string | null }>) => void })
      .setLeadRows([{ product_interest_group: "cellenis" }]);

    await processInboundEmail(BASE_OPTS);

    const prompt = getCapturedPrompt();
    expect(prompt).toContain("Cellenis");
    expect(prompt).toContain("PRP");
    expect(prompt).toContain("cellenis.com");
    expect(prompt).not.toContain("spirecut.com");
    expect(prompt).not.toContain("ministem.com");
  });

  // ── Bonus: lead with null group → no brand context block ─────────────────

  it("omits any brand context block when the matching lead has product_interest_group = null", async () => {
    (mockPoolQuery as unknown as { setLeadRows: (r: Array<{ product_interest_group: string | null }>) => void })
      .setLeadRows([{ product_interest_group: null }]);

    await processInboundEmail(BASE_OPTS);

    const prompt = getCapturedPrompt();
    expect(prompt).not.toContain("Brand context:");
  });

  // ── Task #511: Thread-ID path ─────────────────────────────────────────────

  it("includes the Spirecut brand context block when the lead is resolved via thread ID (not email)", async () => {
    // Arrange:
    //   - Thread lookup (inReplyToMessageId → message_id) returns a row with
    //     related_lead_id = 42.
    //   - Lead-by-id lookup for id=42 returns a spirecut lead.
    //   - Email-fallback lookup returns NO lead (so if the thread path were
    //     skipped the prompt would contain no brand block).
    (mockPoolQuery as unknown as { setThreadRows: (r: Array<{ related_lead_id: number | null; related_doctor_id: number | null }>) => void })
      .setThreadRows([{ related_lead_id: 42, related_doctor_id: null }]);
    (mockPoolQuery as unknown as { setLeadByIdRows: (r: Array<{ product_interest_group: string | null }> | null) => void })
      .setLeadByIdRows([{ product_interest_group: "spirecut" }]);
    // Email fallback intentionally left empty (default from beforeEach)

    // Act
    await processInboundEmail({
      ...BASE_OPTS,
      inReplyToMessageId: "original-message-id@mail.example.com",
    });

    // Assert: Spirecut brand block must be in the prompt even though the email
    // lookup would have returned nothing.
    const prompt = getCapturedPrompt();
    expect(prompt).toContain("Spirecut");
    expect(prompt).toContain("hand surgery");
    expect(prompt).toContain("spirecut.com");
    expect(prompt).not.toContain("MiniStem");
    expect(prompt).not.toContain("Cellenis");
  });

  it("falls back to email lookup when the thread match returns no lead", async () => {
    // Arrange:
    //   - Thread lookup returns an empty result (no sally_email_queue row for
    //     the supplied inReplyToMessageId).
    //   - Email-fallback lookup returns a spirecut lead.
    // Thread rows left empty (default from beforeEach)
    (mockPoolQuery as unknown as { setLeadRows: (r: Array<{ product_interest_group: string | null }>) => void })
      .setLeadRows([{ product_interest_group: "spirecut" }]);

    // Act
    await processInboundEmail({
      ...BASE_OPTS,
      inReplyToMessageId: "unknown-thread-id@mail.example.com",
    });

    // Assert: email fallback still supplies the correct brand block.
    const prompt = getCapturedPrompt();
    expect(prompt).toContain("Spirecut");
    expect(prompt).toContain("hand surgery");
    expect(prompt).toContain("spirecut.com");
    expect(prompt).not.toContain("MiniStem");
    expect(prompt).not.toContain("Cellenis");
  });

  // ── Task #519: Thread path wins over a mismatched email-fallback ─────────
  //
  // When inReplyToMessageId resolves to a spirecut lead AND the email-fallback
  // rows would resolve to a ministem lead, the thread path must take priority
  // and the Spirecut (not MiniStem) brand block must appear in the prompt.

  it("uses the thread-resolved spirecut lead even when the email-fallback lead is ministem", async () => {
    // Arrange:
    //   - Thread lookup returns related_lead_id = 77 (a spirecut lead).
    //   - Lead-by-id lookup for id=77 returns spirecut.
    //   - Email-fallback lookup returns a ministem lead (different group).
    (mockPoolQuery as unknown as { setThreadRows: (r: Array<{ related_lead_id: number | null; related_doctor_id: number | null }>) => void })
      .setThreadRows([{ related_lead_id: 77, related_doctor_id: null }]);
    (mockPoolQuery as unknown as { setLeadByIdRows: (r: Array<{ product_interest_group: string | null }> | null) => void })
      .setLeadByIdRows([{ product_interest_group: "spirecut" }]);
    (mockPoolQuery as unknown as { setLeadRows: (r: Array<{ product_interest_group: string | null }>) => void })
      .setLeadRows([{ product_interest_group: "ministem" }]);

    // Act
    await processInboundEmail({
      ...BASE_OPTS,
      inReplyToMessageId: "spirecut-thread-id@mail.example.com",
    });

    // Assert: the thread-resolved spirecut brand block must appear; the email-
    // fallback ministem block must not.
    const prompt = getCapturedPrompt();
    expect(prompt).toContain("Spirecut");
    expect(prompt).toContain("hand surgery");
    expect(prompt).toContain("spirecut.com");
    expect(prompt).not.toContain("MiniStem");
    expect(prompt).not.toContain("ministem.com");
    expect(prompt).not.toContain("Cellenis");
  });

  // ── Task #521: Group changes mid-thread → prompt uses updated group ─────────
  //
  // When a lead's stored group is "ministem" but the inbound email body contains
  // spirecut keywords, processInboundEmail must:
  //   1. Detect the new group ("spirecut") from the email body.
  //   2. Issue a DB UPDATE to overwrite the lead's product_interest_group.
  //   3. Pass the updated ("spirecut") group to Gemini — so the prompt contains
  //      the Spirecut brand context block, not the MiniStem one.

  it("updates the lead group and uses the new Spirecut context when a ministem lead sends a spirecut-keyword email", async () => {
    // Arrange:
    //   - Thread lookup resolves lead id = 42.
    //   - Lead-by-id lookup returns stored group = "ministem".
    //   - rawSource contains the keyword "spirecut" so specialtyToProductGroup
    //     returns "spirecut" — triggering a DB group update.
    (mockPoolQuery as unknown as { setThreadRows: (r: Array<{ related_lead_id: number | null; related_doctor_id: number | null }>) => void })
      .setThreadRows([{ related_lead_id: 42, related_doctor_id: null }]);
    (mockPoolQuery as unknown as { setLeadByIdRows: (r: Array<{ product_interest_group: string | null }> | null) => void })
      .setLeadByIdRows([{ product_interest_group: "ministem" }]);

    // Act: rawSource contains "spirecut" which drives keyword detection to
    // "spirecut", differing from the stored "ministem" group.
    await processInboundEmail({
      ...BASE_OPTS,
      rawSource: "From: doctor@example.com\n\nHello, I am interested in spirecut instruments for hand surgery.",
      inReplyToMessageId: "ministem-thread-id@mail.example.com",
    });

    // Assert 1: the DB UPDATE was called with the new group ("spirecut") and
    // the correct lead id (42).
    const updateCall = mockPoolQuery.mock.calls.find(
      ([sql, params]: [string, unknown[]]) =>
        typeof sql === "string" &&
        sql.trim().toLowerCase().startsWith("update sally_leads") &&
        Array.isArray(params) &&
        params[0] === "spirecut" &&
        params[1] === 42,
    );
    expect(updateCall).toBeDefined();

    // Assert 2: Gemini receives the Spirecut brand context block, NOT MiniStem.
    const prompt = getCapturedPrompt();
    expect(prompt).toContain("Spirecut");
    expect(prompt).toContain("hand surgery");
    expect(prompt).toContain("spirecut.com");
    expect(prompt).not.toContain("MiniStem");
    expect(prompt).not.toContain("ministem.com");
    expect(prompt).not.toContain("Cellenis");
  });

  // ── Task #530: No-op when detected group == stored group ─────────────────
  //
  // When the lead already has product_interest_group = "spirecut" AND the
  // inbound email body also contains spirecut keywords, the update guard
  // (detectedGroup !== productGroup) must prevent any DB UPDATE.  The Spirecut
  // brand context block must still appear in the Gemini prompt because the
  // original stored group is passed through unchanged.

  it("does not UPDATE the lead group and still passes the Spirecut brand block when detected group equals the stored group", async () => {
    // Arrange:
    //   - Thread lookup resolves lead id = 99 with stored group = "spirecut".
    //   - rawSource also contains spirecut keywords → specialtyToProductGroup
    //     returns "spirecut" (same as stored) → the guard must prevent any UPDATE.
    (mockPoolQuery as unknown as { setThreadRows: (r: Array<{ related_lead_id: number | null; related_doctor_id: number | null }>) => void })
      .setThreadRows([{ related_lead_id: 99, related_doctor_id: null }]);
    (mockPoolQuery as unknown as { setLeadByIdRows: (r: Array<{ product_interest_group: string | null }> | null) => void })
      .setLeadByIdRows([{ product_interest_group: "spirecut" }]);

    // Act: rawSource contains "spirecut" keywords — identical to the stored group.
    await processInboundEmail({
      ...BASE_OPTS,
      rawSource: "From: doctor@example.com\n\nHello, I am interested in spirecut instruments for hand surgery.",
      inReplyToMessageId: "spirecut-noop-thread@mail.example.com",
    });

    // Assert 1: No UPDATE must have been issued for sally_leads.
    const updateCall = mockPoolQuery.mock.calls.find(
      ([sql]: [string, unknown[]]) =>
        typeof sql === "string" &&
        sql.trim().toLowerCase().startsWith("update sally_leads"),
    );
    expect(updateCall).toBeUndefined();

    // Assert 2: The Spirecut brand context block must still appear in the
    // prompt — the stored group is preserved and passed to Gemini unchanged.
    const prompt = getCapturedPrompt();
    expect(prompt).toContain("Spirecut");
    expect(prompt).toContain("hand surgery");
    expect(prompt).toContain("spirecut.com");
    expect(prompt).not.toContain("MiniStem");
    expect(prompt).not.toContain("Cellenis");
  });

  // ── Task #545: No keywords in rawSource → stored group preserved, no UPDATE ─
  //
  // When the inbound email body contains NO spirecut / ministem / cellenis
  // keywords, specialtyToProductGroup returns "".  The update guard
  // (detectedGroup && detectedGroup !== productGroup) must be false, so:
  //   1. No DB UPDATE is issued for sally_leads.
  //   2. The stored group ("spirecut") is passed through to Gemini unchanged,
  //      so the Spirecut brand context block still appears in the prompt.

  it("preserves the stored spirecut group and omits any UPDATE when the inbound email contains no detectable keywords", async () => {
    // Arrange:
    //   - Thread lookup resolves lead id = 55 with stored group = "spirecut".
    //   - rawSource is entirely keyword-free → specialtyToProductGroup returns "".
    //   - The update guard must short-circuit before any DB UPDATE.
    (mockPoolQuery as unknown as { setThreadRows: (r: Array<{ related_lead_id: number | null; related_doctor_id: number | null }>) => void })
      .setThreadRows([{ related_lead_id: 55, related_doctor_id: null }]);
    (mockPoolQuery as unknown as { setLeadByIdRows: (r: Array<{ product_interest_group: string | null }> | null) => void })
      .setLeadByIdRows([{ product_interest_group: "spirecut" }]);

    // Act: rawSource has no product keywords — a generic reply inquiry.
    await processInboundEmail({
      ...BASE_OPTS,
      rawSource: "From: doctor@example.com\n\nHello, I would like to know more about your offerings. Thank you.",
      inReplyToMessageId: "spirecut-nokeyword-thread@mail.example.com",
    });

    // Assert 1: No UPDATE must have been issued for sally_leads.
    const updateCall = mockPoolQuery.mock.calls.find(
      ([sql]: [string, unknown[]]) =>
        typeof sql === "string" &&
        sql.trim().toLowerCase().startsWith("update sally_leads"),
    );
    expect(updateCall).toBeUndefined();

    // Assert 2: The Spirecut brand context block must still appear in the
    // prompt — the stored group is preserved and used unchanged.
    const prompt = getCapturedPrompt();
    expect(prompt).toContain("Spirecut");
    expect(prompt).toContain("hand surgery");
    expect(prompt).toContain("spirecut.com");
    expect(prompt).not.toContain("MiniStem");
    expect(prompt).not.toContain("Cellenis");
  });

  // ── Task #556: Email-path, no keywords → stored group preserved, no UPDATE ─
  //
  // When the lead is resolved via the email-fallback path (no inReplyToMessageId,
  // no related_lead_id) and the inbound email body contains NO detectable
  // product keywords, the update guard (detectedGroup && detectedGroup !==
  // productGroup) must be false so the email-path UPDATE branch is also
  // suppressed.  The stored group ("spirecut") must still be passed to Gemini
  // unchanged, so the Spirecut brand context block appears in the prompt.

  it("preserves the stored spirecut group and suppresses the email-path UPDATE when no keywords are detected (email-fallback path)", async () => {
    // Arrange:
    //   - No inReplyToMessageId → thread lookup is skipped; lead is resolved by
    //     email address only.
    //   - Email-fallback lookup returns a spirecut lead.
    //   - BASE_OPTS.rawSource contains no product keywords → specialtyToProductGroup
    //     returns "" → the update guard must short-circuit before any UPDATE.
    (mockPoolQuery as unknown as { setLeadRows: (r: Array<{ product_interest_group: string | null }>) => void })
      .setLeadRows([{ product_interest_group: "spirecut" }]);

    // Act: BASE_OPTS has no inReplyToMessageId and no product keywords in rawSource.
    await processInboundEmail(BASE_OPTS);

    // Assert 1: No "UPDATE sally_leads" query must have been issued at all.
    const updateCall = mockPoolQuery.mock.calls.find(
      ([sql]: [string, unknown[]]) =>
        typeof sql === "string" &&
        sql.trim().toLowerCase().startsWith("update sally_leads"),
    );
    expect(updateCall).toBeUndefined();

    // Assert 2: The Spirecut brand context block must still appear in the
    // prompt — the stored group is preserved and passed to Gemini unchanged.
    const prompt = getCapturedPrompt();
    expect(prompt).toContain("Spirecut");
    expect(prompt).toContain("hand surgery");
    expect(prompt).toContain("spirecut.com");
    expect(prompt).not.toContain("MiniStem");
    expect(prompt).not.toContain("Cellenis");
  });

  // ── Task #559: Email-path, keyword mismatch → UPDATE fires, Spirecut block ─
  //
  // When the lead is resolved via the email-fallback path (no inReplyToMessageId)
  // and the inbound email body contains spirecut keywords that differ from the
  // stored group ("ministem"), the update guard (detectedGroup && detectedGroup !==
  // productGroup) must be true so the email-path UPDATE branch fires with the
  // new group.  The Spirecut brand context block must then appear in the Gemini
  // prompt because productGroup is updated to "spirecut" before the Gemini call.

  it("fires the email-path UPDATE and uses the Spirecut brand block when a ministem email-fallback lead sends a spirecut-keyword email", async () => {
    // Arrange:
    //   - No inReplyToMessageId → thread lookup is skipped; lead is resolved by
    //     email address only.
    //   - Email-fallback lookup returns a ministem lead (stored group = "ministem").
    //   - rawSource contains "spirecut" and "hand surgery" keywords → specialtyToProductGroup
    //     returns "spirecut" — a mismatch — triggering the email-path UPDATE branch.
    (mockPoolQuery as unknown as { setLeadRows: (r: Array<{ product_interest_group: string | null }>) => void })
      .setLeadRows([{ product_interest_group: "ministem" }]);

    // Act: rawSource contains spirecut keywords; no thread in play.
    await processInboundEmail({
      ...BASE_OPTS,
      rawSource:
        "From: doctor@example.com\n\nHello, I am interested in spirecut instruments for hand surgery.",
    });

    // Assert 1: An "UPDATE sally_leads" query must have been issued with the
    // new group ("spirecut") and the sender's email address as parameters.
    const updateCall = mockPoolQuery.mock.calls.find(
      ([sql, params]: [string, unknown[]]) =>
        typeof sql === "string" &&
        sql.trim().toLowerCase().startsWith("update sally_leads") &&
        Array.isArray(params) &&
        params[0] === "spirecut" &&
        params[1] === BASE_OPTS.inboundFrom,
    );
    expect(updateCall).toBeDefined();

    // Assert 2: Gemini receives the Spirecut brand context block, NOT MiniStem.
    const prompt = getCapturedPrompt();
    expect(prompt).toContain("Spirecut");
    expect(prompt).toContain("hand surgery");
    expect(prompt).toContain("spirecut.com");
    expect(prompt).not.toContain("MiniStem");
    expect(prompt).not.toContain("ministem.com");
    expect(prompt).not.toContain("Cellenis");
  });

  // ── Task #531: Email-only path, no thread ID — subquery UPDATE form ──────
  //
  // When processInboundEmail has NO inReplyToMessageId, the lead can only be
  // resolved by email address.  If the inbound email body contains spirecut
  // keywords that differ from the stored group ("ministem"), the code must:
  //   1. Issue the email-path UPDATE — the subquery form:
  //        UPDATE sally_leads SET product_interest_group = $1
  //        WHERE id = (SELECT id FROM sally_leads WHERE email = $2 …)
  //      with ("spirecut", inboundFrom) as parameters.
  //   2. Pass the updated group ("spirecut") to Gemini so the prompt contains
  //      the Spirecut brand block, not the MiniStem one.

  it("fires the email-path subquery UPDATE and injects the Spirecut brand block when no thread ID is supplied and the email body contains spirecut keywords", async () => {
    // Arrange:
    //   - No inReplyToMessageId → the thread lookup (SELECT related_lead_id …
    //     WHERE message_id = $1) is never executed; relatedLeadId stays null.
    //   - Email-fallback lookup returns a lead with stored group = "ministem".
    //   - rawSource contains "spirecut" + "hand surgery" keywords so
    //     specialtyToProductGroup returns "spirecut" — a mismatch with the
    //     stored "ministem" → the email-path UPDATE branch must fire.
    (mockPoolQuery as unknown as { setLeadRows: (r: Array<{ product_interest_group: string | null }>) => void })
      .setLeadRows([{ product_interest_group: "ministem" }]);

    // Act: no inReplyToMessageId provided.
    await processInboundEmail({
      ...BASE_OPTS,
      rawSource:
        "From: doctor@example.com\n\nI would like information about spirecut instruments for hand surgery.",
    });

    // Assert 1: The email-path UPDATE must have been called.
    //   - params[0] = "spirecut" (the new detected group)
    //   - params[1] = inboundFrom (the email address, used by the subquery)
    //   - The SQL must contain the subquery form "where email" (not "where id = $2").
    const updateCall = mockPoolQuery.mock.calls.find(
      ([sql, params]: [string, unknown[]]) =>
        typeof sql === "string" &&
        sql.trim().toLowerCase().startsWith("update sally_leads") &&
        Array.isArray(params) &&
        params[0] === "spirecut" &&
        params[1] === BASE_OPTS.inboundFrom,
    );
    expect(updateCall).toBeDefined();

    // Also confirm the SQL uses the subquery form:
    //   WHERE id = (SELECT id FROM sally_leads WHERE email = …)
    // rather than a direct WHERE clause like WHERE id = $2 or WHERE email = $2.
    const [updateSql] = updateCall as [string, unknown[]];
    const normalizedSql = updateSql.replace(/\s+/g, " ").toLowerCase();
    // Must contain the nested SELECT that identifies the lead by email
    expect(normalizedSql).toContain("where id = (");
    expect(normalizedSql).toContain("select id from sally_leads where email");

    // Assert 2: Gemini receives the Spirecut brand context block, not MiniStem.
    const prompt = getCapturedPrompt();
    expect(prompt).toContain("Spirecut");
    expect(prompt).toContain("hand surgery");
    expect(prompt).toContain("spirecut.com");
    expect(prompt).not.toContain("MiniStem");
    expect(prompt).not.toContain("ministem.com");
    expect(prompt).not.toContain("Cellenis");
  });

  // ── Task #579: Null stored group + no keywords → UPDATE skipped, no brand block ──
  //
  // The update guard is `if (detectedGroup && detectedGroup !== productGroup)`.
  // When the lead has product_interest_group = null AND the email body contains
  // no detectable keywords, specialtyToProductGroup returns "" (falsy) so the
  // guard short-circuits.  No UPDATE should be issued and no "Brand context:"
  // block should appear in the Gemini prompt.

  it("skips the UPDATE and omits any brand context block when the lead has null group and the email body contains no detectable keywords", async () => {
    // Arrange:
    //   - No inReplyToMessageId → thread lookup skipped; lead resolved by email.
    //   - Email-fallback lookup returns a lead with product_interest_group = null.
    //   - BASE_OPTS.rawSource contains no product keywords → specialtyToProductGroup
    //     returns "" (falsy) → the update guard must be false → no UPDATE issued.
    (mockPoolQuery as unknown as { setLeadRows: (r: Array<{ product_interest_group: string | null }>) => void })
      .setLeadRows([{ product_interest_group: null }]);

    // Act: no inReplyToMessageId, no product keywords in rawSource.
    await processInboundEmail(BASE_OPTS);

    // Assert 1: No "UPDATE sally_leads" query must have been issued at all.
    const updateCall = mockPoolQuery.mock.calls.find(
      ([sql]: [string, unknown[]]) =>
        typeof sql === "string" &&
        sql.trim().toLowerCase().startsWith("update sally_leads"),
    );
    expect(updateCall).toBeUndefined();

    // Assert 2: The Gemini prompt must contain no "Brand context:" block —
    // there is no group to inject into the prompt.
    const prompt = getCapturedPrompt();
    expect(prompt).not.toContain("Brand context:");
    expect(prompt).not.toContain("spirecut.com");
    expect(prompt).not.toContain("ministem.com");
    expect(prompt).not.toContain("cellenis.com");
  });

  // ── Task #512: Unrecognised product group → no brand context block ────────
  //
  // If a new product group is added to the DB without a matching case in
  // brandContextBlock's switch, the function must still return no "Brand context:"
  // block (i.e. the default branch returns ""). The TypeScript exhaustiveness
  // guard in the switch (the `never` assertion) will catch the missing case at
  // compile time before it reaches production.

  it("omits any brand context block when the lead has an unrecognised product_interest_group value", async () => {
    // Arrange: DB returns a lead whose product_interest_group is a value that
    // doesn't exist in the current ProductGroup union — simulating a future DB
    // row whose value hasn't been handled in the switch yet.
    (mockPoolQuery as unknown as { setLeadRows: (r: Array<{ product_interest_group: string | null }>) => void })
      .setLeadRows([{ product_interest_group: "orthopaedics" }]);

    // Act
    await processInboundEmail(BASE_OPTS);

    // Assert: the prompt must contain NO "Brand context:" block because no case
    // in brandContextBlock matches the unrecognised group string.
    const prompt = getCapturedPrompt();
    expect(prompt).not.toContain("Brand context:");
    expect(prompt).not.toContain("spirecut.com");
    expect(prompt).not.toContain("ministem.com");
    expect(prompt).not.toContain("cellenis.com");
  });
});
