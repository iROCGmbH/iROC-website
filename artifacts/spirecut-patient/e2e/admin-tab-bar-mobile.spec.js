// @ts-check
/**
 * E2E: Admin tab bar stays usable on mobile (390 × 844 — iPhone 14 class).
 *
 * Verifies:
 *   1. Every tab button is visible and clickable in both supported locales.
 *   2. Clicking each tab does NOT cause page-level horizontal overflow
 *      (document.body.scrollWidth must not exceed window.innerWidth).
 *   3. Keyboard focus reaches every tab in both locales and has a visible
 *      outline beyond the active-tab border.
 *
 * The fix that introduced `overflow-x-auto` on the tab bar container is the
 * implementation guard; this test is the regression guard — it will fail if a
 * future tab addition or CSS change re-breaks the layout.
 */

import { test, expect } from '@playwright/test';

const BASE = '/spirecut-patient';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'iroc-admin-2024';

const MOBILE_VIEWPORT = { width: 390, height: 844 };

/** The four tab labels expected in the admin panel for each supported locale. */
const TAB_LABELS_BY_LANGUAGE = {
  de: ['Bilder', 'Social Media', 'Postoperative Daten', 'Einstellungen'],
  en: ['Images', 'Social Media', 'Postoperative Data', 'Settings'],
};

/** Log in as admin and wait for the tab bar to be present. */
async function loginAsAdmin(page, language = 'de') {
  // Dismiss the PatientGate before it can block interactions.
  // The gate checks sessionStorage('spirecut_patient_gate_passed') on mount;
  // pre-setting it via addInitScript prevents the modal from appearing at all.
  await page.addInitScript(() => {
    sessionStorage.setItem('spirecut_patient_gate_passed', '1');
    sessionStorage.removeItem('sp_admin_token');
  });
  await page.goto(`${BASE}/admin`);
  await page.waitForSelector('input[type="password"]');
  if (language === 'en') {
    await page.getByRole('button', { name: 'EN', exact: true }).click();
  }
  await page.fill('input[type="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  // Wait for the first tab button to confirm login succeeded and panel has rendered
  await page.waitForSelector(`button:has-text("${TAB_LABELS_BY_LANGUAGE[language][0]}")`, { timeout: 15_000 });
}

/**
 * Returns true when the page body does NOT overflow horizontally.
 * Evaluated inside the browser via page.evaluate so it uses the live DOM.
 */
async function hasNoHorizontalPageScroll(page) {
  return page.evaluate(
    () => document.body.scrollWidth <= window.innerWidth
  );
}

test.describe('Admin tab bar — mobile 390×844', () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test('all four tabs are reachable and clickable without page-level horizontal scroll', async ({ page }) => {
    await loginAsAdmin(page);

    // After login the tab bar is rendered — check no initial overflow
    const noOverflowAfterLogin = await hasNoHorizontalPageScroll(page);
    expect(
      noOverflowAfterLogin,
      'Page overflows horizontally before any tab is clicked'
    ).toBe(true);

    for (const label of TAB_LABELS_BY_LANGUAGE.de) {
      // The button must be in the DOM (it may need a scroll within the tab bar,
      // but page-level overflow must still be absent)
      const tabBtn = page.locator(`button:has-text("${label}")`).first();
      await expect(tabBtn).toBeVisible({ timeout: 8_000 });

      // Click the tab — this is the action that previously caused overflow
      await tabBtn.click();

      // After clicking, the page body must not overflow horizontally
      const noOverflow = await hasNoHorizontalPageScroll(page);
      expect(
        noOverflow,
        `Page overflows horizontally after clicking tab "${label}" (document.body.scrollWidth > window.innerWidth)`
      ).toBe(true);
    }
  });

  test('each tab button is within the visible viewport width after click', async ({ page }) => {
    await loginAsAdmin(page);

    for (const label of TAB_LABELS_BY_LANGUAGE.de) {
      const tabBtn = page.locator(`button:has-text("${label}")`).first();
      await expect(tabBtn).toBeVisible({ timeout: 8_000 });

      await tabBtn.click();

      // Verify the button's bounding box sits within the viewport width
      const box = await tabBtn.boundingBox();
      expect(box, `Could not get bounding box for tab "${label}"`).not.toBeNull();

      // The right edge of the button must be within the viewport (allow 1 px rounding)
      expect(box.x + box.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);

      // No page-level horizontal scroll after this click
      const noOverflow = await hasNoHorizontalPageScroll(page);
      expect(
        noOverflow,
        `Horizontal page scroll detected after clicking tab "${label}"`
      ).toBe(true);
    }
  });

  for (const [language, labels] of Object.entries(TAB_LABELS_BY_LANGUAGE)) {
    test(`each ${language} tab button stays visible with a visible keyboard focus indicator`, async ({ page }) => {
      await loginAsAdmin(page, language);

      const tabButtons = labels.map((label) =>
        page.locator(`button:has-text("${label}")`).first()
      );

      // Start from the beginning of the keyboard focus order. The language
      // controls and logout button come first, so advance until the first tab
      // receives focus rather than relying on a pointer click or direct focus().
      for (let attempts = 0; attempts < 20; attempts += 1) {
        await page.keyboard.press('Tab');
        const firstTabFocused = await tabButtons[0].evaluate(
          (element) => element === document.activeElement
        );
        if (firstTabFocused) break;

        if (attempts === 19) {
          throw new Error(`Could not reach the first ${language} admin tab with the Tab key`);
        }
      }

      for (let index = 0; index < tabButtons.length; index += 1) {
        const tabBtn = tabButtons[index];
        await expect(tabBtn).toBeFocused();

        const focusIndicator = await tabBtn.evaluate((element) => {
          const styles = window.getComputedStyle(element);
          return {
            outlineStyle: styles.outlineStyle,
            outlineWidth: styles.outlineWidth,
            outlineColor: styles.outlineColor,
          };
        });
        expect(
          focusIndicator.outlineStyle,
          `Focused ${language} tab "${labels[index]}" has no outline style`
        ).not.toBe('none');
        expect(
          parseFloat(focusIndicator.outlineWidth),
          `Focused ${language} tab "${labels[index]}" has no visible outline width`
        ).toBeGreaterThan(0);
        expect(
          focusIndicator.outlineColor,
          `Focused ${language} tab "${labels[index]}" has a transparent outline`
        ).not.toBe('rgba(0, 0, 0, 0)');

        const box = await tabBtn.boundingBox();
        expect(box, `Could not get bounding box for tab "${labels[index]}"`).not.toBeNull();
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 1);

        if (index < tabButtons.length - 1) {
          await page.keyboard.press('Tab');
        }
      }
    });
  }

  test('panel save and form controls retain an outline focus indicator without page overflow', async ({ page }) => {
    await loginAsAdmin(page);
    for (const label of ['Bilder', 'Social Media', 'Postoperative Daten', 'Einstellungen']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      const control = page
        .getByTestId('admin-panel')
        .locator('input:not([type="hidden"]), select, button:not([disabled])')
        .first();
      await control.focus();
      const indicator = await control.evaluate((element) => {
        const style = getComputedStyle(element);
        return { outline: style.outlineStyle, width: parseFloat(style.outlineWidth) };
      });
      expect(indicator.outline, `${label} control has no keyboard outline`).not.toBe('none');
      expect(indicator.width, `${label} control outline is not visible`).toBeGreaterThan(0);
      expect(await hasNoHorizontalPageScroll(page)).toBe(true);
    }
  });
});
