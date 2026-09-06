import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SPIRECUT_NAV_ROUTE_HREFS,
  resolveSpirecutLegacyRoute,
} from "@workspace/spirecut-shared";
import { PAGE_LINKS } from "@/config/navLinks";

describe("shared Spirecut patient-flow contract", () => {
  it("registers every shared patient navigation route exactly once", () => {
    expect(PAGE_LINKS.map(({ href }) => href)).toEqual([
      ...SPIRECUT_NAV_ROUTE_HREFS,
    ]);
    expect(new Set(PAGE_LINKS.map(({ href }) => href)).size).toBe(
      PAGE_LINKS.length,
    );
  });

  it("keeps legacy patient links usable", () => {
    expect(resolveSpirecutLegacyRoute("/karpaltunnel")).toBe(
      "/karpaltunnelsyndrom",
    );
    expect(resolveSpirecutLegacyRoute("/postop/")).toBe(
      "/postoperative-entwicklung",
    );
  });

  it("keeps shared content, gate, language, and chatbot support mounted", () => {
    const app = readFileSync(path.resolve("src/App.tsx"), "utf8");
    const layout = readFileSync(
      path.resolve("src/components/Layout.tsx"),
      "utf8",
    );

    expect(app).toContain("loadSpirecutCmsContent");
    expect(app).toContain("<LegacyRouteRedirects />");
    expect(app).toContain("<Chatbot />");
    expect(app).toContain("useTranslation");
    expect(layout).toContain("<PatientGate />");
  });
});