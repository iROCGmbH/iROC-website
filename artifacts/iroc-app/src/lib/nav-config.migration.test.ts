import { describe, expect, it } from "vitest";
import {
  DEFAULT_NAV_CONFIG,
  ROUTE_REGISTRY,
  reconcileNavConfig,
  type NavConfig,
} from "./nav-config";

function groupById(config: NavConfig, id: string) {
  const visit = (groups: NavConfig): NavConfig[number] | undefined => {
    for (const group of groups) {
      if (group.id === id) return group;
      const nested = visit(group.children ?? []);
      if (nested) return nested;
    }
    return undefined;
  };
  return visit(config);
}

describe("navigation config — Incoming Orders relocation", () => {
  it("keeps Incoming Orders under Finance in the default tree", () => {
    const finance = groupById(DEFAULT_NAV_CONFIG, "finance");
    const website = groupById(DEFAULT_NAV_CONFIG, "iroc-website");

    expect(finance?.items).toContainEqual({ slug: "/iroc-website/orders", visible: true });
    expect(website?.items).not.toContainEqual({ slug: "/iroc-website/orders", visible: true });
  });

  it("moves Incoming Orders out of an existing saved iROC Website group", () => {
    const stored: NavConfig = [{
      id: "configuration",
      labelDe: "Konfiguration",
      labelEn: "Configuration",
      icon: "Settings",
      items: [],
      children: [{
        id: "websites",
        labelDe: "Website",
        labelEn: "Website",
        icon: "Globe",
        items: [],
        children: [{
          id: "iroc-website",
          labelDe: "iROC Website",
          labelEn: "iROC Website",
          icon: "Globe",
          items: [{ slug: "/iroc-website/orders", visible: false }],
        }],
      }],
    }];

    const result = reconcileNavConfig(stored);
    const finance = groupById(result, "finance");
    const website = groupById(result, "iroc-website");

    expect(finance?.items).toContainEqual({ slug: "/iroc-website/orders", visible: true });
    expect(website?.items).not.toContainEqual({ slug: "/iroc-website/orders", visible: false });
  });
});

describe("navigation config — iROC Browser APP", () => {
  it("registers the bilingual launcher in the iROC Website group", () => {
    const website = groupById(DEFAULT_NAV_CONFIG, "iroc-website");

    expect(ROUTE_REGISTRY["/iroc-website/browser-app"]).toEqual({
      labelDe: "iROC Browser APP",
      labelEn: "iROC Browser APP",
      icon: "Smartphone",
    });
    expect(website?.items).toContainEqual({
      slug: "/iroc-website/browser-app",
      visible: true,
    });
  });

  it("adds the launcher to navigation saved before the route existed", () => {
    const stored: NavConfig = [{
      id: "configuration",
      labelDe: "Konfiguration",
      labelEn: "Configuration",
      icon: "Settings",
      items: [],
      children: [{
        id: "websites",
        labelDe: "Website",
        labelEn: "Website",
        icon: "Globe",
        items: [],
        children: [{
          id: "iroc-website",
          labelDe: "iROC Website",
          labelEn: "iROC Website",
          icon: "Globe",
          items: [{ slug: "/iroc-website/settings", visible: true }],
        }],
      }],
    }];

    const website = groupById(reconcileNavConfig(stored), "iroc-website");

    expect(website?.items).toContainEqual({
      slug: "/iroc-website/browser-app",
      visible: true,
    });
  });
});