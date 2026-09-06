import { describe, expect, it } from "vitest";
import { filterCustomerInvoices } from "./CustomerDetail";

describe("filterCustomerInvoices", () => {
  it("shows mapped legacy invoices without matching unrelated customer ID values", () => {
    const invoices = [
      { websiteCustomerId: 42, customerId: 11 },
      { websiteCustomerId: null, customerId: 7 },
      { websiteCustomerId: null, customerId: 42 },
      { websiteCustomerId: 99, customerId: 7 },
    ];

    expect(filterCustomerInvoices(invoices, 42, 7)).toEqual([
      invoices[0],
      invoices[1],
    ]);
  });
});