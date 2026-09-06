import { describe, expect, it } from "vitest";
import { calculateInvoiceTotals } from "./invoice-totals";

describe("invoice totals", () => {
  it("includes delivery and insurance in the taxable amount exactly once", () => {
    expect(calculateInvoiceTotals({
      subtotal: 100,
      deliveryCosts: 12.5,
      insuranceCosts: 4.9,
      vatRate: 19,
    })).toEqual({ vatAmount: 22.31, total: 139.71 });
  });

  it("keeps zero insurance out of the total", () => {
    expect(calculateInvoiceTotals({
      subtotal: 100,
      deliveryCosts: 8,
      insuranceCosts: 0,
      vatRate: 19,
    })).toEqual({ vatAmount: 20.52, total: 128.52 });
  });
});