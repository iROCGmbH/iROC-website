// @ts-check
/**
 * E2E: Video embed URLs update on the public page immediately after an admin saves them.
 *
 * Flow per slot (CT and TF):
 *   1. Admin logs in → Settings tab → enters a new YouTube embed URL → saves
 *   2. Public page /so-funktioniert-es is loaded (with an empty cache via fresh context page)
 *   3. The iframe src must reflect the new URL without a hard refresh
 *
 * After each test the original value is always restored (including empty string)
 * so the tests are fully idempotent and leave no persistent config drift.
 */

import { test, expect, request } from '@playwright/test';

const BASE = '/spirecut-patient';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'iroc-admin-2024';

// Distinct test YouTube embed IDs — not the production defaults
const TEST_CT_VIDEO_ID = 'AAAAAAAAACT';
const TEST_TF_VIDEO_ID = 'AAAAAAAATF1';
const TEST_CT_URL = `https://www.youtube.com/embed/${TEST_CT_VIDEO_ID}?rel=0`;
const TEST_TF_URL = `https://www.youtube.com/embed/${TEST_TF_VIDEO_ID}?rel=0`;

/**
 * Reset a spirecut setting key back to `value` directly via the API.
 * Always called — even when value is an empty string — to prevent config drift.
 * Throws if the API responds with a non-OK status so cleanup failures are
 * surfaced immediately rather than silently contaminating later runs.
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
  // Return empty string (not null/undefined) so restoration is always safe
  return typeof body[key] === 'string' ? body[key] : '';
}

// ── helpers ────────────────────────────────────────────────────────────────────

/** Log in as admin and wait for the admin panel to appear. */
async function loginAsAdmin(page) {
  // sessionStorage is tab-scoped.  Seed the patient confirmation before
  // navigation so the admin form is not covered by the gate.
  await page.addInitScript(() => {
    window.sessionStorage.setItem('spirecut_patient_gate_passed', '1');
  });
  await page.goto(`${BASE}/admin`);
  await page.waitForSelector('input[type="password"]');
  // The launch transition can temporarily sit above the admin form and
  // intercept pointer events.
  await page.locator('[aria-label="Loading application / Anwendung wird geladen"]')
    .waitFor({ state: 'hidden', timeout: 15_000 });
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  // Wait for the Settings tab button — confirms login succeeded
  await page.waitForSelector('button:has-text("Einstellungen")', { timeout: 15_000 });
}

/** Click the Settings tab and wait for the CT video card to be visible. */
async function openSettingsTab(page) {
  await page.click('button:has-text("Einstellungen")');
  await page.waitForSelector('text=Video – Karpaltunnelsyndrom', { timeout: 8_000 });
}

// ── CT video slot ──────────────────────────────────────────────────────────────

test('CT video embed updates on the public page after admin saves a new URL', async ({ page, context }) => {
  const originalCt = await getCurrentValue('sp_video_ct_url');

  try {
    // 1. Admin: log in and open settings
    await loginAsAdmin(page);
    await openSettingsTab(page);

    // 2. Fill in the CT video URL and save
    //    The CT card contains heading "Video – Karpaltunnelsyndrom"
    const ctCard = page.locator('div.bg-white').filter({ hasText: 'Video – Karpaltunnelsyndrom' }).first();
    const ctInput = ctCard.locator('input[type="url"]').first();
    await ctInput.fill(TEST_CT_URL);
    await ctCard.locator('button').first().click();
    await expect(ctCard.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // 3. Open the public HowItWorks page in a NEW tab within the same context
    //    (new page = fresh module-level singleton cache; simulates another visitor)
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/so-funktioniert-es`);

    // 4. The CT iframe must reflect the new video ID
    const ctIframe = publicPage.locator('iframe[title="Spirecut Surgery Technique"]');
    await expect(ctIframe).toBeVisible({ timeout: 10_000 });
    await expect(ctIframe).toHaveAttribute('src', new RegExp(TEST_CT_VIDEO_ID));

    await publicPage.close();
  } finally {
    // Always restore — covers the case where originalCt is an empty string
    await resetSetting('sp_video_ct_url', originalCt);
  }
});

// ── TF video slot ──────────────────────────────────────────────────────────────

test('TF video embed updates on the public page after admin saves a new URL', async ({ page, context }) => {
  const originalTf = await getCurrentValue('sp_video_tf_url');

  try {
    // 1. Admin: log in and open settings
    await loginAsAdmin(page);
    await openSettingsTab(page);

    // 2. Fill in the TF video URL and save
    //    The TF card contains heading "Video – Schnappfinger"
    const tfCard = page.locator('div.bg-white').filter({ hasText: 'Video – Schnappfinger' }).first();
    const tfInput = tfCard.locator('input[type="url"]').first();
    await tfInput.fill(TEST_TF_URL);
    await tfCard.locator('button').first().click();
    await expect(tfCard.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // 3. Open the public HowItWorks page in a NEW tab
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/so-funktioniert-es`);

    // 4. The TF iframe must reflect the new video ID
    const tfIframe = publicPage.locator('iframe[title="Spirecut Trigger Finger"]');
    await expect(tfIframe).toBeVisible({ timeout: 10_000 });
    await expect(tfIframe).toHaveAttribute('src', new RegExp(TEST_TF_VIDEO_ID));

    await publicPage.close();
  } finally {
    // Always restore — covers the case where originalTf is an empty string
    await resetSetting('sp_video_tf_url', originalTf);
  }
});

// ── BroadcastChannel cross-tab invalidation ────────────────────────────────────

test('same-context BroadcastChannel: public page re-renders CT video without navigation after admin saves', async ({ page, context }) => {
  const originalCt = await getCurrentValue('sp_video_ct_url');

  try {
    // Load the public page first so the hook + BroadcastChannel listener are active
    await page.goto(`${BASE}/so-funktioniert-es`);
    await page.waitForSelector('iframe[title="Spirecut Surgery Technique"]', { timeout: 10_000 });

    // Open the admin panel in a second tab of the SAME browser context
    // so that BroadcastChannel messages are delivered cross-tab
    const adminPage = await context.newPage();
    await loginAsAdmin(adminPage);
    await openSettingsTab(adminPage);

    const ctCard = adminPage.locator('div.bg-white').filter({ hasText: 'Video – Karpaltunnelsyndrom' }).first();
    await ctCard.locator('input[type="url"]').first().fill(TEST_CT_URL);
    await ctCard.locator('button').first().click();
    await expect(ctCard.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // The already-open public page should re-render via BroadcastChannel invalidation
    // without any navigation — driven by invalidateSpirecutSettingsCache() in Admin.tsx
    await expect(
      page.locator('iframe[title="Spirecut Surgery Technique"]'),
    ).toHaveAttribute('src', new RegExp(TEST_CT_VIDEO_ID), { timeout: 10_000 });

    await adminPage.close();
  } finally {
    // Always restore — covers the case where originalCt is an empty string
    await resetSetting('sp_video_ct_url', originalCt);
  }
});

// ── BroadcastChannel cross-tab invalidation: TF video ─────────────────────────

test('same-context BroadcastChannel: public page re-renders TF video without navigation after admin saves', async ({ page, context }) => {
  const originalTf = await getCurrentValue('sp_video_tf_url');

  try {
    // Load the public page first so the hook + BroadcastChannel listener are active
    await page.goto(`${BASE}/so-funktioniert-es`);
    await page.waitForSelector('iframe[title="Spirecut Trigger Finger"]', { timeout: 10_000 });

    // Open the admin panel in a second tab of the SAME browser context
    // so that BroadcastChannel messages are delivered cross-tab
    const adminPage = await context.newPage();
    await loginAsAdmin(adminPage);
    await openSettingsTab(adminPage);

    const tfCard = adminPage.locator('div.bg-white').filter({ hasText: 'Video – Schnappfinger' }).first();
    await tfCard.locator('input[type="url"]').first().fill(TEST_TF_URL);
    await tfCard.locator('button').first().click();
    await expect(tfCard.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // The already-open public page should re-render via BroadcastChannel invalidation
    // without any navigation — driven by invalidateSpirecutSettingsCache() in Admin.tsx
    await expect(
      page.locator('iframe[title="Spirecut Trigger Finger"]'),
    ).toHaveAttribute('src', new RegExp(TEST_TF_VIDEO_ID), { timeout: 10_000 });

    await adminPage.close();
  } finally {
    await resetSetting('sp_video_tf_url', originalTf);
  }
});

// ── Back-to-back saves: both CT and TF updated without waiting between saves ───

test('both video slots updated back-to-back: public page shows both new iframes after second save', async ({ page, context }) => {
  const originalCt = await getCurrentValue('sp_video_ct_url');
  const originalTf = await getCurrentValue('sp_video_tf_url');

  try {
    // 1. Admin: log in and open settings
    await loginAsAdmin(page);
    await openSettingsTab(page);

    const ctCard = page.locator('div.bg-white').filter({ hasText: 'Video – Karpaltunnelsyndrom' }).first();
    const tfCard = page.locator('div.bg-white').filter({ hasText: 'Video – Schnappfinger' }).first();

    // 2. Fill and save CT, then immediately fill and save TF (no await between saves)
    await ctCard.locator('input[type="url"]').first().fill(TEST_CT_URL);
    await ctCard.locator('button').first().click();
    // Intentionally do NOT await "Gespeichert" before moving to TF
    await tfCard.locator('input[type="url"]').first().fill(TEST_TF_URL);
    await tfCard.locator('button').first().click();

    // 3. Now wait for both save confirmations to settle
    await expect(ctCard.locator('text=Gespeichert')).toBeVisible({ timeout: 10_000 });
    await expect(tfCard.locator('text=Gespeichert')).toBeVisible({ timeout: 10_000 });

    // 4. Open the public HowItWorks page in a fresh tab — cold singleton, real fetch
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/so-funktioniert-es`);

    // 5. Both iframes must reflect the new video IDs
    await expect(
      publicPage.locator('iframe[title="Spirecut Surgery Technique"]'),
    ).toHaveAttribute('src', new RegExp(TEST_CT_VIDEO_ID), { timeout: 10_000 });

    await expect(
      publicPage.locator('iframe[title="Spirecut Trigger Finger"]'),
    ).toHaveAttribute('src', new RegExp(TEST_TF_VIDEO_ID), { timeout: 10_000 });

    await publicPage.close();
  } finally {
    await Promise.all([
      resetSetting('sp_video_ct_url', originalCt),
      resetSetting('sp_video_tf_url', originalTf),
    ]);
  }
});

// ── BroadcastChannel: both videos updated concurrently, already-open page ──────

test('same-context BroadcastChannel: already-open page re-renders both videos after back-to-back admin saves', async ({ page, context }) => {
  const originalCt = await getCurrentValue('sp_video_ct_url');
  const originalTf = await getCurrentValue('sp_video_tf_url');

  try {
    // 1. Open the public page first so both iframes and the BroadcastChannel
    //    listener are already active in this tab.
    await page.goto(`${BASE}/so-funktioniert-es`);
    await page.waitForSelector('iframe[title="Spirecut Surgery Technique"]', { timeout: 10_000 });

    // 2. Open the admin panel in a second tab of the SAME browser context so
    //    BroadcastChannel messages are delivered to the still-open public page.
    const adminPage = await context.newPage();
    await loginAsAdmin(adminPage);
    await openSettingsTab(adminPage);

    const ctCard = adminPage.locator('div.bg-white').filter({ hasText: 'Video – Karpaltunnelsyndrom' }).first();
    const tfCard = adminPage.locator('div.bg-white').filter({ hasText: 'Video – Schnappfinger' }).first();

    // 3. Save CT and immediately (without waiting for "Gespeichert") save TF —
    //    exercises the race where the second BroadcastChannel invalidation may
    //    arrive while the first re-fetch is still in flight.
    await ctCard.locator('input[type="url"]').first().fill(TEST_CT_URL);
    await ctCard.locator('button').first().click();
    // No await on "Gespeichert" before moving to TF — intentional back-to-back
    await tfCard.locator('input[type="url"]').first().fill(TEST_TF_URL);
    await tfCard.locator('button').first().click();

    // 4. Wait for both save confirmations to settle on the admin page
    await expect(ctCard.locator('text=Gespeichert')).toBeVisible({ timeout: 10_000 });
    await expect(tfCard.locator('text=Gespeichert')).toBeVisible({ timeout: 10_000 });

    // 5. The already-open public page must re-render BOTH iframes via the
    //    BroadcastChannel invalidation — no navigation, no reload.
    await expect(
      page.locator('iframe[title="Spirecut Surgery Technique"]'),
    ).toHaveAttribute('src', new RegExp(TEST_CT_VIDEO_ID), { timeout: 12_000 });

    await expect(
      page.locator('iframe[title="Spirecut Trigger Finger"]'),
    ).toHaveAttribute('src', new RegExp(TEST_TF_VIDEO_ID), { timeout: 12_000 });

    await adminPage.close();
  } finally {
    await Promise.all([
      resetSetting('sp_video_ct_url', originalCt),
      resetSetting('sp_video_tf_url', originalTf),
    ]);
  }
});

// ── Fallback to SP_DEFAULTS when video URL is cleared (empty string saved) ─────

test('clearing sp_video_ct_url causes the public page to show the default CT embed', async ({ context }) => {
  const originalCt = await getCurrentValue('sp_video_ct_url');

  try {
    // 1. Save an empty string directly via the API (bypassing the browser URL
    //    input) to test the server-side + hook fallback path.
    await resetSetting('sp_video_ct_url', '');

    // 2. Open the public page in a fresh context page — cold singleton, real fetch
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/so-funktioniert-es`);

    // 3. The CT iframe must fall back to the SP_DEFAULTS embed URL
    //    Default: https://www.youtube.com/embed/jDStbSFduO8?rel=0
    await expect(
      publicPage.locator('iframe[title="Spirecut Surgery Technique"]'),
    ).toHaveAttribute('src', /jDStbSFduO8/, { timeout: 10_000 });

    await publicPage.close();
  } finally {
    await resetSetting('sp_video_ct_url', originalCt);
  }
});

test('clearing sp_video_tf_url causes the public page to show the default TF embed', async ({ context }) => {
  const originalTf = await getCurrentValue('sp_video_tf_url');

  try {
    // 1. Save an empty string directly via the API
    await resetSetting('sp_video_tf_url', '');

    // 2. Open the public page in a fresh context page — cold singleton, real fetch
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/so-funktioniert-es`);

    // 3. The TF iframe must fall back to the SP_DEFAULTS embed URL
    //    Default: https://www.youtube.com/embed/QbOlsFMTbJo?rel=0
    await expect(
      publicPage.locator('iframe[title="Spirecut Trigger Finger"]'),
    ).toHaveAttribute('src', /QbOlsFMTbJo/, { timeout: 10_000 });

    await publicPage.close();
  } finally {
    await resetSetting('sp_video_tf_url', originalTf);
  }
});

// ── UI-driven clear: TF video falls back to SP_DEFAULTS ───────────────────────
//
// Distinct from the API-based fallback test above.  Here the admin opens the
// Settings panel, clears the TF URL input, and clicks Save — exactly the flow
// a real admin would follow.  This exercises the client-side save path
// (including the BroadcastChannel invalidation fired by Admin.tsx) rather than
// the raw POST endpoint.  The public page is then loaded in a fresh context to
// confirm the fallback embed URL is served.

test('clearing sp_video_tf_url via the admin UI causes the public page to fall back to the default TF embed', async ({ page, context }) => {
  const originalTf = await getCurrentValue('sp_video_tf_url');

  // Pre-seed with a known non-default URL so there is something to clear.
  // This guarantees the test starts from a state where the override is active.
  await resetSetting('sp_video_tf_url', TEST_TF_URL);

  try {
    // 1. Admin: log in and open Settings
    await loginAsAdmin(page);
    await openSettingsTab(page);

    // 2. Locate the TF card and clear the URL input
    const tfCard = page.locator('div.bg-white').filter({ hasText: 'Video \u2013 Schnappfinger' }).first();
    const tfInput = tfCard.locator('input[type="url"]').first();
    await tfInput.fill('');

    // 3. Click Save — the empty string is persisted; the server stores '' which
    //    causes the hook to fall back to SP_DEFAULTS.sp_video_tf_url.
    await tfCard.locator('button').first().click();
    await expect(tfCard.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // 4. Open the public HowItWorks page in a NEW tab (fresh singleton cache)
    //    so the re-fetch picks up the now-empty server value.
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/so-funktioniert-es`);

    // 5. The TF iframe must fall back to the SP_DEFAULTS embed URL:
    //    https://www.youtube.com/embed/QbOlsFMTbJo
    const tfIframe = publicPage.locator('iframe[title="Spirecut Trigger Finger"]');
    await expect(tfIframe).toBeVisible({ timeout: 10_000 });
    await expect(tfIframe).toHaveAttribute('src', /QbOlsFMTbJo/);

    await publicPage.close();
  } finally {
    // Always restore — covers the case where originalTf is an empty string
    await resetSetting('sp_video_tf_url', originalTf);
  }
});

// ── URL validation visibility — mobile & desktop viewports ────────────────────
//
// These tests verify that the inline error message ("Ungültige URL …") and the
// red-border input remain fully visible and not clipped by overflow when an
// admin enters a syntactically invalid URL and clicks Save.
//
// Strategy:
//   • Enter a bad URL (no scheme) → click Save → error paragraph must appear
//   • boundingBox() check confirms the element is rendered inside the viewport
//     width, i.e. not pushed out by CSS flex or card overflow:hidden.
//
// Viewports tested:
//   desktop  — 1 280 × 800  (baseline)
//   mobile   — 390 × 844    (iPhone 14 / similar narrow phone)

const BAD_URL = 'not-a-valid-url';
const CT_ERROR_TEXT_DE = 'Ungültige URL';

for (const { label, width, height } of [
  { label: 'desktop (1280×800)',  width: 1280, height: 800  },
  { label: 'mobile (390×844)',    width: 390,  height: 844  },
]) {
  test(`CT video field: inline error is visible and in-viewport at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });

    await loginAsAdmin(page);
    await openSettingsTab(page);

    // Locate the CT card
    const ctCard = page.locator('div.bg-white').filter({ hasText: 'Video – Karpaltunnelsyndrom' }).first();

    // Clear the input and type a bad URL
    const ctInput = ctCard.locator('input[type="url"]').first();
    await ctInput.fill(BAD_URL);

    // Click Save — should be blocked by client-side validation
    await ctCard.locator('button').first().click();

    // The error paragraph must be visible
    const errorPara = ctCard.locator('p.text-red-600').filter({ hasText: CT_ERROR_TEXT_DE });
    await expect(errorPara).toBeVisible({ timeout: 5_000 });

    // Verify it is not clipped outside the viewport (bounding box within page width)
    const box = await errorPara.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    // Right edge must sit within the viewport (allow 1 px rounding)
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);

    // The input must also carry the red border class
    await expect(ctInput).toHaveClass(/border-red-400/);

    // Confirm the settings API was NOT called (no network save for bad URL)
    // — the error must fire before any fetch, so sp_video_ct_url is unchanged.
    // We do NOT restore here because we never actually saved anything.
  });

  test(`TF video field: inline error is visible and in-viewport at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });

    await loginAsAdmin(page);
    await openSettingsTab(page);

    // Locate the TF card
    const tfCard = page.locator('div.bg-white').filter({ hasText: 'Video – Schnappfinger' }).first();

    // Clear the input and type a bad URL
    const tfInput = tfCard.locator('input[type="url"]').first();
    await tfInput.fill(BAD_URL);

    // Click Save — should be blocked by client-side validation
    await tfCard.locator('button').first().click();

    // The error paragraph must be visible
    const errorPara = tfCard.locator('p.text-red-600').filter({ hasText: CT_ERROR_TEXT_DE });
    await expect(errorPara).toBeVisible({ timeout: 5_000 });

    // Verify it is not clipped outside the viewport
    const box = await errorPara.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);

    // The input must also carry the red border class
    await expect(tfInput).toHaveClass(/border-red-400/);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Praktische Informationen video slots (sp_video_praktisch_1_url / _2_url)
// ═══════════════════════════════════════════════════════════════════════════════
//
// These tests mirror the CT/TF pattern above.
// Public page: /spirecut-patient/praktische-informationen
// iframe titles come from t("praktisch.video1Title") / t("praktisch.video2Title")
// which resolve to "Video 1" / "Video 2" in the default (DE) locale.
// The video section is only rendered when at least one URL is non-empty, so
// every test that reads the public page must have set a non-empty value first.

const TEST_P1_VIDEO_ID = 'AAAAAAAAAP1';
const TEST_P2_VIDEO_ID = 'AAAAAAAAAP2';
const TEST_P1_URL = `https://www.youtube.com/embed/${TEST_P1_VIDEO_ID}?rel=0`;
const TEST_P2_URL = `https://www.youtube.com/embed/${TEST_P2_VIDEO_ID}?rel=0`;

// ── Praktisch slot 1 — cold-cache tab ─────────────────────────────────────────

test('Praktisch video 1 embed updates on the public page after admin saves a new URL', async ({ page, context }) => {
  const originalP1 = await getCurrentValue('sp_video_praktisch_1_url');

  try {
    // 1. Admin: log in and open settings
    await loginAsAdmin(page);
    await openSettingsTab(page);

    // 2. Fill in the Praktisch 1 video URL and save
    const p1Card = page.locator('div.bg-white').filter({ hasText: 'Video \u2013 Praktische Info 1' }).first();
    const p1Input = p1Card.locator('input[type="url"]').first();
    await p1Input.fill(TEST_P1_URL);
    await p1Card.locator('button').first().click();
    await expect(p1Card.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // 3. Open the public Praktische Informationen page in a NEW tab (cold singleton cache)
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/praktische-informationen`);

    // 4. The Video 1 iframe must reflect the new video ID
    const p1Iframe = publicPage.locator('iframe[title="Video 1"]');
    await expect(p1Iframe).toBeVisible({ timeout: 10_000 });
    await expect(p1Iframe).toHaveAttribute('src', new RegExp(TEST_P1_VIDEO_ID));

    await publicPage.close();
  } finally {
    await resetSetting('sp_video_praktisch_1_url', originalP1);
  }
});

// ── Praktisch slot 2 — cold-cache tab ─────────────────────────────────────────

test('Praktisch video 2 embed updates on the public page after admin saves a new URL', async ({ page, context }) => {
  const originalP2 = await getCurrentValue('sp_video_praktisch_2_url');

  try {
    // 1. Admin: log in and open settings
    await loginAsAdmin(page);
    await openSettingsTab(page);

    // 2. Fill in the Praktisch 2 video URL and save
    const p2Card = page.locator('div.bg-white').filter({ hasText: 'Video \u2013 Praktische Info 2' }).first();
    const p2Input = p2Card.locator('input[type="url"]').first();
    await p2Input.fill(TEST_P2_URL);
    await p2Card.locator('button').first().click();
    await expect(p2Card.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // 3. Open the public Praktische Informationen page in a NEW tab (cold singleton cache)
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/praktische-informationen`);

    // 4. The Video 2 iframe must reflect the new video ID
    const p2Iframe = publicPage.locator('iframe[title="Video 2"]');
    await expect(p2Iframe).toBeVisible({ timeout: 10_000 });
    await expect(p2Iframe).toHaveAttribute('src', new RegExp(TEST_P2_VIDEO_ID));

    await publicPage.close();
  } finally {
    await resetSetting('sp_video_praktisch_2_url', originalP2);
  }
});

// ── BroadcastChannel: Praktisch slot 1 — already-open page ────────────────────

test('same-context BroadcastChannel: public page re-renders Praktisch video 1 without navigation after admin saves', async ({ page, context }) => {
  const originalP1 = await getCurrentValue('sp_video_praktisch_1_url');

  // The video section only appears when a URL is set — ensure slot 1 is pre-seeded
  // so the iframe is present in the DOM before the admin makes a change.
  await resetSetting('sp_video_praktisch_1_url', TEST_P1_URL);

  try {
    // 1. Load the public page so the hook + BroadcastChannel listener are active
    await page.goto(`${BASE}/praktische-informationen`);
    await page.waitForSelector('iframe[title="Video 1"]', { timeout: 10_000 });

    // 2. Open the admin panel in a second tab of the SAME browser context
    const adminPage = await context.newPage();
    await loginAsAdmin(adminPage);
    await openSettingsTab(adminPage);

    // 3. Save a different URL to trigger invalidation
    const NEW_P1_ID = 'BBBBBBBBBP1';
    const NEW_P1_URL = `https://www.youtube.com/embed/${NEW_P1_ID}?rel=0`;
    const p1Card = adminPage.locator('div.bg-white').filter({ hasText: 'Video \u2013 Praktische Info 1' }).first();
    await p1Card.locator('input[type="url"]').first().fill(NEW_P1_URL);
    await p1Card.locator('button').first().click();
    await expect(p1Card.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // 4. The already-open public page must re-render via BroadcastChannel
    await expect(
      page.locator('iframe[title="Video 1"]'),
    ).toHaveAttribute('src', new RegExp(NEW_P1_ID), { timeout: 10_000 });

    await adminPage.close();
  } finally {
    await resetSetting('sp_video_praktisch_1_url', originalP1);
  }
});

// ── BroadcastChannel: Praktisch slot 2 — already-open page ────────────────────

test('same-context BroadcastChannel: public page re-renders Praktisch video 2 without navigation after admin saves', async ({ page, context }) => {
  const originalP2 = await getCurrentValue('sp_video_praktisch_2_url');

  // Pre-seed slot 2 so its iframe exists in the DOM when the public page loads.
  await resetSetting('sp_video_praktisch_2_url', TEST_P2_URL);

  try {
    // 1. Load the public page so the hook + BroadcastChannel listener are active
    await page.goto(`${BASE}/praktische-informationen`);
    await page.waitForSelector('iframe[title="Video 2"]', { timeout: 10_000 });

    // 2. Open the admin panel in a second tab of the SAME browser context
    const adminPage = await context.newPage();
    await loginAsAdmin(adminPage);
    await openSettingsTab(adminPage);

    // 3. Save a different URL to trigger invalidation
    const NEW_P2_ID = 'BBBBBBBBBP2';
    const NEW_P2_URL = `https://www.youtube.com/embed/${NEW_P2_ID}?rel=0`;
    const p2Card = adminPage.locator('div.bg-white').filter({ hasText: 'Video \u2013 Praktische Info 2' }).first();
    await p2Card.locator('input[type="url"]').first().fill(NEW_P2_URL);
    await p2Card.locator('button').first().click();
    await expect(p2Card.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // 4. The already-open public page must re-render via BroadcastChannel
    await expect(
      page.locator('iframe[title="Video 2"]'),
    ).toHaveAttribute('src', new RegExp(NEW_P2_ID), { timeout: 10_000 });

    await adminPage.close();
  } finally {
    await resetSetting('sp_video_praktisch_2_url', originalP2);
  }
});

// ── Both praktisch slots updated back-to-back: cold-cache tab ─────────────────

test('both Praktisch video slots updated back-to-back: public page shows both new iframes after second save', async ({ page, context }) => {
  const originalP1 = await getCurrentValue('sp_video_praktisch_1_url');
  const originalP2 = await getCurrentValue('sp_video_praktisch_2_url');

  try {
    // 1. Admin: log in and open settings
    await loginAsAdmin(page);
    await openSettingsTab(page);

    const p1Card = page.locator('div.bg-white').filter({ hasText: 'Video \u2013 Praktische Info 1' }).first();
    const p2Card = page.locator('div.bg-white').filter({ hasText: 'Video \u2013 Praktische Info 2' }).first();

    // 2. Fill and save slot 1, then immediately fill and save slot 2
    await p1Card.locator('input[type="url"]').first().fill(TEST_P1_URL);
    await p1Card.locator('button').first().click();
    // Intentionally do NOT await "Gespeichert" before moving to slot 2
    await p2Card.locator('input[type="url"]').first().fill(TEST_P2_URL);
    await p2Card.locator('button').first().click();

    // 3. Wait for both save confirmations to settle
    await expect(p1Card.locator('text=Gespeichert')).toBeVisible({ timeout: 10_000 });
    await expect(p2Card.locator('text=Gespeichert')).toBeVisible({ timeout: 10_000 });

    // 4. Open the public page in a fresh tab — cold singleton, real fetch
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/praktische-informationen`);

    // 5. Both iframes must reflect the new video IDs
    await expect(
      publicPage.locator('iframe[title="Video 1"]'),
    ).toHaveAttribute('src', new RegExp(TEST_P1_VIDEO_ID), { timeout: 10_000 });

    await expect(
      publicPage.locator('iframe[title="Video 2"]'),
    ).toHaveAttribute('src', new RegExp(TEST_P2_VIDEO_ID), { timeout: 10_000 });

    await publicPage.close();
  } finally {
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', originalP1),
      resetSetting('sp_video_praktisch_2_url', originalP2),
    ]);
  }
});

// ── BroadcastChannel: both praktisch slots updated concurrently ───────────────

test('same-context BroadcastChannel: already-open page re-renders both Praktisch videos after back-to-back admin saves', async ({ page, context }) => {
  const originalP1 = await getCurrentValue('sp_video_praktisch_1_url');
  const originalP2 = await getCurrentValue('sp_video_praktisch_2_url');

  // Pre-seed both slots so the iframes exist when the public page first loads.
  await Promise.all([
    resetSetting('sp_video_praktisch_1_url', TEST_P1_URL),
    resetSetting('sp_video_praktisch_2_url', TEST_P2_URL),
  ]);

  try {
    // 1. Load the public page first so both iframes and the BroadcastChannel
    //    listener are already active.
    await page.goto(`${BASE}/praktische-informationen`);
    await page.waitForSelector('iframe[title="Video 1"]', { timeout: 10_000 });

    // 2. Open the admin panel in a second tab of the SAME browser context
    const adminPage = await context.newPage();
    await loginAsAdmin(adminPage);
    await openSettingsTab(adminPage);

    const p1Card = adminPage.locator('div.bg-white').filter({ hasText: 'Video \u2013 Praktische Info 1' }).first();
    const p2Card = adminPage.locator('div.bg-white').filter({ hasText: 'Video \u2013 Praktische Info 2' }).first();

    const NEW_P1_ID = 'CCCCCCCCP1X';
    const NEW_P2_ID = 'CCCCCCCCP2X';

    // 3. Save slot 1 and immediately save slot 2 (no await between) — exercises
    //    the race where the second BroadcastChannel invalidation arrives while the
    //    first re-fetch is still in flight.
    await p1Card.locator('input[type="url"]').first().fill(`https://www.youtube.com/embed/${NEW_P1_ID}?rel=0`);
    await p1Card.locator('button').first().click();
    // No await on "Gespeichert" — intentional back-to-back
    await p2Card.locator('input[type="url"]').first().fill(`https://www.youtube.com/embed/${NEW_P2_ID}?rel=0`);
    await p2Card.locator('button').first().click();

    // 4. Wait for both saves to settle on the admin page
    await expect(p1Card.locator('text=Gespeichert')).toBeVisible({ timeout: 10_000 });
    await expect(p2Card.locator('text=Gespeichert')).toBeVisible({ timeout: 10_000 });

    // 5. The already-open public page must re-render BOTH iframes via
    //    BroadcastChannel invalidation — no navigation, no reload.
    await expect(
      page.locator('iframe[title="Video 1"]'),
    ).toHaveAttribute('src', new RegExp(NEW_P1_ID), { timeout: 12_000 });

    await expect(
      page.locator('iframe[title="Video 2"]'),
    ).toHaveAttribute('src', new RegExp(NEW_P2_ID), { timeout: 12_000 });

    await adminPage.close();
  } finally {
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', originalP1),
      resetSetting('sp_video_praktisch_2_url', originalP2),
    ]);
  }
});

// ── Both praktisch URLs cleared → video section must be hidden ────────────────
//
// When both sp_video_praktisch_1_url and sp_video_praktisch_2_url are empty
// strings, the hasVideos guard in PraktischeInformationen.tsx evaluates to
// falsy and the entire <section> is not rendered.  This test verifies that
// fallback path so a regression (e.g. a default embed sneaking in) is caught.
//
// Task 190 adds the inverse path directly below: saving a URL after both were
// empty must cause the section to reappear immediately on a fresh page load.

test('video section is hidden on /praktische-informationen when both URLs are cleared', async ({ context }) => {
  const originalP1 = await getCurrentValue('sp_video_praktisch_1_url');
  const originalP2 = await getCurrentValue('sp_video_praktisch_2_url');

  try {
    // 1. Clear both praktisch video URLs via the API
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', ''),
      resetSetting('sp_video_praktisch_2_url', ''),
    ]);

    // 2. Open the public page in a fresh context page (cold singleton cache)
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/praktische-informationen`);

    // 3. Wait for the page to be sufficiently loaded — the main heading must be
    //    present so we are not testing a blank-page race condition.
    await publicPage.waitForSelector('h1', { timeout: 10_000 });

    // 4. Neither iframe must exist in the DOM
    await expect(publicPage.locator('iframe[title="Video 1"]')).toHaveCount(0);
    await expect(publicPage.locator('iframe[title="Video 2"]')).toHaveCount(0);

    // 5. The dark video section itself must not be rendered
    //    (it carries a bg-gray-900 class when present)
    await expect(publicPage.locator('section.bg-gray-900')).toHaveCount(0);

    await publicPage.close();
  } finally {
    // Always restore — ensures other tests are not affected by cleared URLs
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', originalP1),
      resetSetting('sp_video_praktisch_2_url', originalP2),
    ]);
  }
});

// ── Inverse of Task 170: section reappears after a URL is saved when both were cleared ──
//
// This covers the hasVideos guard re-enabling after the admin restores a URL.
// Without this test a regression where the section stays hidden after
// restoration would go undetected.
//
// Flow:
//   1. Clear both URLs via the API → confirm section is absent (cold page)
//   2. Save a valid URL for slot 1 via the admin settings panel
//   3. Open a fresh page → confirm the video section and Video 1 iframe reappear
//   4. Restore original values

test('video section reappears on /praktische-informationen after admin adds a URL back when both were cleared', async ({ page, context }) => {
  const originalP1 = await getCurrentValue('sp_video_praktisch_1_url');
  const originalP2 = await getCurrentValue('sp_video_praktisch_2_url');

  try {
    // 1. Clear both praktisch video URLs via the API
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', ''),
      resetSetting('sp_video_praktisch_2_url', ''),
    ]);

    // 2. Confirm the video section is absent on a fresh cold-cache page load
    const blankPage = await context.newPage();
    await blankPage.goto(`${BASE}/praktische-informationen`);
    await blankPage.waitForSelector('h1', { timeout: 10_000 });
    await expect(blankPage.locator('section.bg-gray-900')).toHaveCount(0);
    await expect(blankPage.locator('iframe[title="Video 1"]')).toHaveCount(0);
    await blankPage.close();

    // 3. Admin saves a valid URL for slot 1 via the settings panel
    await loginAsAdmin(page);
    await openSettingsTab(page);

    const p1Card = page.locator('div.bg-white').filter({ hasText: 'Video \u2013 Praktische Info 1' }).first();
    const p1Input = p1Card.locator('input[type="url"]').first();
    await p1Input.fill(TEST_P1_URL);
    await p1Card.locator('button').first().click();
    await expect(p1Card.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // 4. Open the public page in a NEW cold-cache tab — singleton cache is fresh
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/praktische-informationen`);

    // 5. The video section must now be rendered
    await expect(publicPage.locator('section.bg-gray-900')).toBeVisible({ timeout: 10_000 });

    // 6. The Video 1 iframe must carry the newly saved URL
    const p1Iframe = publicPage.locator('iframe[title="Video 1"]');
    await expect(p1Iframe).toBeVisible({ timeout: 10_000 });
    await expect(p1Iframe).toHaveAttribute('src', new RegExp(TEST_P1_VIDEO_ID));

    // 7. Slot 2 was left empty — its iframe must NOT appear
    await expect(publicPage.locator('iframe[title="Video 2"]')).toHaveCount(0);

    await publicPage.close();
  } finally {
    // Always restore both slots so no other test inherits a dirty state
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', originalP1),
      resetSetting('sp_video_praktisch_2_url', originalP2),
    ]);
  }
});

// ── Fallback to SP_DEFAULTS when individual praktisch URL is cleared ───────────
//
// SP_DEFAULTS for sp_video_praktisch_1_url and sp_video_praktisch_2_url are
// both empty strings.  Saving an empty string causes the hook's nonEmpty filter
// to exclude the key so the SP_DEFAULTS value ('') is applied — the iframe for
// that slot must disappear on a fresh page load.
//
// Each test:
//   1. Pre-seeds the slot with a known URL (so the iframe is initially visible)
//   2. Saves '' via the API (simulating a clear)
//   3. Opens a cold-cache page and confirms the iframe is gone
//   4. Restores the original value in finally
//
// The other slot is pre-seeded with a valid URL and restored, so the hasVideos
// guard stays truthy and we can verify only the cleared slot's iframe disappears.

test('clearing sp_video_praktisch_1_url causes the Video 1 iframe to disappear (falls back to empty default)', async ({ context }) => {
  const originalP1 = await getCurrentValue('sp_video_praktisch_1_url');
  const originalP2 = await getCurrentValue('sp_video_praktisch_2_url');

  try {
    // Pre-seed slot 2 so the video section (hasVideos guard) remains rendered,
    // and pre-seed slot 1 so there is something to clear.
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', TEST_P1_URL),
      resetSetting('sp_video_praktisch_2_url', TEST_P2_URL),
    ]);

    // Confirm slot 1 iframe is initially visible on a fresh page load.
    const seedPage = await context.newPage();
    await seedPage.goto(`${BASE}/praktische-informationen`);
    await expect(seedPage.locator('iframe[title="Video 1"]')).toBeVisible({ timeout: 10_000 });
    await seedPage.close();

    // Clear slot 1 via the API — the hook will fall back to SP_DEFAULTS ('').
    await resetSetting('sp_video_praktisch_1_url', '');

    // Open a fresh cold-cache page and confirm Video 1 iframe is gone.
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/praktische-informationen`);
    // The section still renders because slot 2 is non-empty (hasVideos is truthy).
    await publicPage.waitForSelector('h1', { timeout: 10_000 });
    await expect(publicPage.locator('iframe[title="Video 1"]')).toHaveCount(0);
    // Slot 2 iframe must still be present.
    await expect(publicPage.locator('iframe[title="Video 2"]')).toBeVisible({ timeout: 10_000 });
    await publicPage.close();
  } finally {
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', originalP1),
      resetSetting('sp_video_praktisch_2_url', originalP2),
    ]);
  }
});

test('clearing sp_video_praktisch_2_url causes the Video 2 iframe to disappear (falls back to empty default)', async ({ context }) => {
  const originalP1 = await getCurrentValue('sp_video_praktisch_1_url');
  const originalP2 = await getCurrentValue('sp_video_praktisch_2_url');

  try {
    // Pre-seed both slots so the video section is fully rendered initially.
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', TEST_P1_URL),
      resetSetting('sp_video_praktisch_2_url', TEST_P2_URL),
    ]);

    // Confirm slot 2 iframe is initially visible on a fresh page load.
    const seedPage = await context.newPage();
    await seedPage.goto(`${BASE}/praktische-informationen`);
    await expect(seedPage.locator('iframe[title="Video 2"]')).toBeVisible({ timeout: 10_000 });
    await seedPage.close();

    // Clear slot 2 via the API — the hook will fall back to SP_DEFAULTS ('').
    await resetSetting('sp_video_praktisch_2_url', '');

    // Open a fresh cold-cache page and confirm Video 2 iframe is gone.
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/praktische-informationen`);
    await publicPage.waitForSelector('h1', { timeout: 10_000 });
    await expect(publicPage.locator('iframe[title="Video 2"]')).toHaveCount(0);
    // Slot 1 iframe must still be present (slot 1 was not cleared).
    await expect(publicPage.locator('iframe[title="Video 1"]')).toBeVisible({ timeout: 10_000 });
    await publicPage.close();
  } finally {
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', originalP1),
      resetSetting('sp_video_praktisch_2_url', originalP2),
    ]);
  }
});

// ── UI-driven clear: Praktisch slot 1 falls back to empty default ──────────────
//
// The admin opens the Settings panel, clears the slot-1 URL input, and clicks
// Save.  Exercises the client-side save path (including the BroadcastChannel
// invalidation from Admin.tsx).  Slot 2 is pre-seeded so the section stays
// visible and we can confirm only slot 1's iframe disappears.
//
// Card heading in Admin.tsx: "Video 1 – Praktische Informationen"
// Each card has two save buttons: index 0 = title, index 1 = URL (nth(1)).

test('clearing sp_video_praktisch_1_url via the admin UI causes the Video 1 iframe to disappear (falls back to empty default)', async ({ page, context }) => {
  const originalP1 = await getCurrentValue('sp_video_praktisch_1_url');
  const originalP2 = await getCurrentValue('sp_video_praktisch_2_url');

  try {
    // Pre-seed both slots inside try so partial failures are cleaned up.
    // Slot 1 gets a real URL so there is something to clear; slot 2 stays
    // non-empty so hasVideos stays truthy and the section remains rendered.
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', TEST_P1_URL),
      resetSetting('sp_video_praktisch_2_url', TEST_P2_URL),
    ]);

    // 1. Admin: log in and open Settings
    await loginAsAdmin(page);
    await openSettingsTab(page);

    // 2. Locate the Praktisch 1 card by its actual heading text and clear the
    //    URL input.  nth(1) targets the URL save button (0 = title save button).
    const p1Card = page.locator('div.bg-white').filter({ hasText: 'Video 1 \u2013 Praktische Informationen' }).first();
    const p1Input = p1Card.locator('input[type="url"]').first();
    await p1Input.fill('');

    // 3. Click the URL save button — the empty string is persisted;
    //    the hook falls back to SP_DEFAULTS ('') for this slot.
    await p1Card.locator('button').nth(1).click();
    await expect(p1Card.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // 4. Open the public page in a NEW cold-cache tab
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/praktische-informationen`);
    await publicPage.waitForSelector('h1', { timeout: 10_000 });

    // 5. Video 1 iframe must be gone (fell back to empty default)
    await expect(publicPage.locator('iframe[title="Video 1"]')).toHaveCount(0);
    // Video 2 iframe must still appear (slot 2 was not cleared)
    await expect(publicPage.locator('iframe[title="Video 2"]')).toBeVisible({ timeout: 10_000 });

    await publicPage.close();
  } finally {
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', originalP1),
      resetSetting('sp_video_praktisch_2_url', originalP2),
    ]);
  }
});

// ── UI-driven clear: Praktisch slot 2 falls back to empty default ──────────────

test('clearing sp_video_praktisch_2_url via the admin UI causes the Video 2 iframe to disappear (falls back to empty default)', async ({ page, context }) => {
  const originalP1 = await getCurrentValue('sp_video_praktisch_1_url');
  const originalP2 = await getCurrentValue('sp_video_praktisch_2_url');

  try {
    // Pre-seed both slots inside try so partial failures are cleaned up.
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', TEST_P1_URL),
      resetSetting('sp_video_praktisch_2_url', TEST_P2_URL),
    ]);

    // 1. Admin: log in and open Settings
    await loginAsAdmin(page);
    await openSettingsTab(page);

    // 2. Locate the Praktisch 2 card by its actual heading text and clear the
    //    URL input.  nth(1) targets the URL save button (0 = title save button).
    const p2Card = page.locator('div.bg-white').filter({ hasText: 'Video 2 \u2013 Praktische Informationen' }).first();
    const p2Input = p2Card.locator('input[type="url"]').first();
    await p2Input.fill('');

    // 3. Click the URL save button — the empty string is persisted;
    //    the hook falls back to SP_DEFAULTS ('') for this slot.
    await p2Card.locator('button').nth(1).click();
    await expect(p2Card.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // 4. Open the public page in a NEW cold-cache tab
    const publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/praktische-informationen`);
    await publicPage.waitForSelector('h1', { timeout: 10_000 });

    // 5. Video 2 iframe must be gone (fell back to empty default)
    await expect(publicPage.locator('iframe[title="Video 2"]')).toHaveCount(0);
    // Video 1 iframe must still appear (slot 1 was not cleared)
    await expect(publicPage.locator('iframe[title="Video 1"]')).toBeVisible({ timeout: 10_000 });

    await publicPage.close();
  } finally {
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', originalP1),
      resetSetting('sp_video_praktisch_2_url', originalP2),
    ]);
  }
});

// ── BroadcastChannel: section reappears on already-open page after both URLs were cleared ──
//
// This is the BroadcastChannel counterpart to the cold-cache test above (Task 190).
// An already-open /praktische-informationen page (loaded while both URLs were empty,
// so hasVideos was falsy and the section was never rendered) must re-render the video
// section immediately when the admin saves a URL — driven by the BroadcastChannel
// invalidation — without the user navigating away or refreshing.
//
// Flow:
//   1. Clear both URLs via the API
//   2. Open the public page — section absent
//   3. In a second tab of the SAME context, admin saves a valid URL for slot 1
//   4. The already-open page must show the video section and Video 1 iframe
//   5. Restore original values

test('same-context BroadcastChannel: already-open page shows video section after admin adds a URL back when both were cleared', async ({ page, context }) => {
  const originalP1 = await getCurrentValue('sp_video_praktisch_1_url');
  const originalP2 = await getCurrentValue('sp_video_praktisch_2_url');

  try {
    // 1. Clear both praktisch video URLs via the API so hasVideos starts as falsy
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', ''),
      resetSetting('sp_video_praktisch_2_url', ''),
    ]);

    // 2. Open the public page while both URLs are empty — the video section must
    //    be absent and the BroadcastChannel listener must be active in this tab.
    await page.goto(`${BASE}/praktische-informationen`);
    await page.waitForSelector('h1', { timeout: 10_000 });
    // Confirm section is absent before we proceed
    await expect(page.locator('section.bg-gray-900')).toHaveCount(0);
    await expect(page.locator('iframe[title="Video 1"]')).toHaveCount(0);

    // 3. Open the admin panel in a SECOND tab of the SAME browser context so
    //    BroadcastChannel messages are delivered to the still-open public page.
    const adminPage = await context.newPage();
    await loginAsAdmin(adminPage);
    await openSettingsTab(adminPage);

    // 4. Admin saves a valid URL for slot 1 — this triggers
    //    invalidateSpirecutSettingsCache() → BroadcastChannel message → public page
    //    re-fetches settings and re-evaluates hasVideos.
    const p1Card = adminPage.locator('div.bg-white').filter({ hasText: 'Video \u2013 Praktische Info 1' }).first();
    await p1Card.locator('input[type="url"]').first().fill(TEST_P1_URL);
    await p1Card.locator('button').first().click();
    await expect(p1Card.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // 5. The already-open public page must now render the video section
    //    without any navigation or reload — hasVideos becomes truthy after
    //    the BroadcastChannel-triggered re-fetch.
    await expect(
      page.locator('section.bg-gray-900'),
    ).toBeVisible({ timeout: 12_000 });

    // 6. The Video 1 iframe must carry the newly saved URL
    await expect(
      page.locator('iframe[title="Video 1"]'),
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.locator('iframe[title="Video 1"]'),
    ).toHaveAttribute('src', new RegExp(TEST_P1_VIDEO_ID), { timeout: 10_000 });

    // 7. Slot 2 was left empty — its iframe must still NOT appear
    await expect(page.locator('iframe[title="Video 2"]')).toHaveCount(0);

    await adminPage.close();
  } finally {
    // Always restore both slots so no other test inherits a dirty state
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', originalP1),
      resetSetting('sp_video_praktisch_2_url', originalP2),
    ]);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Settings tab round-trip: praktisch input pre-fill after navigate-away-and-back
// ═══════════════════════════════════════════════════════════════════════════════
//
// Task 171: Confirms that when the admin reopens the Settings tab (or navigates
// back to it after visiting another tab) the sp_video_praktisch_1_url and
// sp_video_praktisch_2_url inputs are pre-filled with the previously saved
// values.  This exercises the useEffect in Admin.tsx that calls
// /api/patient-settings whenever tab === "settings" becomes truthy.
//
// Flow:
//   1. Pre-seed both praktisch URLs via the API (bypassing the UI so the
//      saved state is known before the admin even opens the tab).
//   2. Log in as admin — initial tab is "Bilder" (images).
//   3. Click the Settings tab → wait for the card to appear → read both inputs.
//   4. Assert each input value matches the pre-seeded URL.
//   5. Navigate away to a different tab ("Bilder") and back to "Einstellungen".
//   6. Assert both inputs are still pre-filled (the useEffect re-fired and
//      repopulated spEdits from the API response).
//   7. Restore original values in finally.

test('Settings tab pre-fills sp_video_praktisch_1_url and sp_video_praktisch_2_url inputs on open and after navigate-away-and-back', async ({ page }) => {
  const originalP1 = await getCurrentValue('sp_video_praktisch_1_url');
  const originalP2 = await getCurrentValue('sp_video_praktisch_2_url');

  // Distinct IDs for the two rounds — chosen so a stale spEdits (first-round
  // values held in component state) cannot accidentally satisfy the second-round
  // assertions.
  const ROUND1_P1_ID = 'ROUND1AAAP1';
  const ROUND1_P2_ID = 'ROUND1AAAP2';
  const ROUND2_P1_ID = 'ROUND2BBBP1';
  const ROUND2_P2_ID = 'ROUND2BBBP2';
  const ROUND1_P1_URL = `https://www.youtube.com/embed/${ROUND1_P1_ID}?rel=0`;
  const ROUND1_P2_URL = `https://www.youtube.com/embed/${ROUND1_P2_ID}?rel=0`;
  const ROUND2_P1_URL = `https://www.youtube.com/embed/${ROUND2_P1_ID}?rel=0`;
  const ROUND2_P2_URL = `https://www.youtube.com/embed/${ROUND2_P2_ID}?rel=0`;

  try {
    // Seed Round 1 values so the Settings tab has something to load.
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', ROUND1_P1_URL),
      resetSetting('sp_video_praktisch_2_url', ROUND1_P2_URL),
    ]);

    // ── Round 1: first open ─────────────────────────────────────────────────
    // Log in; the admin panel defaults to the "Bilder" tab.
    await loginAsAdmin(page);

    // Click Settings → useEffect fires → fetches /api/patient-settings
    await openSettingsTab(page);

    const p1Card = page.locator('div.bg-white').filter({ hasText: 'Video 1 \u2013 Praktische Informationen' }).first();
    const p2Card = page.locator('div.bg-white').filter({ hasText: 'Video 2 \u2013 Praktische Informationen' }).first();
    const p1Input = p1Card.locator('input[type="url"]').first();
    const p2Input = p2Card.locator('input[type="url"]').first();

    // Both inputs must reflect the Round 1 values on first open.
    await expect(p1Input).toHaveValue(ROUND1_P1_URL, { timeout: 8_000 });
    await expect(p2Input).toHaveValue(ROUND1_P2_URL, { timeout: 8_000 });

    // ── Navigate away ───────────────────────────────────────────────────────
    // Click "Bilder" tab — the component stays mounted (spEdits still holds
    // the Round 1 strings in state).
    await page.click('button:has-text("Bilder")');
    await page.waitForSelector('text=Startseite', { timeout: 8_000 });

    // While the admin is on the Bilder tab, update both URLs to Round 2 values
    // via the API.  When the Settings tab is reopened its useEffect must fetch
    // the new values and write them into spEdits — a missing re-fetch would
    // leave the stale Round 1 strings in the inputs, causing the assertions
    // below to fail deterministically.
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', ROUND2_P1_URL),
      resetSetting('sp_video_praktisch_2_url', ROUND2_P2_URL),
    ]);

    // ── Round 2: reopen Settings ────────────────────────────────────────────
    // Click Settings again → useEffect re-fires → re-fetches /api/patient-settings
    await openSettingsTab(page);

    const p1CardAgain = page.locator('div.bg-white').filter({ hasText: 'Video 1 \u2013 Praktische Informationen' }).first();
    const p2CardAgain = page.locator('div.bg-white').filter({ hasText: 'Video 2 \u2013 Praktische Informationen' }).first();
    const p1InputAgain = p1CardAgain.locator('input[type="url"]').first();
    const p2InputAgain = p2CardAgain.locator('input[type="url"]').first();

    // Both inputs must now show the Round 2 values loaded by the re-fetch.
    // Stale Round 1 state would differ → test fails if the re-fetch is broken.
    await expect(p1InputAgain).toHaveValue(ROUND2_P1_URL, { timeout: 8_000 });
    await expect(p2InputAgain).toHaveValue(ROUND2_P2_URL, { timeout: 8_000 });
  } finally {
    // Always restore — covers the case where originals were empty strings
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', originalP1),
      resetSetting('sp_video_praktisch_2_url', originalP2),
    ]);
  }
});

// ── BroadcastChannel: video section hides on already-open page when the last URL is cleared ──
//
// This is the reverse of the "section reappears" test above.  An already-open
// /praktische-informationen page (loaded while slot 1 was the only active URL,
// so the video section was visible) must hide the section immediately when the
// admin clears that last URL via the settings panel — driven by the
// BroadcastChannel invalidation — without the user navigating away or refreshing.
//
// Without this test a regression where hasVideos stays truthy after the last URL
// is deleted would go undetected.
//
// Flow:
//   1. Seed slot 1 with a valid URL (slot 2 stays empty) → hasVideos is truthy
//   2. Open the public page — video section (section.bg-gray-900) is visible
//   3. In a second tab of the SAME context, admin clears the slot 1 URL and saves
//   4. The already-open public page hides the section (count becomes 0)
//      without any navigation or reload
//   5. Restore original values

test('same-context BroadcastChannel: video section hides on already-open page when the last URL is cleared via admin settings', async ({ page, context }) => {
  const originalP1 = await getCurrentValue('sp_video_praktisch_1_url');
  const originalP2 = await getCurrentValue('sp_video_praktisch_2_url');

  // Pre-seed slot 1 with a valid URL; leave slot 2 empty so slot 1 is the ONLY
  // active URL.  This ensures hasVideos is truthy when the public page loads.
  await Promise.all([
    resetSetting('sp_video_praktisch_1_url', TEST_P1_URL),
    resetSetting('sp_video_praktisch_2_url', ''),
  ]);

  try {
    // 1. Open the public page while slot 1 is active — the video section must be
    //    visible and the BroadcastChannel listener must be active in this tab.
    await page.goto(`${BASE}/praktische-informationen`);
    await page.waitForSelector('section.bg-gray-900', { timeout: 10_000 });
    // Confirm the seeded Video 1 iframe is present before the admin makes any
    // change.  Use its URL because the editable title may be customized.
    const activeVideo = page.locator('section.bg-gray-900 iframe');
    await expect(activeVideo).toHaveCount(1, { timeout: 10_000 });
    await expect(activeVideo).toHaveAttribute('src', new RegExp(TEST_P1_VIDEO_ID));

    // 2. Open the admin panel in a SECOND tab of the SAME browser context so
    //    BroadcastChannel messages are delivered to the still-open public page.
    const adminPage = await context.newPage();
    await loginAsAdmin(adminPage);
    await openSettingsTab(adminPage);

    // 3. Locate the Praktisch 1 card and clear the URL input.
    //    nth(1) targets the URL save button (0 = title save button).
    const p1Card = adminPage.locator('div.bg-white').filter({ hasText: 'Video 1 \u2013 Praktische Informationen' }).first();
    const p1Input = p1Card.locator('input[type="url"]').first();
    await p1Input.fill('');

    // 4. Click the URL save button — the empty string is persisted.
    //    Admin.tsx calls invalidateSpirecutSettingsCache() which broadcasts a
    //    settings-invalidated message; the public page re-fetches and re-evaluates
    //    hasVideos (now falsy because both slots are empty).
    await p1Card.locator('button').nth(1).click();
    await expect(p1Card.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // 5. The already-open public page must hide the video section without any
    //    navigation or reload.  section.bg-gray-900 count must drop to 0.
    await expect(
      page.locator('section.bg-gray-900'),
    ).toHaveCount(0, { timeout: 12_000 });

    // 6. Neither iframe must remain in the DOM.
    await expect(page.locator('iframe[title="Video 1"]')).toHaveCount(0);
    await expect(page.locator('iframe[title="Video 2"]')).toHaveCount(0);

    await adminPage.close();
  } finally {
    // Always restore both slots so no other test inherits a dirty state.
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', originalP1),
      resetSetting('sp_video_praktisch_2_url', originalP2),
    ]);
  }
});

// ── BroadcastChannel: video section hides when slot 2 is the last URL cleared ──
//
// Symmetric coverage for the slot-1 test above.  Slot 2 is the only active URL
// when the public page opens, so clearing it must make hasVideos falsy and remove
// the entire section from the already-open page.

test('same-context BroadcastChannel: video section hides on already-open page when the slot 2 last URL is cleared via admin settings', async ({ page, context }) => {
  const originalP1 = await getCurrentValue('sp_video_praktisch_1_url');
  const originalP2 = await getCurrentValue('sp_video_praktisch_2_url');

  // Pre-seed only slot 2 with a valid URL.  Slot 1 must remain empty so slot 2
  // is the only active URL and the section disappears after it is cleared.
  await Promise.all([
    resetSetting('sp_video_praktisch_1_url', ''),
    resetSetting('sp_video_praktisch_2_url', TEST_P2_URL),
  ]);

  try {
    // 1. Open the public page while slot 2 is active.
    await page.goto(`${BASE}/praktische-informationen`);
    // Accept the patient gate so the shared browser context also permits the
    // admin tab's controls to receive clicks.
    await page.getByRole('button', { name: /Weiter/ }).click();
    await page.waitForSelector('section.bg-gray-900', { timeout: 10_000 });
    // Use the seeded URL rather than the editable iframe title: production
    // title settings may be customized independently of the URL slots.
    const activeVideo = page.locator('section.bg-gray-900 iframe');
    await expect(activeVideo).toHaveCount(1, { timeout: 10_000 });
    await expect(activeVideo).toHaveAttribute('src', new RegExp(TEST_P2_VIDEO_ID));

    // 2. Open the admin panel in a SECOND tab of the SAME browser context so
    // BroadcastChannel messages reach the still-open public page.
    const adminPage = await context.newPage();
    await loginAsAdmin(adminPage);
    await openSettingsTab(adminPage);

    // 3. Locate the Praktisch 2 card and clear its URL input.
    const p2Card = adminPage.locator('div.bg-white').filter({ hasText: 'Video 2 \u2013 Praktische Informationen' }).first();
    const p2Input = p2Card.locator('input[type="url"]').first();
    await p2Input.fill('');

    // 4. Save the empty URL, which broadcasts the settings invalidation.
    await p2Card.locator('button').nth(1).click();
    await expect(p2Card.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // 5. The already-open public page must hide the section without navigation.
    await expect(page.locator('section.bg-gray-900')).toHaveCount(0, { timeout: 12_000 });

    // 6. Neither iframe must remain in the DOM.
    await expect(page.locator('iframe[title="Video 1"]')).toHaveCount(0);
    await expect(page.locator('iframe[title="Video 2"]')).toHaveCount(0);

    await adminPage.close();
  } finally {
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', originalP1),
      resetSetting('sp_video_praktisch_2_url', originalP2),
    ]);
  }
});

// ── Invalid persisted praktisch videos stay hidden after a public-page reload ─
//
// New non-YouTube values are rejected by the admin UI and API, but older
// deployments may still contain them in the settings table.  This test seeds
// both slots through the real admin flow, then simulates those legacy values at
// the settings response boundary.  Reloading must not turn either invalid
// value into an empty/default iframe or destabilize the page.

test('invalid Praktisch videos stay hidden after reloading the public page', async ({ page, context }) => {
  const originalP1 = await getCurrentValue('sp_video_praktisch_1_url');
  const originalP2 = await getCurrentValue('sp_video_praktisch_2_url');
  let publicPage;

  try {
    // 1. Seed both slots through the admin settings flow so the public page
    //    proves that it can render the valid persisted values first.
    await loginAsAdmin(page);
    await openSettingsTab(page);

    const p1Card = page.locator('div.bg-white').filter({ hasText: 'Video 1 \u2013 Praktische Informationen' }).first();
    const p2Card = page.locator('div.bg-white').filter({ hasText: 'Video 2 \u2013 Praktische Informationen' }).first();
    await p1Card.locator('input[type="url"]').first().fill(TEST_P1_URL);
    await p1Card.locator('button').nth(1).click();
    await expect(p1Card.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });
    await p2Card.locator('input[type="url"]').first().fill(TEST_P2_URL);
    await p2Card.locator('button').nth(1).click();
    await expect(p2Card.locator('text=Gespeichert')).toBeVisible({ timeout: 8_000 });

    // 2. Load the public page once with the valid saved values.
    publicPage = await context.newPage();
    await publicPage.goto(`${BASE}/praktische-informationen`);
    const gateButton = publicPage.getByRole('button', { name: /Weiter/ });
    if (await gateButton.isVisible().catch(() => false)) {
      await gateButton.click();
    }
    await publicPage.waitForSelector('section.bg-gray-900', { timeout: 10_000 });
    const videoIframes = publicPage.locator('section.bg-gray-900 iframe');
    await expect(videoIframes).toHaveCount(2);
    await expect(videoIframes.nth(0)).toHaveAttribute('src', new RegExp(TEST_P1_VIDEO_ID));
    await expect(videoIframes.nth(1)).toHaveAttribute('src', new RegExp(TEST_P2_VIDEO_ID));

    // 3. Simulate an older persisted configuration containing non-YouTube
    //    values.  Keep all other live settings intact so this remains a
    //    browser-level test of the real settings store and page rendering.
    await publicPage.route('**/api/patient-settings', async (route) => {
      const response = await route.fetch();
      const settings = await response.json();
      settings.sp_video_praktisch_1_url = 'https://vimeo.com/111222333';
      settings.sp_video_praktisch_2_url = 'https://example.com/video/practical-2';
      await route.fulfill({
        response,
        body: JSON.stringify(settings),
      });
    });

    // 4. Reload the same public page.  Invalid persisted values must be
    //    normalized to empty embeds, not replaced with defaults.
    await publicPage.reload();
    await publicPage.waitForSelector('h1', { timeout: 10_000 });
    await expect(publicPage.locator('section.bg-gray-900')).toHaveCount(0);
    await expect(publicPage.locator('section.bg-gray-900 iframe')).toHaveCount(0);
  } finally {
    await publicPage?.close();
    await Promise.all([
      resetSetting('sp_video_praktisch_1_url', originalP1),
      resetSetting('sp_video_praktisch_2_url', originalP2),
    ]);
  }
});
