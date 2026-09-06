import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ values: new Map<string, string>(), logoContent: Buffer.from("logo"), logoContentType: "image/png" }));
vi.mock("@workspace/db", () => ({
  settingsTable: { key: "key" },
  db: { select: () => ({ from: () => {
    const query = { where: (key: string) => {
      const value = state.values.get(key);
      return Promise.resolve(value ? [{ key, value }] : []);
    } };
    return Object.assign(query, { then: (resolve: (rows: unknown[]) => unknown) => resolve([{ key: "smtp_from", value: "Sender <sender@example.test>" }]) });
  } }) },
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((_column: unknown, key: string) => key) }));
vi.mock("./objectStorage.js", () => ({
  ObjectStorageService: class {
    async getObjectEntityFile() { return {}; }
    async downloadObject() {
      return {
        ok: true,
        headers: { get: () => state.logoContentType },
        arrayBuffer: async () => state.logoContent,
      };
    }
  },
}));
vi.mock("./impressum-signature.js", () => ({
  buildImpressumSignature: vi.fn(async lang => lang === "de" ? "RECHT DE" : "LEGAL EN"),
  appendImpressumSignature: vi.fn(async (body, lang) => `${body}\n\n\u2063${lang === "de" ? "RECHT DE" : "LEGAL EN"}\u2064`),
}));

import { applyEmailSignature } from "./email-signatures.js";

const profile = {
  group: "admin" as const, enabled: true, addressId: "smtp_from",
  thankYouDe: "Danke", thankYouEn: "Thanks", writerName: "Ada",
  writerRoleDe: "Vertrieb", writerRoleEn: "Sales", writerEmail: "ada@example.test",
  writerPhone: "+49 30 123", logoPath: "/objects/logo.png", columns: [
    { id: "contact", titleDe: "Kontakt", titleEn: "Contact", bodyDe: "Berlin\nDeutschland", bodyEn: "London\nUnited Kingdom" },
    { id: "support", titleDe: "Support", titleEn: "Support", bodyDe: "Hilfe", bodyEn: "Help" },
  ],
};
beforeEach(() => {
  state.values.clear();
  state.logoContent = Buffer.from("logo");
  state.logoContentType = "image/png";
  for (const group of ["admin", "sally", "tori"] as const) {
    state.values.set(`iroc.email_signature.${group}`, JSON.stringify({ ...profile, group }));
  }
});

describe("email signature rendering", () => {
  it.each(["admin", "sally", "tori"] as const)("renders the %s profile in German and English with email-safe layout", async group => {
    const german = await applyEmailSignature("Hello", group, "de");
    const english = await applyEmailSignature("Hello", group, "en");

    expect(german.text).toContain("Danke");
    expect(german.text).toContain("Vertrieb");
    expect(german.text).toContain("Kontakt\nBerlin");
    expect(german.text).toContain("RECHT DE");
    expect(english.text).toContain("Thanks");
    expect(english.text).toContain("Sales");
    expect(english.text).toContain("Contact\nLondon");
    expect(english.text).toContain("LEGAL EN");
    expect(english.html).toContain('class="iroc-signature-columns"');
    expect(english.html).toContain('width="50%"');
    expect(english.html).toContain("max-width:100%");
    expect(english.html).toContain("@media only screen and (max-width:600px)");
    expect(english.html).toContain('data-iroc-legal-footer="1"');
    expect(english.html).not.toContain("white-space:pre-wrap");
    expect(english.attachments).toEqual([
      expect.objectContaining({ cid: `email-signature-${group}@iroc`, contentType: "image/png" }),
    ]);
    expect(english.html).toContain(`src="cid:email-signature-${group}@iroc"`);
  });

  it("selects language, decorates caller HTML, and replaces prior managed blocks", async () => {
    const first = await applyEmailSignature("Hello", "admin", "en", "<p><em>Original HTML</em></p>");
    const second = await applyEmailSignature(first.text, "admin", "en", first.html);
    expect(second.text).toContain("Thanks");
    expect(second.text).not.toContain("Danke");
    expect(second.html).toContain("<em>Original HTML</em>");
    expect(second.html.match(/data-iroc-email-signature="1"/g)).toHaveLength(1);
    expect(second.html.match(/data-iroc-email-signature-style="1"/g)).toHaveLength(1);
    expect(second.html).toContain("Contact");
    expect(second.html).toContain("LEGAL EN");
    expect(second.from).toBe("Sender <sender@example.test>");
  });

  it("uses only the canonical legal footer when profile is disabled", async () => {
    state.values.set("iroc.email_signature.admin", JSON.stringify({ ...profile, enabled: false }));
    const result = await applyEmailSignature("Body", "admin", "de", '<p>Body</p><div data-iroc-email-signature="1">Old signature</div><div data-iroc-legal-footer="1">Old legal</div>');
    expect(result.text).toContain("RECHT DE");
    expect(result.text).not.toContain("Danke");
    expect(result.html).not.toContain('data-iroc-email-signature="1"');
    expect(result.html).not.toContain("Old legal");
    expect(result.html).toContain("<p>Body</p>");
    expect(result.html).toContain("RECHT DE");
  });

  it("does not attach an oversized stored logo to outgoing mail", async () => {
    state.logoContent = Buffer.alloc(512 * 1024 + 1);
    const result = await applyEmailSignature("Body", "admin", "en");
    expect(result.attachments).toEqual([]);
    expect(result.html).not.toContain("cid:email-signature-admin@iroc");
  });
});