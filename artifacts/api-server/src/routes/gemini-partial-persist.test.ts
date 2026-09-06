/**
 * Confirmation test: partial streamed content survives a page reload after a
 * mid-stream Gemini failure.
 *
 * What & Why
 * ──────────
 * The POST /gemini/conversations/:id/messages handler accumulates tokens in
 * `fullResponse` and persists whatever arrived before the error to the messages
 * table. This test confirms:
 *
 *   1. When Gemini throws mid-stream (after emitting some tokens), the partial
 *      assistant text is written to the DB.
 *   2. A subsequent GET on the conversation returns that partial assistant
 *      message — not an empty response and not a 404.
 *   3. When the stream completes without error, the full content and its
 *      complete follow-up marker are also persisted correctly.
 *   4. When the stream errors before emitting any tokens, nothing is inserted
 *      for the assistant role (no empty ghost message).
 *   5. Marker-like comments without the Spiro prefix remain patient content,
 *      while actual markers are removed from the history sent back to Gemini.
 *   6. Multiple complete or interrupted markers cannot hide answer fragments
 *      before, between, or after the metadata blocks.
 *
 * Strategy
 * ────────
 * Only `@workspace/integrations-gemini-ai` is mocked so we control exactly
 * when the stream throws and what tokens preceded the error.  Everything else
 * (DB, routing, SSE serialisation) runs against the real dev database.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";

// ── Hoist mutable mock state ───────────────────────────────────────────────────
const geminiState = vi.hoisted(() => ({
  chunks: [] as string[],
  /** Index at which to throw; -1 means never throw */
  throwAfter: -1 as number,
  lastContents: [] as Array<{
    role: string;
    parts: Array<{ text: string }>;
  }>,
}));

// ── Mock Gemini: async generator that optionally throws mid-stream ─────────────
vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: {
    models: {
      generateContentStream: async (opts: unknown) => {
        const request = opts as {
          contents?: Array<{
            role: string;
            parts: Array<{ text: string }>;
          }>;
        };
        geminiState.lastContents = request.contents ?? [];
        return (async function* () {
          for (let i = 0; i < geminiState.chunks.length; i++) {
            if (geminiState.throwAfter >= 0 && i >= geminiState.throwAfter) {
              throw new Error("Simulated mid-stream Gemini error");
            }
            yield { text: geminiState.chunks[i] };
          }
        })();
      },
    },
  },
}));

// Import app AFTER mock wiring
import app from "../app";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Collect SSE frames from a raw text/event-stream body. */
function parseSseBody(body: string): Array<Record<string, unknown>> {
  return body
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const line = block.replace(/^data:\s*/, "").trim();
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return {};
      }
    })
    .filter((f) => Object.keys(f).length > 0);
}

/** Fetch messages for a conversation directly from DB. */
async function getMessages(convId: number) {
  const { rows } = await pool.query<{ role: string; content: string }>(
    "SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY id",
    [convId],
  );
  return rows;
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

const createdConvIds: number[] = [];

/** Create a conversation via the API and track its id for cleanup. */
async function createConversation(): Promise<number> {
  const res = await request(app)
    .post("/api/gemini/conversations")
    .send({ title: "partial-persist-test" });
  expect(res.status).toBe(201);
  const id = (res.body as { id: number }).id;
  createdConvIds.push(id);
  return id;
}

/** Send a message and wait for the full SSE stream to complete. */
async function sendMessage(convId: number, content: string) {
  return request(app)
    .post(`/api/gemini/conversations/${convId}/messages`)
    .set("Accept", "text/event-stream")
    .send({ content });
}

afterAll(async () => {
  if (createdConvIds.length > 0) {
    // messages are cascade-deleted with conversations
    await pool.query(
      `DELETE FROM conversations WHERE id = ANY($1::int[])`,
      [createdConvIds],
    );
  }
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("Partial streamed content persistence on mid-stream failure", () => {
  it("persists partial tokens when Gemini throws after the first chunk", async () => {
    geminiState.chunks = ["Hello, I am Spiro. ", "Here is some more text. ", "And even more."];
    geminiState.throwAfter = 1; // throw before the 2nd chunk is yielded

    const convId = await createConversation();
    const res = await sendMessage(convId, "Tell me about Spirecut");

    // Response should still complete (done: true frame sent)
    expect(res.status).toBe(200);
    const frames = parseSseBody(res.text as string);
    const doneFrame = frames.find((f) => f.done === true);
    expect(doneFrame).toBeDefined();

    // An error frame should be present
    const errorFrame = frames.find((f) => typeof f.error === "string");
    expect(errorFrame).toBeDefined();
    expect(errorFrame!.error).toContain("Simulated mid-stream Gemini error");

    // The partial assistant message must be in the DB
    const msgs = await getMessages(convId);
    const assistantMsgs = msgs.filter((m) => m.role === "assistant");
    expect(assistantMsgs).toHaveLength(1);
    // Only the first chunk was emitted before the throw.
    // The route calls .trimEnd() before inserting, so trailing whitespace is stripped.
    expect(assistantMsgs[0].content).toBe("Hello, I am Spiro.");
  });

  it("returns the partial assistant message on a subsequent GET of the conversation", async () => {
    geminiState.chunks = ["Partial chunk A. ", "Partial chunk B."];
    geminiState.throwAfter = 1; // throw before second chunk

    const convId = await createConversation();
    await sendMessage(convId, "What is Spirecut?");

    // Simulate page reload: fetch conversation via GET
    const getRes = await request(app).get(`/api/gemini/conversations/${convId}`);
    expect(getRes.status).toBe(200);

    const body = getRes.body as { messages: Array<{ role: string; content: string }> };
    const assistantMsgs = body.messages.filter((m) => m.role === "assistant");

    // Partial assistant message must be present and non-empty.
    // The route calls .trimEnd() before inserting, so trailing whitespace is stripped.
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].content).toBe("Partial chunk A.");
  });

  it("does not persist an unclosed follow-up marker after a mid-stream failure", async () => {
    geminiState.chunks = [
      'Here is the answer. <!-- SPIRO_FOLLOWUPS: ["What happens next?"',
      "This chunk should never arrive.",
    ];
    geminiState.throwAfter = 1; // throw after the marker has started

    const convId = await createConversation();
    const res = await sendMessage(convId, "Tell me about recovery");

    expect(res.status).toBe(200);
    const msgs = await getMessages(convId);
    const assistantMsgs = msgs.filter((m) => m.role === "assistant");

    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].content).toBe("Here is the answer.");
    expect(assistantMsgs[0].content).not.toContain("SPIRO_FOLLOWUPS");
    expect(assistantMsgs[0].content).not.toContain("<!--");
  });

  it("keeps marker-like comments without the Spiro prefix in the persisted answer", async () => {
    const answer =
      'Before the note. <!-- FOLLOWUPS: ["This is patient content"] --> After the note.';
    geminiState.chunks = [answer];
    geminiState.throwAfter = -1;

    const convId = await createConversation();
    const res = await sendMessage(convId, "Show me an example");

    expect(res.status).toBe(200);
    const msgs = await getMessages(convId);
    const assistantMsgs = msgs.filter((m) => m.role === "assistant");

    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].content).toBe(answer);
  });

  it("preserves answer text around a completed marker and removes only the marker from history", async () => {
    const answerWithMarker =
      'Answer before. <!-- SPIRO_FOLLOWUPS: ["What happens next?"] --> Answer after.';
    geminiState.chunks = [answerWithMarker];
    geminiState.throwAfter = -1;

    const convId = await createConversation();
    const firstRes = await sendMessage(convId, "What should I expect?");
    expect(firstRes.status).toBe(200);

    const msgs = await getMessages(convId);
    const assistantMsgs = msgs.filter((m) => m.role === "assistant");
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].content).toBe(answerWithMarker);

    // A later request replays the stored assistant message to Gemini. The
    // marker is UI metadata, but both answer fragments must remain in context.
    geminiState.chunks = ["A later answer."];
    geminiState.throwAfter = -1;
    const secondRes = await sendMessage(convId, "And after that?");
    expect(secondRes.status).toBe(200);

    const replayedAssistant = geminiState.lastContents.find(
      (entry) => entry.role === "model",
    );
    expect(replayedAssistant?.parts[0]?.text).toBe(
      "Answer before.  Answer after.",
    );
    expect(replayedAssistant?.parts[0]?.text).not.toContain("SPIRO_FOLLOWUPS");
  });

  it("preserves all answer fragments around multiple completed markers on replay", async () => {
    const answerWithMarkers =
      'Answer one. <!-- SPIRO_FOLLOWUPS: ["Question one?"] --> Answer two. <!-- SPIRO_FOLLOWUPS: ["Question two?"] --> Answer three.';
    geminiState.chunks = [answerWithMarkers];
    geminiState.throwAfter = -1;

    const convId = await createConversation();
    const firstRes = await sendMessage(convId, "Tell me what to expect");
    expect(firstRes.status).toBe(200);

    const msgs = await getMessages(convId);
    const assistantMsgs = msgs.filter((m) => m.role === "assistant");
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].content).toBe(answerWithMarkers);

    geminiState.chunks = ["A later answer."];
    geminiState.throwAfter = -1;
    const secondRes = await sendMessage(convId, "What happens next?");
    expect(secondRes.status).toBe(200);

    const replayedAssistant = geminiState.lastContents.find(
      (entry) => entry.role === "model",
    );
    expect(replayedAssistant?.parts[0]?.text).toBe(
      "Answer one.  Answer two.  Answer three.",
    );
    expect(replayedAssistant?.parts[0]?.text).not.toContain("SPIRO_FOLLOWUPS");
  });

  it("removes every marker while preserving fragments when a later marker is interrupted", async () => {
    geminiState.chunks = [
      "Answer before. ",
      '<!-- SPIRO_FOLLOWUPS: ["Completed question?"] --> Answer between. ',
      '<!-- SPIRO_FOLLOWUPS: ["Interrupted question?"',
      "This chunk should never arrive.",
    ];
    geminiState.throwAfter = 3; // throw after the second marker has started

    const convId = await createConversation();
    const firstRes = await sendMessage(convId, "Tell me about recovery");
    expect(firstRes.status).toBe(200);

    const msgs = await getMessages(convId);
    const assistantMsgs = msgs.filter((m) => m.role === "assistant");
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].content).toBe("Answer before.  Answer between.");
    expect(assistantMsgs[0].content).not.toContain("SPIRO_FOLLOWUPS");

    geminiState.chunks = ["A later answer."];
    geminiState.throwAfter = -1;
    const secondRes = await sendMessage(convId, "And after that?");
    expect(secondRes.status).toBe(200);

    const replayedAssistant = geminiState.lastContents.find(
      (entry) => entry.role === "model",
    );
    expect(replayedAssistant?.parts[0]?.text).toBe(
      "Answer before.  Answer between.",
    );
    expect(replayedAssistant?.parts[0]?.text).not.toContain("SPIRO_FOLLOWUPS");
  });

  it("persists the full response when the stream completes without error (baseline)", async () => {
    geminiState.chunks = [
      "Full response chunk 1. ",
      'Full response chunk 2. <!-- SPIRO_FOLLOWUPS: ["What happens next?", "When can I return?"] -->',
    ];
    geminiState.throwAfter = -1; // no error

    const convId = await createConversation();
    const res = await sendMessage(convId, "How long is recovery?");

    expect(res.status).toBe(200);
    const frames = parseSseBody(res.text as string);
    expect(frames.find((f) => f.done === true)).toBeDefined();
    expect(frames.find((f) => typeof f.error === "string")).toBeUndefined();

    const msgs = await getMessages(convId);
    const assistantMsgs = msgs.filter((m) => m.role === "assistant");
    expect(assistantMsgs).toHaveLength(1);
    // Raw concatenation, including the metadata the patient UI restores.
    expect(assistantMsgs[0].content).toContain("Full response chunk 1.");
    expect(assistantMsgs[0].content).toContain("Full response chunk 2.");
    expect(assistantMsgs[0].content).toContain("SPIRO_FOLLOWUPS");
  });

  it("does not insert an empty assistant message when the stream errors before emitting any tokens", async () => {
    geminiState.chunks = ["token that should never arrive"];
    geminiState.throwAfter = 0; // throw immediately, before any chunk

    const convId = await createConversation();
    const res = await sendMessage(convId, "What is the recovery time?");

    expect(res.status).toBe(200);
    const frames = parseSseBody(res.text as string);
    expect(frames.find((f) => typeof f.error === "string")).toBeDefined();

    const msgs = await getMessages(convId);
    const assistantMsgs = msgs.filter((m) => m.role === "assistant");
    // fullResponse is empty → nothing inserted
    expect(assistantMsgs).toHaveLength(0);
  });
});
