// @ts-check
/**
 * E2E: Clearing a CMS text field falls back to the hardcoded default.
 *
 * Edge case: an admin accidentally saves an *empty* string for a content key.
 * Both websites must silently show the original hardcoded string rather than
 * a blank gap.
 *
 * Sites under test:
 *   iROC website      — localhost:80/           (LanguageContext t() fallback)
 *   Spirecut patient  — localhost:80/spirecut-patient/  (i18next bundle fallback)
 *
 * The API rejects rows where BOTH de and en are empty, so each test clears
 * one language at a time while keeping the other non-empty.
 * All tests restore the original values in finally blocks so the suite is
 * fully idempotent.
 */

import { test, expect, request } from '@playwright/test';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'iroc-admin-2024';

// ── Shared helpers ─────────────────────────────────────────────────────────────

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
 * Fetch the current values (including seed defaults) for a CMS key.
 * Returns { de, en, seedDe, seedEn } from GET /api/content/:site.
 */
async function getContentEntry(site, key) {
  const ctx = await request.newContext({ baseURL: 'http://localhost:80' });
  try {
    const res = await ctx.get(`/api/content/${site}`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    const body = await res.json();
    const entry = body[key];
    return {
      de:     entry?.de     ?? '',
      en:     entry?.en     ?? '',
      seedDe: entry?.seedDe ?? '',
      seedEn: entry?.seedEn ?? '',
    };
  } finally {
    await ctx.dispose();
  }
}

// ── iROC website — empty DE falls back to hardcoded DE ───────────────────────
//
// Key: iroc.home.portfolio_title  (t('Unser Portfolio', 'Our Portfolio'))
// Saving de="" while en is non-empty must leave the page showing "Unser Portfolio".

test('iROC: empty DE override falls back to hardcoded DE string', async ({ context }) => {
  const KEY  = 'iroc.home.portfolio_title';
  const SITE = 'iroc';
  const { de: origDe, en: origEn, seedDe } = await getContentEntry(SITE, KEY);

  // The hardcoded German string we expect to see as the fallback.
  // Use the seed default; if for some reason the entry is not in the seed
  // response, fall back to the known static string from LanguageContext.
  const hardcodedDe = seedDe || 'Unser Portfolio';

  try {
    // 1. Clear the DE override (keep EN non-empty so the API accepts the row)
    await saveContent([{ key: KEY, de: '', en: origEn || 'Our Portfolio' }]);

    // 2. Open a fresh tab — cold module-level CMS singleton, real fetch
    const publicPage = await context.newPage();
    try {
      await publicPage.goto('/');

      // 3. The hardcoded German string must appear (not a blank)
      await expect(
        publicPage.locator(`text=${hardcodedDe}`).first(),
      ).toBeVisible({ timeout: 10_000 });

      // 4. No blank text node where the heading should be
      const heading = publicPage.locator('h2').filter({ hasText: hardcodedDe });
      await expect(heading.first()).not.toBeEmpty();
    } finally {
      await publicPage.close();
    }
  } finally {
    await saveContent([{ key: KEY, de: origDe, en: origEn }]);
  }
});

// ── iROC website — empty EN falls back to hardcoded EN string ────────────────
//
// Switch to EN language, save en="", verify the hardcoded EN string appears.

test('iROC: empty EN override falls back to hardcoded EN string', async ({ context }) => {
  const KEY  = 'iroc.home.portfolio_title';
  const SITE = 'iroc';
  const { de: origDe, en: origEn, seedEn } = await getContentEntry(SITE, KEY);

  const hardcodedEn = seedEn || 'Our Portfolio';

  try {
    // 1. Clear the EN override (keep DE non-empty)
    await saveContent([{ key: KEY, de: origDe || 'Unser Portfolio', en: '' }]);

    // 2. Open a fresh tab with EN language preference set
    const publicPage = await context.newPage();
    try {
      // Set EN preference before navigating
      await publicPage.addInitScript(() => {
        localStorage.setItem('iroc_language', 'EN');
      });
      await publicPage.goto('/');

      // 3. The hardcoded English string must appear (not a blank)
      await expect(
        publicPage.locator(`text=${hardcodedEn}`).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await publicPage.close();
    }
  } finally {
    await saveContent([{ key: KEY, de: origDe, en: origEn }]);
  }
});

// ── iROC website — empty DE falls back via BroadcastChannel invalidation ─────
//
// An already-open page must also fall back to the hardcoded string (not blank)
// after a BC invalidation when the DE value is cleared.

test('iROC: BC invalidation with empty DE override still shows hardcoded DE', async ({ page }) => {
  const KEY  = 'iroc.home.portfolio_title';
  const SITE = 'iroc';
  const { de: origDe, en: origEn, seedDe } = await getContentEntry(SITE, KEY);

  const hardcodedDe = seedDe || 'Unser Portfolio';

  try {
    // 1. Open the home page and confirm initial CMS load
    await page.goto('/');
    await expect(
      page.locator(`text=${origDe || hardcodedDe}`).first(),
    ).toBeVisible({ timeout: 10_000 });

    // 2. Clear the DE override via the admin API
    await saveContent([{ key: KEY, de: '', en: origEn || 'Our Portfolio' }]);

    // 3. Trigger BC invalidation so the already-open page re-fetches
    await page.evaluate(() => {
      const bc = new BroadcastChannel('iroc-cms-content-invalidate');
      bc.postMessage('invalidate');
      bc.close();
    });

    // 4. The page must now show the hardcoded DE string, not a blank
    await expect(
      page.locator(`text=${hardcodedDe}`).first(),
    ).toBeVisible({ timeout: 10_000 });
  } finally {
    await saveContent([{ key: KEY, de: origDe, en: origEn }]);
  }
});

// ── Spirecut patient — empty DE falls back to hardcoded DE ───────────────────
//
// Key: spirecut.home.ctaPraktisch
// i18next path: home.ctaPraktisch
// Saving de="" must leave the CTA button showing the static de.json string.

test('Spirecut: empty DE override falls back to hardcoded DE string', async ({ context }) => {
  const KEY  = 'spirecut.home.ctaPraktisch';
  const SITE = 'spirecut';
  const { de: origDe, en: origEn, seedDe } = await getContentEntry(SITE, KEY);

  const hardcodedDe = seedDe || 'Praktische Informationen';

  try {
    // 1. Clear the DE override (keep EN non-empty)
    await saveContent([{ key: KEY, de: '', en: origEn || 'Practical Information' }]);

    // 2. Open a fresh tab — cold i18next singleton + fresh CMS fetch
    const publicPage = await context.newPage();
    try {
      await publicPage.goto('/spirecut-patient/');

      // 3. The hardcoded German CTA text must appear (not a blank button)
      await expect(
        publicPage.locator(`text=${hardcodedDe}`).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await publicPage.close();
    }
  } finally {
    await saveContent([{ key: KEY, de: origDe, en: origEn }]);
  }
});

// ── Spirecut patient — empty EN falls back to hardcoded EN string ─────────────

test('Spirecut: empty EN override falls back to hardcoded EN string', async ({ context }) => {
  const KEY  = 'spirecut.home.ctaPraktisch';
  const SITE = 'spirecut';
  const { de: origDe, en: origEn, seedEn } = await getContentEntry(SITE, KEY);

  const hardcodedEn = seedEn || 'Practical Information';

  try {
    // 1. Clear the EN override (keep DE non-empty)
    await saveContent([{ key: KEY, de: origDe || 'Praktische Informationen', en: '' }]);

    // 2. Open a fresh tab with EN language preference
    const publicPage = await context.newPage();
    try {
      await publicPage.addInitScript(() => {
        localStorage.setItem('spirecut_lang', 'en');
      });
      await publicPage.goto('/spirecut-patient/');

      // 3. The hardcoded English CTA text must appear (not a blank button)
      await expect(
        publicPage.locator(`text=${hardcodedEn}`).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await publicPage.close();
    }
  } finally {
    await saveContent([{ key: KEY, de: origDe, en: origEn }]);
  }
});

// ── Spirecut patient — empty DE falls back via BroadcastChannel ───────────────
//
// An already-open page must show the hardcoded DE string (not blank) after a
// BC invalidation when the DE value is cleared.

test('Spirecut: BC invalidation with empty DE override still shows hardcoded DE', async ({ page }) => {
  const KEY  = 'spirecut.home.ctaPraktisch';
  const SITE = 'spirecut';
  const { de: origDe, en: origEn, seedDe } = await getContentEntry(SITE, KEY);

  const hardcodedDe = seedDe || 'Praktische Informationen';

  try {
    // 1. Open the Spirecut home page and confirm initial CMS load
    await page.goto('/spirecut-patient/');
    await expect(
      page.locator(`text=${origDe || hardcodedDe}`).first(),
    ).toBeVisible({ timeout: 10_000 });

    // 2. Clear the DE override via the admin API
    await saveContent([{ key: KEY, de: '', en: origEn || 'Practical Information' }]);

    // 3. Trigger BC invalidation so the already-open page re-loads CMS bundles
    await page.evaluate(() => {
      const bc = new BroadcastChannel('spirecut-cms-content-invalidate');
      bc.postMessage('invalidate');
      bc.close();
    });

    // 4. The page must now show the hardcoded DE string, not a blank
    await expect(
      page.locator(`text=${hardcodedDe}`).first(),
    ).toBeVisible({ timeout: 10_000 });
  } finally {
    await saveContent([{ key: KEY, de: origDe, en: origEn }]);
  }
});
