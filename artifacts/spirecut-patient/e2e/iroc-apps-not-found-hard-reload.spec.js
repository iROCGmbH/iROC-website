// @ts-check
/**
 * E2E: each iROC SPA renders its NotFound page after a hard navigation to an
 * unknown URL in a production preview or through the mounted artifact proxy.
 */

import { test, expect } from "@playwright/test";

const LOCAL_APPS = [
  {
    name: "iROC Interface App",
    origin: process.env.PLAYWRIGHT_APP_BASE_URL ?? "http://localhost:5906",
    base: "/iroc-app",
    heading: "404 Page Not Found",
  },
  {
    name: "iROC Doc App",
    origin: process.env.PLAYWRIGHT_PORTAL_BASE_URL ?? "http://localhost:5907",
    base: "/iroc-portal",
    heading: "404 Page Not Found",
  },
  {
    name: "iROC Website",
    origin: process.env.PLAYWRIGHT_WEBSITE_BASE_URL ?? "http://localhost:5908",
    base: "",
    heading: /404 (Page Not Found|Seite nicht gefunden)/,
  },
];

const mountedOrigin = process.env.PLAYWRIGHT_MOUNTED_BASE_URL;
const isMountedCheck = Boolean(mountedOrigin);
const APPS = isMountedCheck
  ? LOCAL_APPS.map((app) => ({
      ...app,
      origin: mountedOrigin,
    }))
  : LOCAL_APPS;
const targetName = isMountedCheck
  ? "mounted artifact preview"
  : "direct Vite preview";

for (const app of APPS) {
  test(`${app.name} shows NotFound after a hard reload in the ${targetName}`, async ({
    page,
  }) => {
    // goto() is a hard navigation: the browser requests the unknown URL
    // directly instead of reaching it through client-side navigation.
    const response = await page.goto(
      `${app.origin}${app.base}/this-path-does-not-exist-at-all`,
    );

    // The preview server must serve index.html so the SPA can boot and route
    // the unknown path to its React NotFound component.
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1", { hasText: app.heading })).toBeVisible({
      timeout: 10_000,
    });
  });
}
