import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  status: "failed",
  reference: null as string | null,
  sent: [] as Array<{ to?: string; subject: string; text: string }>,
  failSuccessWrite: true,
}));

const client = vi.hoisted(() => ({
  query: vi.fn(async (sqlValue: string, params: unknown[] = []) => {
    const sql = sqlValue.replace(/\s+/g, " ").trim();
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("pg_advisory_unlock")) return { rows: [{ pg_advisory_unlock: true }] };
    if (sql.startsWith("SELECT inbound_from")) {
      return {
        rows: [{
          inbound_from: "customer@example.com",
          inbound_body: "Subject: Original question\n\nOriginal inquiry body",
          subject: "Fallback subject",
          escalation_forward_status: state.status,
        }],
      };
    }
    if (sql.includes("SET escalation_forward_status = 'retrying'")) {
      if (state.status !== "failed") return { rowCount: 0, rows: [] };
      state.status = "retrying";
      state.reference = String(params[1]);
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("SET escalation_forward_status = 'succeeded'")) {
      if (state.failSuccessWrite) throw new Error("simulated post-send database failure");
      state.status = "succeeded";
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("SET escalation_forward_status = 'uncertain'")) {
      state.status = "uncertain";
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("SET escalation_forward_status = 'failed'")) {
      state.status = "failed";
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  }),
  release: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { connect: vi.fn(async () => client) },
}));

vi.mock("./email.js", () => ({
  getEmailDest: vi.fn(async () => "current-service@example.com"),
  sendEmail: vi.fn(async (message: { to?: string; subject: string; text: string }) => {
    state.sent.push(message);
    return { messageId: "accepted-message" };
  }),
}));

import { retryFailedEscalation } from "./sally-reply.js";

beforeEach(() => {
  state.status = "failed";
  state.reference = null;
  state.sent = [];
  state.failSuccessWrite = true;
  client.query.mockClear();
  client.release.mockClear();
});

describe("retryFailedEscalation durability", () => {
  it("does not resend when delivery succeeds but its success write is uncertain", async () => {
    expect(await retryFailedEscalation(1192)).toBe("uncertain");
    expect(state.status).toBe("uncertain");
    expect(state.sent).toHaveLength(1);
    expect(state.reference).toMatch(/^sally-escalation:1192:/);
    expect(state.sent[0]).toMatchObject({
      to: "current-service@example.com",
      subject: "[Sally-Eskalation] Original question",
    });
    expect(state.sent[0].text).toContain(`Versandreferenz: ${state.reference}`);

    state.failSuccessWrite = false;
    expect(await retryFailedEscalation(1192)).toBe("uncertain");
    expect(state.sent).toHaveLength(1);
    expect(state.status).toBe("uncertain");
  });
});