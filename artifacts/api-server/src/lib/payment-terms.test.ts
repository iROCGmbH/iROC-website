import { describe, expect, it } from "vitest";
import { resolvePaymentTerms } from "@workspace/spirecut-shared";

describe("invoice payment terms", () => {
  it("normalizes legacy localized values and calculates deterministic due dates", () => {
    expect(resolvePaymentTerms({
      issueDate: "2026-01-30", paymentTerms: "Zahlbar innerhalb von 14 Tagen", language: "de",
    })).toMatchObject({
      paymentTermCode: "net14",
      dueDate: "2026-02-13",
      description: "Zahlbar innerhalb von 14 Tagen, rein netto ohne Abzug. Fällig am 13.02.2026.",
    });
  });

  it("preserves a custom due date and returns English BT-20 text", () => {
    expect(resolvePaymentTerms({
      issueDate: "2026-01-30", paymentTermCode: "custom", dueDate: "2026-02-20", language: "en",
    })).toEqual({
      paymentTermCode: "custom",
      dueDate: "2026-02-20",
      description: "Payable net without deduction. Due on 20 February 2026.",
    });
  });

  it("treats unknown legacy terms with a saved deadline as custom", () => {
    expect(resolvePaymentTerms({
      issueDate: "2026-01-30", paymentTerms: "Agreed individually", dueDate: "2026-03-01",
    })).toMatchObject({ paymentTermCode: "custom", dueDate: "2026-03-01" });
  });

  it("never rewrites a blank or divergent recognized legacy deadline", () => {
    expect(resolvePaymentTerms({
      issueDate: "2026-01-30", paymentTerms: "", dueDate: "2026-03-01",
    })).toMatchObject({ paymentTermCode: "custom", dueDate: "2026-03-01" });
    expect(resolvePaymentTerms({
      issueDate: "2026-01-30", paymentTerms: "Payable within 14 days", dueDate: "2026-03-01",
    })).toMatchObject({ paymentTermCode: "custom", dueDate: "2026-03-01" });
  });

  it("preserves even a malformed legacy deadline for later explicit validation", () => {
    expect(resolvePaymentTerms({ issueDate: "2026-01-30", dueDate: "2026-02-30" }))
      .toMatchObject({ paymentTermCode: "custom", dueDate: "2026-02-30" });
  });
});