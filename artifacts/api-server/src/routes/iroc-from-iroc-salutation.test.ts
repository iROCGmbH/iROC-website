/**
 * Regression test: POST /iroc/website-customers/from-iroc — salutation + title propagation
 *
 * Confirms three behaviours of the back-fill logic at the from-iroc endpoint:
 *
 *  1. When no matching website_customer exists, the INSERT payload sent to the
 *     database includes the salutation and title from the source iroc_customer.
 *
 *  2. When a matching website_customer exists but is missing salutation and/or
 *     title, the UPDATE SET payload contains only the missing fields from the
 *     source iroc_customer — not the fields already present.
 *
 *  3. When a matching website_customer already has both salutation and title,
 *     db.update() is never called and the existing values are preserved.
 *
 *  4. When an administrator corrects the salutation between imports while the
 *     title remains missing, a repeat import back-fills only the title.
 *
 * The relevant tests assert on the arguments passed TO the database helpers
 * (mockInsertValues / mockUpdateSet), not just on the HTTP response body.
 * This ensures the production code cannot silently drop the fields and still
 * pass the tests by returning a pre-seeded mock object.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist mock-factory state ──────────────────────────────────────────────────
const {
  mockUpdateReturning,
  mockUpdateWhere,
  mockUpdateSet,
  mockDbUpdate,
  mockInsertReturning,
  mockInsertValues,
  mockDbInsert,
  mockOnConflictDoNothing,
  mockWhere,
  mockFrom,
  mockDbSelect,
  mockIsNull,
  mockWebsiteCustomersTable,
  mockPoolQuery,
} = vi.hoisted(() => {
  // update chain: db.update(t).set(patch).where(cond).returning()
  const mockUpdateReturning = vi.fn();
  const mockUpdateWhere     = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
  const mockUpdateSet       = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockDbUpdate        = vi.fn().mockReturnValue({ set: mockUpdateSet });

  // insert chain: db.insert(t).values(row).returning()
  const mockInsertReturning = vi.fn();
  const mockOnConflictDoNothing = vi.fn();
  const mockInsertValues    = vi.fn().mockReturnValue({
    returning: mockInsertReturning,
    onConflictDoNothing: mockOnConflictDoNothing,
  });
  const mockDbInsert        = vi.fn().mockReturnValue({ values: mockInsertValues });

  // select chain: db.select(...).from(t).where(cond) — awaitable directly
  const mockWhere    = vi.fn();
  const mockFrom     = vi.fn().mockReturnValue({ where: mockWhere });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockFrom });
  const mockIsNull = vi.fn((column: unknown) => ({ __isNull: column }));
  const mockPoolQuery = vi.fn();
  const mockWebsiteCustomersTable = {
    id: "website_customers.id",
    email: "website_customers.email",
    salutation: "website_customers.salutation",
    title: "website_customers.title",
  };

  return {
    mockUpdateReturning, mockUpdateWhere, mockUpdateSet, mockDbUpdate,
    mockInsertReturning, mockInsertValues, mockDbInsert, mockOnConflictDoNothing,
    mockWhere, mockFrom, mockDbSelect, mockIsNull, mockWebsiteCustomersTable, mockPoolQuery,
  };
});

// ── Mock @workspace/db ────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    transaction: async (callback: (tx: {
      insert: typeof mockDbInsert;
      select: typeof mockDbSelect;
      update: typeof mockDbUpdate;
    }) => unknown) => callback({
      insert: mockDbInsert,
      select: mockDbSelect,
      update: mockDbUpdate,
    }),
  },
  pool: { query: mockPoolQuery },
  irocInvoices:               {},
  irocInvoiceItems:           {},
  irocCustomers:              {},
  irocCustomerWebsiteLinks:   {},
  websiteCustomersTable:      mockWebsiteCustomersTable,
  irocAppUsers:               {},
  irocNotifications:          {},
  settingsTable:              {},
  irocProducts:               {},
  irocInventoryLots:          {},
  irocLeads:                  {},
  irocTrainingOffers:         {},
  trainingRegistrationsTable: {},
  trainedDoctorsTable:        {},
}));

vi.mock("drizzle-orm", async importOriginal => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, isNull: mockIsNull };
});

vi.mock("../lib/reorder-code", () => ({
  generateUniqueReorderCode: vi.fn().mockResolvedValue("REORDER42"),
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Source iroc_customer with salutation and title set. */
const irocCustomerFull = {
  id:         7,
  salutation: "Herr",
  title:      "Dr. med",
  name:       "Mustermann",
  company:    "Muster Klinik",
  email:      "mustermann@example.com",
  address:    "Musterstr. 1",
  postalCode: "80331",
  city:       "München",
  country:    "DE",
  phone:      null,
  vatId:      null,
  isEu:       true,
  notes:      null,
  createdAt:  new Date("2025-01-01"),
  updatedAt:  new Date("2025-01-01"),
};

/** Existing website_customer with NEITHER salutation NOR title. */
const existingWcNoSalutation = {
  id:              42,
  customerNr:      "2025-0001",
  salutation:      null,   // missing → should be patched
  title:           null,   // missing → should be patched
  firstName:       "Maria",
  lastName:        "Mustermann",
  institutionName: null,
  institutionType: null,
  specialty:       null,
  address:         "Musterstr. 1",
  postalCode:      "80331",
  city:            "München",
  country:         "DE",
  phone:           null,
  fax:             null,
  email:           "mustermann@example.com",
  website:         null,
  referenceNumber: null,
  ustIdNr:         null,
  instrument:      "other",
  notes:           null,
  privacyConsent:  true,
  shippingFirstName: null, shippingLastName: null, shippingInstitutionName: null,
  shippingAddress: null, shippingPostalCode: null, shippingCity: null,
  shippingCountry: null, shippingPhone: null, shippingEmail: null,
  createdAt:       new Date("2025-06-01"),
};

/** Existing website_customer that already has BOTH salutation AND title. */
const existingWcWithBoth = {
  ...existingWcNoSalutation,
  salutation: "Frau",    // already set — must not be overwritten
  title:      "Prof.",   // already set — must not be overwritten
};

/** Existing website_customer with a title but no salutation. */
const existingWcWithTitleOnly = {
  ...existingWcNoSalutation,
  salutation: null,      // missing → should be patched
  title:      "Prof.",   // already set — must not be overwritten
};

/** Existing website_customer with a salutation but no title. */
const existingWcWithSalutationOnly = {
  ...existingWcNoSalutation,
  salutation: "Frau",    // already set — must not be overwritten
  title:      null,      // missing → should be patched
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/iroc/website-customers/from-iroc — salutation + title propagation", () => {
  beforeEach(() => {
    // Reset select-chain mocks
    mockWhere.mockReset();
    mockFrom.mockReset().mockReturnValue({ where: mockWhere });
    mockDbSelect.mockReturnValue({ from: mockFrom });
    mockIsNull.mockReset().mockImplementation((column: unknown) => ({ __isNull: column }));
    mockPoolQuery.mockReset();

    // Reset update-chain mocks
    mockUpdateReturning.mockReset();
    mockUpdateWhere.mockReset().mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReset().mockReturnValue({ where: mockUpdateWhere });
    mockDbUpdate.mockReset().mockReturnValue({ set: mockUpdateSet });

    // Reset insert-chain mocks
    mockInsertReturning.mockReset();
    mockOnConflictDoNothing.mockReset().mockResolvedValue(undefined);
    mockInsertValues.mockReset().mockReturnValue({
      returning: mockInsertReturning,
      onConflictDoNothing: mockOnConflictDoNothing,
    });
    mockDbInsert.mockReset().mockReturnValue({ values: mockInsertValues });
  });

  // ── Test 1: creation path ───────────────────────────────────────────────────
  it("passes salutation and title from the iroc_customer to the INSERT payload when no website_customer exists", async () => {
    // Call 1: irocCustomers lookup → [irocCustomerFull]
    // Call 2: normalized website email lookup → [] (no existing record)
    // Call 3: normalized legacy email lookup → [source customer]
    // Call 4: existing mapping lookup → []
    // Call 5: nextCustomerNr() websiteCustomersTable → [{ maxNr: null }]
    mockWhere
      .mockResolvedValueOnce([irocCustomerFull])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ maxNr: null }])
      .mockResolvedValueOnce([{ irocCustomerId: 7 }])
      .mockResolvedValueOnce([{ websiteCustomerId: 99 }]);

    // Insert returns a minimal stub — the test cares about the VALUES sent, not the response
    const insertedRow = { ...existingWcNoSalutation, id: 99, salutation: "Herr", title: "Dr. med", createdAt: new Date() };
    mockInsertReturning.mockResolvedValueOnce([insertedRow]);

    const res = await request(app)
      .post("/api/iroc/website-customers/from-iroc")
      .set("Authorization", AUTH)
      .send({ irocCustomerId: 7 });

    expect(res.status).toBe(201);

    // The critical assertion: production code must pass the source customer's
    // salutation and title to the database, not just return them from the stub.
    const insertedPayload = mockInsertValues.mock.calls
      .map(([payload]) => payload as Record<string, unknown>)
      .find(payload => "salutation" in payload);
    expect(insertedPayload).toBeDefined();
    if (!insertedPayload) throw new Error("Expected a website customer insert payload");
    expect(insertedPayload.salutation).toBe("Herr");
    expect(insertedPayload.title).toBe("Dr. med");
    expect(insertedPayload.reorderCode).toBe("REORDER42");
    expect(mockInsertValues).toHaveBeenCalledWith({
      irocCustomerId: 7,
      websiteCustomerId: 99,
    });
  });

  it("removes the title from a legacy full name before splitting first and last names", async () => {
    const titledLegacyCustomer = {
      ...irocCustomerFull,
      title: "Dr.",
      name: "Dr. Max Mustermann",
    };
    mockWhere
      .mockResolvedValueOnce([titledLegacyCustomer])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ maxNr: null }])
      .mockResolvedValueOnce([{ irocCustomerId: 7 }])
      .mockResolvedValueOnce([{ websiteCustomerId: 99 }]);
    mockInsertReturning.mockResolvedValueOnce([{
      ...existingWcNoSalutation,
      id: 99,
      title: "Dr.",
      firstName: "Max",
      lastName: "Mustermann",
      createdAt: new Date(),
    }]);

    const res = await request(app)
      .post("/api/iroc/website-customers/from-iroc")
      .set("Authorization", AUTH)
      .send({ irocCustomerId: 7 });

    expect(res.status).toBe(201);
    const insertedPayload = mockInsertValues.mock.calls
      .map(([payload]) => payload as Record<string, unknown>)
      .find(payload => "salutation" in payload);
    expect(insertedPayload).toMatchObject({
      title: "Dr.",
      firstName: "Max",
      lastName: "Mustermann",
    });
  });

  // ── Test 2: back-fill path ──────────────────────────────────────────────────
  it("passes only the missing fields to db.update() when an existing website_customer lacks salutation and title", async () => {
    // Call 1: irocCustomers lookup → [irocCustomerFull]
    // Call 2: normalized website email lookup → [existingWcNoSalutation]
    // Call 3: normalized legacy email lookup → [source customer]
    // (salutation=null, title=null → both are missing → needsUpdate=true)
    mockWhere
      .mockResolvedValueOnce([irocCustomerFull])
      .mockResolvedValueOnce([existingWcNoSalutation])
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([{ irocCustomerId: 7 }])
      .mockResolvedValueOnce([{ websiteCustomerId: 42 }]);

    // Update returns the patched record
    const patchedRow = { ...existingWcNoSalutation, salutation: "Herr", title: "Dr. med" };
    mockUpdateReturning.mockResolvedValueOnce([patchedRow]);

    const res = await request(app)
      .post("/api/iroc/website-customers/from-iroc")
      .set("Authorization", AUTH)
      .send({ irocCustomerId: 7 });

    expect(res.status).toBe(200);

    // One update back-fills the profile, while another associates legacy
    // invoices with the verified customer mapping.
    expect(mockDbUpdate).toHaveBeenCalledTimes(2);

    // The profile SET payload must include both missing fields. The invoice
    // link update is deliberately performed first inside the transaction.
    const setPatch = mockUpdateSet.mock.calls
      .map(([patch]) => patch as Record<string, unknown>)
      .find(patch => "salutation" in patch);
    expect(setPatch).toBeDefined();
    if (!setPatch) throw new Error("Expected a website customer profile patch");
    expect(setPatch.salutation).toBe("Herr");
    expect(setPatch.title).toBe("Dr. med");
  });

  it("back-fills salutation while preserving an existing website_customer title", async () => {
    // Call 1: irocCustomers lookup → [irocCustomerFull]
    // Call 2: normalized website email lookup → [existingWcWithTitleOnly]
    // Call 3: normalized legacy email lookup → [source customer]
    // (salutation=null, title="Prof." → only salutation needs updating)
    mockWhere
      .mockResolvedValueOnce([irocCustomerFull])
      .mockResolvedValueOnce([existingWcWithTitleOnly])
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([{ irocCustomerId: 7 }])
      .mockResolvedValueOnce([{ websiteCustomerId: 42 }]);

    const patchedRow = { ...existingWcWithTitleOnly, salutation: "Herr" };
    mockUpdateReturning.mockResolvedValueOnce([patchedRow]);

    const res = await request(app)
      .post("/api/iroc/website-customers/from-iroc")
      .set("Authorization", AUTH)
      .send({ irocCustomerId: 7 });

    expect(res.status).toBe(200);
    expect(mockDbUpdate).toHaveBeenCalled();

    // The profile update must patch only the missing salutation.
    const setPatch = mockUpdateSet.mock.calls
      .map(([patch]) => patch as Record<string, unknown>)
      .find(patch => "salutation" in patch);
    expect(setPatch).toEqual({ salutation: "Herr" });

    // The response reflects the patched salutation and preserves the existing title.
    expect(res.body.salutation).toBe("Herr");
    expect(res.body.title).toBe("Prof.");
  });

  it("back-fills title while preserving an existing website_customer salutation", async () => {
    // Call 1: irocCustomers lookup → [irocCustomerFull]
    // Call 2: normalized website email lookup → [existingWcWithSalutationOnly]
    // Call 3: normalized legacy email lookup → [source customer]
    // (salutation="Frau", title=null → only title needs updating)
    mockWhere
      .mockResolvedValueOnce([irocCustomerFull])
      .mockResolvedValueOnce([existingWcWithSalutationOnly])
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([{ irocCustomerId: 7 }])
      .mockResolvedValueOnce([{ websiteCustomerId: 42 }]);

    const patchedRow = { ...existingWcWithSalutationOnly, title: "Dr. med" };
    mockUpdateReturning.mockResolvedValueOnce([patchedRow]);

    const res = await request(app)
      .post("/api/iroc/website-customers/from-iroc")
      .set("Authorization", AUTH)
      .send({ irocCustomerId: 7 });

    expect(res.status).toBe(200);
    expect(mockDbUpdate).toHaveBeenCalled();

    // The profile update must patch only the missing title.
    const setPatch = mockUpdateSet.mock.calls
      .map(([patch]) => patch as Record<string, unknown>)
      .find(patch => "title" in patch);
    expect(setPatch).toEqual({ title: "Dr. med" });

    // The response preserves the existing salutation and returns the imported title.
    expect(res.body.salutation).toBe("Frau");
    expect(res.body.title).toBe("Dr. med");
  });

  it("preserves an admin correction when the conditional back-fill loses a race", async () => {
    // The initial lookup sees both fields as missing. Before this import's
    // UPDATE is applied, an admin fills both values. PostgreSQL then returns
    // no row for the IS NULL-guarded UPDATE, so the endpoint must re-read the
    // customer instead of treating the stale lookup as authoritative.
    const adminCorrectedRow = {
      ...existingWcNoSalutation,
      salutation: "Frau",
      title: "Prof.",
    };
    mockWhere
      .mockResolvedValueOnce([irocCustomerFull])
      .mockResolvedValueOnce([existingWcNoSalutation])
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([{ irocCustomerId: 7 }])
      .mockResolvedValueOnce([{ websiteCustomerId: 42 }])
      .mockResolvedValueOnce([adminCorrectedRow]);
    mockUpdateReturning.mockResolvedValueOnce([]);

    const res = await request(app)
      .post("/api/iroc/website-customers/from-iroc")
      .set("Authorization", AUTH)
      .send({ irocCustomerId: 7 });

    expect(res.status).toBe(200);
    expect(res.body.salutation).toBe("Frau");
    expect(res.body.title).toBe("Prof.");

    const guardedFields = mockIsNull.mock.calls
      .map(([column]) => column)
      .filter(column =>
        column === mockWebsiteCustomersTable.salutation
        || column === mockWebsiteCustomersTable.title,
      );
    expect(guardedFields).toEqual([
      mockWebsiteCustomersTable.salutation,
      mockWebsiteCustomersTable.title,
    ]);
  });

  // ── Test 3: no-overwrite path ───────────────────────────────────────────────
  it("does not patch profile fields when the repeat-import source fields are blank", async () => {
    const blankSource = { ...irocCustomerFull, salutation: "  ", title: " " };
    mockWhere
      .mockResolvedValueOnce([blankSource])
      .mockResolvedValueOnce([existingWcNoSalutation])
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([{ irocCustomerId: 7 }])
      .mockResolvedValueOnce([{ websiteCustomerId: 42 }]);

    const res = await request(app)
      .post("/api/iroc/website-customers/from-iroc")
      .set("Authorization", AUTH)
      .send({ irocCustomerId: 7 });

    expect(res.status).toBe(200);
    const profilePatches = mockUpdateSet.mock.calls
      .map(([patch]) => patch as Record<string, unknown>)
      .filter((patch) => "salutation" in patch || "title" in patch);
    expect(profilePatches).toEqual([]);
    expect(res.body.salutation).toBe(existingWcNoSalutation.salutation);
    expect(res.body.title).toBe(existingWcNoSalutation.title);
  });

  it("preserves admin-corrected salutation and title on a second import", async () => {
    // First import sees a website_customer missing both fields and back-fills
    // them from irocCustomerFull. After the admin corrects both values, the
    // second import sees the corrected record and must not patch either field.
    mockWhere
      // First import
      .mockResolvedValueOnce([irocCustomerFull])
      .mockResolvedValueOnce([existingWcNoSalutation])
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([{ irocCustomerId: 7 }])
      .mockResolvedValueOnce([{ websiteCustomerId: 42 }])
      // Second import, after the admin corrected the website customer
      .mockResolvedValueOnce([irocCustomerFull])
      .mockResolvedValueOnce([existingWcWithBoth])
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([{ irocCustomerId: 7 }])
      .mockResolvedValueOnce([{ websiteCustomerId: 42 }]);

    const patchedRow = { ...existingWcNoSalutation, salutation: "Herr", title: "Dr. med" };
    mockUpdateReturning.mockResolvedValueOnce([patchedRow]);

    const firstImport = await request(app)
      .post("/api/iroc/website-customers/from-iroc")
      .set("Authorization", AUTH)
      .send({ irocCustomerId: 7 });

    expect(firstImport.status).toBe(200);
    expect(firstImport.body.salutation).toBe("Herr");
    expect(firstImport.body.title).toBe("Dr. med");

    const secondImport = await request(app)
      .post("/api/iroc/website-customers/from-iroc")
      .set("Authorization", AUTH)
      .send({ irocCustomerId: 7 });

    expect(secondImport.status).toBe(200);

    // The mapping updates legacy invoice links on both imports, but only the
    // first import may update the website customer's salutation/title.
    const profilePatches = mockUpdateSet.mock.calls
      .map(([patch]) => patch as Record<string, unknown>)
      .filter(patch => "salutation" in patch || "title" in patch);
    expect(profilePatches).toEqual([
      { salutation: "Herr", title: "Dr. med" },
    ]);

    // The second response must contain the values corrected by the admin.
    expect(secondImport.body.salutation).toBe("Frau");
    expect(secondImport.body.title).toBe("Prof.");
  });

  it("preserves a later admin salutation correction while back-filling a missing title on repeat import", async () => {
    // First import sees a website_customer missing both fields and back-fills
    // them from irocCustomerFull. The administrator then corrects the
    // salutation and leaves the title missing before the repeat import.
    mockWhere
      // First import
      .mockResolvedValueOnce([irocCustomerFull])
      .mockResolvedValueOnce([existingWcNoSalutation])
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([{ irocCustomerId: 7 }])
      .mockResolvedValueOnce([{ websiteCustomerId: 42 }])
      // Repeat import after the salutation was corrected by an administrator
      .mockResolvedValueOnce([irocCustomerFull])
      .mockResolvedValueOnce([existingWcWithSalutationOnly])
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([{ irocCustomerId: 7 }])
      .mockResolvedValueOnce([{ websiteCustomerId: 42 }]);

    mockUpdateReturning
      .mockResolvedValueOnce([{
        ...existingWcNoSalutation,
        salutation: "Herr",
        title: "Dr. med",
      }])
      .mockResolvedValueOnce([{
        ...existingWcWithSalutationOnly,
        title: "Dr. med",
      }]);

    const firstImport = await request(app)
      .post("/api/iroc/website-customers/from-iroc")
      .set("Authorization", AUTH)
      .send({ irocCustomerId: 7 });

    expect(firstImport.status).toBe(200);

    const repeatImport = await request(app)
      .post("/api/iroc/website-customers/from-iroc")
      .set("Authorization", AUTH)
      .send({ irocCustomerId: 7 });

    expect(repeatImport.status).toBe(200);

    // The repeat import must not overwrite the administrator's salutation
    // correction while filling the title that is still missing.
    const profilePatches = mockUpdateSet.mock.calls
      .map(([patch]) => patch as Record<string, unknown>)
      .filter(patch => "salutation" in patch || "title" in patch);
    expect(profilePatches).toEqual([
      { salutation: "Herr", title: "Dr. med" },
      { title: "Dr. med" },
    ]);
    expect(repeatImport.body.salutation).toBe("Frau");
    expect(repeatImport.body.title).toBe("Dr. med");
  });

  it("guards lead qualification back-fills when an admin edits the customer after lookup", async () => {
    const racedCustomer = {
      ...existingWcNoSalutation,
      salutation: null as string | null,
      title: null as string | null,
    };
    const qualifiedLead = {
      id: 7,
      status: "qualified",
      email: racedCustomer.email,
      salutation: "Herr",
      medicalTitle: "Dr. med",
    };

    // Lead lookup, saved-offer lookup, then the existing customer lookup.
    mockWhere
      .mockResolvedValueOnce([qualifiedLead])
      .mockResolvedValueOnce([])
      .mockReturnValueOnce({
        limit: vi.fn().mockResolvedValueOnce([racedCustomer]),
      });
    mockPoolQuery.mockResolvedValue({ rows: [] });

    // Model the admin edit winning between the read and UPDATE. The database
    // predicate must then reject the stale qualification patch.
    mockUpdateWhere.mockImplementationOnce(() => {
      racedCustomer.salutation = "Frau";
      racedCustomer.title = "Prof.";
      return { returning: mockUpdateReturning };
    });

    const res = await request(app)
      .post("/api/iroc/leads/7/invoice-config")
      .set("Authorization", AUTH);

    expect(res.status).toBe(200);
    expect(res.body.websiteCustomerId).toBe(racedCustomer.id);
    expect(mockUpdateSet).toHaveBeenCalledWith({
      salutation: "Herr",
      title: "Dr. med",
    });

    const guardedFields = mockIsNull.mock.calls
      .map(([column]) => column)
      .filter(column =>
        column === mockWebsiteCustomersTable.salutation
        || column === mockWebsiteCustomersTable.title,
      );
    expect(guardedFields).toEqual([
      mockWebsiteCustomersTable.salutation,
      mockWebsiteCustomersTable.title,
    ]);
  });

  it("rejects ambiguous email matches before changing or linking a customer", async () => {
    mockWhere
      .mockResolvedValueOnce([irocCustomerFull])
      .mockResolvedValueOnce([
        existingWcNoSalutation,
        { ...existingWcNoSalutation, id: 43 },
      ])
      .mockResolvedValueOnce([{ id: 7 }]);

    const res = await request(app)
      .post("/api/iroc/website-customers/from-iroc")
      .set("Authorization", AUTH)
      .send({ irocCustomerId: 7 });

    expect(res.status).toBe(409);
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockDbInsert).not.toHaveBeenCalled();
  });
});
