import { describe, expect, it, vi } from "vitest";
import { enforceSupplierReorderDraftLanguage } from "./tori-reorder-language";

const englishDraft = {
  to: "supplier@example.com",
  subject: "Reorder request",
  email_body_markdown: "Dear Supplier,\n\nPlease confirm our reorder.\n\nKind regards,",
};
const germanDraft = {
  to: "supplier@example.com",
  subject: "Nachbestellung",
  email_body_markdown: "Sehr geehrte Damen und Herren,\n\nbitte bestätigen Sie unsere Bestellung.\n\nMit freundlichen Grüßen,",
};

describe("enforceSupplierReorderDraftLanguage", () => {
  it("rewrites conflicting model output once before it can be queued", async () => {
    const rewrite = vi.fn().mockResolvedValue(germanDraft);
    const fallback = vi.fn(() => germanDraft);

    const result = await enforceSupplierReorderDraftLanguage(englishDraft, "de", rewrite, fallback);

    expect(rewrite).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
    expect(result).toMatchObject({ draft: germanDraft, retried: true, fallbackUsed: false });
  });

  it("uses a deterministic English fallback after bilingual retry output", async () => {
    const bilingualDraft = {
      ...germanDraft,
      email_body_markdown: `${germanDraft.email_body_markdown}\nPlease confirm.`,
    };
    const fallback = vi.fn(() => englishDraft);

    const result = await enforceSupplierReorderDraftLanguage(germanDraft, "en", async () => bilingualDraft, fallback);

    expect(fallback).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ draft: englishDraft, retried: true, fallbackUsed: true });
  });
});