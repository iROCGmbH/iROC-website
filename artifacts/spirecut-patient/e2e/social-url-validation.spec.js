// @ts-check
/**
 * E2E: Social-media URL fields reject syntactically bad URLs.
 *
 * The Social Media tab has five input[type="url"] fields (Instagram, YouTube,
 * LinkedIn, TikTok, Facebook).  Each field has an inline Save button.  When
 * the admin types a bad URL and clicks Save the client-side validation must:
 *   • block the network request entirely (API never fires)
 *   • show a red error paragraph below the input
 *   • apply the border-red-400 class to the input
 *   • keep all error feedback within the viewport (no overflow clipping)
 *
 * Viewports tested:
 *   desktop  — 1 280 × 800
 *   mobile   — 390 × 844  (iPhone 14 / similar narrow phone)
 */

import { test, expect } from '@playwright/test';

const BASE = '/spirecut-patient';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'iroc-admin-2024';
const BAD_URL = 'not-a-valid-url';
const SOCIAL_ERROR_TEXT = 'Ungültige URL';

// ── helpers ────────────────────────────────────────────────────────────────────

/** Log in as admin and wait for the admin panel to appear. */
async function loginAsAdmin(page) {
  // Pre-set the PatientGate sessionStorage key so the gate dialog does not
  // appear and block interaction with the admin login form.
  await page.addInitScript(() => {
    sessionStorage.setItem('spirecut_patient_gate_passed', '1');
  });
  await page.goto(`${BASE}/admin`);
  await page.waitForSelector('input[type="password"]');
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  // Wait for any tab button to confirm login succeeded
  await page.waitForSelector('button:has-text("Social Media")', { timeout: 15_000 });
}

/** Click the Social Media tab and wait for the Instagram card to be visible. */
async function openSocialTab(page) {
  await page.click('button:has-text("Social Media")');
  await page.waitForSelector('text=Instagram', { timeout: 8_000 });
}

// ── Shared assertion helper ────────────────────────────────────────────────────

/**
 * Assert that:
 *   1. The error paragraph is visible.
 *   2. The error paragraph's bounding box is entirely within the viewport.
 *   3. The input carries the red-border class.
 *   4. The API was NOT called (request was intercepted but never sent).
 */
async function assertSocialUrlError(page, card, input, viewportWidth) {
  const errorPara = card.locator('p.text-red-600').filter({ hasText: SOCIAL_ERROR_TEXT });
  await expect(errorPara).toBeVisible({ timeout: 5_000 });

  // Bounding-box check: error text must be fully within the viewport width
  const box = await errorPara.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  // Right edge must sit within the viewport (allow 1 px rounding)
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1);

  // Input must carry the red-border class
  await expect(input).toHaveClass(/border-red-400/);
}

// ── Tests at both viewport sizes ───────────────────────────────────────────────

for (const { label, width, height } of [
  { label: 'desktop (1280×800)', width: 1280, height: 800  },
  { label: 'mobile (390×844)',   width: 390,  height: 844  },
]) {
  // ── Instagram field ─────────────────────────────────────────────────────────

  test(`Social Media – Instagram: bad URL is rejected and error is in-viewport at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });

    // Intercept any POST to /api/admin/patient-social — it must NOT fire
    let apiCalled = false;
    await page.route('**/api/admin/patient-social', (route) => {
      if (route.request().method() === 'POST') {
        apiCalled = true;
        route.continue();
      } else {
        route.continue();
      }
    });

    await loginAsAdmin(page);
    await openSocialTab(page);

    const card = page.locator('div.bg-white').filter({ hasText: 'Instagram' }).first();
    const input = card.locator('input[type="url"]').first();
    await input.fill(BAD_URL);
    // Click the Save button — client-side validation should block the request
    await card.locator('button').first().click();

    await assertSocialUrlError(page, card, input, width);
    expect(apiCalled).toBe(false);
  });

  // ── YouTube field ───────────────────────────────────────────────────────────

  test(`Social Media – YouTube: bad URL is rejected and error is in-viewport at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });

    let apiCalled = false;
    await page.route('**/api/admin/patient-social', (route) => {
      if (route.request().method() === 'POST') { apiCalled = true; }
      route.continue();
    });

    await loginAsAdmin(page);
    await openSocialTab(page);

    const card = page.locator('div.bg-white').filter({ hasText: 'YouTube' }).first();
    const input = card.locator('input[type="url"]').first();
    await input.fill(BAD_URL);
    await card.locator('button').first().click();

    await assertSocialUrlError(page, card, input, width);
    expect(apiCalled).toBe(false);
  });

  // ── LinkedIn field ──────────────────────────────────────────────────────────

  test(`Social Media – LinkedIn: bad URL is rejected and error is in-viewport at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });

    let apiCalled = false;
    await page.route('**/api/admin/patient-social', (route) => {
      if (route.request().method() === 'POST') { apiCalled = true; }
      route.continue();
    });

    await loginAsAdmin(page);
    await openSocialTab(page);

    const card = page.locator('div.bg-white').filter({ hasText: 'LinkedIn' }).first();
    const input = card.locator('input[type="url"]').first();
    await input.fill(BAD_URL);
    await card.locator('button').first().click();

    await assertSocialUrlError(page, card, input, width);
    expect(apiCalled).toBe(false);
  });

  // ── TikTok field ────────────────────────────────────────────────────────────

  test(`Social Media – TikTok: bad URL is rejected and error is in-viewport at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });

    let apiCalled = false;
    await page.route('**/api/admin/patient-social', (route) => {
      if (route.request().method() === 'POST') { apiCalled = true; }
      route.continue();
    });

    await loginAsAdmin(page);
    await openSocialTab(page);

    const card = page.locator('div.bg-white').filter({ hasText: 'TikTok' }).first();
    const input = card.locator('input[type="url"]').first();
    await input.fill(BAD_URL);
    await card.locator('button').first().click();

    await assertSocialUrlError(page, card, input, width);
    expect(apiCalled).toBe(false);
  });

  // ── Facebook field ──────────────────────────────────────────────────────────

  test(`Social Media – Facebook: bad URL is rejected and error is in-viewport at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });

    let apiCalled = false;
    await page.route('**/api/admin/patient-social', (route) => {
      if (route.request().method() === 'POST') { apiCalled = true; }
      route.continue();
    });

    await loginAsAdmin(page);
    await openSocialTab(page);

    const card = page.locator('div.bg-white').filter({ hasText: 'Facebook' }).first();
    const input = card.locator('input[type="url"]').first();
    await input.fill(BAD_URL);
    await card.locator('button').first().click();

    await assertSocialUrlError(page, card, input, width);
    expect(apiCalled).toBe(false);
  });
}
