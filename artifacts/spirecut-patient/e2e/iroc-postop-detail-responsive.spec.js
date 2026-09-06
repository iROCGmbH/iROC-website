// @ts-check
import { test, expect } from '@playwright/test';

const APP_ORIGIN = process.env.PLAYWRIGHT_APP_BASE_URL ?? 'http://localhost:80';
const APP_PATH = '/iroc-app/spirecut/postop';
const MOBILE_VIEWPORT = { width: 390, height: 844 };

const LONG_EXPERIENCE =
  'Sehr ausführlicher Erfahrungsbericht zur Nachbehandlung und Genesung. '.repeat(160);

/**
 * This test uses a browser-rendered page, but stubs the data endpoints so it
 * stays deterministic and never mutates shared postoperative submissions.
 */
async function stubPostopData(page, language = 'de') {
  await page.addInitScript((language) => {
    localStorage.setItem('iroc_token', 'postop-detail-responsive-test-token');
    localStorage.setItem('iroc_username', 'postop-detail-responsive-test');
    localStorage.setItem('iroc_lang', language);
  }, language);

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = {};

    if (path === '/api/admin/patient-postop-diagnostics') {
      body = {
        submissions: [{
          id: 'responsive-detail-row',
          procedure: 'carpal-tunnel',
          operationMonth: '2025-01',
          rating: 5,
          ageRange: '41–50',
          gender: 'Weiblich',
          occupation: 'Ärztin',
          diseases: ['Keine'],
          operatedParts: ['Rechte Hand'],
          experience: LONG_EXPERIENCE,
          submittedAt: '2025-01-15T10:00:00.000Z',
        }],
        unreadableCount: 0,
        unreadable: [],
      };
    } else if (path === '/api/patient-postop-stats') {
      body = { skippedInvalid: 0 };
    } else if (path === '/api/iroc/postop-form-config') {
      body = {
        procedures: [{
          key: 'carpal-tunnel',
          labelDe: 'Karpaltunnel',
          labelEn: 'Carpal tunnel',
        }],
        ageRanges: [],
        genders: [],
        occupations: [],
        diseases: [],
        visibleSections: {},
      };
    } else if (path === '/api/iroc/notifications') {
      body = [];
    } else if (path === '/api/iroc/nav-config') {
      body = null;
    } else if (path === '/api/auth/me') {
      body = { username: 'postop-detail-responsive-test' };
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

test.describe('iROC postoperative detail dialog — mobile 390×844', () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test('keeps the long report scrollable while German actions and keyboard recovery stay reachable', async ({ page }) => {
    await stubPostopData(page);
    await page.goto(`${APP_ORIGIN}${APP_PATH}`);

    const viewButton = page.getByRole('button', { name: 'Alle Daten anzeigen' });
    await expect(viewButton).toBeVisible();
    await viewButton.click();

    const dialog = page.getByRole('dialog', { name: 'Eintragsdetails' });
    await expect(dialog).toBeVisible();

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    const layout = await dialog.evaluate((element) => {
      const body = element.querySelector('.overflow-y-auto');
      const headerClose = element.querySelector(
        'button[aria-label="Schließen"]',
      );
      const footerActions = Array.from(element.querySelectorAll('button')).filter(
        (button) => button.textContent?.trim() === 'Schließen' ||
          button.textContent?.includes('Bewertung korrigieren') ||
          button.textContent?.trim() === 'Löschen',
      );
      const actions = [headerClose, ...footerActions];
      if (!body || !headerClose || actions.length !== 4) {
        throw new Error('Responsive detail dialog controls were not rendered');
      }

      const dialogBox = element.getBoundingClientRect();
      const bodyBox = body.getBoundingClientRect();
      const controlsInViewport = actions.every((control) => {
        const box = control.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= window.innerHeight;
      });

      return {
        dialogBottom: dialogBox.bottom,
        bodyOverflowY: getComputedStyle(body).overflowY,
        bodyScrollable: body.scrollHeight > body.clientHeight,
        bodyFitsDialog: bodyBox.bottom <= dialogBox.bottom,
        controlsInViewport,
      };
    });

    expect(layout.dialogBottom).toBeLessThanOrEqual(viewport.height);
    expect(layout.bodyOverflowY).toBe('auto');
    expect(layout.bodyScrollable).toBe(true);
    expect(layout.bodyFitsDialog).toBe(true);
    expect(layout.controlsInViewport).toBe(true);

    const detailBody = dialog.locator('.overflow-y-auto');
    await detailBody.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await detailBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    const closeButtons = dialog.getByRole('button', { name: 'Schließen' });
    const editButton = dialog.getByRole('button', { name: 'Bewertung korrigieren' });
    const deleteButton = dialog.getByRole('button', { name: 'Löschen' });

    // Opening the dialog places focus on the first (header) close control.
    await expect(closeButtons.nth(0)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(closeButtons.nth(1)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(editButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(deleteButton).toBeFocused();

    // The focus trap wraps from the footer back to the header.
    await page.keyboard.press('Tab');
    await expect(closeButtons.nth(0)).toBeFocused();

    // Escape closes the real rendered dialog and restores focus to its trigger.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(viewButton).toBeFocused();
  });

  test('keeps the long report scrollable while English actions and keyboard recovery stay reachable', async ({ page }) => {
    await stubPostopData(page, 'en');
    await page.goto(`${APP_ORIGIN}${APP_PATH}`);

    const viewButton = page.getByRole('button', { name: 'View all data' });
    await expect(viewButton).toBeVisible();
    await viewButton.click();

    const dialog = page.getByRole('dialog', { name: 'Entry details' });
    await expect(dialog).toBeVisible();

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    const layout = await dialog.evaluate((element) => {
      const body = element.querySelector('.overflow-y-auto');
      const headerClose = element.querySelector('button[aria-label="Close"]');
      const footerActions = Array.from(element.querySelectorAll('button')).filter(
        (button) => button.textContent?.trim() === 'Close' ||
          button.textContent?.includes('Correct rating') ||
          button.textContent?.trim() === 'Delete',
      );
      const actions = [headerClose, ...footerActions];
      if (!body || !headerClose || actions.length !== 4) {
        throw new Error('Responsive detail dialog controls were not rendered');
      }

      const dialogBox = element.getBoundingClientRect();
      const bodyBox = body.getBoundingClientRect();
      const controlsInViewport = actions.every((control) => {
        const box = control.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= window.innerHeight;
      });

      return {
        dialogBottom: dialogBox.bottom,
        bodyOverflowY: getComputedStyle(body).overflowY,
        bodyScrollable: body.scrollHeight > body.clientHeight,
        bodyFitsDialog: bodyBox.bottom <= dialogBox.bottom,
        controlsInViewport,
      };
    });

    expect(layout.dialogBottom).toBeLessThanOrEqual(viewport.height);
    expect(layout.bodyOverflowY).toBe('auto');
    expect(layout.bodyScrollable).toBe(true);
    expect(layout.bodyFitsDialog).toBe(true);
    expect(layout.controlsInViewport).toBe(true);

    const detailBody = dialog.locator('.overflow-y-auto');
    await detailBody.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(await detailBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    const closeButtons = dialog.getByRole('button', { name: 'Close' });
    const editButton = dialog.getByRole('button', { name: 'Correct rating' });
    const deleteButton = dialog.getByRole('button', { name: 'Delete' });

    // Opening the dialog places focus on the first (header) close control.
    await expect(closeButtons.nth(0)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(closeButtons.nth(1)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(editButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(deleteButton).toBeFocused();

    // The focus trap wraps from the footer back to the header.
    await page.keyboard.press('Tab');
    await expect(closeButtons.nth(0)).toBeFocused();

    // Escape closes the real rendered dialog and restores focus to its trigger.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(viewButton).toBeFocused();
  });
});