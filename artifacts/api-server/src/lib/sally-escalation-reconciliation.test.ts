import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  status: "forwarding",
  sent: 0,
  customerServiceEmail: "service@example.com",
  sendError: false,
  audits: [] as Array<{ action: string; previous: string | null; resulting: string | null; acknowledged: boolean }>,
  history: [] as Array<Record<string, unknown>>,
}));

const client = vi.hoisted(() => ({
  query: vi.fn(async (sqlValue: string, params: unknown[] = []) => {
    const sql = sqlValue.replace(/\s+/g, " ").trim();
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };

    if (sql.includes("SET escalation_forward_status = 'confirmed'")) {
      if (state.status !== "forwarding" && state.status !== "unconfirmed") return { rows: [] };
      const previous = state.status;
      state.status = "confirmed";
      return { rows: [{ previous_status: previous }] };
    }
    if (sql.includes("SET escalation_forward_status = 'resending'")) {
      if (state.status !== "forwarding" && state.status !== "unconfirmed") return { rows: [] };
      const previous = state.status;
      state.status = "resending";
      return {
        rows: [{
          inbound_from: "customer@example.com",
          subject: "Clinical question",
          inbound_body: "Original inquiry",
          detected_language: "en",
          detected_formality: "formal",
          previous_status: previous,
        }],
      };
    }
    if (sql.startsWith("SELECT escalation_forward_status FROM sally_email_queue")) {
      return { rows: state.status ? [{ escalation_forward_status: state.status }] : [] };
    }
    if (sql.includes("INSERT INTO sally_escalation_reconciliation_audit")) {
      const dynamicAction = sql.includes("VALUES ($1, $2,");
      const action = dynamicAction
        ? String(params[1] ?? "")
        : sql.match(/'([^']+)'/)?.[1] ?? String(params[1] ?? "");
      const previous = dynamicAction
        ? sql.match(/VALUES \(\$1, \$2, '([^']+)'/)?.[1] ?? null
        : String(params[1] ?? "");
      const resulting = dynamicAction
        ? String(params[2] ?? "")
        : action === "confirm_delivery" ? "confirmed" : action === "resend_requested" ? "resending" : null;
      const acknowledged = sql.includes("acknowledged_duplicate_risk") || action.startsWith("resend");
      state.audits.push({
        action,
        previous,
        resulting,
        acknowledged,
      });
      return { rows: [] };
    }
    if (sql.includes("SET escalation_forward_status = $1")) {
      state.status = String(params[0]);
      return { rows: [] };
    }
    throw new Error(`Unexpected reconciliation query: ${sql}`);
  }),
  release: vi.fn(),
}));

const poolQuery = vi.hoisted(() => vi.fn(async (sqlValue: string) => {
  const sql = sqlValue.replace(/\s+/g, " ").trim();
  if (sql.startsWith("SELECT id, queue_item_id, action, previous_status, resulting_status")) {
    return { rows: state.history };
  }
  if (sql.startsWith("SELECT key, value FROM settings")) {
    return { rows: [{ key: "sally_from_name", value: "Sally" }, { key: "sally_from_email", value: "sally@example.com" }] };
  }
  if (sql.startsWith("INSERT INTO iroc_notifications")) {
    return { rows: [] };
  }
  if (sql.includes("SET escalation_forward_status = 'forwarding'") && sql.includes("RETURNING inbound_from")) {
    if (state.status !== "failed") return { rows: [] };
    state.status = "forwarding";
    return {
      rows: [{
        inbound_from: "customer@example.com",
        subject: "Clinical question",
        inbound_body: "Original inquiry",
        detected_language: "en",
        detected_formality: "formal",
      }],
    };
  }
  if (sql.startsWith("SELECT id FROM sally_email_queue")) {
    return { rows: [{ id: 42 }] };
  }
  throw new Error(`Unexpected pool query: ${sql}`);
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query: poolQuery,
    connect: vi.fn(async () => client),
  },
}));

vi.mock("./email.js", () => ({
  getEmailDest: vi.fn(async () => state.customerServiceEmail),
  sendEmail: vi.fn(async () => {
    state.sent += 1;
    if (state.sendError) throw new Error("simulated transport failure");
    return { messageId: "manual-resend" };
  }),
}));

vi.mock("./impressum-signature.js", () => ({
  appendImpressumSignature: vi.fn(async (body: string) => body),
}));

import {
  confirmEscalationDelivery,
  getEscalationReconciliationHistory,
  resendUnconfirmedEscalation,
  retryFailedEscalation,
} from "./sally-reply.js";

beforeEach(() => {
  state.status = "forwarding";
  state.sent = 0;
  state.customerServiceEmail = "service@example.com";
  state.sendError = false;
  state.audits = [];
  state.history = [];
  client.query.mockClear();
  client.release.mockClear();
  poolQuery.mockClear();
});

describe("Sally escalation reconciliation", () => {
  it("reads the audit trail without issuing a locking query", async () => {
    state.history = [{
      id: 7,
      queue_item_id: 42,
      action: "confirm_delivery",
      previous_status: "unconfirmed",
      resulting_status: "confirmed",
      actor: "iroc:alice",
      acknowledged_duplicate_risk: false,
      created_at: new Date("2026-09-05T12:00:00.000Z"),
    }];

    await expect(getEscalationReconciliationHistory(42)).resolves.toEqual(state.history);
    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE queue_item_id = $1"),
      [42],
    );
    expect(poolQuery.mock.calls[0][0]).not.toContain("FOR UPDATE");
  });

  it("confirms an uncertain delivery once and audits the action", async () => {
    await expect(confirmEscalationDelivery(42, "iroc:alice")).resolves.toBe("confirmed");
    expect(state.status).toBe("confirmed");
    expect(state.audits[0]).toMatchObject({
      action: "confirm_delivery",
      resulting: "confirmed",
      acknowledged: false,
    });
    const queries = client.query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, " ").trim());
    expect(queries[0]).toBe("BEGIN");
    expect(queries[1]).toContain("FOR UPDATE");
    expect(queries[1]).toContain("SET escalation_forward_status = 'confirmed'");
    expect(queries[2]).toContain("INSERT INTO sally_escalation_reconciliation_audit");
    expect(queries[3]).toBe("COMMIT");
  });

  it("returns a conflict and records a repeated confirmation instead of changing state", async () => {
    await expect(confirmEscalationDelivery(42, "iroc:alice")).resolves.toBe("confirmed");
    await expect(confirmEscalationDelivery(42, "iroc:bob")).resolves.toBe("conflict");
    expect(state.status).toBe("confirmed");
    expect(state.audits.map(audit => audit.action)).toEqual(["confirm_delivery", "confirm_conflict"]);
  });

  it("claims a resend before sending and does not allow a second resend", async () => {
    await expect(resendUnconfirmedEscalation(42, "iroc:alice")).resolves.toBe("succeeded");
    expect(state.sent).toBe(1);
    expect(state.status).toBe("succeeded");
    expect(state.audits.map(audit => audit.action)).toEqual(["resend_requested", "resend_succeeded"]);
    expect(state.audits[0].acknowledged).toBe(true);

    await expect(resendUnconfirmedEscalation(42, "iroc:bob")).resolves.toBe("conflict");
    expect(state.sent).toBe(1);
    expect(state.audits.at(-1)?.action).toBe("resend_conflict");
  });

  it("keeps a definite pre-send failure retryable and audits the failed delivery", async () => {
    state.status = "failed";
    state.customerServiceEmail = "";

    await expect(retryFailedEscalation(42, "iroc:alice")).resolves.toBe("failed");

    expect(state.sent).toBe(0);
    expect(state.status).toBe("failed");
    expect(state.audits).toEqual([expect.objectContaining({
      action: "retry_failed",
      previous: "forwarding",
      resulting: "failed",
    })]);
    const queries = client.query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, " ").trim());
    expect(queries[0]).toBe("BEGIN");
    expect(queries[1]).toContain("SET escalation_forward_status = $1");
    expect(queries[2]).toContain("INSERT INTO sally_escalation_reconciliation_audit");
    expect(queries[3]).toBe("COMMIT");
  });

  it("keeps an ambiguous post-send failure unconfirmed and outside automatic retry", async () => {
    state.status = "failed";
    state.sendError = true;

    await expect(retryFailedEscalation(42, "iroc:alice")).resolves.toBe("unconfirmed");

    expect(state.sent).toBe(1);
    expect(state.status).toBe("forwarding");
    expect(state.audits).toEqual([expect.objectContaining({
      action: "retry_unconfirmed",
      previous: "forwarding",
      resulting: "forwarding",
    })]);
    const queries = client.query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, " ").trim());
    expect(queries[0]).toBe("BEGIN");
    expect(queries[1]).toContain("INSERT INTO sally_escalation_reconciliation_audit");
    expect(queries[2]).toBe("COMMIT");

    await expect(retryFailedEscalation(42, "iroc:bob")).resolves.toBe("not_retryable");
    expect(state.sent).toBe(1);
    expect(state.audits.map(audit => audit.action)).toEqual(["retry_unconfirmed"]);
  });
});
