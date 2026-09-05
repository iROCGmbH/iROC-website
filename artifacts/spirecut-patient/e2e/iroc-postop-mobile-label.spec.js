// @ts-check
import { test, expect } from '@playwright/test';

const APP_ORIGIN = process.env.PLAYWRIGHT_APP_BASE_URL ?? 'http://localhost:80';
const APP_PATH = process.env.PLAYWRIGHT_APP_BASE_URL
  ? '/iroc-app/spirecut/postop'
  : '/iroc-app/spirecut/postop';
const LONG_LABEL =
  'Karpaltunnel-Operation mit zusätzlicher Sehnenfreilegung und umfassender Nachbehandlung';

test.use({ viewport: { width: 320, height: 844 } });

test('keeps a long custom postop label clipped in a two-column grid at 320px', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('iroc_token', 'postop-mobile-test-token');
    localStorage.setItem('iroc_username', 'postop-mobile-test');
    localStorage.setItem('iroc_lang', 'de');
  });

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = {};
    if (path === '/api/admin/patient-postop-diagnostics') {
      body = {
        submissions: [{
          id: 'mobile-row',
          procedure: 'custom-procedure',
          operationMonth: '2025-01',
          rating: 5,
          submittedAt: '2025-01-15T10:00:00.000Z',
        }],
        unreadableCount: 0,
        unreadable: [],
      };
    } else if (path === '/api/patient-postop-stats') {
      body = { skippedInvalid: 0 };
    } else if (path === '/api/admin/patient-postop-form-config') {
      body = {
        procedures: [
          { key: 'custom-procedure', labelDe: LONG_LABEL, labelEn: 'Custom procedure' },
          { key: 'second-procedure', labelDe: 'Zweite Behandlung', labelEn: 'Second procedure' },
        ],
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
      body = { username: 'postop-mobile-test' };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.goto(`${APP_ORIGIN}${APP_PATH}`);
  const label = page.getByText(LONG_LABEL, { exact: true }).first();
  await expect(label).toBeVisible();

  const measurements = await label.evaluate((element) => {
    const card = element.parentElement;
    const grid = card?.parentElement;
    if (!card || !grid) throw new Error('Stats card structure not found');
    return {
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
      clipped: element.scrollWidth > element.clientWidth &&
        ['hidden', 'clip'].includes(getComputedStyle(element).overflowX),
      labelInsideCard: element.getBoundingClientRect().right <= card.getBoundingClientRect().right,
      documentFits: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });

  expect(measurements.columns).toBe(2);
  expect(measurements.clipped).toBe(true);
  expect(measurements.labelInsideCard).toBe(true);
  expect(measurements.documentFits).toBe(true);
});