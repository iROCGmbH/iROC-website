import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockValues } = vi.hoisted(() => {
  process.env.SESSION_SECRET = "portal-training-request-test-secret";

  return {
    mockValues: vi.fn().mockResolvedValue({}),
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: mockValues }),
    select: vi.fn(),
  },
  pool: { query: vi.fn() },
  websiteCustomersTable: { id: "id", customerNr: "customerNr", instrument: "instrument" },
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

const app = express();
app.use(express.json());
app.use(portalRouter);

function authHeaderFor(customerId: number): string {
  return `Bearer ${jwt.sign(
    { customerId, customerNr: `DOC${customerId}`, instrument: "spirecut" },
    "portal-training-request-test-secret",
  )}`;
}

beforeEach(() => {
  mockValues.mockClear();
});

describe("POST /portal/training-request", () => {
  it("persists the selected training date ID and ISO date in the admin queue payload", async () => {
    const selectedDate = {
      trainingDateId: 17,
      requestedDate: "2026-09-15",
    };

    const response = await request(app)
      .post("/portal/training-request")
      .set("Authorization", authHeaderFor(42))
      .send({
        salutation: "Frau",
        medicalDegree: "Dr. med.",
        firstName: "Erika",
        lastName: "Musterfrau",
        specialty: "Chirurgie",
        institutionName: "Testklinik GmbH",
        address: "Musterstraße 2",
        postalCode: "80331",
        city: "München",
        country: "DE",
        phone: "+49 89 54321",
        email: "erika.musterfrau@example.com",
        ...selectedDate,
        privacyConsent: true,
        marketingConsent: true,
      });

    expect(response.status).toBe(200);
    expect(mockValues).toHaveBeenCalledOnce();
    expect(mockValues).toHaveBeenCalledWith({
      customerId: 42,
      type: "training_request",
      payload: expect.objectContaining(selectedDate),
    });
  });
});