import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import {
  finalizeSupplierReorderDraft,
  removeSupplierCompanyContactFooter,
} from "./tori.js";

describe("Tori supplier reorder legal signatures", () => {
  it("removes an AI-provided company contact footer but preserves Tori's identity", () => {
    const body = removeSupplierCompanyContactFooter(
      "Dear Supplier,\n\nPlease confirm the reorder.\n\n"
      + "Kind regards,\n\nTori – AI Operations Assistant, on behalf of iROC GmbH\n\n"
      + "Invented Medical Devices GmbH\nFake Street 12\n12345 Berlin\n"
      + "Phone: +49 30 123456\nEmail: invented@example.test\nWeb: https://invented.example.test",
    );

    expect(body).toContain("Tori – AI Operations Assistant");
    expect(body).not.toContain("Invented Medical Devices");
    expect(body).not.toContain("invented@example.test");
  });

  it("adds the current English Impressum signature after the safe supplier draft", async () => {
    const draft = await finalizeSupplierReorderDraft({
      to: "supplier@example.test",
      subject: "Reorder request",
      email_body_markdown: "Dear Supplier,\n\nPlease confirm our reorder.\n\nKind regards,\n\nTori – AI Operations Assistant, on behalf of iROC GmbH",
    }, "en");

    expect(draft.email_body_markdown).toContain("Tori – AI Operations Assistant");
    expect(draft.email_body_markdown).toContain("iROC GmbH");
    expect(draft.email_body_markdown).toContain("St.-Emmeram-Str. 26");
    expect(draft.email_body_markdown).toContain("Phone: +49 89 4625993 70");
    expect(draft.email_body_markdown).toContain("info@i-roc.de");
    expect(draft.email_body_markdown).toContain("https://i-roc.de");
  });

  it("uses German legal labels for German suppliers", async () => {
    const draft = await finalizeSupplierReorderDraft({
      to: "lieferant@example.test",
      subject: "Nachbestellung",
      email_body_markdown: "Sehr geehrte Damen und Herren,\n\nbitte bestätigen Sie die Bestellung.\n\nMit freundlichen Grüßen,\n\nTori – AI Operations Assistant, im Auftrag der iROC GmbH",
    }, "de");

    expect(draft.email_body_markdown).toContain("Telefon: +49 89 4625993 70");
    expect(draft.email_body_markdown).toContain("E-Mail: info@i-roc.de");
    expect(draft.email_body_markdown).toContain("Deutschland");
  });
});