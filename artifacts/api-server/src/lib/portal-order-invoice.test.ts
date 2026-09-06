import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockConnect, mockGenerateInvoiceNumber, mockClientQuery, mockRelease } = vi.hoisted(() => {
  const mockClientQuery = vi.fn();
  const mockRelease = vi.fn();
  return {
    mockClientQuery,
    mockRelease,
    mockConnect: vi.fn().mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease,
    }),
    mockGenerateInvoiceNumber: vi.fn().mockResolvedValue("2026-0101"),
  };
});

vi.mock("@workspace/db", () => ({
  pool: { connect: mockConnect },
}));

vi.mock("../routes/iroc.js", () => ({
  generateInvoiceNumber: mockGenerateInvoiceNumber,
}));

vi.mock("./sally-invoice.js", () => ({
  canonicalCountry: (country: string | null) => country || "DE",
}));

vi.mock("./recipient-language.js", () => ({
  recipientLanguageForCountry: (country: string | null) => country === "DE" || country === "AT" ? "de" : "en",
}));

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

import { createPortalOrderAndDraftInvoice } from "./portal-order-invoice";

const input = {
  customer: {
    id: 25,
    customerNr: "DOC10025",
    institutionName: "Example Clinic",
    firstName: "Ada",
    lastName: "Example",
    country: "DE",
    instrument: "spirecut",
    ustIdNr: null,
    isPublicAuthority: false,
    defaultBuyerReference: null,
  },
  contactName: "Ada Example",
  contactEmail: "ada@example.com",
  contactPhone: "+49 30 123456",
  deliveryAddress: "Clinic Street 1\n10115 Berlin",
  notes: null,
  products: [{
    id: 7,
    sku: "SPI-CT",
    nameEn: "Spirecut CT",
    nameDe: "Spirecut CT",
    descriptionEn: "English description",
    descriptionDe: "Deutsche Beschreibung",
    unitPrice: "100.00",
    category: "spirecut",
    quantity: 2,
  }],
};

beforeEach(() => {
  mockClientQuery.mockReset();
  mockConnect.mockClear();
  mockGenerateInvoiceNumber.mockClear();
  mockRelease.mockClear();
});

describe("createPortalOrderAndDraftInvoice", () => {
  it("commits the order, draft invoice, and invoice items atomically", async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO iroc_orders")) return { rows: [{ id: 101 }] };
      if (sql.includes("INSERT INTO iroc_invoices")) return { rows: [{ id: 202 }] };
      return { rows: [] };
    });

    await expect(createPortalOrderAndDraftInvoice(input)).resolves.toEqual({
      orderId: 101,
      invoiceId: 202,
      invoiceNumber: "2026-0101",
      invoiceStatus: "draft",
    });

    const statements = mockClientQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toBe("BEGIN");
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringContaining("INSERT INTO iroc_orders"),
      expect.stringContaining("INSERT INTO iroc_invoices"),
      expect.stringContaining("INSERT INTO iroc_invoice_items"),
      expect.stringContaining("INSERT INTO iroc_notifications"),
      "COMMIT",
    ]));
    expect(statements).not.toContain("ROLLBACK");
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it("keeps the Portal order but skips the invoice when automation is paused", async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO iroc_orders")) return { rows: [{ id: 303 }] };
      return { rows: [] };
    });

    await expect(createPortalOrderAndDraftInvoice(input, { createInvoice: false })).resolves.toEqual({
      orderId: 303,
      invoiceId: null,
      invoiceNumber: null,
      invoiceStatus: null,
    });

    const statements = mockClientQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements).not.toContain(expect.stringContaining("INSERT INTO iroc_invoices"));
    expect(statements).not.toContain(expect.stringContaining("INSERT INTO iroc_invoice_items"));
    expect(statements).toContain("COMMIT");
  });

  it("carries the latest positive discount for each matching customer product", async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("DISTINCT ON (ii.product_id)")) {
        return { rows: [{ product_id: 7, discount_percent: "15.00" }] };
      }
      if (sql.includes("INSERT INTO iroc_orders")) return { rows: [{ id: 101 }] };
      if (sql.includes("INSERT INTO iroc_invoices")) return { rows: [{ id: 202 }] };
      return { rows: [] };
    });

    await createPortalOrderAndDraftInvoice(input);

    const invoiceInsert = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO iroc_invoices"),
    );
    expect(invoiceInsert?.[1]).toEqual(expect.arrayContaining(["170.00", "19.00", "32.30", "202.30"]));

    const itemInsert = mockClientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO iroc_invoice_items"),
    );
    expect(itemInsert?.[1]).toEqual(expect.arrayContaining(["100.00", "15.00", 2, "170.00", "19.00"]));
  });

  it("rolls the entire transaction back when an invoice item cannot be inserted", async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO iroc_orders")) return { rows: [{ id: 101 }] };
      if (sql.includes("INSERT INTO iroc_invoices")) return { rows: [{ id: 202 }] };
      if (sql.includes("INSERT INTO iroc_invoice_items")) throw new Error("item insert failed");
      return { rows: [] };
    });

    await expect(createPortalOrderAndDraftInvoice(input)).rejects.toThrow("item insert failed");
    const statements = mockClientQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(mockRelease).toHaveBeenCalledOnce();
  });
});