// @ts-check
/**
 * E2E: Contact email addresses update on the public footer and contact page
 * immediately after an admin saves new values.
 *
 * Flow per email key (sp_contact_email_de and sp_contact_email_com):
 *   1. Admin logs in → Settings tab → enters a new email address → saves
 *   2. Public /kontakt page is loaded in a fresh context page
 *   3. The displayed email must reflect the saved value without a hard refresh
 *
 * A BroadcastChannel cross-tab test also confirms an already-open public page
 * re-renders immediately after the admin saves, without any navigation.
 *
 * After each test the original values are always restored so tests are fully
 * idempotent and leave no persistent config drift.
 */

import { test, expect, request } from '@playwright/test';

const BASE = '/spirecut-patient';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'iroc-admin-2024';

// Distinct test email addresses — not the production defaults
const TEST_EMAIL_DE  = 'test-de@spirecut-e2e.example';
const TEST_EMAIL_COM = 'test-com@spirecut-e2e.example';

/**
 * Reset a spirecut setting key back to `value` directly via the API.
 * Always called — even when value is an empty string — to prevent config drift.
 * Throws if the API responds with a non-OK status.
 */
async function resetSetting(key, value) {
  const ctx = await request.newContext({ baseURL: 'http://localhost:80' });
  let res;
  try {
    res = await ctx.post('/api/admin/spirecut-settings', {
      headers: { Authorization: `Bearer ${ADMIN_PASSWORD}`, 'Content-Type': 'application/json' },
      data: { key, value },
    });
  } finally {
    await ctx.dispose();
  }
  if (!res.ok()) {
    throw new Error(`resetSetting failed for key=${key}: HTTP ${res.status()} — settings may be left in a dirty state`);
  }
}

/** Read the current saved value for a key from /api/patient-settings. */
async function getCurrentValue(key) {
  const ctx = await request.newContext({ baseURL: 'http://localhost:80' });
  const res = await ctx.get('/api/patient-settings');
  const body = await res.json();
  await ctx.dispose();
  return typeof body[key] === 'string' ? body[key] : '';
}

// ── helpers ────────────────────────────────────────────────────────────────────

/** Log in as admin and wait for the admin panel to appear. */
async function loginAsAdmin(page) {
  await page.goto(`${BASE}/admin`);
  await page.waitForSelector('input[type="password"]');
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  // Wait for the Settings tab button — confirms login succeeded
  await page.waitForSelector('button:has-text("Einstellungen")', { timeout: 15_000 });
}

/** Click the Settings tab and wait for the DE email card to be visible. */
async function openSettingsTab(page) {
  await page.click('button:has-text("Einstellungen")');
  await page.waitForSelector('text=Kontakt-E-Mail (Spirecut .de)', { timeout: 8_000 });
}

// ── .de email: new tab ─────────────────────────────────────────────────────────

test('DE contact email updates on /kontakt and footer after admin saves', async ({ page, context }) => {
  const originalDe = await getCurrentValue('sp_contact_email_de');

  try {
    // 1. Admin: log in and open settings
    await loginAsAdmin(page);
    await openSettingsTab(page);

    // 2. Fill in the DE email and save
    const deCard = page.locator('div.bg-white').filter({ hasText: 'Kontakt-E-Mail (Spirecut .de)' }).first();
    const deInput = deCard.locator('input[type="email"]').first();
    await deInput.fill(TEST_EMAIL_DE);
    await deCard.locator('button').first().click();
    await expect(deCard.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // 3. Open /kontakt in a NEW tab within the same context
    //    (fresh page = cold module-level singleton; simulates a new visitor)
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/kontakt`);

    // 4. The contact page must show the new DE email
    await expect(
      publicPage.locator(`a[href="mailto:${TEST_EMAIL_DE}"]`).first(),
    ).toBeVisible({ timeout: 10_000 });

    // 5. The footer on the same page must also reflect the new DE email
    await expect(
      publicPage.locator('footer').locator(`a[href="mailto:${TEST_EMAIL_DE}"]`),
    ).toBeVisible({ timeout: 10_000 });

    await publicPage.close();
  } finally {
    await resetSetting('sp_contact_email_de', originalDe);
  }
});

// ── .com email: new tab ────────────────────────────────────────────────────────

test('COM contact email updates on /kontakt and footer after admin saves', async ({ page, context }) => {
  const originalCom = await getCurrentValue('sp_contact_email_com');

  try {
    // 1. Admin: log in and open settings
    await loginAsAdmin(page);
    await openSettingsTab(page);

    // 2. Fill in the COM email and save
    const comCard = page.locator('div.bg-white').filter({ hasText: 'Kontakt-E-Mail (Spirecut .com)' }).first();
    const comInput = comCard.locator('input[type="email"]').first();
    await comInput.fill(TEST_EMAIL_COM);
    await comCard.locator('button').first().click();
    await expect(comCard.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // 3. Open /kontakt in a NEW tab
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/kontakt`);

    // 4. The contact page must show the new COM email
    await expect(
      publicPage.locator(`a[href="mailto:${TEST_EMAIL_COM}"]`).first(),
    ).toBeVisible({ timeout: 10_000 });

    // 5. The footer must also show the new COM email
    await expect(
      publicPage.locator('footer').locator(`a[href="mailto:${TEST_EMAIL_COM}"]`),
    ).toBeVisible({ timeout: 10_000 });

    await publicPage.close();
  } finally {
    await resetSetting('sp_contact_email_com', originalCom);
  }
});

// ── BroadcastChannel cross-tab invalidation ────────────────────────────────────

test('same-context BroadcastChannel: /kontakt re-renders DE email without navigation after admin saves', async ({ page, context }) => {
  const originalDe = await getCurrentValue('sp_contact_email_de');

  try {
    // Load the public contact page first so the hook + BroadcastChannel listener are active
    await page.goto(`${BASE}/kontakt`);
    // Wait for the page to settle — the email link must be present with the current value
    await page.waitForSelector('a[href^="mailto:"]', { timeout: 10_000 });

    // Open the admin panel in a second tab of the SAME browser context
    // so that BroadcastChannel messages are delivered cross-tab
    const adminPage = await context.newPage();
    await loginAsAdmin(adminPage);
    await openSettingsTab(adminPage);

    const deCard = adminPage.locator('div.bg-white').filter({ hasText: 'Kontakt-E-Mail (Spirecut .de)' }).first();
    await deCard.locator('input[type="email"]').first().fill(TEST_EMAIL_DE);
    await deCard.locator('button').first().click();
    await expect(deCard.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // The already-open /kontakt page should re-render via BroadcastChannel invalidation
    // without any navigation — driven by invalidateSpirecutSettingsCache() in Admin.tsx
    await expect(
      page.locator(`a[href="mailto:${TEST_EMAIL_DE}"]`).first(),
    ).toBeVisible({ timeout: 10_000 });

    await adminPage.close();
  } finally {
    await resetSetting('sp_contact_email_de', originalDe);
  }
});

// ── BroadcastChannel cross-tab invalidation: COM email on footer ───────────────

test('same-context BroadcastChannel: footer re-renders COM email without navigation after admin saves', async ({ page, context }) => {
  const originalCom = await getCurrentValue('sp_contact_email_com');

  try {
    // Load the home page first — Footer renders sp_contact_email_com
    // and the BroadcastChannel listener inside useSpirecutSettings is active
    await page.goto(`${BASE}/`);
    // Wait for the footer's COM email link to be present with whatever the current value is
    await page.waitForSelector('footer a[href^="mailto:"]', { timeout: 10_000 });

    // Open the admin panel in a second tab of the SAME browser context
    // so that BroadcastChannel messages are delivered cross-tab
    const adminPage = await context.newPage();
    await loginAsAdmin(adminPage);
    await openSettingsTab(adminPage);

    const comCard = adminPage.locator('div.bg-white').filter({ hasText: 'Kontakt-E-Mail (Spirecut .com)' }).first();
    await comCard.locator('input[type="email"]').first().fill(TEST_EMAIL_COM);
    await comCard.locator('button').first().click();
    await expect(comCard.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // The already-open home page footer should re-render via BroadcastChannel invalidation
    // without any navigation — the COM email href must update in-place
    await expect(
      page.locator('footer').locator(`a[href="mailto:${TEST_EMAIL_COM}"]`),
    ).toBeVisible({ timeout: 10_000 });

    await adminPage.close();
  } finally {
    await resetSetting('sp_contact_email_com', originalCom);
  }
});

// ── Back-to-back saves: both emails updated without waiting between saves ───────

test('both emails updated back-to-back: /kontakt shows both new addresses after the second save', async ({ page, context }) => {
  const originalDe  = await getCurrentValue('sp_contact_email_de');
  const originalCom = await getCurrentValue('sp_contact_email_com');

  try {
    // 1. Admin: log in and open settings
    await loginAsAdmin(page);
    await openSettingsTab(page);

    // 2. Fill in the DE email and click Save — but do NOT wait for "Gespeichert"
    //    before moving on to the COM field, to simulate rapid back-to-back saves.
    const deCard  = page.locator('div.bg-white').filter({ hasText: 'Kontakt-E-Mail (Spirecut .de)'  }).first();
    const comCard = page.locator('div.bg-white').filter({ hasText: 'Kontakt-E-Mail (Spirecut .com)' }).first();

    await deCard.locator('input[type="email"]').first().fill(TEST_EMAIL_DE);
    await deCard.locator('button').first().click();
    // Immediately (without awaiting "Gespeichert") fill and save the COM field
    await comCard.locator('input[type="email"]').first().fill(TEST_EMAIL_COM);
    await comCard.locator('button').first().click();

    // 3. Now wait for both save confirmations to settle
    await expect(deCard.locator('text=Gespeichert')).toBeVisible({ timeout: 10_000 });
    await expect(comCard.locator('text=Gespeichert')).toBeVisible({ timeout: 10_000 });

    // 4. Open /kontakt in a fresh tab — cold singleton, real fetch
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/kontakt`);

    // 5. Both email addresses must appear on the contact page
    await expect(
      publicPage.locator(`a[href="mailto:${TEST_EMAIL_DE}"]`).first(),
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      publicPage.locator(`a[href="mailto:${TEST_EMAIL_COM}"]`).first(),
    ).toBeVisible({ timeout: 10_000 });

    // 6. Both must also appear in the footer
    await expect(
      publicPage.locator('footer').locator(`a[href="mailto:${TEST_EMAIL_DE}"]`),
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      publicPage.locator('footer').locator(`a[href="mailto:${TEST_EMAIL_COM}"]`),
    ).toBeVisible({ timeout: 10_000 });

    await publicPage.close();
  } finally {
    // Always restore originals — order does not matter here
    await Promise.all([
      resetSetting('sp_contact_email_de',  originalDe),
      resetSetting('sp_contact_email_com', originalCom),
    ]);
  }
});

// ── BroadcastChannel: both emails updated concurrently, already-open page ──────

test('same-context BroadcastChannel: footer re-renders both DE and COM emails without navigation after back-to-back saves', async ({ page, context }) => {
  const originalDe  = await getCurrentValue('sp_contact_email_de');
  const originalCom = await getCurrentValue('sp_contact_email_com');

  try {
    // 1. Open the home page first — Footer renders both emails and the
    //    BroadcastChannel listener inside useSpirecutSettings becomes active.
    await page.goto(`${BASE}/`);
    // Wait for any footer email link to confirm the hook has loaded
    await page.waitForSelector('footer a[href^="mailto:"]', { timeout: 10_000 });

    // 2. Open the admin panel in a second tab of the SAME browser context so
    //    BroadcastChannel messages are delivered to the still-open home page.
    const adminPage = await context.newPage();
    await loginAsAdmin(adminPage);
    await openSettingsTab(adminPage);

    const deCard  = adminPage.locator('div.bg-white').filter({ hasText: 'Kontakt-E-Mail (Spirecut .de)'  }).first();
    const comCard = adminPage.locator('div.bg-white').filter({ hasText: 'Kontakt-E-Mail (Spirecut .com)' }).first();

    // 3. Save the DE email and immediately (without waiting for "Gespeichert")
    //    save the COM email — this is the back-to-back / race scenario.
    await deCard.locator('input[type="email"]').first().fill(TEST_EMAIL_DE);
    await deCard.locator('button').first().click();
    // No await on "Gespeichert" before moving to COM — intentional race
    await comCard.locator('input[type="email"]').first().fill(TEST_EMAIL_COM);
    await comCard.locator('button').first().click();

    // 4. Wait for both save confirmations to settle on the admin page
    await expect(deCard.locator('text=Gespeichert')).toBeVisible({ timeout: 10_000 });
    await expect(comCard.locator('text=Gespeichert')).toBeVisible({ timeout: 10_000 });

    // 5. The already-open home page footer must re-render BOTH emails via the
    //    BroadcastChannel invalidation — no navigation, no reload.
    await expect(
      page.locator('footer').locator(`a[href="mailto:${TEST_EMAIL_COM}"]`),
    ).toBeVisible({ timeout: 12_000 });

    await expect(
      page.locator('footer').locator(`a[href="mailto:${TEST_EMAIL_DE}"]`),
    ).toBeVisible({ timeout: 12_000 });

    await adminPage.close();
  } finally {
    await Promise.all([
      resetSetting('sp_contact_email_de',  originalDe),
      resetSetting('sp_contact_email_com', originalCom),
    ]);
  }
});

// ── Fallback to SP_DEFAULTS when email is cleared (empty string saved) ───────────

test('clearing sp_contact_email_de causes /kontakt to show the default info@spirecut.de link', async ({ context }) => {
  const originalDe = await getCurrentValue('sp_contact_email_de');

  try {
    // 1. Save an empty string directly via the API (the browser email input
    //    enforces non-empty, so we bypass it to test the server-side + hook
    //    fallback path).
    await resetSetting('sp_contact_email_de', '');

    // 2. Open /kontakt in a fresh context page — cold singleton, real fetch
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/kontakt`);

    // 3. The contact page must fall back to the hardcoded SP_DEFAULTS value
    await expect(
      publicPage.locator('a[href="mailto:info@spirecut.de"]').first(),
    ).toBeVisible({ timeout: 10_000 });

    // 4. The footer on the same page must also show the default DE email
    await expect(
      publicPage.locator('footer').locator('a[href="mailto:info@spirecut.de"]'),
    ).toBeVisible({ timeout: 10_000 });

    await publicPage.close();
  } finally {
    // Restore the original value — if it was already empty this is a no-op
    await resetSetting('sp_contact_email_de', originalDe);
  }
});

// ── API error during BroadcastChannel-triggered re-fetch ─────────────────────────

test('/kontakt does not revert to default email when BroadcastChannel-triggered re-fetch fails', async ({ page }) => {
  const originalDe = await getCurrentValue('sp_contact_email_de');

  // Use a recognisable non-default email so we can distinguish it from SP_DEFAULTS
  const SAVED_EMAIL = 'recovery-test@spirecut-e2e.example';

  try {
    // 1. Persist a known non-default email so the page will load it on startup
    await resetSetting('sp_contact_email_de', SAVED_EMAIL);

    // 2. Load /kontakt — the hook fetches successfully; lastKnownGoodCache is set
    await page.goto(`${BASE}/kontakt`);
    await expect(
      page.locator(`a[href="mailto:${SAVED_EMAIL}"]`).first(),
    ).toBeVisible({ timeout: 10_000 });

    // 3. Block the API so the next fetch returns a 500
    await page.route('**/api/patient-settings', (route) =>
      route.fulfill({ status: 500, body: 'Internal Server Error' }),
    );

    // 4. Simulate a BroadcastChannel invalidation from another tab — this clears
    //    the module-level cache and triggers a re-fetch inside useSpirecutSettings
    await page.evaluate((channelName) => {
      new BroadcastChannel(channelName).postMessage('invalidate');
    }, 'spirecut-sp-settings-invalidate');

    // 5. Wait long enough for the failed fetch to resolve and React to re-render
    await page.waitForTimeout(2_000);

    // 6. The page must still show the saved email — NOT the hardcoded default
    await expect(
      page.locator(`a[href="mailto:${SAVED_EMAIL}"]`).first(),
    ).toBeVisible({ timeout: 5_000 });

    // Explicitly confirm the default email is absent (belt-and-suspenders)
    await expect(
      page.locator('a[href="mailto:info@spirecut.de"]').first(),
    ).toHaveCount(0);

    // 7. Restore the route so subsequent requests go through normally
    await page.unroute('**/api/patient-settings');
  } finally {
    await resetSetting('sp_contact_email_de', originalDe);
  }
});

// ── BroadcastChannel: back-to-back saves, already-open /kontakt tab ─────────────

test('same-context BroadcastChannel: already-open /kontakt shows both new emails after back-to-back admin saves', async ({ page, context }) => {
  const originalDe  = await getCurrentValue('sp_contact_email_de');
  const originalCom = await getCurrentValue('sp_contact_email_com');

  try {
    // 1. Open /kontakt first so the useSpirecutSettings hook and its
    //    BroadcastChannel listener are already active in this tab.
    await page.goto(`${BASE}/kontakt`);
    // Wait for any email link to confirm the hook has loaded and rendered
    await page.waitForSelector('a[href^="mailto:"]', { timeout: 10_000 });

    // 2. Open the admin panel in a second tab of the SAME browser context so
    //    BroadcastChannel messages are delivered to the still-open /kontakt tab.
    const adminPage = await context.newPage();
    await loginAsAdmin(adminPage);
    await openSettingsTab(adminPage);

    const deCard  = adminPage.locator('div.bg-white').filter({ hasText: 'Kontakt-E-Mail (Spirecut .de)'  }).first();
    const comCard = adminPage.locator('div.bg-white').filter({ hasText: 'Kontakt-E-Mail (Spirecut .com)' }).first();

    // 3. Save DE email and immediately (without waiting for "Gespeichert")
    //    save the COM email — this exercises the race where the second
    //    BroadcastChannel invalidation may arrive while the first re-fetch is
    //    still in flight, potentially deduplicating against a stale promise.
    await deCard.locator('input[type="email"]').first().fill(TEST_EMAIL_DE);
    await deCard.locator('button').first().click();
    // No await on "Gespeichert" before moving to COM — intentional back-to-back
    await comCard.locator('input[type="email"]').first().fill(TEST_EMAIL_COM);
    await comCard.locator('button').first().click();

    // 4. Wait for both save confirmations to settle on the admin page
    await expect(deCard.locator('text=Gespeichert')).toBeVisible({ timeout: 10_000 });
    await expect(comCard.locator('text=Gespeichert')).toBeVisible({ timeout: 10_000 });

    // 5. The already-open /kontakt page must re-render BOTH new email addresses
    //    via BroadcastChannel invalidation — no navigation, no reload.
    await expect(
      page.locator(`a[href="mailto:${TEST_EMAIL_DE}"]`).first(),
    ).toBeVisible({ timeout: 12_000 });

    await expect(
      page.locator(`a[href="mailto:${TEST_EMAIL_COM}"]`).first(),
    ).toBeVisible({ timeout: 12_000 });

    await adminPage.close();
  } finally {
    await Promise.all([
      resetSetting('sp_contact_email_de',  originalDe),
      resetSetting('sp_contact_email_com', originalCom),
    ]);
  }
});
