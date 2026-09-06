import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockQuery },
}));

import {
  appendImpressumSignature,
  buildImpressumSignature,
} from "./impressum-signature";

describe("Impressum signature", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("uses the live, explicitly selected language values on every call", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { key: "iroc.impressum.body_company_address", value: "iROC DE\r\nStraße 1" },
          { key: "iroc.impressum.body_contact_info", value: "Telefon: +49 1\r\nE-Mail: de@example.test" },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { key: "iroc.impressum.body_company_address", value: "iROC EN\r\nRoad 1" },
          { key: "iroc.impressum.body_contact_info", value: "Phone: +49 2\r\nE-mail: en@example.test" },
        ],
      });

    await expect(buildImpressumSignature("de")).resolves.toBe(
      "iROC DE\nStraße 1\n\nTelefon: +49 1\nE-Mail: de@example.test",
    );
    await expect(buildImpressumSignature("en")).resolves.toBe(
      "iROC EN\nRoad 1\n\nPhone: +49 2\nE-mail: en@example.test",
    );

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0][0]).toContain("SELECT key, de AS value");
    expect(mockQuery.mock.calls[1][0]).toContain("SELECT key, en AS value");
    expect(mockQuery.mock.calls[0][1]).toEqual([
      "iroc",
      ["iroc.impressum.body_company_address", "iroc.impressum.body_contact_info"],
    ]);
  });

  it("falls back per missing value and when the database is unavailable", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ key: "iroc.impressum.body_company_address", value: "  Live company\nAddress  " }],
    });

    await expect(buildImpressumSignature("en")).resolves.toBe(
      "Live company\nAddress\n\nPhone: +49 89 4625993 70\nFax: +49 89 21530 334\nE-mail: info@i-roc.de\nWeb: https://i-roc.de",
    );

    mockQuery.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(buildImpressumSignature("de")).resolves.toContain(
      "Deutschland\n\nTelefon: +49 89 4625993 70",
    );
  });

  it("replaces a stale marked footer with one freshly queried signature", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { key: "iroc.impressum.body_company_address", value: "iROC GmbH\nOld address" },
          { key: "iroc.impressum.body_contact_info", value: "Phone: +49 1\nWeb: https://old.example.test\nE-mail: old@example.test" },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { key: "iroc.impressum.body_company_address", value: "iROC GmbH\nNew address" },
          { key: "iroc.impressum.body_contact_info", value: "Phone: +49 2\nWeb: https://new.example.test\nE-mail: new@example.test" },
        ],
      });

    const once = await appendImpressumSignature("Hello\r\n\r\nKind regards", "en");
    const twice = await appendImpressumSignature(once, "en");

    expect(once).toContain("iROC GmbH\nOld address");
    expect(twice).toContain("iROC GmbH\nNew address");
    expect(twice).not.toContain("Old address");
    expect(twice.match(/\u2063/g)).toHaveLength(1);
    expect(twice.match(/\u2064/g)).toHaveLength(1);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("replaces only a trailing unmarked legacy iROC legal footer", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { key: "iroc.impressum.body_company_address", value: "iROC GmbH\nNew address" },
        { key: "iroc.impressum.body_contact_info", value: "Phone: +49 9\nWeb: https://new.example.test\nE-mail: new@example.test" },
      ],
    });
    const legacyBody = [
      "Hello,",
      "",
      "Kind regards,",
      "Jane Doe",
      "",
      "iROC GmbH",
      "Innovative & Regenerative medical Oriented Consultation",
      "St.-Emmeram-Str. 26",
      "85609 Aschheim",
      "Germany",
      "",
      "Phone: +49 89 4625993 70",
      "Fax: +49 89 21530 334",
      "E-mail: info@i-roc.de",
      "Web: https://i-roc.de",
    ].join("\n");

    await expect(appendImpressumSignature(legacyBody, "en")).resolves.toBe(
      "Hello,\n\nKind regards,\nJane Doe\n\n\u2063iROC GmbH\nNew address\n\nPhone: +49 9\nWeb: https://new.example.test\nE-mail: new@example.test\u2064",
    );
  });

  it("replaces the exact historical Leads footer without removing the sign-off", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { key: "iroc.impressum.body_company_address", value: "iROC GmbH\nCurrent address" },
        { key: "iroc.impressum.body_contact_info", value: "Phone: +49 9\nWeb: https://new.example.test\nE-mail: current@example.test" },
      ],
    });
    const historicalLeadsBody = [
      "Hello,",
      "",
      "Kind regards,",
      "Jane Doe",
      "",
      "──────────────────────────────────",
      "iROC GmbH",
      "Landsberger Straße 302",
      "80687 München",
      "Tel: +49 89 74 79 40 40",
      "info@i-roc.de",
      "www.i-roc.de",
    ].join("\n");

    const appended = await appendImpressumSignature(historicalLeadsBody, "en");

    expect(appended).toBe(
      "Hello,\n\nKind regards,\nJane Doe\n\n\u2063iROC GmbH\nCurrent address\n\nPhone: +49 9\nWeb: https://new.example.test\nE-mail: current@example.test\u2064",
    );
    expect(appended).not.toContain("Landsberger Straße 302");
    expect(appended).not.toContain("80687 München");
    expect(appended).not.toContain("Tel: +49 89 74 79 40 40");
    expect(appended).not.toContain("info@i-roc.de");
    expect(appended).not.toContain("www.i-roc.de");
    expect(appended.match(/\u2063/g)).toHaveLength(1);
  });

  it("does not remove unmarked text that lacks the complete legacy footer shape", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { key: "iroc.impressum.body_company_address", value: "iROC GmbH\nNew address" },
        { key: "iroc.impressum.body_contact_info", value: "Phone: +49 9\nWeb: https://new.example.test\nE-mail: new@example.test" },
      ],
    });

    const body = "Kind regards,\n\niROC GmbH\nAddress\nPhone: +49 1";
    await expect(appendImpressumSignature(body, "en")).resolves.toContain(
      "Kind regards,\n\niROC GmbH\nAddress\nPhone: +49 1\n\n\u2063iROC GmbH\nNew address",
    );
  });

  it("appends the recipient's German or English signature to external bodies", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { key: "iroc.impressum.body_company_address", value: "iROC Deutschland" },
          { key: "iroc.impressum.body_contact_info", value: "Telefon: +49 1" },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { key: "iroc.impressum.body_company_address", value: "iROC Germany" },
          { key: "iroc.impressum.body_contact_info", value: "Phone: +49 1" },
        ],
      });

    await expect(appendImpressumSignature("Guten Tag", "de")).resolves.toBe(
      "Guten Tag\n\n\u2063iROC Deutschland\n\nTelefon: +49 1\u2064",
    );
    await expect(appendImpressumSignature("Hello", "en")).resolves.toBe(
      "Hello\n\n\u2063iROC Germany\n\nPhone: +49 1\u2064",
    );
  });

  it("returns marker-wrapped content for editable browser prefills", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { key: "iroc.impressum.body_company_address", value: "iROC GmbH" },
        { key: "iroc.impressum.body_contact_info", value: "Phone: +49 1" },
      ],
    });

    await expect(appendImpressumSignature("", "en")).resolves.toBe(
      "\u2063iROC GmbH\n\nPhone: +49 1\u2064",
    );
  });
});