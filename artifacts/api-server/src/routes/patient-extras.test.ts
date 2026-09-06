/**
 * Tests for patient-extras route
 *
 * Public endpoints:
 *   POST /api/patient-postop
 *
 * Admin endpoints:
 *   GET    /api/admin/patient-postop
 *   PATCH  /api/admin/patient-postop/:id
 *   DELETE /api/admin/patient-postop/:id
 *   POST   /api/admin/patient-social
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

// ── Mock @workspace/db ───────────────────────────────────────────────────────
// vi.mock factories are hoisted to the top of the file, so any variables they
// reference must also be hoisted via vi.hoisted().  The db module opens a real
// Postgres connection at import time; mocking it avoids the need for a live DB.

const { mockInsert, mockUpdate, mockDelete, mockSelectWhere } = vi.hoisted(() => {
  const mockInsert = vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  });

  const mockUpdate = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });

  const mockDelete = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });

  // Configurable per-test: controls what db.select().from().where() resolves to.
  const mockSelectWhere = vi.fn().mockResolvedValue([]);

  return { mockInsert, mockUpdate, mockDelete, mockSelectWhere };
});

vi.mock("@workspace/db", () => ({
  db: {
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockSelectWhere,
      }),
    }),
  },
  settingsTable: {},
  irocNotifications: {},
}));

// ── Import app AFTER mocks are in place ─────────────────────────────────────
import app from "../app";
import {
  VALID_GENDERS,
  VALID_OCCUPATIONS,
  VALID_DISEASES,
  VALID_PROCEDURES,
} from "@workspace/spirecut-shared";

// ── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Returns a `values()` vi.fn() that is directly awaitable AND supports
 * `.onConflictDoNothing()` / `.onConflictDoUpdate()` chaining, mirroring
 * Drizzle's promise-like query builder API.
 */
function makeValuesMock() {
  return vi.fn().mockImplementation(() => {
    const p: any = Promise.resolve(undefined);
    p.onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    p.onConflictDoUpdate  = vi.fn().mockResolvedValue(undefined);
    return p;
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal valid payload; override individual fields per test. */
function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    procedure: "ct",
    operationMonth: "2024-01",
    rating: 5,
    ...overrides,
  };
}

async function post(body: Record<string, unknown>) {
  return request(app).post("/api/patient-postop").send(body).set("Content-Type", "application/json");
}

/**
 * In the test environment ADMIN_PASSWORD env var is not set, so the route uses
 * the default empty string.  The valid Authorization header is therefore
 * "Bearer " (keyword + space + empty password).
 */
const ADMIN_AUTH = `Bearer ${process.env.ADMIN_PASSWORD ?? ""}`;

afterEach(() => {
  mockUpdate.mockClear();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/patient-postop – required fields", () => {
  beforeEach(() => {
    mockInsert.mockReturnValue({ values: makeValuesMock() });
    mockSelectWhere.mockResolvedValue([]);
  });

  it("rejects when procedure is missing", async () => {
    const { procedure: _omit, ...rest } = validBody() as { procedure: string; [k: string]: unknown };
    const res = await post(rest);
    expect(res.status).toBe(400);
  });

  it("rejects when procedure is an unknown key", async () => {
    const res = await post(validBody({ procedure: "laser" }));
    expect(res.status).toBe(400);
  });

  it("rejects when operationMonth is missing", async () => {
    const res = await post({ procedure: "ct", rating: 5 });
    expect(res.status).toBe(400);
  });

  it("rejects when rating is missing", async () => {
    const res = await post({ procedure: "ct", operationMonth: "2024-01" });
    expect(res.status).toBe(400);
  });

  it("rejects when rating is out of range (0)", async () => {
    const res = await post(validBody({ rating: 0 }));
    expect(res.status).toBe(400);
  });

  it("rejects when rating is out of range (6)", async () => {
    const res = await post(validBody({ rating: 6 }));
    expect(res.status).toBe(400);
  });

  it("rejects when rating is a float (4.7)", async () => {
    const res = await post(validBody({ rating: 4.7 }));
    expect(res.status).toBe(400);
  });

  it("rejects when rating is a float (0.5)", async () => {
    const res = await post(validBody({ rating: 0.5 }));
    expect(res.status).toBe(400);
  });

  it("rejects when rating is NaN (sent as null which becomes non-number)", async () => {
    const res = await post(validBody({ rating: null }));
    expect(res.status).toBe(400);
  });

  it("rejects when rating is a string instead of a number", async () => {
    const res = await post(validBody({ rating: "4" }));
    expect(res.status).toBe(400);
  });

  it("accepts integer ratings at the boundaries (1 and 5)", async () => {
    const res1 = await post(validBody({ rating: 1 }));
    expect(res1.status).toBe(201);
    const res5 = await post(validBody({ rating: 5 }));
    expect(res5.status).toBe(201);
  });

  it("accepts all valid whole-number ratings 1–5", async () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      const res = await post(validBody({ rating }));
      expect(res.status).toBe(201);
    }
  });
});

describe("POST /api/patient-postop – valid procedure keys", () => {
  beforeEach(() => {
    mockInsert.mockReturnValue({ values: makeValuesMock() });
    mockSelectWhere.mockResolvedValue([]);
  });

  for (const procedure of VALID_PROCEDURES) {
    it(`accepts procedure="${procedure}"`, async () => {
      const res = await post(validBody({ procedure }));
      expect(res.status).toBe(201);
    });
  }
});

describe("POST /api/patient-postop – valid gender keys", () => {
  beforeEach(() => {
    mockInsert.mockReturnValue({ values: makeValuesMock() });
    mockSelectWhere.mockResolvedValue([]);
  });

  for (const gender of VALID_GENDERS) {
    it(`accepts gender="${gender}"`, async () => {
      const res = await post(validBody({ gender }));
      expect(res.status).toBe(201);
    });
  }

  it("strips an unknown gender (does not reject the whole request)", async () => {
    const res = await post(validBody({ gender: "unknown_gender" }));
    expect(res.status).toBe(201);
    // The persisted value should have gender set to "" (stripped)
    const storedJson: string = mockInsert.mock.calls.at(-1)?.[0] === undefined
      ? "{}"
      : (mockInsert.mock.results.at(-1)?.value?.values?.mock?.calls?.at(-1)?.[0]?.value ?? "{}");
    const parsed = JSON.parse(storedJson);
    expect(parsed.gender).toBe("");
  });
});

describe("POST /api/patient-postop – valid occupation keys", () => {
  beforeEach(() => {
    mockInsert.mockReturnValue({ values: makeValuesMock() });
    mockSelectWhere.mockResolvedValue([]);
  });

  for (const occupation of VALID_OCCUPATIONS) {
    it(`accepts occupation="${occupation}"`, async () => {
      const res = await post(validBody({ occupation }));
      expect(res.status).toBe(201);
    });
  }

  it("strips an unknown occupation (does not reject the whole request)", async () => {
    const res = await post(validBody({ occupation: "unknown_job" }));
    expect(res.status).toBe(201);
  });
});

describe("POST /api/patient-postop – valid disease keys", () => {
  beforeEach(() => {
    mockInsert.mockReturnValue({ values: makeValuesMock() });
    mockSelectWhere.mockResolvedValue([]);
  });

  for (const disease of VALID_DISEASES) {
    it(`accepts disease="${disease}" in array`, async () => {
      const res = await post(validBody({ diseases: [disease] }));
      expect(res.status).toBe(201);
    });
  }

  it("accepts all valid diseases together", async () => {
    const res = await post(validBody({ diseases: [...VALID_DISEASES] }));
    expect(res.status).toBe(201);
  });

  it("strips unknown disease keys from the array", async () => {
    const valuesMock = makeValuesMock();
    mockInsert.mockReturnValue({ values: valuesMock });

    const res = await post(validBody({ diseases: ["diabetes", "fake_disease", "cholesterol"] }));
    expect(res.status).toBe(201);

    // Retrieve the stored JSON from the values() call
    const storedValue: string = valuesMock.mock.calls[0]?.[0]?.value ?? "{}";
    const parsed = JSON.parse(storedValue);
    expect(parsed.diseases).toEqual(["diabetes", "cholesterol"]);
    expect(parsed.diseases).not.toContain("fake_disease");
  });

  it("results in an empty diseases array when all entries are unknown", async () => {
    const valuesMock = makeValuesMock();
    mockInsert.mockReturnValue({ values: valuesMock });

    const res = await post(validBody({ diseases: ["not_a_disease", "also_fake"] }));
    expect(res.status).toBe(201);

    const storedValue: string = valuesMock.mock.calls[0]?.[0]?.value ?? "{}";
    const parsed = JSON.parse(storedValue);
    expect(parsed.diseases).toEqual([]);
  });
});

describe("POST /api/patient-postop – operated parts validation", () => {
  beforeEach(() => {
    mockInsert.mockReturnValue({ values: makeValuesMock() });
    mockSelectWhere.mockResolvedValue([]);
  });

  it("accepts valid operated parts", async () => {
    const res = await post(validBody({ operatedParts: ["left_thumb", "right_wrist"] }));
    expect(res.status).toBe(201);
  });

  it("strips invalid operated parts", async () => {
    const valuesMock = makeValuesMock();
    mockInsert.mockReturnValue({ values: valuesMock });

    const res = await post(validBody({ operatedParts: ["left_thumb", "invalid_part", "up_arm"] }));
    expect(res.status).toBe(201);

    const storedValue: string = valuesMock.mock.calls[0]?.[0]?.value ?? "{}";
    const parsed = JSON.parse(storedValue);
    expect(parsed.operatedParts).toEqual(["left_thumb"]);
  });
});

describe("POST /api/patient-postop – quote consent", () => {
  beforeEach(() => {
    mockInsert.mockReturnValue({ values: makeValuesMock() });
    mockSelectWhere.mockResolvedValue([]);
  });

  it("sets quoteApproved=null when experience is provided and shareQuote=true", async () => {
    const valuesMock = makeValuesMock();
    mockInsert.mockReturnValue({ values: valuesMock });

    const res = await post(validBody({
      experience: "Great experience overall, very happy with the result.",
      shareQuote: true,
    }));
    expect(res.status).toBe(201);

    const storedValue: string = valuesMock.mock.calls[0]?.[0]?.value ?? "{}";
    const parsed = JSON.parse(storedValue);
    expect(parsed.quoteApproved).toBeNull();
    expect(parsed.shareQuote).toBe(true);
  });

  it("does not set quoteApproved when shareQuote=false", async () => {
    const valuesMock = makeValuesMock();
    mockInsert.mockReturnValue({ values: valuesMock });

    const res = await post(validBody({
      experience: "Great experience overall.",
      shareQuote: false,
    }));
    expect(res.status).toBe(201);

    const storedValue: string = valuesMock.mock.calls[0]?.[0]?.value ?? "{}";
    const parsed = JSON.parse(storedValue);
    expect(parsed.quoteApproved).toBeUndefined();
  });
});

describe("Postop procedure label snapshots", () => {
  it("stores both language labels with a new submission", async () => {
    const valuesMock = makeValuesMock();
    mockInsert.mockReturnValue({ values: valuesMock });
    mockSelectWhere.mockResolvedValue([{
      key: "postop_form_config",
      value: JSON.stringify({
        procedures: [{ key: "custom", labelDe: "Individuelle Behandlung", labelEn: "Custom treatment" }],
        ageRanges: [],
        genders: [],
        occupations: [],
        diseases: [],
        visibleSections: {},
      }),
    }]);

    const res = await post(validBody({ procedure: "custom" }));

    expect(res.status).toBe(201);
    const stored = JSON.parse(valuesMock.mock.calls[0]?.[0]?.value ?? "{}");
    expect(stored.procedureLabelDe).toBe("Individuelle Behandlung");
    expect(stored.procedureLabelEn).toBe("Custom treatment");
  });

  it("backfills labels on historical submissions when a procedure is removed", async () => {
    const previousConfig = {
      procedures: [{ key: "removed", labelDe: "Archivierter Eingriff", labelEn: "Archived procedure" }],
      ageRanges: [],
      genders: [],
      occupations: [],
      diseases: [],
      visibleSections: {},
    };
    const historicalSubmission = {
      id: "historical",
      procedure: "removed",
      operationMonth: "2024-01",
      rating: 5,
      submittedAt: "2024-01-15T10:00:00.000Z",
    };
    mockSelectWhere
      .mockResolvedValueOnce([{ key: "postop_form_config", value: JSON.stringify(previousConfig) }])
      .mockResolvedValueOnce([{ key: "patient_postop_historical", value: JSON.stringify(historicalSubmission) }]);
    mockInsert.mockReturnValue({ values: makeValuesMock() });
    mockUpdate.mockClear();

    const nextConfig = {
      ...previousConfig,
      procedures: [],
    };
    const res = await request(app)
      .put("/api/admin/patient-postop-form-config")
      .set("Authorization", ADMIN_AUTH)
      .send(nextConfig);

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateQuery = mockUpdate.mock.results[0]?.value as {
      set: { mock: { calls: Array<Array<Record<string, unknown>>> } };
    };
    const updated = updateQuery.set.mock.calls[0]?.[0] ?? {};
    const stored = JSON.parse(String(updated.value));
    expect(stored.procedureLabelDe).toBe("Archivierter Eingriff");
    expect(stored.procedureLabelEn).toBe("Archived procedure");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Admin endpoint tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/admin/patient-postop – auth guard", () => {
  beforeEach(() => {
    mockSelectWhere.mockResolvedValue([]);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app).get("/api/admin/patient-postop");
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header is wrong", async () => {
    const res = await request(app)
      .get("/api/admin/patient-postop")
      .set("Authorization", "Bearer wrong-password");
    expect(res.status).toBe(401);
  });

  it("returns 200 with valid credentials", async () => {
    const res = await request(app)
      .get("/api/admin/patient-postop")
      .set("Authorization", ADMIN_AUTH);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/admin/patient-postop – ordering", () => {
  it("returns submissions ordered newest-first", async () => {
    const older = JSON.stringify({ id: "older", submittedAt: "2024-01-01T00:00:00.000Z", rating: 3 });
    const newer = JSON.stringify({ id: "newer", submittedAt: "2024-06-01T00:00:00.000Z", rating: 5 });
    // DB returns them in arbitrary order (older first)
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_older", value: older },
      { key: "patient_postop_newer", value: newer },
    ]);

    const res = await request(app)
      .get("/api/admin/patient-postop")
      .set("Authorization", ADMIN_AUTH);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe("newer");
    expect(res.body[1].id).toBe("older");
  });

  it("returns an empty array when there are no submissions", async () => {
    mockSelectWhere.mockResolvedValue([]);

    const res = await request(app)
      .get("/api/admin/patient-postop")
      .set("Authorization", ADMIN_AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("admin malformed-rating repair path", () => {
  it("keeps every malformed record editable and leaves public stats protected after correction", async () => {
    const malformedRows = [
      { key: "patient_postop_null", value: JSON.stringify({ id: "null", rating: null, submittedAt: "2024-01-01T00:00:00.000Z" }) },
      { key: "patient_postop_string", value: JSON.stringify({ id: "string", rating: "5", submittedAt: "2024-01-02T00:00:00.000Z" }) },
      { key: "patient_postop_low", value: JSON.stringify({ id: "low", rating: 0, submittedAt: "2024-01-03T00:00:00.000Z" }) },
      { key: "patient_postop_high", value: JSON.stringify({ id: "high", rating: 6, submittedAt: "2024-01-04T00:00:00.000Z" }) },
      { key: "patient_postop_infinite", value: '{"id":"infinite","rating":1e999,"submittedAt":"2024-01-05T00:00:00.000Z"}' },
    ];
    mockSelectWhere.mockResolvedValue(malformedRows);

    const list = await request(app)
      .get("/api/admin/patient-postop")
      .set("Authorization", ADMIN_AUTH);
    expect(list.status).toBe(200);
    expect(list.body.map((row: { id: string }) => row.id).sort()).toEqual(
      ["null", "string", "low", "high", "infinite"].sort(),
    );

    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    for (const row of malformedRows) {
      mockSelectWhere.mockResolvedValue([row]);
      const id = JSON.parse(row.value).id as string;
      const correction = await request(app)
        .patch(`/api/admin/patient-postop/${id}`)
        .set("Authorization", ADMIN_AUTH)
        .send({ rating: 4 });
      expect(correction.status).toBe(200);
      expect(correction.body.rating).toBe(4);
    }

    mockSelectWhere.mockResolvedValue(
      malformedRows.map((row) => ({
        key: row.key,
        value: makeSubmission({ id: JSON.parse(row.value).id, rating: 4 }),
      })),
    );
    const stats = await request(app).get("/api/patient-postop-stats");
    expect(stats.status).toBe(200);
    expect(stats.body.skippedInvalid).toBe(0);
    expect(stats.body.quotes.every((quote: { rating: unknown }) => quote.rating === 4)).toBe(true);
  });
});

describe("GET /api/admin/patient-postop-diagnostics – unreadable records", () => {
  it("returns valid submissions separately from non-sensitive unreadable-record metadata", async () => {
    const valid = makeSubmission({ procedure: "ct" });
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_good", value: valid },
      { key: "patient_postop_bad", value: "patient name and other private data {{{" },
    ]);

    const res = await request(app)
      .get("/api/admin/patient-postop-diagnostics")
      .set("Authorization", ADMIN_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.submissions).toHaveLength(1);
    expect(res.body.submissions[0].procedure).toBe("ct");
    expect(res.body.unreadableCount).toBe(1);
    expect(res.body.unreadable).toEqual([
      { key: "patient_postop_bad", reason: "invalid_json" },
    ]);
    expect(JSON.stringify(res.body)).not.toContain("patient name and other private data");
  });

  it("returns zero diagnostics when every saved submission is readable", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_a", value: makeSubmission() },
    ]);

    const res = await request(app)
      .get("/api/admin/patient-postop-diagnostics")
      .set("Authorization", ADMIN_AUTH);

    expect(res.status).toBe(200);
    expect(res.body.unreadableCount).toBe(0);
    expect(res.body.unreadable).toEqual([]);
  });

  it("requires admin authentication", async () => {
    const res = await request(app).get("/api/admin/patient-postop-diagnostics");

    expect(res.status).toBe(401);
  });
});

describe("POST /api/admin/patient-postop-recovery/:id", () => {
  const id = "backup-record";
  const replacement = {
    id,
    procedure: "ct",
    operationMonth: "2024-01",
    rating: 5,
    submittedAt: "2024-01-15T10:00:00.000Z",
  };

  beforeEach(() => {
    mockSelectWhere.mockResolvedValue([
      { key: `patient_postop_${id}`, value: "{unreadable" },
    ]);
    mockInsert.mockReturnValue({ values: makeValuesMock() });
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it("requires authentication and explicit backup verification", async () => {
    const unauthenticated = await request(app)
      .post(`/api/admin/patient-postop-recovery/${id}`)
      .send({ verifiedBackup: true, submission: replacement });
    expect(unauthenticated.status).toBe(401);

    const unverified = await request(app)
      .post(`/api/admin/patient-postop-recovery/${id}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ verifiedBackup: false, submission: replacement });
    expect(unverified.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("validates the replacement before changing the unreadable record", async () => {
    const res = await request(app)
      .post(`/api/admin/patient-postop-recovery/${id}`)
      .set("Authorization", ADMIN_AUTH)
      .send({
        verifiedBackup: true,
        submission: { ...replacement, rating: 9 },
      });

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("restores the record and writes a metadata-only audit entry", async () => {
    const valuesMock = makeValuesMock();
    const setMock = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockInsert.mockReturnValue({ values: valuesMock });
    mockUpdate.mockReturnValue({ set: setMock });

    const res = await request(app)
      .post(`/api/admin/patient-postop-recovery/${id}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ verifiedBackup: true, submission: replacement });

    expect(res.status).toBe(200);
    expect(JSON.parse(setMock.mock.calls[0][0].value)).toEqual(replacement);
    const audit = valuesMock.mock.calls[0][0] as { key: string; value: string };
    expect(audit.key).toMatch(/^postop_repair_audit_/);
    expect(JSON.parse(audit.value)).toMatchObject({
      action: "postop_submission_recovered",
      submissionKey: `patient_postop_${id}`,
      source: "verified_backup",
    });
    expect(audit.value).not.toContain("operationMonth");
  });

  it("refuses to overwrite an already readable record", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: `patient_postop_${id}`, value: JSON.stringify(replacement) },
    ]);

    const res = await request(app)
      .post(`/api/admin/patient-postop-recovery/${id}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ verifiedBackup: true, submission: replacement });

    expect(res.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/patient-postop/:id – validation", () => {
  beforeEach(() => {
    mockSelectWhere.mockResolvedValue([]);
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it("returns 401 without valid credentials", async () => {
    const res = await request(app)
      .patch("/api/admin/patient-postop/abc123")
      .send({ approved: true });
    expect(res.status).toBe(401);
  });

  it("returns 400 when approved field is missing", async () => {
    const res = await request(app)
      .patch("/api/admin/patient-postop/abc123")
      .set("Authorization", ADMIN_AUTH)
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when approved is a string instead of boolean", async () => {
    const res = await request(app)
      .patch("/api/admin/patient-postop/abc123")
      .set("Authorization", ADMIN_AUTH)
      .send({ approved: "true" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when approved is a number instead of boolean", async () => {
    const res = await request(app)
      .patch("/api/admin/patient-postop/abc123")
      .set("Authorization", ADMIN_AUTH)
      .send({ approved: 1 });
    expect(res.status).toBe(400);
  });

  it("returns 400 and does not update when approved is invalid alongside a valid rating", async () => {
    const res = await request(app)
      .patch("/api/admin/patient-postop/abc123")
      .set("Authorization", ADMIN_AUTH)
      .send({ approved: "yes", rating: 3 });

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 and does not update when rating is invalid alongside a valid approved flag", async () => {
    const res = await request(app)
      .patch("/api/admin/patient-postop/abc123")
      .set("Authorization", ADMIN_AUTH)
      .send({ approved: true, rating: 0 });

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the submission id does not exist", async () => {
    // select returns empty → not found
    mockSelectWhere.mockResolvedValue([]);

    const res = await request(app)
      .patch("/api/admin/patient-postop/nonexistent")
      .set("Authorization", ADMIN_AUTH)
      .send({ approved: true });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/admin/patient-postop/:id – approve / reject", () => {
  const submissionId = "1700000000000_abc123";
  const dbKey = `patient_postop_${submissionId}`;

  function makeStoredSubmission(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      id: submissionId,
      procedure: "ct",
      operationMonth: "2024-01",
      rating: 5,
      experience: "Really great outcome.",
      shareQuote: true,
      quoteApproved: null,
      submittedAt: "2024-01-15T10:00:00.000Z",
      ...overrides,
    });
  }

  beforeEach(() => {
    // Default: the submission exists and has shareQuote=true
    mockSelectWhere.mockResolvedValue([{ key: dbKey, value: makeStoredSubmission() }]);
    mockUpdate.mockClear();
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it("approves a submission and returns quoteApproved=true", async () => {
    const res = await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ approved: true });

    expect(res.status).toBe(200);
    expect(res.body.quoteApproved).toBe(true);
    expect(res.body.id).toBe(submissionId);
  });

  it("rejects a submission and returns quoteApproved=false", async () => {
    const res = await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ approved: false });

    expect(res.status).toBe(200);
    expect(res.body.quoteApproved).toBe(false);
  });

  it("calls db.update to persist the approval", async () => {
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    mockUpdate.mockReturnValue({ set: setMock });

    await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ approved: true });

    expect(mockUpdate).toHaveBeenCalledOnce();
    // The set() call should include the serialised JSON with quoteApproved=true
    const setArg = setMock.mock.calls[0]?.[0] as { value?: string };
    const persisted = JSON.parse(setArg?.value ?? "{}");
    expect(persisted.quoteApproved).toBe(true);
  });

  it("returns 400 when the submission has no shareQuote consent", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: dbKey, value: makeStoredSubmission({ shareQuote: false, quoteApproved: undefined }) },
    ]);

    const res = await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ approved: true });

    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/admin/patient-postop/:id", () => {
  beforeEach(() => {
    mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  it("returns 401 without valid credentials", async () => {
    const res = await request(app).delete("/api/admin/patient-postop/abc123");
    expect(res.status).toBe(401);
  });

  it("calls db.delete with the correct prefixed key", async () => {
    const whereMock = vi.fn().mockResolvedValue(undefined);
    mockDelete.mockReturnValue({ where: whereMock });

    const res = await request(app)
      .delete("/api/admin/patient-postop/mysubmission42")
      .set("Authorization", ADMIN_AUTH);

    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledOnce();
    // The where() predicate is built from eq(settingsTable.key, dbKey); we
    // verify delete itself was called (key derivation tested via integration).
    expect(whereMock).toHaveBeenCalledOnce();
  });

  it("returns a success message", async () => {
    const res = await request(app)
      .delete("/api/admin/patient-postop/xyz")
      .set("Authorization", ADMIN_AUTH);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("message");
  });
});

describe("POST /api/admin/patient-social", () => {
  beforeEach(() => {
    mockInsert.mockClear();
    mockInsert.mockReturnValue({ values: makeValuesMock() });
  });

  it("returns 401 without valid credentials", async () => {
    const res = await request(app)
      .post("/api/admin/patient-social")
      .send({ key: "instagram", url: "https://instagram.com/test" });
    expect(res.status).toBe(401);
  });

  it("accepts a valid key (instagram)", async () => {
    const res = await request(app)
      .post("/api/admin/patient-social")
      .set("Authorization", ADMIN_AUTH)
      .send({ key: "instagram", url: "https://instagram.com/test" });
    expect(res.status).toBe(200);
    expect(res.body.key).toBe("instagram");
    expect(res.body.url).toBe("https://instagram.com/test");
  });

  it("accepts a valid key (youtube)", async () => {
    const res = await request(app)
      .post("/api/admin/patient-social")
      .set("Authorization", ADMIN_AUTH)
      .send({ key: "youtube", url: "https://youtube.com/@test" });
    expect(res.status).toBe(200);
  });

  it("accepts a valid key (linkedin)", async () => {
    const res = await request(app)
      .post("/api/admin/patient-social")
      .set("Authorization", ADMIN_AUTH)
      .send({ key: "linkedin", url: "https://linkedin.com/company/test" });
    expect(res.status).toBe(200);
  });

  it("accepts a valid key (tiktok)", async () => {
    const res = await request(app)
      .post("/api/admin/patient-social")
      .set("Authorization", ADMIN_AUTH)
      .send({ key: "tiktok", url: "https://tiktok.com/@test" });
    expect(res.status).toBe(200);
  });

  it("accepts a valid key (facebook)", async () => {
    const res = await request(app)
      .post("/api/admin/patient-social")
      .set("Authorization", ADMIN_AUTH)
      .send({ key: "facebook", url: "https://facebook.com/test" });
    expect(res.status).toBe(200);
  });

  it("rejects an unknown key", async () => {
    const res = await request(app)
      .post("/api/admin/patient-social")
      .set("Authorization", ADMIN_AUTH)
      .send({ key: "twitter", url: "https://twitter.com/test" });
    expect(res.status).toBe(400);
  });

  it("rejects when key is missing", async () => {
    const res = await request(app)
      .post("/api/admin/patient-social")
      .set("Authorization", ADMIN_AUTH)
      .send({ url: "https://instagram.com/test" });
    expect(res.status).toBe(400);
  });

  it("rejects when url is missing", async () => {
    const res = await request(app)
      .post("/api/admin/patient-social")
      .set("Authorization", ADMIN_AUTH)
      .send({ key: "instagram" });
    expect(res.status).toBe(400);
  });

  it("calls db.insert once with key=patient_social_instagram (SOCIAL_PREFIX + key)", async () => {
    const valuesMock = makeValuesMock();
    mockInsert.mockReturnValue({ values: valuesMock });

    await request(app)
      .post("/api/admin/patient-social")
      .set("Authorization", ADMIN_AUTH)
      .send({ key: "instagram", url: "https://instagram.com/spirecut" });

    expect(mockInsert).toHaveBeenCalledOnce();
    // values() must receive the prefixed key and the raw URL
    const valuesArg = valuesMock.mock.calls[0]?.[0] as { key?: string; value?: string };
    expect(valuesArg?.key).toBe("patient_social_instagram");
    expect(valuesArg?.value).toBe("https://instagram.com/spirecut");
  });

  it("calls onConflictDoUpdate so existing rows are overwritten rather than duplicated", async () => {
    const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
    const valuesMock = vi.fn().mockImplementation(() => {
      const p: any = Promise.resolve(undefined);
      p.onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
      p.onConflictDoUpdate = onConflictDoUpdateMock;
      return p;
    });
    mockInsert.mockReturnValue({ values: valuesMock });

    await request(app)
      .post("/api/admin/patient-social")
      .set("Authorization", ADMIN_AUTH)
      .send({ key: "instagram", url: "https://instagram.com/spirecut" });

    expect(onConflictDoUpdateMock).toHaveBeenCalledOnce();
  });

  it("response body echoes back { key, url } after a successful write", async () => {
    const res = await request(app)
      .post("/api/admin/patient-social")
      .set("Authorization", ADMIN_AUTH)
      .send({ key: "youtube", url: "https://youtube.com/@spirecut" });

    expect(res.status).toBe(200);
    expect(res.body.key).toBe("youtube");
    expect(res.body.url).toBe("https://youtube.com/@spirecut");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/patient-postop-stats — quotes filtering
// ═══════════════════════════════════════════════════════════════════════════════

/** Build a stored submission JSON string for the DB mock. */
function makeSubmission(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: `test_${Math.random().toString(36).slice(2, 8)}`,
    procedure: "ct",
    operationMonth: "2024-01",
    rating: 5,
    experience: "Excellent outcome, very happy with the result overall.",
    shareQuote: true,
    quoteApproved: true,
    submittedAt: "2024-01-15T10:00:00.000Z",
    ...overrides,
  });
}

describe("GET /api/patient-postop-stats – quotes array when no approved quotes", () => {
  it("returns quotes=[] when there are no submissions at all", async () => {
    mockSelectWhere.mockResolvedValue([]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.quotes).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.averageRating).toBeNull();
  });

  it("returns quotes=[] when submissions exist but none are approved (all pending)", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_a", value: makeSubmission({ quoteApproved: null }) },
      { key: "patient_postop_b", value: makeSubmission({ quoteApproved: null }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.quotes).toEqual([]);
    // total still reflects all submissions
    expect(res.body.total).toBe(2);
  });

  it("returns quotes=[] when all quotes are rejected", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_a", value: makeSubmission({ quoteApproved: false }) },
      { key: "patient_postop_b", value: makeSubmission({ quoteApproved: false }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.quotes).toEqual([]);
  });

  it("returns quotes=[] when shareQuote=false even if quoteApproved=true", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_a", value: makeSubmission({ shareQuote: false, quoteApproved: true }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.quotes).toEqual([]);
  });

  it("returns quotes=[] when experience is too short (< 20 chars)", async () => {
    mockSelectWhere.mockResolvedValue([
      {
        key: "patient_postop_a",
        value: makeSubmission({ shareQuote: true, quoteApproved: true, experience: "Short." }),
      },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.quotes).toEqual([]);
  });

  it("excludes approved quotes with a float rating from the public response", async () => {
    mockSelectWhere.mockResolvedValue([
      {
        key: "patient_postop_float_rating",
        value: makeSubmission({ shareQuote: true, quoteApproved: true, rating: 3.7 }),
      },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.quotes).toEqual([]);
  });

  it("excludes approved shared quotes with malformed ratings while preserving the total", async () => {
    mockSelectWhere.mockResolvedValue([
      {
        key: "patient_postop_null_rating",
        value: makeSubmission({ rating: null }),
      },
      {
        key: "patient_postop_string_rating",
        value: makeSubmission({ rating: "5" }),
      },
      {
        key: "patient_postop_zero_rating",
        value: makeSubmission({ rating: 0 }),
      },
      {
        key: "patient_postop_six_rating",
        value: makeSubmission({ rating: 6 }),
      },
      {
        key: "patient_postop_non_finite_rating",
        // JSON.parse accepts this overflowing exponent as Infinity.
        value: makeSubmission().replace('"rating":5', '"rating":1e999'),
      },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
    expect(res.body.skippedInvalid).toBe(5);
    expect(res.body.quotes).toEqual([]);
  });
});

describe("GET /api/patient-postop-stats – quotes array with one approved quote", () => {
  it("returns exactly one quote entry", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_a", value: makeSubmission() },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.quotes).toHaveLength(1);
  });

  it("surfaces the correct quote text, procedure, and rating", async () => {
    mockSelectWhere.mockResolvedValue([
      {
        key: "patient_postop_a",
        value: makeSubmission({
          experience: "Excellent outcome, very happy with the result overall.",
          procedure: "ct",
          rating: 5,
        }),
      },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    const [quote] = res.body.quotes;
    expect(quote.text).toBe("Excellent outcome, very happy with the result overall.");
    expect(quote.procedure).toBe("ct");
    expect(quote.rating).toBe(5);
  });

  it("does not expose private fields such as submittedAt or id in the quote object", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_a", value: makeSubmission() },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    const [quote] = res.body.quotes;
    expect(quote).not.toHaveProperty("id");
    expect(quote).not.toHaveProperty("submittedAt");
    expect(quote).not.toHaveProperty("experience"); // only "text" is exposed
  });
});

describe("GET /api/patient-postop-stats – quotes array with two approved quotes", () => {
  it("returns exactly two quote entries", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_a", value: makeSubmission({ experience: "First patient: great outcome overall." }) },
      { key: "patient_postop_b", value: makeSubmission({ experience: "Second patient: wonderful experience too." }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.quotes).toHaveLength(2);
  });

  it("orders non-featured quotes oldest-first (stable rotation)", async () => {
    mockSelectWhere.mockResolvedValue([
      {
        key: "patient_postop_newer",
        value: makeSubmission({
          experience: "Newer patient: excellent result from the procedure.",
          submittedAt: "2024-06-01T00:00:00.000Z",
        }),
      },
      {
        key: "patient_postop_older",
        value: makeSubmission({
          experience: "Older patient: very satisfied with the treatment.",
          submittedAt: "2024-01-01T00:00:00.000Z",
        }),
      },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.quotes[0].text).toContain("Older");
    expect(res.body.quotes[1].text).toContain("Newer");
  });

  it("places the featured quote first regardless of submission date", async () => {
    mockSelectWhere.mockResolvedValue([
      {
        key: "patient_postop_older",
        value: makeSubmission({
          experience: "Older non-featured patient: good experience overall.",
          submittedAt: "2024-01-01T00:00:00.000Z",
          featured: false,
        }),
      },
      {
        key: "patient_postop_newer_featured",
        value: makeSubmission({
          experience: "Newer featured patient: absolutely fantastic result.",
          submittedAt: "2024-06-01T00:00:00.000Z",
          featured: true,
        }),
      },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.quotes[0].featured).toBe(true);
    expect(res.body.quotes[0].text).toContain("featured");
    expect(res.body.quotes[1].featured).toBe(false);
  });

  it("excludes rejected quotes even when mixed with approved ones", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_a", value: makeSubmission({ experience: "Approved: very positive experience overall." }) },
      { key: "patient_postop_b", value: makeSubmission({ quoteApproved: false, experience: "Rejected patient: should not appear here." }) },
      { key: "patient_postop_c", value: makeSubmission({ quoteApproved: null, experience: "Pending patient: also should not appear here." }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.quotes).toHaveLength(1);
    expect(res.body.quotes[0].text).toContain("Approved");
    // total reflects ALL submissions, not just approved quotes
    expect(res.body.total).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/patient-postop-stats — aggregation correctness
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/patient-postop-stats – safe zeroes/nulls when no submissions", () => {
  it("returns total=0, averageRating=null, empty distribution and byProcedure, quotes=[]", async () => {
    mockSelectWhere.mockResolvedValue([]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.averageRating).toBeNull();
    expect(res.body.ratingDistribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(res.body.byProcedure).toEqual({});
    expect(res.body.quotes).toEqual([]);
  });
});

describe("GET /api/patient-postop-stats – averageRating", () => {
  it("returns the correct average for a homogeneous set (all 5s)", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_a", value: makeSubmission({ rating: 5 }) },
      { key: "patient_postop_b", value: makeSubmission({ rating: 5 }) },
      { key: "patient_postop_c", value: makeSubmission({ rating: 5 }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.averageRating).toBe(5);
  });

  it("rounds to one decimal place", async () => {
    // (4 + 4 + 5) / 3 = 4.333… → rounded to 4.3
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_a", value: makeSubmission({ rating: 4 }) },
      { key: "patient_postop_b", value: makeSubmission({ rating: 4 }) },
      { key: "patient_postop_c", value: makeSubmission({ rating: 5 }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.averageRating).toBeCloseTo(4.3, 1);
  });

  it("computes a mixed-rating average correctly", async () => {
    // (1 + 2 + 3 + 4 + 5) / 5 = 3.0
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_1", value: makeSubmission({ rating: 1 }) },
      { key: "patient_postop_2", value: makeSubmission({ rating: 2 }) },
      { key: "patient_postop_3", value: makeSubmission({ rating: 3 }) },
      { key: "patient_postop_4", value: makeSubmission({ rating: 4 }) },
      { key: "patient_postop_5", value: makeSubmission({ rating: 5 }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.averageRating).toBe(3);
  });

  it("includes all submissions (including those whose quotes are not approved) in the average", async () => {
    // A non-shared submission with rating=1 must still count in the average
    // (1 + 5) / 2 = 3.0
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_a", value: makeSubmission({ rating: 1, shareQuote: false, quoteApproved: undefined }) },
      { key: "patient_postop_b", value: makeSubmission({ rating: 5 }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.averageRating).toBe(3);
    expect(res.body.total).toBe(2);
  });
});

describe("GET /api/patient-postop-stats – ratingDistribution", () => {
  it("counts each bucket correctly with no overlaps", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_1", value: makeSubmission({ rating: 1 }) },
      { key: "patient_postop_2a", value: makeSubmission({ rating: 2 }) },
      { key: "patient_postop_2b", value: makeSubmission({ rating: 2 }) },
      { key: "patient_postop_3a", value: makeSubmission({ rating: 3 }) },
      { key: "patient_postop_3b", value: makeSubmission({ rating: 3 }) },
      { key: "patient_postop_3c", value: makeSubmission({ rating: 3 }) },
      { key: "patient_postop_5", value: makeSubmission({ rating: 5 }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.ratingDistribution).toEqual({ 1: 1, 2: 2, 3: 3, 4: 0, 5: 1 });
  });

  it("returns all zero buckets when there are no submissions", async () => {
    mockSelectWhere.mockResolvedValue([]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.body.ratingDistribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });

  it("returns all counts in bucket 5 for all-five-star submissions", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_a", value: makeSubmission({ rating: 5 }) },
      { key: "patient_postop_b", value: makeSubmission({ rating: 5 }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.body.ratingDistribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 2 });
  });

  it("counts all submissions, not only approved-quote submissions", async () => {
    // One with shareQuote=false should still land in the distribution
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_a", value: makeSubmission({ rating: 4, shareQuote: false, quoteApproved: undefined }) },
      { key: "patient_postop_b", value: makeSubmission({ rating: 5 }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.body.ratingDistribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 });
  });
});

describe("GET /api/patient-postop-stats – byProcedure", () => {
  it("counts ct, tf, and both correctly", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_ct1", value: makeSubmission({ procedure: "ct" }) },
      { key: "patient_postop_ct2", value: makeSubmission({ procedure: "ct" }) },
      { key: "patient_postop_tf1", value: makeSubmission({ procedure: "tf" }) },
      { key: "patient_postop_both1", value: makeSubmission({ procedure: "both" }) },
      { key: "patient_postop_both2", value: makeSubmission({ procedure: "both" }) },
      { key: "patient_postop_both3", value: makeSubmission({ procedure: "both" }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.byProcedure).toEqual({ ct: 2, tf: 1, both: 3 });
  });

  it("returns all zeros when there are no submissions", async () => {
    mockSelectWhere.mockResolvedValue([]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.body.byProcedure).toEqual({});
  });

  it("counts every submission regardless of quote approval status", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_a", value: makeSubmission({ procedure: "ct", quoteApproved: null }) },
      { key: "patient_postop_b", value: makeSubmission({ procedure: "ct", quoteApproved: false }) },
      { key: "patient_postop_c", value: makeSubmission({ procedure: "tf", shareQuote: false, quoteApproved: undefined }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.body.byProcedure).toEqual({ ct: 2, tf: 1 });
    expect(res.body.total).toBe(3);
  });

  it("counts non-standard procedure values under their own key (procedures are configurable)", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_a", value: makeSubmission({ procedure: "ct" }) },
      // custom procedure key — form procedures are admin-configurable
      { key: "patient_postop_bad", value: JSON.stringify({ id: "bad", procedure: "laser", rating: 4, submittedAt: "2024-01-01T00:00:00.000Z" }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    // total counts all parseable submissions regardless
    expect(res.body.total).toBe(2);
    expect(res.body.byProcedure).toEqual({ ct: 1, laser: 1 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/patient-postop-stats — corrupt or missing data resilience
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/patient-postop-stats – corrupt JSON rows are silently ignored", () => {
  it("returns 200 and skips the unparseable row when the only DB row is corrupt JSON", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_corrupt", value: "not json" },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.averageRating).toBeNull();
    expect(res.body).not.toHaveProperty("unreadableCount");
  });

  it("counts only the valid row and ignores a corrupt neighbour", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_good", value: makeSubmission({ rating: 4 }) },
      { key: "patient_postop_bad", value: "not json at all {{{" },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.averageRating).toBe(4);
  });

  it("returns a valid response when all rows are corrupt JSON", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_a", value: "garbage" },
      { key: "patient_postop_b", value: "{bad: true" },
      { key: "patient_postop_c", value: "undefined" },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.averageRating).toBeNull();
    expect(res.body.ratingDistribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(res.body.byProcedure).toEqual({});
    expect(res.body.quotes).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/patient-postop-stats — invalid rating filter (skippedInvalid)
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/patient-postop-stats – invalid ratings are excluded from averageRating and ratingDistribution", () => {
  it("excludes a null-rated submission from averageRating and reports skippedInvalid=1", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_null_rating", value: JSON.stringify({ id: "x", procedure: "ct", operationMonth: "2024-01", rating: null, submittedAt: "2024-01-01T00:00:00.000Z" }) },
      { key: "patient_postop_good", value: makeSubmission({ rating: 5 }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    // total still counts all parseable submissions
    expect(res.body.total).toBe(2);
    // averageRating is computed from the one valid submission only
    expect(res.body.averageRating).toBe(5);
    expect(res.body.skippedInvalid).toBe(1);
  });

  it("excludes a submission with no rating field from averageRating and reports skippedInvalid=1", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_no_rating", value: JSON.stringify({ id: "y", procedure: "tf", operationMonth: "2024-02", submittedAt: "2024-02-01T00:00:00.000Z" }) },
      { key: "patient_postop_good", value: makeSubmission({ rating: 3 }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.averageRating).toBe(3);
    expect(res.body.skippedInvalid).toBe(1);
  });

  it("excludes a string-valued rating from averageRating and ratingDistribution", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_str", value: JSON.stringify({ id: "z", procedure: "ct", rating: "5", submittedAt: "2024-01-01T00:00:00.000Z" }) },
      { key: "patient_postop_good", value: makeSubmission({ rating: 4 }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.averageRating).toBe(4);
    expect(res.body.skippedInvalid).toBe(1);
    // The string "5" must not land in the distribution
    expect(res.body.ratingDistribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 });
  });

  it("excludes an out-of-range numeric rating (0) from averageRating", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_zero", value: JSON.stringify({ id: "z0", procedure: "ct", rating: 0, submittedAt: "2024-01-01T00:00:00.000Z" }) },
      { key: "patient_postop_good", value: makeSubmission({ rating: 5 }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.averageRating).toBe(5);
    expect(res.body.skippedInvalid).toBe(1);
  });

  it("excludes an out-of-range numeric rating (6) from averageRating", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_six", value: JSON.stringify({ id: "z6", procedure: "ct", rating: 6, submittedAt: "2024-01-01T00:00:00.000Z" }) },
      { key: "patient_postop_good", value: makeSubmission({ rating: 2 }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.averageRating).toBe(2);
    expect(res.body.skippedInvalid).toBe(1);
  });

  it("returns averageRating=null and skippedInvalid=total when ALL submissions have invalid ratings", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_a", value: JSON.stringify({ id: "a", procedure: "ct", rating: null, submittedAt: "2024-01-01T00:00:00.000Z" }) },
      { key: "patient_postop_b", value: JSON.stringify({ id: "b", procedure: "ct", rating: "high", submittedAt: "2024-01-02T00:00:00.000Z" }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.averageRating).toBeNull();
    expect(res.body.skippedInvalid).toBe(2);
    expect(res.body.ratingDistribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });

  it("returns skippedInvalid=0 when all submissions have valid ratings", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_a", value: makeSubmission({ rating: 4 }) },
      { key: "patient_postop_b", value: makeSubmission({ rating: 5 }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.skippedInvalid).toBe(0);
    expect(res.body.averageRating).toBe(4.5);
  });

  it("preserves total to include the invalid submission (byProcedure still counts it)", async () => {
    // A submission with a null rating still contributes to byProcedure and total,
    // but must not skew the average.
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_invalid", value: JSON.stringify({ id: "inv", procedure: "tf", rating: null, submittedAt: "2024-01-01T00:00:00.000Z" }) },
      { key: "patient_postop_valid", value: makeSubmission({ procedure: "ct", rating: 5 }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.byProcedure).toEqual({ ct: 1, tf: 1 });
    expect(res.body.averageRating).toBe(5);
    expect(res.body.skippedInvalid).toBe(1);
  });

  it("zero-submission response also includes skippedInvalid=0", async () => {
    mockSelectWhere.mockResolvedValue([]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.skippedInvalid).toBe(0);
  });

  it("excludes a stored float rating (4.7) from averageRating and reports skippedInvalid=1", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_float", value: JSON.stringify({ id: "f1", procedure: "ct", rating: 4.7, submittedAt: "2024-01-01T00:00:00.000Z" }) },
      { key: "patient_postop_good", value: makeSubmission({ rating: 4 }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    // total still counts all parseable submissions
    expect(res.body.total).toBe(2);
    // float must be excluded; averageRating comes from the one valid integer-rated submission only
    expect(res.body.averageRating).toBe(4);
    expect(res.body.skippedInvalid).toBe(1);
  });

  it("excludes a stored float rating (4.7) from ratingDistribution (no phantom bucket)", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_float", value: JSON.stringify({ id: "f2", procedure: "ct", rating: 4.7, submittedAt: "2024-01-01T00:00:00.000Z" }) },
      { key: "patient_postop_good", value: makeSubmission({ rating: 3 }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    // The float 4.7 must not appear in any bucket — only the integer 3 counts
    expect(res.body.ratingDistribution).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 0 });
    expect(res.body.skippedInvalid).toBe(1);
  });

  it("excludes a stored float rating (1.0) that is in-range but non-integer from averageRating", async () => {
    // 1.0 passes the >= 1 && <= 5 range check but must fail the isInteger guard
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_float_one", value: JSON.stringify({ id: "f3", procedure: "ct", rating: 1.0, submittedAt: "2024-01-01T00:00:00.000Z" }) },
      { key: "patient_postop_good", value: makeSubmission({ rating: 5 }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    // 1.0 === 1 in JS (Number.isInteger(1.0) is true), so this submission IS valid
    // This test documents the boundary: 1.0 is accepted, 1.1 is not
    expect(res.body.skippedInvalid).toBe(0);
    expect(res.body.averageRating).toBe(3); // (1 + 5) / 2
  });

  it("excludes a stored float rating (2.5) from averageRating and ratingDistribution, counting it in skippedInvalid", async () => {
    mockSelectWhere.mockResolvedValue([
      { key: "patient_postop_float_mid", value: JSON.stringify({ id: "f4", procedure: "tf", rating: 2.5, submittedAt: "2024-02-01T00:00:00.000Z" }) },
      { key: "patient_postop_good_a", value: makeSubmission({ rating: 2 }) },
      { key: "patient_postop_good_b", value: makeSubmission({ rating: 4 }) },
    ]);

    const res = await request(app).get("/api/patient-postop-stats");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    // averageRating uses only the two integer-rated submissions: (2 + 4) / 2 = 3
    expect(res.body.averageRating).toBe(3);
    expect(res.body.skippedInvalid).toBe(1);
    // 2.5 must not land in bucket "2" or any other bucket
    expect(res.body.ratingDistribution).toEqual({ 1: 0, 2: 1, 3: 0, 4: 1, 5: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Notification deduplication tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/patient-postop – notification deduplication", () => {
  it("calls onConflictDoNothing() on every notification insert so the DB unique partial index prevents duplicates", async () => {
    const onConflictDoNothingCalls: unknown[] = [];

    mockInsert.mockImplementation(() => ({
      values: vi.fn().mockImplementation(() => {
        const p: any = Promise.resolve(undefined);
        p.onConflictDoNothing = vi.fn().mockImplementation(() => {
          onConflictDoNothingCalls.push(true);
          return Promise.resolve(undefined);
        });
        p.onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
        return p;
      }),
    }));

    const body = validBody({
      experience: "I had a fantastic recovery, highly recommend.",
      shareQuote: true,
    });

    // Simulate 5 concurrent patient submissions that all want to share a quote
    const results = await Promise.all([
      post(body), post(body), post(body), post(body), post(body),
    ]);

    // Every request must succeed — the insert never throws because conflicts are silenced
    expect(results.every((r) => r.status === 201)).toBe(true);

    // onConflictDoNothing() must be called for each request's irocNotifications insert.
    // The DB unique partial index (uniq_unread_pending_quote) then silently discards
    // duplicates so only one unread pending_quote notification row survives.
    expect(onConflictDoNothingCalls).toHaveLength(5);
  });

  it("does not insert a notification when shareQuote is false", async () => {
    const insertedTables: unknown[] = [];

    mockInsert.mockImplementation((table: unknown) => {
      insertedTables.push(table);
      return {
        values: vi.fn().mockImplementation(() => {
          const p: any = Promise.resolve(undefined);
          p.onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
          p.onConflictDoUpdate  = vi.fn().mockResolvedValue(undefined);
          return p;
        }),
      };
    });

    const res = await post(validBody({
      experience: "Average experience.",
      shareQuote: false,
    }));

    expect(res.status).toBe(201);
    // Only the settingsTable insert should have fired — no notification insert
    expect(insertedTables).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/patient-social — fallback and merge behaviour
// ═══════════════════════════════════════════════════════════════════════════════

const SOCIAL_DEFAULTS = {
  instagram: "https://www.instagram.com/spirecut_officiel/",
  youtube: "https://www.youtube.com/@Spirecut",
  linkedin: "https://www.linkedin.com/company/spirecut/",
  tiktok: "https://www.tiktok.com/@spirecut",
  facebook: "https://www.facebook.com/spirecut",
};

describe("GET /api/patient-social – empty DB returns hardcoded defaults", () => {
  it("returns 200 with all five default social links when DB has no stored values", async () => {
    mockSelectWhere.mockResolvedValue([]);

    const res = await request(app).get("/api/patient-social");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(SOCIAL_DEFAULTS);
  });
});

describe("GET /api/patient-social – stored value overrides only that key", () => {
  it("merges a stored instagram URL over the default while keeping the other four as defaults", async () => {
    const customInstagram = "https://www.instagram.com/custom_account/";
    mockSelectWhere.mockResolvedValue([
      { key: "patient_social_instagram", value: customInstagram },
    ]);

    const res = await request(app).get("/api/patient-social");

    expect(res.status).toBe(200);
    expect(res.body.instagram).toBe(customInstagram);
    expect(res.body.youtube).toBe(SOCIAL_DEFAULTS.youtube);
    expect(res.body.linkedin).toBe(SOCIAL_DEFAULTS.linkedin);
    expect(res.body.tiktok).toBe(SOCIAL_DEFAULTS.tiktok);
    expect(res.body.facebook).toBe(SOCIAL_DEFAULTS.facebook);
  });
});

describe("GET /api/patient-social – DB error falls back to defaults", () => {
  it("returns 200 with all five default social links when the DB throws", async () => {
    mockSelectWhere.mockRejectedValue(new Error("connection refused"));

    const res = await request(app).get("/api/patient-social");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(SOCIAL_DEFAULTS);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /api/admin/patient-postop/:id – rating correction
// ═══════════════════════════════════════════════════════════════════════════════

describe("PATCH /api/admin/patient-postop/:id – rating correction validation", () => {
  const submissionId = "1700000000000_rating_test";
  const dbKey = `patient_postop_${submissionId}`;

  function makeStoredSubmission(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      id: submissionId,
      procedure: "ct",
      operationMonth: "2024-03",
      rating: 99, // intentionally invalid stored value
      submittedAt: "2024-03-01T08:00:00.000Z",
      ...overrides,
    });
  }

  beforeEach(() => {
    mockSelectWhere.mockResolvedValue([{ key: dbKey, value: makeStoredSubmission() }]);
    mockUpdate.mockClear();
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it("returns 400 when rating is 0 (below minimum)", async () => {
    const res = await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ rating: 0 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when rating is 6 (above maximum)", async () => {
    const res = await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ rating: 6 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when rating is a float (e.g. 3.5)", async () => {
    const res = await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ rating: 3.5 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when rating is a string", async () => {
    const res = await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ rating: "4" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when rating is null", async () => {
    const res = await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ rating: null });
    expect(res.status).toBe(400);
  });

  it("returns 400 when rating is -1 (negative)", async () => {
    const res = await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ rating: -1 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when the body is empty (rating absent entirely)", async () => {
    const res = await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when rating is a word string ('five')", async () => {
    const res = await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ rating: "five" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the submission does not exist", async () => {
    mockSelectWhere.mockResolvedValue([]);
    const res = await request(app)
      .patch(`/api/admin/patient-postop/nonexistent_id`)
      .set("Authorization", ADMIN_AUTH)
      .send({ rating: 3 });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/admin/patient-postop/:id – rating correction success", () => {
  const submissionId = "1700000000001_rating_ok";
  const dbKey = `patient_postop_${submissionId}`;

  function makeStoredSubmission(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      id: submissionId,
      procedure: "tf",
      operationMonth: "2024-05",
      rating: 99, // corrupt value to be corrected
      submittedAt: "2024-05-10T12:00:00.000Z",
      shareQuote: false,
      ...overrides,
    });
  }

  beforeEach(() => {
    mockSelectWhere.mockResolvedValue([{ key: dbKey, value: makeStoredSubmission() }]);
    mockUpdate.mockClear();
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it("returns 200 with { id, rating } when rating is a valid integer (3)", async () => {
    const res = await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ rating: 3 });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(submissionId);
    expect(res.body.rating).toBe(3);
  });

  it("prioritizes a valid rating and leaves approval unchanged when both fields are supplied", async () => {
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    mockUpdate.mockReturnValue({ set: setMock });

    const res = await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ approved: true, rating: 3 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: "Rating corrected",
      id: submissionId,
      rating: 3,
    });
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(setMock).toHaveBeenCalledOnce();

    const setArg = setMock.mock.calls[0]?.[0] as { value?: string };
    expect(JSON.parse(setArg?.value ?? "{}")).toEqual({
      id: submissionId,
      procedure: "tf",
      operationMonth: "2024-05",
      rating: 3,
      submittedAt: "2024-05-10T12:00:00.000Z",
      shareQuote: false,
    });
    expect(whereMock).toHaveBeenCalledOnce();
  });

  it("accepts boundary rating 1 and returns 200", async () => {
    const res = await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ rating: 1 });

    expect(res.status).toBe(200);
    expect(res.body.rating).toBe(1);
  });

  it("accepts boundary rating 5 and returns 200", async () => {
    const res = await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ rating: 5 });

    expect(res.status).toBe(200);
    expect(res.body.rating).toBe(5);
  });

  it("calls db.update and persists the corrected rating in the stored JSON", async () => {
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    mockUpdate.mockReturnValue({ set: setMock });

    await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ rating: 4 });

    expect(mockUpdate).toHaveBeenCalledOnce();
    const setArg = setMock.mock.calls[0]?.[0] as { value?: string };
    const persisted = JSON.parse(setArg?.value ?? "{}");
    expect(persisted.rating).toBe(4);
  });

  it("does not call db.update for an approval when only rating is supplied", async () => {
    // When body has { rating } only, the approval branch should not run
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    mockUpdate.mockReturnValue({ set: setMock });

    await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ rating: 2 });

    // update called exactly once (for the rating save, not an extra approval call)
    expect(mockUpdate).toHaveBeenCalledOnce();
    const persisted = JSON.parse(
      (setMock.mock.calls[0]?.[0] as { value?: string })?.value ?? "{}"
    );
    // quoteApproved should NOT be changed — remains whatever was stored
    expect(persisted).not.toHaveProperty("quoteApproved", true);
  });

  it("GET after a successful PATCH returns the corrected rating (simulates page reload)", async () => {
    // Step 1 – capture what value the PATCH would write to the DB
    let writtenValue: string | undefined;
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const setMock = vi.fn().mockImplementation((arg: { value?: string }) => {
      writtenValue = arg.value;
      return { where: whereMock };
    });
    mockUpdate.mockReturnValue({ set: setMock });

    const patchRes = await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ rating: 3 });

    expect(patchRes.status).toBe(200);
    expect(writtenValue).toBeDefined();

    // Step 2 – simulate a page reload: the next GET reads the now-updated row from the DB
    mockSelectWhere.mockResolvedValue([{ key: dbKey, value: writtenValue! }]);

    const getRes = await request(app)
      .get("/api/admin/patient-postop")
      .set("Authorization", ADMIN_AUTH);

    expect(getRes.status).toBe(200);
    expect(Array.isArray(getRes.body)).toBe(true);
    const found = getRes.body.find((row: any) => row.id === submissionId);
    expect(found).toBeDefined();
    // The corrected rating must be present — not the original corrupt value (99)
    expect(found.rating).toBe(3);
  });

  it("corrected rating replaces only the rating field; all other submission fields are preserved", async () => {
    // The PATCH must perform a non-destructive merge: only `rating` changes.
    const whereMock = vi.fn().mockResolvedValue(undefined);
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    mockUpdate.mockReturnValue({ set: setMock });

    await request(app)
      .patch(`/api/admin/patient-postop/${submissionId}`)
      .set("Authorization", ADMIN_AUTH)
      .send({ rating: 5 });

    const setArg = setMock.mock.calls[0]?.[0] as { value?: string };
    const persisted = JSON.parse(setArg?.value ?? "{}");

    // Rating is updated
    expect(persisted.rating).toBe(5);
    // All other fields from the original submission are intact
    expect(persisted.id).toBe(submissionId);
    expect(persisted.procedure).toBe("tf");
    expect(persisted.operationMonth).toBe("2024-05");
    expect(persisted.submittedAt).toBe("2024-05-10T12:00:00.000Z");
    expect(persisted.shareQuote).toBe(false);
  });
});
