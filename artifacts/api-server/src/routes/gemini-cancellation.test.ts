import { afterAll, describe, expect, it, vi } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import request from "supertest";
import { pool } from "@workspace/db";

const geminiState = vi.hoisted(() => ({
  signal: null as AbortSignal | null,
  generationStopped: false,
}));

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: {
    models: {
      generateContentStream: async (options: {
        config?: { abortSignal?: AbortSignal };
      }) => {
        const signal = options.config?.abortSignal;
        geminiState.signal = signal ?? null;
        return (async function* () {
          try {
            yield { text: "Abandoned partial answer." };
            await new Promise<void>((resolve) => {
              if (signal?.aborted) resolve();
              else signal?.addEventListener("abort", () => resolve(), { once: true });
            });
          } finally {
            geminiState.generationStopped = true;
          }
        })();
      },
    },
  },
}));

import app from "../app";

const conversationIds: number[] = [];
let server: Server | null = null;

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (conversationIds.length > 0) {
    await pool.query("DELETE FROM conversations WHERE id = ANY($1::int[])", [conversationIds]);
  }
});

async function waitFor(check: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for cancellation");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("Gemini response cancellation", () => {
  it("aborts generation and never persists an assistant answer after disconnect", async () => {
    const created = await request(app)
      .post("/api/gemini/conversations")
      .send({ title: "cancellation-test" });
    expect(created.status).toBe(201);
    const conversationId = (created.body as { id: number }).id;
    conversationIds.push(conversationId);

    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");

    await new Promise<void>((resolve, reject) => {
      const outgoing = httpRequest({
        hostname: "127.0.0.1",
        port: address.port,
        path: `/api/gemini/conversations/${conversationId}/messages`,
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      outgoing.on("error", (error) => {
        if ((error as NodeJS.ErrnoException).code === "ECONNRESET") resolve();
        else reject(error);
      });
      outgoing.on("response", (response) => {
        response.once("data", () => {
          response.destroy();
          resolve();
        });
      });
      outgoing.end(JSON.stringify({ content: "Please answer this question.", language: "en" }));
    });

    await waitFor(() =>
      geminiState.signal?.aborted === true && geminiState.generationStopped,
    );
    const { rows } = await pool.query<{ role: string }>(
      "SELECT role FROM messages WHERE conversation_id = $1 ORDER BY id",
      [conversationId],
    );

    expect(geminiState.signal).toBeInstanceOf(AbortSignal);
    expect(geminiState.signal?.aborted).toBe(true);
    expect(rows.filter((message) => message.role === "assistant")).toHaveLength(0);
    expect(rows.filter((message) => message.role === "user")).toHaveLength(1);
  });
});