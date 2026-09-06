// @ts-check
/**
 * E2E: CMS content edits appear live on both public websites without a page reload.
 *
 * Flow:
 *   1. Admin saves a text change via POST /api/admin/content
 *   2a. (new-tab tests)  A fresh public page fetches the updated content and renders it
 *   2b. (BC tests)       An already-open public page re-renders via BroadcastChannel
 *                        invalidation — no navigation, no reload
 *
 * Sites under test:
 *   iROC website    — localhost:80/          (LanguageContext CMS map)
 *   Spirecut patient — localhost:80/spirecut-patient/  (i18next CMS bundles)
 *
 * After every test the original values are restored so the suite is fully idempotent.
 */

import { test, expect, request } from '@playwright/test';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'iroc-admin-2024';

// Unique test strings — must not collide with any real production content
const TEST_IROC_DE  = 'TEST-IROC-CMS-LIVE-DE-E2E';
const TEST_IROC_EN  = 'TEST-IROC-CMS-LIVE-EN-E2E';
const TEST_SP_DE    = 'TEST-SP-CMS-LIVE-DE-E2E';
const TEST_SP_EN    = 'TEST-SP-CMS-LIVE-EN-E2E';

/**
 * Save one or more CMS content entries via the admin API.
 * Throws if the API responds with a non-OK status so failures are visible.
 */
async function saveContent(updates) {
  const ctx = await request.newContext({ baseURL: 'http://localhost:80' });
  let res;
  try {
    res = await ctx.post('/api/admin/content', {
      headers: {
        Authorization: `Bearer ${ADMIN_PASSWORD}`,
        'Content-Type': 'application/json',
      },
      data: { updates },
    });
  } finally {
    await ctx.dispose();
  }
  if (!res.ok()) {
    const body = await res.text().catch(() => '(no body)');
    throw new Error(`saveContent failed: HTTP ${res.status()} — ${body}`);
  }
}

/**
 * Fetch the current DE and EN values for a CMS key.
 * Returns { de, en } from /api/content/:site.
 */
async function getContentEntry(site, key) {
  const ctx = await request.newContext({ baseURL: 'http://localhost:80' });
  try {
    // Bypass HTTP cache so we always get the live DB value
    const res = await ctx.get(`/api/content/${site}`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    const body = await res.json();
    const entry = body[key];
    return { de: entry?.de ?? '', en: entry?.en ?? '' };
  } finally {
    await ctx.dispose();
  }
}

// ── iROC website — new-tab test ───────────────────────────────────────────────
//
// Key: iroc.home.portfolio_title  (label: 'Unser Portfolio')
// Rendered on /  via  t('Unser Portfolio', 'Our Portfolio')

test('iROC: updated CMS text appears on the home page in a fresh tab', async ({ context }) => {
  const KEY  = 'iroc.home.portfolio_title';
  const SITE = 'iroc';
  const original = await getContentEntry(SITE, KEY);

  try {
    // 1. Save a unique test string via the admin API
    await saveContent([{ key: KEY, de: TEST_IROC_DE, en: TEST_IROC_EN }]);

    // 2. Open a fresh tab — cold module-level singleton, real fetch
    const publicPage = await context.newPage();
    try {
      await publicPage.goto('/');

      // 3. The home page must display the updated DE text
      await expect(
        publicPage.locator(`text=${TEST_IROC_DE}`).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await publicPage.close();
    }
  } finally {
    await saveContent([{ key: KEY, de: original.de, en: original.en }]);
  }
});

// ── iROC website — BroadcastChannel live-update test ─────────────────────────
//
// An already-open home page must re-render the new text after a BroadcastChannel
// invalidation message arrives — without any navigation or reload.

test('iROC: already-open home page re-renders updated CMS text via BroadcastChannel', async ({ page }) => {
  const KEY  = 'iroc.home.portfolio_title';
  const SITE = 'iroc';
  const original = await getContentEntry(SITE, KEY);

  try {
    // 1. Open the home page and wait for the CMS map to load
    await page.goto('/');
    // Wait for the default DE text to confirm initial CMS load succeeded
    await expect(
      page.locator(`text=${original.de}`).first(),
    ).toBeVisible({ timeout: 10_000 });

    // 2. Save a unique test string via the admin API
    await saveContent([{ key: KEY, de: TEST_IROC_DE, en: TEST_IROC_EN }]);

    // 3. Trigger the BroadcastChannel invalidation from within the page's origin.
    //    The page's LanguageContext BC listener receives this and calls
    //    forceFetchCmsMap() (cache:'no-store') → setCmsMap() → re-render.
    await page.evaluate(() => {
      const bc = new BroadcastChannel('iroc-cms-content-invalidate');
      bc.postMessage('invalidate');
      bc.close();
    });

    // 4. The same page must now show the updated DE text without any navigation
    await expect(
      page.locator(`text=${TEST_IROC_DE}`).first(),
    ).toBeVisible({ timeout: 10_000 });
  } finally {
    await saveContent([{ key: KEY, de: original.de, en: original.en }]);
  }
});

// ── Spirecut patient — new-tab test ──────────────────────────────────────────
//
// Key: spirecut.home.ctaPraktisch  (i18next key: home.ctaPraktisch)
// Default DE: 'Praktische Informationen'
// Rendered on /spirecut-patient/  as a CTA button

test('Spirecut: updated CMS text appears on the home page in a fresh tab', async ({ context }) => {
  const KEY  = 'spirecut.home.ctaPraktisch';
  const SITE = 'spirecut';
  const original = await getContentEntry(SITE, KEY);

  try {
    // 1. Save a unique test string via the admin API
    await saveContent([{ key: KEY, de: TEST_SP_DE, en: TEST_SP_EN }]);

    // 2. Open a fresh tab — cold i18next singleton, real fetch
    const publicPage = await context.newPage();
    try {
      await publicPage.goto('/spirecut-patient/');

      // 3. The home page must display the updated DE text (CTA button)
      await expect(
        publicPage.locator(`text=${TEST_SP_DE}`).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await publicPage.close();
    }
  } finally {
    await saveContent([{ key: KEY, de: original.de, en: original.en }]);
  }
});

// ── Spirecut patient — BroadcastChannel live-update test ─────────────────────
//
// An already-open Spirecut home page must re-render the new CMS text after a
// BroadcastChannel invalidation — i18next re-loads its bundles and triggers a
// re-render in all useTranslation() consumers.

test('Spirecut: already-open home page re-renders updated CMS text via BroadcastChannel', async ({ page }) => {
  const KEY  = 'spirecut.home.ctaPraktisch';
  const SITE = 'spirecut';
  const original = await getContentEntry(SITE, KEY);

  try {
    // 1. Open the Spirecut home page and wait for the CMS bundles to load
    await page.goto('/spirecut-patient/');
    // Wait for the default DE button text to confirm i18next CMS load succeeded
    await expect(
      page.locator(`text=${original.de}`).first(),
    ).toBeVisible({ timeout: 10_000 });

    // 2. Save a unique test string via the admin API
    await saveContent([{ key: KEY, de: TEST_SP_DE, en: TEST_SP_EN }]);

    // 3. Trigger the BroadcastChannel invalidation from within the page's origin.
    //    The page's i18n.ts BC listener receives this, calls
    //    loadSpirecutCmsContent(true) (cache:'no-store') → i18next.addResourceBundle
    //    → i18n.emit('added') → useTranslation() consumers re-render.
    await page.evaluate(() => {
      const bc = new BroadcastChannel('spirecut-cms-content-invalidate');
      bc.postMessage('invalidate');
      bc.close();
    });

    // 4. The same page must now show the updated DE text without any navigation
    await expect(
      page.locator(`text=${TEST_SP_DE}`).first(),
    ).toBeVisible({ timeout: 10_000 });
  } finally {
    await saveContent([{ key: KEY, de: original.de, en: original.en }]);
  }
});

// ── iROC website — both DE and EN update correctly ───────────────────────────
//
// Switch to EN, save via API, BC-invalidate, verify the EN string appears.

test('iROC: BroadcastChannel invalidation also updates the EN translation', async ({ page }) => {
  const KEY  = 'iroc.home.portfolio_title';
  const SITE = 'iroc';
  const original = await getContentEntry(SITE, KEY);

  try {
    // 1. Open the home page and switch to English
    await page.goto('/');
    await page.waitForSelector('[data-testid="lang-toggle"], button:has-text("EN"), button:has-text("English")', {
      timeout: 8_000,
    }).catch(() => null); // graceful — not all builds expose this as a button
    // Use localStorage to switch language and reload
    await page.evaluate(() => {
      localStorage.setItem('iroc_language', 'EN');
    });
    await page.reload();

    // 2. Wait for the default EN text to confirm CMS loaded in EN
    await expect(
      page.locator(`text=${original.en}`).first(),
    ).toBeVisible({ timeout: 10_000 });

    // 3. Save unique test strings
    await saveContent([{ key: KEY, de: TEST_IROC_DE, en: TEST_IROC_EN }]);

    // 4. BC invalidation
    await page.evaluate(() => {
      const bc = new BroadcastChannel('iroc-cms-content-invalidate');
      bc.postMessage('invalidate');
      bc.close();
    });

    // 5. EN string must appear
    await expect(
      page.locator(`text=${TEST_IROC_EN}`).first(),
    ).toBeVisible({ timeout: 10_000 });
  } finally {
    await saveContent([{ key: KEY, de: original.de, en: original.en }]);
    // Restore DE language preference so other tests start in DE
    await page.evaluate(() => {
      localStorage.setItem('iroc_language', 'DE');
    });
  }
});
