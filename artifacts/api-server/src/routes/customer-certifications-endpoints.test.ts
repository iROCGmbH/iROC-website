/**
 * Regression coverage for website-customer certification serialization.
 *
 * Both admin surfaces update the same website customer record, but they use
 * different auth guards and response serializers. Keep both paths covered so
 * adding MiniStem certification cannot silently reduce a doctor to one system.
 */
import crypto from "crypto";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSelect,
  mockInsert,
  mockUpdate,
  mockSet,
} = vi.hoisted(() => {
  process.env.SESSION_SECRET = "customer-certifications-test-secret";
  process.env.ADMIN_PASSWORD = "customer-certifications-admin-password";

  return {
    mockSelect: vi.fn(),
    mockInsert: vi.fn(),
    mockUpdate: vi.fn(),
    mockSet: vi.fn(),
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  },
  pool: { query: vi.fn() },
  irocAppUsers: {},
  irocCustomers: {},
  irocProducts: {},
  irocProductGroups: {},
  irocInventoryLots: {},
  irocInvoices: {},
  irocInvoiceItems: {},
  irocNotifications: {},
  irocLeads: {},
  irocTrainingOffers: {},
  irocOrders: {},
  irocOrderShipments: {},
  irocCustomerWebsiteLinks: {},
  websiteCustomersTable: { id: "id", title: "title", email: "email" },
  trainingRegistrationsTable: {},
  settingsTable: {},
  trainingDatesTable: {},
  trainedDoctorsTable: {},
  doctorCertificationsTable: {},
  resourcesTable: {},
}));

vi.mock("pdfkit", () => {
  class MockPDF {
    page = { width: 595.28, height: 841.89 };
    y = 0;
    font() { return this; }
    fontSize() { return this; }
    fillColor() { return this; }
    strokeColor() { return this; }
    lineWidth() { return this; }
    save() { return this; }
    restore() { return this; }
    addPage() { return this; }
    image() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    rect() { return this; }
    clip() { return this; }
    stroke() { return this; }
    fill() { return this; }
    text() { return this; }
    heightOfString() { return 10; }
    end(callback?: () => void) { callback?.(); return this; }
  }
  return { default: MockPDF };
});

import adminRouter from "./admin";
import irocRouter from "./iroc";

const app = express();
app.use(express.json());
app.use(adminRouter);
app.use(irocRouter);

const ADMIN_AUTH = "Bearer customer-certifications-admin-password";
const IROC_AUTH = `Bearer ${makeIrocToken()}`;

function makeIrocToken(): string {
  const payload = {
    userId: 1,
    username: "admin",
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", "customer-certifications-test-secret")
    .update(data)
    .digest("base64url");
  return `${data}.${signature}`;
}

const CUSTOMER = {
  id: 42,
  customerNr: "2026-0042",
  reorderCode: "REORDER42",
  salutation: "Dr.",
  title: null,
  firstName: "Anna",
  lastName: "Example",
  specialty: "Orthopedics",
  institutionName: "Example Clinic",
  institutionType: null,
  address: "Main Street 1",
  postalCode: "10115",
  city: "Berlin",
  country: "DE",
  email: "anna@example.com",
  phone: null,
  fax: null,
  website: null,
  referenceNumber: null,
  isPublicAuthority: false,
  defaultBuyerReference: null,
  ustIdNr: null,
  instrument: "spirecut",
  certifications: ["spirecut", "ministem"],
  notes: null,
  privacyConsent: true,
  shippingFirstName: null,
  shippingLastName: null,
  shippingInstitutionName: null,
  shippingAddress: null,
  shippingPostalCode: null,
  shippingCity: null,
  shippingCountry: null,
  shippingPhone: null,
  shippingEmail: null,
  createdAt: new Date("2026-01-15T12:00:00.000Z"),
};

const ENDPOINTS = [
  {
    name: "iROC",
    path: "/iroc/website-customers/42",
    auth: IROC_AUTH,
  },
  {
    name: "legacy admin",
    path: "/admin/customers/42",
    auth: ADMIN_AUTH,
  },
] as const;

beforeEach(() => {
  mockSelect.mockReset();
  mockInsert.mockReset();
  mockUpdate.mockReset();
  mockSet.mockReset();

  // iroc.ts calls ensureAdminUser() during module initialization. The
  // default select chain also keeps any unrelated route setup harmless.
  mockSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
      limit: vi.fn().mockResolvedValue([]),
    }),
  });
  mockInsert.mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  });

  mockSet.mockImplementation((fields: Record<string, unknown>) => ({
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{
        ...CUSTOMER,
        ...fields,
      }]),
    }),
  }));
  mockUpdate.mockReturnValue({ set: mockSet });
});

describe.each(ENDPOINTS)("PATCH $name customer certifications", (endpoint) => {
  it("preserves both certifications when updating an unrelated field", async () => {
    const response = await request(app)
      .patch(endpoint.path)
      .set("Authorization", endpoint.auth)
      .send({ phone: "+49 30 123456" });

    expect(response.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith({ phone: "+49 30 123456" });
    expect(response.body.certifications).toEqual(["spirecut", "ministem"]);
  });

  it("preserves both certifications in the saved response", async () => {
    const response = await request(app)
      .patch(endpoint.path)
      .set("Authorization", endpoint.auth)
      .send({
        certifications: ["spirecut", "ministem"],
        instrument: "spirecut",
      });

    expect(response.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      certifications: ["spirecut", "ministem"],
    }));
    expect(response.body.certifications).toEqual(["spirecut", "ministem"]);
  });

  it("keeps a one-certification request compatible", async () => {
    const response = await request(app)
      .patch(endpoint.path)
      .set("Authorization", endpoint.auth)
      .send({ certifications: ["ministem"] });

    expect(response.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ certifications: ["ministem"] }),
    );
    expect(response.body.certifications).toEqual(["ministem"]);
  });

  it("derives certifications for legacy instrument-only requests", async () => {
    const response = await request(app)
      .patch(endpoint.path)
      .set("Authorization", endpoint.auth)
      .send({ instrument: "both" });

    expect(response.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      instrument: "both",
      certifications: ["spirecut", "ministem"],
    }));
    expect(response.body.certifications).toEqual(["spirecut", "ministem"]);
  });
});