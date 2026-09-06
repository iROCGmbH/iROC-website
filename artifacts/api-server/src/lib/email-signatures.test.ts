import { describe, expect, it } from "vitest";
import {
  EMAIL_SIGNATURE_LOGO_MAX_BYTES,
  validateEmailSignatureLogo,
  validateEmailSignatureProfile,
} from "./email-signatures.js";

const profile = {
  group: "admin", enabled: true, addressId: "smtp_from",
  thankYouDe: "Vielen Dank", thankYouEn: "Thank you",
  writerName: "Ada Admin", writerRoleDe: "Vertrieb", writerRoleEn: "Sales",
  writerEmail: "ada@example.test", writerPhone: "+49 1", logoPath: "",
  columns: [],
};

describe("email signature profile validation", () => {
  it("accepts a complete profile and keeps stable source address IDs", () => {
    expect(validateEmailSignatureProfile(profile)).toMatchObject({ addressId: "smtp_from", group: "admin" });
  });
  it("rejects unsafe logo paths and more than four columns", () => {
    expect(() => validateEmailSignatureProfile({ ...profile, logoPath: "https://bad.example/logo.png" })).toThrow("/objects/");
    expect(() => validateEmailSignatureProfile({ ...profile, columns: Array.from({ length: 5 }, (_, i) => ({ id: String(i), titleDe: "", titleEn: "", bodyDe: "", bodyEn: "" })) })).toThrow("at most 4");
  });
  it("rejects profile groups that disagree with the route group", () => {
    expect(() => validateEmailSignatureProfile(profile, "sally")).toThrow("match the URL group");
  });

  it("accepts an email-sized PNG logo", () => {
    const png = Buffer.alloc(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    png.writeUInt32BE(600, 16);
    png.writeUInt32BE(200, 20);
    expect(() => validateEmailSignatureLogo(png, "image/png")).not.toThrow();
  });

  it("rejects logo bytes above the email limit and images above the pixel limit", () => {
    expect(() => validateEmailSignatureLogo(Buffer.alloc(EMAIL_SIGNATURE_LOGO_MAX_BYTES + 1), "image/png"))
      .toThrow("512 KB");

    const png = Buffer.alloc(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    png.writeUInt32BE(601, 16);
    png.writeUInt32BE(200, 20);
    expect(() => validateEmailSignatureLogo(png, "image/png")).toThrow("600 × 200");
  });
});