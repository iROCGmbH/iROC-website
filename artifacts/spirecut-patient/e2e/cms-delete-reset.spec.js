// @ts-check
/**
 * E2E + API: DELETE /admin/content/:key resets seeded keys to their seed
 * default — even when the current DB value is an empty string.
 *
 * Scenarios covered:
 *  1. POST empty DE → page shows hardcoded fallback → DELETE → page still shows
 *     hardcoded (seed value is now back in DB, no longer empty).
 *  2. Direct API: DELETE on a key whose DB value is already empty returns 200
 *     and the subsequent GET returns the non-empty seedDe value (not empty).
 *  3. Same as (2) but for Spirecut — confirms the endpoint works for both
 *     sites via their respective seed maps.
 *
 * Sites under test:
 *   iROC website      — localhost:80/
 *   Spirecut patient  — localhost:80/spirecut-patient/
 *
 * All tests restore the original values in finally blocks so the suite is
 * fully idempotent.
 */

import { test, expect, request } from '@playwright/test';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'iroc-admin-2024';

// ── Shared helpers ─────────────────────────────────────────────────────────────

/**
 * Save one or more CMS content entries via the admin POST API.
 */
async function saveContent(updates) {
  const ctx = await request.newContext({ baseURL: 'http://localhost:80' });
  try {
    const res = await ctx.post('/api/admin/content', {
      headers: {
        Authorization: `Bearer ${ADMIN_PASSWORD}`,
        'Content-Type': 'application/json',
      },
      data: { updates },
    });
    if (!res.ok()) {
      const body = await res.text().catch(() => '(no body)');
      throw new Error(`saveContent failed: HTTP ${res.status()} — ${body}`);
    }
    return await res.json();
  } finally {
    await ctx.dispose();
  }
}

/**
 * Call DELETE /admin/content/:key and return the parsed JSON body.
 * Throws if the response is not 2xx.
 */
async function deleteContent(key) {
  const ctx = await request.newContext({ baseURL: 'http://localhost:80' });
  try {
    const res = await ctx.delete(`/api/admin/content/${key}`, {
      headers: {
        Authorization: `Bearer ${ADMIN_PASSWORD}`,
      },
    });
    if (!res.ok()) {
      const body = await res.text().catch(() => '(no body)');
      throw new Error(`deleteContent failed: HTTP ${res.status()} — ${body}`);
    }
    return await res.json();
  } finally {
    await ctx.dispose();
  }
}

/**
 * Fetch the current CMS entry for a given site and key.
 * Returns { de, en, seedDe, seedEn }.
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

// ── Test 1: iROC — save empty DE, page shows hardcoded, DELETE restores seed ──
//
// Flow: POST de="" → open page (sees hardcoded fallback) → DELETE → page still
// sees the same hardcoded string (now backed by real seed value in DB).

test('iROC: save empty DE then DELETE restores seed — page shows hardcoded throughout', async ({ context }) => {
  const KEY  = 'iroc.home.portfolio_title';
  const SITE = 'iroc';
  const { de: origDe, en: origEn, seedDe } = await getContentEntry(SITE, KEY);

  const hardcodedDe = seedDe || 'Unser Portfolio';

  try {
    // 1. Save an empty DE override (keep EN non-empty so the API accepts it)
    await saveContent([{ key: KEY, de: '', en: origEn || 'Our Portfolio' }]);

    // 2. Confirm the page shows the hardcoded fallback (not a blank)
    const pageBeforeDelete = await context.newPage();
    try {
      await pageBeforeDelete.goto('/');
      await expect(
        pageBeforeDelete.locator(`text=${hardcodedDe}`).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await pageBeforeDelete.close();
    }

    // 3. DELETE the key — this should write the seed de/en values back to DB
    const deleteResult = await deleteContent(KEY);
    expect(deleteResult.ok).toBe(true);
    // The response must carry the non-empty seed values
    expect(typeof deleteResult.de).toBe('string');
    expect(deleteResult.de.length).toBeGreaterThan(0);

    // 4. Verify the DB now holds the seed value (not empty)
    const afterDelete = await getContentEntry(SITE, KEY);
    expect(afterDelete.de.length).toBeGreaterThan(0);
    expect(afterDelete.de).toBe(hardcodedDe);

    // 5. Open a fresh page — must still show the hardcoded (now seed) string
    const pageAfterDelete = await context.newPage();
    try {
      await pageAfterDelete.goto('/');
      await expect(
        pageAfterDelete.locator(`text=${hardcodedDe}`).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await pageAfterDelete.close();
    }
  } finally {
    // Restore exact original values — the API accepts empty strings, so pass
    // origDe/origEn verbatim to avoid silently overwriting an intentional empty.
    await saveContent([{ key: KEY, de: origDe, en: origEn }]);
  }
});

// ── Test 2: iROC — direct API: DELETE on already-empty DE returns seedDe ──────
//
// The DB row has de="" (written by a previous save). DELETE must:
//   • return HTTP 200 with { ok: true, de: <non-empty seed>, en: <non-empty seed> }
//   • leave the DB with the non-empty seed value so GET returns seedDe in `de`.

test('iROC: DELETE on key with empty DE responds with non-empty seedDe and GET confirms', async () => {
  const KEY  = 'iroc.home.portfolio_title';
  const SITE = 'iroc';
  const { de: origDe, en: origEn, seedDe, seedEn } = await getContentEntry(SITE, KEY);

  try {
    // 1. Force de="" into the DB
    await saveContent([{ key: KEY, de: '', en: origEn || 'Our Portfolio' }]);

    // 2. Verify the DB now shows empty de
    const beforeDelete = await getContentEntry(SITE, KEY);
    expect(beforeDelete.de).toBe('');

    // 3. Call DELETE
    const result = await deleteContent(KEY);
    expect(result.ok).toBe(true);

    // DELETE response must carry the seed value (non-empty) for DE
    expect(result.de).toBeTruthy();
    expect(result.de.length).toBeGreaterThan(0);
    expect(result.de).toBe(seedDe || 'Unser Portfolio');

    // 4. GET after DELETE: de must equal the seedDe (not empty)
    const afterDelete = await getContentEntry(SITE, KEY);
    expect(afterDelete.de).toBe(seedDe || 'Unser Portfolio');
    expect(afterDelete.de.length).toBeGreaterThan(0);
  } finally {
    await saveContent([{ key: KEY, de: origDe, en: origEn }]);
  }
});

// ── Test 3: Spirecut — direct API: DELETE on already-empty DE returns seedDe ──
//
// Same scenario as Test 2 but for the Spirecut site, confirming both seed maps
// are consulted by the DELETE endpoint.

test('Spirecut: DELETE on key with empty DE responds with non-empty seedDe and GET confirms', async () => {
  const KEY  = 'spirecut.home.ctaPraktisch';
  const SITE = 'spirecut';
  const { de: origDe, en: origEn, seedDe, seedEn } = await getContentEntry(SITE, KEY);

  try {
    // 1. Force de="" into the DB
    await saveContent([{ key: KEY, de: '', en: origEn || 'Practical Information' }]);

    // 2. Verify the DB now shows empty de
    const beforeDelete = await getContentEntry(SITE, KEY);
    expect(beforeDelete.de).toBe('');

    // 3. Call DELETE
    const result = await deleteContent(KEY);
    expect(result.ok).toBe(true);

    // DELETE response must carry the seed value (non-empty) for DE
    expect(result.de).toBeTruthy();
    expect(result.de.length).toBeGreaterThan(0);
    expect(result.de).toBe(seedDe || 'Praktische Informationen');

    // 4. GET after DELETE: de must equal the seedDe (not empty)
    const afterDelete = await getContentEntry(SITE, KEY);
    expect(afterDelete.de).toBe(seedDe || 'Praktische Informationen');
    expect(afterDelete.de.length).toBeGreaterThan(0);
  } finally {
    await saveContent([{ key: KEY, de: origDe, en: origEn }]);
  }
});

// ── Test 4: Spirecut — save empty DE, page shows hardcoded, DELETE restores ───
//
// Full round-trip on the Spirecut patient site: POST de="" → page shows
// hardcoded CTA → DELETE → page still shows the same hardcoded text.

test('Spirecut: save empty DE then DELETE restores seed — page shows hardcoded throughout', async ({ context }) => {
  const KEY  = 'spirecut.home.ctaPraktisch';
  const SITE = 'spirecut';
  const { de: origDe, en: origEn, seedDe } = await getContentEntry(SITE, KEY);

  const hardcodedDe = seedDe || 'Praktische Informationen';

  try {
    // 1. Save an empty DE override
    await saveContent([{ key: KEY, de: '', en: origEn || 'Practical Information' }]);

    // 2. Open fresh tab — must show hardcoded fallback, not blank
    const pageBeforeDelete = await context.newPage();
    try {
      await pageBeforeDelete.goto('/spirecut-patient/');
      await expect(
        pageBeforeDelete.locator(`text=${hardcodedDe}`).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await pageBeforeDelete.close();
    }

    // 3. DELETE the key to restore seed values
    const deleteResult = await deleteContent(KEY);
    expect(deleteResult.ok).toBe(true);
    expect(deleteResult.de).toBe(hardcodedDe);

    // 4. Verify DB holds non-empty seed value
    const afterDelete = await getContentEntry(SITE, KEY);
    expect(afterDelete.de).toBe(hardcodedDe);

    // 5. Fresh tab after DELETE — must still show hardcoded (now seed-backed) string
    const pageAfterDelete = await context.newPage();
    try {
      await pageAfterDelete.goto('/spirecut-patient/');
      await expect(
        pageAfterDelete.locator(`text=${hardcodedDe}`).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await pageAfterDelete.close();
    }
  } finally {
    await saveContent([{ key: KEY, de: origDe, en: origEn }]);
  }
});
