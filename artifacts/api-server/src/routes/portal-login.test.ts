/**
 * Regression tests for the credentials displayed on the development portal login.
 *
 * The development database may not contain a demo customer on first start, so
 * the portal route creates one when the displayed credential pair is used.
 * Production must still require a certified doctor.
 */
import express from "express";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelect, mockValues, mockReturning, mockPoolQuery } = vi.hoisted(() => {
  process.env.SESSION_SECRET = "portal-login-test-secret";
  return {
    mockSelect: vi.fn(),
    mockValues: vi.fn(),
    mockReturning: vi.fn(),
    mockPoolQuery: vi.fn(),
  };
});

vi.mock("./admin-auth.js", () => ({
  requireAdmin: (
    _req: Request,
    _res: Response,
    next: NextFunction,
  ) => next(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn().mockReturnValue({ values: mockValues }),
  },
  pool: { query: mockPoolQuery },
  websiteCustomersTable: { id: "id", customerNr: "customer_nr" },
  irocInvoices: {},
  irocInvoiceItems: {},
  irocCustomers: {},
  resourcesTable: {},
  adminApprovalQueueTable: {},
  irocProductGroups: {},
  irocProducts: {},
  trainingDatesTable: {},
  settingsTable: {},
}));

import portalRouter from "./portal";
import sallyRouter from "./sally";

const app = express();
app.use(express.json());
app.use(portalRouter);
app.use(sallyRouter);

const DEMO_CUSTOMER = {
  id: 234,
  customerNr: "DOC10025",
  reorderCode: "M3D9X7P8",
  salutation: "Dr.",
  title: null,
  firstName: "Demo",
  lastName: "Doctor",
  specialty: "Orthopedics",
  institutionName: "iROC Demo Practice",
  address: null,
  postalCode: null,
  city: null,
  country: "DE",
  email: "demo.doctor@example.invalid",
  phone: null,
  instrument: "both",
  certifications: ["spirecut", "ministem"],
};

const CERTIFIED_CUSTOMER = {
  ...DEMO_CUSTOMER,
  id: 235,
  customerNr: "DOC10026",
  firstName: "Certified",
  lastName: "Doctor",
  email: "certified.doctor@example.com",
};

const CANCELLED_CERTIFIED_CUSTOMER = {
  ...DEMO_CUSTOMER,
  id: 236,
  customerNr: "DOC10027",
  firstName: "Cancelled",
  lastName: "Doctor",
  email: "cancelled.doctor@example.com",
};

const DELETED_CERTIFIED_CUSTOMER = {
  ...DEMO_CUSTOMER,
  id: 237,
  customerNr: "DOC10028",
  firstName: "Removed",
  lastName: "Doctor",
  email: "removed.doctor@example.com",
};

function mockCustomerLookup(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  mockSelect.mockReturnValueOnce({ from });
}

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NODE_ENV = "development";
  mockSelect.mockReset();
  mockValues.mockReset();
  mockReturning.mockReset();
  mockPoolQuery.mockReset();
  mockValues.mockReturnValue({ returning: mockReturning });
  mockReturning.mockResolvedValue([DEMO_CUSTOMER]);
});

afterAll(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

describe("POST /portal/login", () => {
  it("authenticates with the displayed demo credentials on an unseeded development database", async () => {
    mockCustomerLookup([]);

    const response = await request(app)
      .post("/portal/login")
      .send({ customerNr: "DOC10025", reorderCode: "M3D9X7P8" });

    expect(response.status).toBe(200);
    expect(response.body.customer).toMatchObject({
      customerNr: "DOC10025",
      firstName: "Demo",
      lastName: "Doctor",
    });
    expect(response.body.token).toEqual(expect.any(String));
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        customerNr: "DOC10025",
        reorderCode: "M3D9X7P8",
        email: "demo.doctor@example.invalid",
      }),
    );
  });

  it("rejects an incorrect access code", async () => {
    mockCustomerLookup([DEMO_CUSTOMER]);

    const response = await request(app)
      .post("/portal/login")
      .send({ customerNr: "DOC10025", reorderCode: "WRONGCODE" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: "Invalid customer number or access code",
    });
  });

  it("keeps the certified-doctor gate enabled in production", async () => {
    process.env.NODE_ENV = "production";
    mockCustomerLookup([DEMO_CUSTOMER]);
    mockPoolQuery.mockResolvedValue({ rows: [] });

    const response = await request(app)
      .post("/portal/login")
      .send({ customerNr: "DOC10025", reorderCode: "M3D9X7P8" });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "PORTAL_NOT_CERTIFIED" });
    expect(mockPoolQuery).toHaveBeenCalledOnce();
  });

  it("authenticates a certified doctor in production", async () => {
    process.env.NODE_ENV = "production";
    mockCustomerLookup([CERTIFIED_CUSTOMER]);
    // This represents the customer's active certification in
    // sally_certified_doctors (the production query also checks trained_doctors).
    mockPoolQuery.mockResolvedValue({ rows: [{ n: 1 }] });

    const response = await request(app)
      .post("/portal/login")
      .send({ customerNr: "DOC10026", reorderCode: "M3D9X7P8" });

    expect(response.status).toBe(200);
    expect(response.body.token).toEqual(expect.any(String));
    expect(response.body.customer).toMatchObject({
      id: CERTIFIED_CUSTOMER.id,
      customerNr: CERTIFIED_CUSTOMER.customerNr,
      firstName: CERTIFIED_CUSTOMER.firstName,
      lastName: CERTIFIED_CUSTOMER.lastName,
      email: CERTIFIED_CUSTOMER.email,
      certifications: ["spirecut", "ministem"],
    });
    expect(response.body.customer.certifications).toEqual(
      CERTIFIED_CUSTOMER.certifications,
    );
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("sally_certified_doctors"),
      [CERTIFIED_CUSTOMER.email],
    );
  });

  it("returns both certifications from GET /portal/me after login", async () => {
    process.env.NODE_ENV = "production";
    mockCustomerLookup([CERTIFIED_CUSTOMER]);
    mockPoolQuery.mockResolvedValue({ rows: [{ n: 1 }] });

    const loginResponse = await request(app)
      .post("/portal/login")
      .send({
        customerNr: CERTIFIED_CUSTOMER.customerNr,
        reorderCode: CERTIFIED_CUSTOMER.reorderCode,
      });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.customer.certifications).toEqual([
      "spirecut",
      "ministem",
    ]);

    // /portal/me re-reads the customer instead of relying on the token's
    // customer snapshot, so its response must preserve the same list too.
    mockCustomerLookup([CERTIFIED_CUSTOMER]);
    const meResponse = await request(app)
      .get("/portal/me")
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.certifications).toEqual([
      "spirecut",
      "ministem",
    ]);
  });

  it("does not authenticate a doctor with only a cancelled Sally certification", async () => {
    process.env.NODE_ENV = "production";
    mockCustomerLookup([CANCELLED_CERTIFIED_CUSTOMER]);
    // A cancelled-only Sally row does not satisfy the production certification
    // query, so the database returns no active certification rows.
    mockPoolQuery.mockResolvedValue({ rows: [] });

    const response = await request(app)
      .post("/portal/login")
      .send({ customerNr: "DOC10027", reorderCode: "M3D9X7P8" });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "PORTAL_NOT_CERTIFIED" });
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM sally_certified_doctors"),
      [CANCELLED_CERTIFIED_CUSTOMER.email],
    );
    expect(mockPoolQuery.mock.calls[0][0]).toContain(
      "is_cancelled = false",
    );
  });

  it("does not authenticate a doctor with only a soft-deleted Sally certification", async () => {
    process.env.NODE_ENV = "production";
    mockCustomerLookup([DELETED_CERTIFIED_CUSTOMER]);
    // A soft-deleted-only Sally row does not satisfy the production
    // certification query, so the database returns no active certification rows.
    mockPoolQuery.mockResolvedValue({ rows: [] });

    const response = await request(app)
      .post("/portal/login")
      .send({ customerNr: "DOC10028", reorderCode: "M3D9X7P8" });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "PORTAL_NOT_CERTIFIED" });
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM sally_certified_doctors"),
      [DELETED_CERTIFIED_CUSTOMER.email],
    );
    expect(mockPoolQuery.mock.calls[0][0]).toContain(
      "deleted_at IS NULL",
    );
    expect(mockPoolQuery.mock.calls[0][0]).toContain(
      "is_cancelled = false",
    );
  });

  it("rejects a portal token after the doctor's Sally certification is removed", async () => {
    process.env.NODE_ENV = "production";
    mockCustomerLookup([CERTIFIED_CUSTOMER]);
    mockPoolQuery.mockResolvedValue({ rows: [{ n: 1 }] });

    const loginResponse = await request(app)
      .post("/portal/login")
      .send({ customerNr: CERTIFIED_CUSTOMER.customerNr, reorderCode: "M3D9X7P8" });

    expect(loginResponse.status).toBe(200);

    // Exercise the same removal endpoint used by the admin UI. The handler
    // records the revocation timestamp on the soft-deleted Sally row.
    const removeResponse = await request(app)
      .delete("/admin/sally/doctors/42");

    expect(removeResponse.status).toBe(200);
    expect(mockPoolQuery.mock.calls[1][0]).toContain(
      "portal_sessions_revoked_at = NOW()",
    );

    // The middleware sees a revocation newer than this token's iat and must
    // reject it before the protected endpoint reaches its customer lookup.
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ revoked_at: new Date(Date.now() + 1000) }],
    });
    const meResponse = await request(app)
      .get("/portal/me")
      .set("Authorization", loginResponse.body.token
        ? `Bearer ${loginResponse.body.token}`
        : "");

    expect(meResponse.status).toBe(401);
    expect(meResponse.body).toEqual({ error: "Unauthorized" });
  });
});
