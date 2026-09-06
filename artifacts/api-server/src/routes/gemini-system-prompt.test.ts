/**
 * gemini-system-prompt.test.ts — Task #199
 *
 * Confirms that the Gemini chat route (`POST /api/gemini/conversations/:id/messages`)
 * uses the admin-saved system prompt when `sp_chatbot_system_prompt` is non-empty
 * in the DB, and falls back to the hardcoded default (SYSTEM_PROMPT) when the
 * setting is absent or cleared to an empty string.
 *
 * Three scenarios:
 *  1. No DB row for sp_chatbot_system_prompt → hardcoded SYSTEM_PROMPT is used.
 *  2. Admin saves a custom prompt → that prompt is used as systemInstruction.
 *  3. Admin clears the prompt (empty string) → hardcoded SYSTEM_PROMPT is restored.
 *
 * Strategy:
 *  - An in-memory store simulates the `settings` table.
 *  - A fake conversation + empty history lets the route proceed without a real DB.
 *  - `generateContentStream` is mocked to (a) capture the config it receives and
 *    (b) return a minimal async-iterable with one text chunk so SSE completes.
 *  - The test reads the captured `systemInstruction` and asserts on it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── In-memory settings store (shared across mocks via vi.hoisted) ──────────────

const { settingsStore, capturedConfig } = vi.hoisted(() => {
  const settingsStore = new Map<string, string>();
  // Will hold the config passed to generateContentStream for inspection
  const capturedConfig: { systemInstruction?: string }[] = [];
  return { settingsStore, capturedConfig };
});

// ── Fake conversation + empty message history ──────────────────────────────────

const FAKE_CONV = { id: 1, title: "Test conv", createdAt: new Date() };

// ── DB mock ───────────────────────────────────────────────────────────────────
//
// The send-message route performs these DB operations in order:
//   1. select().from(conversationsTable).where(eq(id))        → conversation
//   2. insert(messagesTable).values(...)                       → persist user msg
//   3. select().from(messagesTable).where(...).orderBy(...)    → history (empty)
//   4. select().from(settingsTable).where(inArray(...))        → settings override
//   5. insert(messagesTable).values(...)                       → persist assistant
//
// We discriminate on the table symbol/object passed to `.from()` by checking
// object identity with the exported table objects.

vi.mock("@workspace/db", () => {
  // Minimal drizzle-style query builder helpers ─────────────────────────────
  function makeChainable(resolvedValue: unknown) {
    const p = Promise.resolve(resolvedValue) as Promise<unknown> & Record<string, unknown>;
    // attach common chainable methods so all code paths work
    const chain = (..._args: unknown[]) => makeChainable(resolvedValue);
    p.where = chain;
    p.orderBy = chain;
    p.limit = chain;
    p.returning = () => makeChainable(resolvedValue);
    return p;
  }

  // Symbols that identify which table is being queried ─────────────────────
  const SETTINGS_TABLE = { _tag: "settings" } as const;
  const CONVERSATIONS_TABLE = { _tag: "conversations" } as const;
  const MESSAGES_TABLE = { _tag: "messages" } as const;
  const SPIRO_KNOWLEDGE_TABLE = {
    _tag: "spiro-knowledge",
    name: Symbol("name"),
    extractedText: Symbol("extractedText"),
    status: Symbol("status"),
  } as const;

  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: { _tag?: string }) => {
        if (table === SETTINGS_TABLE) {
          // Return rows currently in the in-memory settings store
          const rows = Array.from(settingsStore.entries()).map(([key, value]) => ({ key, value }));
          return makeChainable(rows);
        }
        if (table === CONVERSATIONS_TABLE) {
          // Always return our fake conversation
          return makeChainable([FAKE_CONV]);
        }
        if (table === MESSAGES_TABLE) {
          // Empty history so the conversation starts fresh
          return makeChainable([]);
        }
        return makeChainable([]);
      }),
    })),

    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: 99 }])),
        onConflictDoUpdate: vi.fn(() => Promise.resolve(undefined)),
      })),
    })),

    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(undefined)),
      })),
    })),

    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(undefined)),
    })),
  };

  return {
    db,
    // Export table objects that the route imports by name
    conversations: CONVERSATIONS_TABLE,
    messages: MESSAGES_TABLE,
    settingsTable: SETTINGS_TABLE,
    spiroKnowledgeDocuments: SPIRO_KNOWLEDGE_TABLE,
    // Drizzle helpers (eq, asc, inArray) are used only as opaque values passed
    // to mock functions that ignore them — return distinguishable symbols
    eq: vi.fn((_col: unknown, _val: unknown) => Symbol("eq")),
    asc: vi.fn((_col: unknown) => Symbol("asc")),
    inArray: vi.fn((_col: unknown, _vals: unknown) => Symbol("inArray")),
  };
});

// ── Gemini AI mock ─────────────────────────────────────────────────────────────
//
// generateContentStream must return an AsyncIterable<{ text?: string }>.
// We emit one chunk with the text "Mocked AI response." so the route's
// for-await loop finishes and the assistant message is persisted.

vi.mock("@workspace/integrations-gemini-ai", () => {
  async function* fakeStream() {
    yield { text: "Mocked AI response." };
  }

  return {
    ai: {
      models: {
        generateContentStream: vi.fn(async (opts: { config?: { systemInstruction?: string } }) => {
          // Capture the config so tests can assert on systemInstruction
          capturedConfig.push({ systemInstruction: opts?.config?.systemInstruction });
          return fakeStream();
        }),
      },
    },
  };
});

// ── api-zod mock — SendGeminiMessageBody accepts any non-empty content string ──

vi.mock("@workspace/api-zod", () => ({
  SendGeminiMessageBody: {
    safeParse: vi.fn((body: unknown) => {
      const b = body as Record<string, unknown>;
      if (b && typeof b.content === "string" && b.content.length > 0) {
        return { success: true, data: { content: b.content, language: b.language } };
      }
      return { success: false, error: { message: "content required" } };
    }),
  },
}));

// ── Import the Express app (AFTER all mocks are registered) ──────────────────

import app from "../app";

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN_TOKEN = "Bearer iroc-admin-2024";

async function sendMessage(content: string) {
  return request(app)
    .post("/api/gemini/conversations/1/messages")
    .set("Authorization", ADMIN_TOKEN)
    .send({ content });
}

async function sendMessageInLanguage(content: string, language: "de" | "en") {
  return request(app)
    .post("/api/gemini/conversations/1/messages")
    .set("Authorization", ADMIN_TOKEN)
    .send({ content, language });
}

/** Drain the SSE stream and return all lines. */
function parseSSELines(body: string): Array<Record<string, unknown>> {
  return body
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const HARDCODED_MARKER = "You are Spiro";   // unique substring of the default SYSTEM_PROMPT

describe("gemini route — system prompt override", () => {
  beforeEach(() => {
    settingsStore.clear();
    capturedConfig.length = 0;
  });

  // ── Scenario 1: no DB row → hardcoded default is used ───────────────────────

  it("uses the hardcoded SYSTEM_PROMPT when no DB row exists for sp_chatbot_system_prompt", async () => {
    // settingsStore is empty — no override saved
    const res = await sendMessage("Hello Spiro");

    expect(res.status).toBe(200);

    // The SSE body must contain a done frame
    const frames = parseSSELines(res.text);
    expect(frames.some((f) => f.done === true)).toBe(true);

    // Captured config must reference the hardcoded default
    expect(capturedConfig.length).toBeGreaterThan(0);
    const { systemInstruction } = capturedConfig[0];
    expect(systemInstruction).toContain(HARDCODED_MARKER);
  });

  // ── Scenario 2: admin saves a custom prompt → custom prompt is used ──────────

  it("uses the custom sp_chatbot_system_prompt saved by the admin", async () => {
    const CUSTOM_PROMPT = "You are TestBot, a recognisably unique test assistant.";
    settingsStore.set("sp_chatbot_system_prompt", CUSTOM_PROMPT);

    const res = await sendMessage("Hello");

    expect(res.status).toBe(200);

    const frames = parseSSELines(res.text);
    expect(frames.some((f) => f.done === true)).toBe(true);

    expect(capturedConfig.length).toBeGreaterThan(0);
    const { systemInstruction } = capturedConfig[0];
    expect(systemInstruction).toBe(CUSTOM_PROMPT);
    expect(systemInstruction).not.toContain(HARDCODED_MARKER);
  });

  // ── Scenario 3: admin clears the prompt (empty string) → default is restored ─

  it("falls back to the hardcoded SYSTEM_PROMPT when sp_chatbot_system_prompt is cleared to an empty string", async () => {
    // First: set a custom prompt
    settingsStore.set("sp_chatbot_system_prompt", "Temporary custom prompt");

    const firstRes = await sendMessage("first message");
    expect(firstRes.status).toBe(200);
    expect(capturedConfig[0].systemInstruction).toBe("Temporary custom prompt");

    // Admin clears the prompt (saves "")
    settingsStore.set("sp_chatbot_system_prompt", "");
    capturedConfig.length = 0;

    const secondRes = await sendMessage("second message");
    expect(secondRes.status).toBe(200);

    const frames = parseSSELines(secondRes.text);
    expect(frames.some((f) => f.done === true)).toBe(true);

    // Empty string trims to "" → falsy → falls back to SYSTEM_PROMPT
    expect(capturedConfig.length).toBeGreaterThan(0);
    const { systemInstruction } = capturedConfig[0];
    expect(systemInstruction).toContain(HARDCODED_MARKER);
    expect(systemInstruction).not.toBe("");
  });

  // ── Scenario 4: whitespace-only override is treated as empty → default ────────

  it("treats a whitespace-only sp_chatbot_system_prompt as empty and uses the default", async () => {
    settingsStore.set("sp_chatbot_system_prompt", "   \n  ");

    const res = await sendMessage("hi");
    expect(res.status).toBe(200);

    expect(capturedConfig.length).toBeGreaterThan(0);
    const { systemInstruction } = capturedConfig[0];
    expect(systemInstruction).toContain(HARDCODED_MARKER);
  });

  // ── Scenario 5: confirm the SSE response carries AI text chunks ──────────────

  it("streams an AI text chunk alongside the done frame when prompt is active", async () => {
    const CUSTOM_PROMPT = "You are StreamBot.";
    settingsStore.set("sp_chatbot_system_prompt", CUSTOM_PROMPT);

    const res = await sendMessage("Test message");
    expect(res.status).toBe(200);

    const frames = parseSSELines(res.text);
    const contentFrames = frames.filter((f) => typeof f.content === "string");
    expect(contentFrames.length).toBeGreaterThan(0);
    expect(contentFrames[0].content).toBe("Mocked AI response.");
    expect(frames.some((f) => f.done === true)).toBe(true);
  });

  it("appends the explicitly selected English language after an admin prompt", async () => {
    const CUSTOM_PROMPT = "Antworte freundlich und ausführlich auf Deutsch.";
    settingsStore.set("sp_chatbot_system_prompt", CUSTOM_PROMPT);

    const res = await sendMessageInLanguage("What should I expect after surgery?", "en");

    expect(res.status).toBe(200);
    expect(capturedConfig[0].systemInstruction).toBe(
      `${CUSTOM_PROMPT}\n\nCURRENT RESPONSE LANGUAGE (highest priority): Respond entirely in English. This applies to the answer, medical disclaimer, and follow-up questions. Do not switch languages unless the patient explicitly asks you to.`,
    );
  });
});
