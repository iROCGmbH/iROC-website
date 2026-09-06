/**
 * Confirmation test: GET /iroc/invoices/:id/delivery-note reads the DB row
 * written by the preceding PUT, not stale cached data.
 *
 * What & Why
 * ──────────
 * The delivery-note endpoint performs a fresh SELECT on every request — no
 * response cache, no in-process memo.  This test confirms:
 *
 *   1. After a PUT that switches the linked websiteCustomerId (and therefore
 *      the customer's billing address), a subsequent GET /delivery-note shows
 *      the NEW customer's address, not the pre-edit address.
 *   2. Two consecutive GET /delivery-note calls served with different DB rows
 *      produce different outputs — proving the endpoint never re-uses a prior
 *      response.
 *
 * Strategy
 * ────────
 * PDFKit output is FlateDecode-compressed, so we mock PDFDocument and capture
 * every `.text()` call.  The db layer is mocked with staged `mockReturnValueOnce`
 * chains that simulate the DB state before and after the edit.
 *
 * Follows the MockPDFDocument / selectChain pattern from
 * invoice-pdf-reflects-saved-edits.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import crypto from "crypto";

// ── Hoist ALL mock-factory state ──────────────────────────────────────────────
const {
  pdfState,
  mockDbSelect,
  mockDbUpdate,
  updateReturning,
  mockDbDelete,
  mockDbInsert,
} = vi.hoisted(() => {
  const pdfState = { capturedText: [] as string[] };

  // select chain — staged per-call in tests via mockReturnValueOnce
  const mockDbSelect = vi.fn();

  // update chain: db.update(t).set({}).where({}).returning()
  const updateReturning = vi.fn();
  const updateWhere     = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet       = vi.fn().mockReturnValue({ where: updateWhere });
  const mockDbUpdate    = vi.fn().mockReturnValue({ set: updateSet });

  // delete chain: db.delete(t).where({})
  const deleteWhere  = vi.fn().mockResolvedValue([]);
  const mockDbDelete = vi.fn().mockReturnValue({ where: deleteWhere });

  // insert chain: db.insert(t).values([...])
  const insertValues = vi.fn().mockResolvedValue([]);
  const mockDbInsert = vi.fn().mockReturnValue({ values: insertValues });

  return {
    pdfState,
    mockDbSelect,
    mockDbUpdate, updateReturning,
    mockDbDelete,
    mockDbInsert,
  };
});

// ── Mock pdfkit ───────────────────────────────────────────────────────────────
vi.mock("pdfkit", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough } = require("stream") as typeof import("stream");

  class MockPDFDocument extends PassThrough {
    page = { width: 595.28, height: 841.89 };
    y = 0;

    constructor(_opts?: unknown) { super(); }

    text(str: string, ..._rest: unknown[]) {
      if (typeof str === "string") pdfState.capturedText.push(str);
      return this;
    }

    font()               { return this; }
    fontSize()           { return this; }
    fillColor()          { return this; }
    strokeColor()        { return this; }
    lineWidth()          { return this; }
    save()               { return this; }
    restore()            { return this; }
    rotate()             { return this; }
    addPage()            { return this; }
    image()              { return this; }
    moveTo()             { return this; }
    lineTo()             { return this; }
    rect()               { return this; }
    clip()               { return this; }
    stroke()             { return this; }
    fill()               { return this; }
    heightOfString()     { return 10; }
    widthOfString()      { return 10; }
    opacity()            { return this; }
    switchToPage()       { return this; }
    flushPages()         { return this; }
    bufferedPageRange()  { return { start: 0, count: 1 }; }
    end(cb?: () => void) { super.end(cb); return this; }
  }

  return { default: MockPDFDocument };
});

// ── Mock @workspace/db ────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    delete: mockDbDelete,
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

/** Minimal website-customer with OLD billing address. */
const WC_OLD = {
  id:                      5,
  customerNr:              "WC-005",
  salutation:              "Herr",
  title:                   null,
  firstName:               "OldFirst",
  lastName:                "OldLast",
  institutionName:         null,
  specialty:               null,
  institutionType:         null,
  address:                 "Alte Str. 1",
  postalCode:              "10001",
  city:                    "Berlin",
  country:                 "Deutschland",
  phone:                   null,
  fax:                     null,
  email:                   "old@example.com",
  website:                 null,
  referenceNumber:         null,
  ustIdNr:                 null,
  instrument:              "iroc",
  notes:                   null,
  privacyConsent:          true,
  isEu:                    false,
  shippingFirstName:       null,
  shippingLastName:        null,
  shippingInstitutionName: null,
  shippingAddress:         null,
  shippingPostalCode:      null,
  shippingCity:            null,
  shippingCountry:         null,
  shippingPhone:           null,
  shippingEmail:           null,
  createdAt:               new Date(),
};

/** Minimal website-customer with NEW billing address (used after the PUT). */
const WC_NEW = {
  ...WC_OLD,
  id:          9,
  customerNr:  "WC-009",
  firstName:   "NewFirst",
  lastName:    "NewLast",
  address:     "Neue Str. 99",
  postalCode:  "20095",
  city:        "Hamburg",
  country:     "Deutschland",
  email:       "new@example.com",
};

/** Invoice linked to WC_OLD before the PUT. */
const invoiceBefore = {
  id:                1,
  invoiceNumber:     "2026-0077",
  invoiceType:       "domestic",
  language:          "de",
  issueDate:         "2026-08-05",
  dueDate:           null,
  orderNumber:       null,
  referenceNumber:   null,
  shippingMethod:    null,
  reasonForExport:   null,
  termsOfDelivery:   null,
  websiteCustomerId: WC_OLD.id,
  customerId:        null,
  status:            "draft",
  subtotal:          "100.00",
  vatRate:           "19.00",
  vatAmount:         "19.00",
  total:             "119.00",
  deliveryCosts:     "0.00",
  insuranceCosts:    "0.00",
  notes:             null,
  vatNote:           null,
  createdAt:         new Date(),
  updatedAt:         new Date(),
};

/** Invoice after the PUT — now linked to WC_NEW. */
const invoiceAfter = {
  ...invoiceBefore,
  websiteCustomerId: WC_NEW.id,
  updatedAt:         new Date(),
};

/** A single line item (content unimportant for address assertions). */
const item = {
  id:              1,
  invoiceId:       1,
  productId:       null,
  productName:     "Implant Kit",
  sku:             null,
  description:     null,
  lotNumber:       null,
  hsCode:          null,
  countryOfOrigin: null,
  weightKg:        null,
  unitPrice:       "100.00",
  discountPercent: null,
  isDemo:          false,
  quantity:        1,
  lineTotal:       "100.00",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fluent select-chain that always resolves to `result`.
 * Mirrors the helper used in invoice-pdf-reflects-saved-edits.test.ts.
 */
function selectChain(result: unknown[]) {
  const p = Promise.resolve(result);
  type AnyFn = ReturnType<typeof vi.fn>;
  interface Chain {
    from: AnyFn; where: AnyFn; leftJoin: AnyFn; innerJoin: AnyFn;
    orderBy: AnyFn; limit: AnyFn;
    then: typeof p.then; catch: typeof p.catch; finally: typeof p.finally;
  }
  const c = {
    then: p.then.bind(p), catch: p.catch.bind(p), finally: p.finally.bind(p),
  } as unknown as Chain;
  c.from      = vi.fn().mockReturnValue(c);
  c.where     = vi.fn().mockReturnValue(c);
  c.leftJoin  = vi.fn().mockReturnValue(c);
  c.innerJoin = vi.fn().mockReturnValue(c);
  c.orderBy   = vi.fn().mockReturnValue(c);
  c.limit     = vi.fn().mockResolvedValue(result);
  return c;
}

/** PUT body: domestic DE invoice re-linked to WC_NEW. */
const putBody = {
  websiteCustomerId: WC_NEW.id,
  invoiceType:       "domestic",
  language:          "de",
  issueDate:         "2026-08-05",
  dueDate:           null,
  orderNumber:       null,
  referenceNumber:   null,
  shippingMethod:    null,
  reasonForExport:   null,
  termsOfDelivery:   null,
  deliveryCosts:     "0.00",
  vatRate:           "19.00",
  notes:             null,
  vatNote:           null,
  items: [{
    productId:       null,
    productName:     "Implant Kit",
    sku:             null,
    description:     null,
    lotNumber:       null,
    hsCode:          null,
    countryOfOrigin: null,
    weightKg:        null,
    unitPrice:       "100.00",
    discountPercent: null,
    isDemo:          false,
    quantity:        1,
  }],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /iroc/invoices/:id/delivery-note — reads DB row from preceding PUT, not stale data", () => {
  beforeEach(() => {
    pdfState.capturedText = [];
    mockDbSelect.mockReset();
    updateReturning.mockReset();
  });

  it("delivery note downloaded after a customer re-link reflects the new address, not the pre-edit address", async () => {
    // ── Stage PUT db calls ────────────────────────────────────────────────
    // PUT /iroc/invoices/1:
    //   1. select existing invoice
    //   2. select websiteCustomer (WC_NEW — the one being linked)
    //   3. update invoice .returning()
    //   4. delete items (delete chain — no select needed)
    //   5. insert items (insert chain — no select needed)
    //   6. select updated items (for response body)
    mockDbSelect
      .mockReturnValueOnce(selectChain([invoiceBefore]))  // existing-invoice check
      .mockReturnValueOnce(selectChain([WC_NEW]))          // new websiteCustomer lookup
      .mockReturnValueOnce(selectChain([item]));           // items select after upsert

    // db.update().set().where().returning() → updated invoice
    updateReturning.mockResolvedValueOnce([invoiceAfter]);

    // ── Execute PUT ───────────────────────────────────────────────────────
    const putRes = await request(app)
      .put("/api/iroc/invoices/1")
      .set("Authorization", AUTH)
      .send(putBody);

    expect(putRes.status).toBe(200);

    // ── Stage GET /delivery-note db calls with the UPDATED invoice ────────
    // GET /delivery-note: select invoice → select websiteCustomer → select items
    mockDbSelect
      .mockReturnValueOnce(selectChain([invoiceAfter]))   // fresh row — now linked to WC_NEW
      .mockReturnValueOnce(selectChain([WC_NEW]))          // WC_NEW customer
      .mockReturnValueOnce(selectChain([item]));           // line items

    // ── Request the delivery note ─────────────────────────────────────────
    const dnRes = await request(app)
      .get("/api/iroc/invoices/1/delivery-note")
      .set("Authorization", AUTH);

    expect(dnRes.status).toBe(200);
    expect(dnRes.headers["content-type"]).toMatch(/pdf/);

    const allText = pdfState.capturedText.join("\n");

    // New customer address must appear in the delivery note.
    // wcToCustomerShape joins firstName + lastName → name; buildDeliveryNotePDF
    // prepends salutation, so the rendered line is "Herr NewFirst NewLast".
    expect(allText).toContain("NewFirst NewLast");
    expect(allText).toContain("Neue Str. 99");
    expect(allText).toContain("20095 Hamburg");

    // Pre-edit (old) address must NOT appear — confirms no stale data
    expect(allText).not.toContain("OldFirst");
    expect(allText).not.toContain("Alte Str. 1");
    expect(allText).not.toContain("10001 Berlin");
  });

  it("delivery note downloaded after saving a linked custom name keeps both saved item names", async () => {
    const customItem = {
      ...item,
      productId: 7,
      productName: "Customer-specific product name",
      description: "Customer-specific product description",
    };
    const canonicalItem = {
      ...item,
      id: 2,
      productId: 8,
      productName: "Medical Device",
    };

    mockDbSelect
      .mockReturnValueOnce(selectChain([invoiceAfter]))
      .mockReturnValueOnce(selectChain([WC_NEW]))
      .mockReturnValueOnce(selectChain([customItem, canonicalItem]));

    const deliveryNoteRes = await request(app)
      .get("/api/iroc/invoices/1/delivery-note")
      .set("Authorization", AUTH);

    expect(deliveryNoteRes.status).toBe(200);
    expect(deliveryNoteRes.headers["content-type"]).toMatch(/pdf/);

    const allText = pdfState.capturedText.join("\n");
    expect(allText).toContain("Customer-specific product name");
    expect(allText).toContain("Medical Device");
  });

  it("two consecutive GET /delivery-note calls produce different outputs when the DB row changes between them", async () => {
    // ── First GET: invoice still linked to WC_OLD ─────────────────────────
    mockDbSelect
      .mockReturnValueOnce(selectChain([invoiceBefore]))  // invoice linked to WC_OLD
      .mockReturnValueOnce(selectChain([WC_OLD]))          // WC_OLD customer
      .mockReturnValueOnce(selectChain([]));               // no items needed

    const res1 = await request(app)
      .get("/api/iroc/invoices/1/delivery-note")
      .set("Authorization", AUTH);

    expect(res1.status).toBe(200);
    const text1 = pdfState.capturedText.join("\n");

    // Old address in first response
    expect(text1).toContain("OldFirst OldLast");
    expect(text1).toContain("Alte Str. 1");

    // ── Reset and stage updated DB row (linked to WC_NEW) ─────────────────
    pdfState.capturedText = [];

    mockDbSelect
      .mockReturnValueOnce(selectChain([invoiceAfter]))   // DB now holds updated row
      .mockReturnValueOnce(selectChain([WC_NEW]))          // WC_NEW customer
      .mockReturnValueOnce(selectChain([item]));

    const res2 = await request(app)
      .get("/api/iroc/invoices/1/delivery-note")
      .set("Authorization", AUTH);

    expect(res2.status).toBe(200);
    const text2 = pdfState.capturedText.join("\n");

    // New address must appear in the second delivery note
    expect(text2).toContain("NewFirst NewLast");
    expect(text2).toContain("Neue Str. 99");

    // Old address must NOT appear — confirms the endpoint re-queries the DB every time
    expect(text2).not.toContain("OldFirst");
    expect(text2).not.toContain("Alte Str. 1");
  });
});
