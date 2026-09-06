/**
 * Regression test: GET /iroc/customers-combined — salutation+title disambiguation
 *
 * Confirms that when two website_customers share the same surname but have
 * different salutation and title values, the endpoint returns both with their
 * distinct salutation and title fields intact, so the CustomerCombobox in
 * InvoiceNew/InvoiceEdit can render them as "Herr Dr. med Max Mustermann" vs
 * "Frau Erika Mustermann" and let admins tell them apart.
 *
 * Strategy: mock @workspace/db so db.select().from().orderBy() returns the
 * two fixture customers; assert the response contains both with correct
 * salutation, title, and name fields.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist mock-factory state ──────────────────────────────────────────────────
const { mockOrderBy, mockFrom, mockDbSelect } = vi.hoisted(() => {
  const mockOrderBy  = vi.fn();
  const mockFrom     = vi.fn().mockReturnValue({ orderBy: mockOrderBy, where: vi.fn().mockResolvedValue([]) });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockFrom });
  return { mockOrderBy, mockFrom, mockDbSelect };
});

// ── Mock @workspace/db ────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
  },
  irocInvoices:               {},
  irocInvoiceItems:           {},
  irocCustomers:              {},
  websiteCustomersTable:      {},
  irocAppUsers:               {},
  irocNotifications:          {},
  settingsTable:              {},
  irocProducts:               {},
  irocInventoryLots:          {},
  trainingRegistrationsTable: {},
  trainedDoctorsTable:        {},
}));

// ── Mock pdfkit (imported transitively by iroc.ts) ────────────────────────────
vi.mock("pdfkit", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough } = require("stream") as typeof import("stream");
  class MockPDF extends PassThrough {
    page = { width: 595.28, height: 841.89 };
    y = 0;
    font()           { return this; }
    fontSize()       { return this; }
    fillColor()      { return this; }
    strokeColor()    { return this; }
    lineWidth()      { return this; }
    save()           { return this; }
    restore()        { return this; }
    addPage()        { return this; }
    image()          { return this; }
    moveTo()         { return this; }
    lineTo()         { return this; }
    rect()           { return this; }
    clip()           { return this; }
    stroke()         { return this; }
    fill()           { return this; }
    text()           { return this; }
    heightOfString() { return 10; }
    end(cb?: () => void) { super.end(cb); return this; }
  }
  return { default: MockPDF };
});

// ── Import app AFTER mocks ────────────────────────────────────────────────────
import app from "../app";

// ── JWT helper ────────────────────────────────────────────────────────────────
const SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";

function makeIrocToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const payload = { userId: 1, username: "admin", exp };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig  = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

const AUTH = `Bearer ${makeIrocToken()}`;

// ── Fixture data ──────────────────────────────────────────────────────────────

/** Two website_customers with the same lastName but distinct salutation/title. */
const wc1 = {
  id:              1,
  customerNr:      "2026-0001",
  salutation:      "Herr",
  title:           "Dr. med",
  firstName:       "Max",
  lastName:        "Mustermann",
  institutionName: "Muster Klinik",
  institutionType: null,
  specialty:       null,
  address:         "Musterstr. 1",
  postalCode:      "80331",
  city:            "München",
  country:         "DE",
  phone:           null,
  fax:             null,
  email:           "max.mustermann@example.com",
  website:         null,
  referenceNumber: null,
  ustIdNr:         null,
  instrument:      "spirecut",
  notes:           null,
  privacyConsent:  true,
  isPublicAuthority: true,
  defaultBuyerReference: "LEITWEG-123",
  shippingFirstName: null, shippingLastName: null, shippingInstitutionName: null,
  shippingAddress: null, shippingPostalCode: null, shippingCity: null,
  shippingCountry: null, shippingPhone: null, shippingEmail: null,
  createdAt:       new Date("2026-01-01"),
};

const wc2 = {
  ...wc1,
  id:              2,
  customerNr:      "2026-0002",
  salutation:      "Frau",
  title:           null,
  firstName:       "Erika",
  isPublicAuthority: false,
  defaultBuyerReference: null,
  email:           "erika.mustermann@example.com",
  createdAt:       new Date("2026-01-02"),
};

/**
 * Stage db.select() calls for /iroc/customers-combined:
 *   Promise.all([
 *     db.select().from(irocCustomers).orderBy(...)   → first  orderBy call → irocList
 *     db.select().from(websiteCustomersTable).orderBy(...) → second orderBy call → websiteList
 *   ])
 */
function stageDbSelects(irocList: object[], websiteList: object[]) {
  mockOrderBy
    .mockResolvedValueOnce(irocList)
    .mockResolvedValueOnce(websiteList);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /iroc/customers-combined — salutation+title for shared surname", () => {
  beforeEach(() => {
    mockOrderBy.mockReset().mockResolvedValue([]);
    mockFrom.mockReturnValue({ orderBy: mockOrderBy, where: vi.fn().mockResolvedValue([]) });
    mockDbSelect.mockReturnValue({ from: mockFrom });
  });

  it("returns both customers with their distinct salutation and title when they share a surname", async () => {
    stageDbSelects([], [wc1, wc2]);

    const res = await request(app)
      .get("/api/iroc/customers-combined")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);

    const body: Array<{
      source: string;
      salutation: string | null;
      title: string | null;
      name: string;
      isPublicAuthority: boolean;
      defaultBuyerReference: string | null;
    }> = res.body;

    // Both website customers should appear
    const herrEntry = body.find(c => c.salutation === "Herr");
    const frauEntry = body.find(c => c.salutation === "Frau");

    expect(herrEntry).toBeDefined();
    expect(frauEntry).toBeDefined();

    // salutation + title + name form the distinct display strings used by the combobox
    const herrDisplay = [herrEntry!.salutation, herrEntry!.title, herrEntry!.name]
      .filter(Boolean).join(" ");
    const frauDisplay = [frauEntry!.salutation, frauEntry!.title, frauEntry!.name]
      .filter(Boolean).join(" ");

    expect(herrDisplay).toBe("Herr Dr. med Max Mustermann");
    expect(frauDisplay).toBe("Frau Erika Mustermann");

    // The two displays are distinct despite the shared surname
    expect(herrDisplay).not.toBe(frauDisplay);

    // Billing defaults must remain available to the invoice customer picker.
    expect(herrEntry).toMatchObject({
      isPublicAuthority: true,
      defaultBuyerReference: "LEITWEG-123",
    });
    expect(frauEntry).toMatchObject({
      isPublicAuthority: false,
      defaultBuyerReference: null,
    });
  });

  it("returns salutation and title as null for website customers that have none", async () => {
    const noSalutationCustomer = {
      ...wc1,
      id:         3,
      salutation: null,
      title:      null,
      firstName:  "Klaus",
      email:      "klaus.mustermann@example.com",
    };
    stageDbSelects([], [noSalutationCustomer]);

    const res = await request(app)
      .get("/api/iroc/customers-combined")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    const [entry] = res.body as Array<{ salutation: string | null; title: string | null; name: string }>;

    expect(entry.salutation).toBeNull();
    expect(entry.title).toBeNull();
    // With no salutation/title, the display string is just the name
    const display = [entry.salutation, entry.title, entry.name].filter(Boolean).join(" ");
    expect(display).toBe("Klaus Mustermann");
  });

  it("also returns salutation and title for iroc customers in the combined list", async () => {
    const irocCustomer = {
      id:         10,
      salutation: "Herr",
      title:      "Prof. Dr.",
      name:       "Mustermann",
      company:    null,
      email:      "prof.mustermann@example.com",
      country:    "DE",
      city:       "Berlin",
      isEu:       false,
      vatId:      null,
      createdAt:  new Date("2026-01-01"),
      updatedAt:  new Date("2026-01-01"),
    };
    stageDbSelects([irocCustomer], []);

    const res = await request(app)
      .get("/api/iroc/customers-combined")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    const [entry] = res.body as Array<{ source: string; salutation: string | null; title: string | null; name: string }>;

    expect(entry.source).toBe("iroc");
    expect(entry.salutation).toBe("Herr");
    expect(entry.title).toBe("Prof. Dr.");

    const display = [entry.salutation, entry.title, entry.name].filter(Boolean).join(" ");
    expect(display).toBe("Herr Prof. Dr. Mustermann");
  });
});
