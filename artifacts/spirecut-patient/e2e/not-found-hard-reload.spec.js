// @ts-check
/**
 * E2E: SPA 404 page renders after a hard browser reload at an unknown URL.
 *
 * Without `historyApiFallback: true` in vite.config.ts the dev server returns
 * a real HTTP 404 before React loads, so the NotFound component never renders.
 *
 * This test navigates directly to a URL the router does not recognise,
 * simulating a hard reload, and confirms the NotFound UI is visible.
 */

import { test, expect } from '@playwright/test';

const BASE = '/spirecut-patient';

test('NotFound page renders after a hard reload at an unknown URL', async ({ page }) => {
  // Navigate directly — Playwright uses goto() which is equivalent to typing
  // the URL in the address bar and pressing Enter (a hard navigation).
  const response = await page.goto(`${BASE}/this-path-does-not-exist-at-all`);

  // The server must serve index.html (HTTP 200) for the SPA to boot.
  // A real server-level 404 would return HTML without our app and the heading
  // "Seite nicht gefunden" would never appear.
  expect(response?.status()).toBe(200);

  // The NotFound component renders the translated title "Seite nicht gefunden".
  await expect(
    page.locator('h1', { hasText: 'Seite nicht gefunden' }),
  ).toBeVisible({ timeout: 10_000 });
});

test('NotFound page renders for a deeply nested unknown path', async ({ page }) => {
  const response = await page.goto(`${BASE}/a/b/c/definitely-unknown`);

  expect(response?.status()).toBe(200);

  await expect(
    page.locator('h1', { hasText: 'Seite nicht gefunden' }),
  ).toBeVisible({ timeout: 10_000 });
});

test('NotFound page contains a back-to-home link', async ({ page }) => {
  await page.goto(`${BASE}/no-such-page`);

  // The "Zurück zur Startseite" button must be present and point to the SPA root.
  const backLink = page.locator('a', { hasText: 'Zurück zur Startseite' });
  await expect(backLink).toBeVisible({ timeout: 10_000 });
});
