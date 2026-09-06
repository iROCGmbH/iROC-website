// @ts-check
/**
 * E2E: mobile startup keeps route-only code out of the first navigation.
 *
 * These checks deliberately run against production previews (or the mounted
 * artifact router when PLAYWRIGHT_MOUNTED_BASE_URL is supplied). Build
 * manifests prove that routes are lazy; this verifies the browser does not
 * eagerly request those chunks at a mobile viewport.
 */

import { test, expect } from '@playwright/test';

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const mountedOrigin = process.env.PLAYWRIGHT_MOUNTED_BASE_URL;
const isMountedPreview = Boolean(mountedOrigin);

const routeChunkPattern = (pageName) =>
  isMountedPreview
    ? new RegExp(`/src/pages/${pageName}\\.tsx(?:\\?.*)?$`)
    : new RegExp(`/assets/${pageName}-[^/]+\\.js$`);

const routeChunkNames = (pageNames) =>
  isMountedPreview
    ? new RegExp(`/src/pages/(?:${pageNames.join('|')})\\.tsx(?:\\?.*)?$`)
    : new RegExp(`/assets/(?:${pageNames.join('|')})-[^/]+\\.js$`);

const APPS = mountedOrigin
  ? {
      website: {
        name: 'iROC website',
        origin: mountedOrigin,
        basePath: '/',
        initialRouteChunks: routeChunkPattern('Home'),
        adminChunk: routeChunkPattern('Admin'),
        forbiddenInitialChunks: routeChunkNames([
          'Admin',
          'CertificatePDF',
          'TrainingOverview',
          'Events',
          'Doctors',
          'Order',
          'Contact',
          'Spirecut',
          'MiniStem',
          'Portal',
          'Login',
          'Impressum',
          'Agb',
        ]),
      },
      patient: {
        name: 'Spirecut patient',
        origin: mountedOrigin,
        basePath: '/spirecut-patient/',
        initialRouteChunks: routeChunkPattern('Home'),
        adminChunk: routeChunkPattern('Admin'),
        forbiddenInitialChunks: routeChunkNames([
          'Admin',
          'ChatbotPDF',
          'FindDoctor',
          'Karpaltunnelsyndrom',
          'Schnappfinger',
          'PraktischeInformationen',
          'PostoperativeEntwicklung',
          'PatientTestimonials',
          'FAQ',
          'Kontakt',
          'HowItWorks',
          'Impressum',
          'Datenschutz',
        ]),
      },
    }
  : {
      website: {
        name: 'iROC website',
        origin: process.env.PLAYWRIGHT_WEBSITE_BASE_URL ?? 'http://localhost:5908',
        basePath: '/',
        initialRouteChunks: routeChunkPattern('Home'),
        adminChunk: routeChunkPattern('Admin'),
        forbiddenInitialChunks: routeChunkNames([
          'Admin',
          'CertificatePDF',
          'TrainingOverview',
          'Events',
          'Doctors',
          'Order',
          'Contact',
          'Spirecut',
          'MiniStem',
          'Portal',
          'Login',
          'Impressum',
          'Agb',
        ]),
      },
      patient: {
        name: 'Spirecut patient',
        origin: process.env.PLAYWRIGHT_PATIENT_BASE_URL ?? 'http://localhost:5905',
        basePath: '/spirecut-patient/',
        initialRouteChunks: routeChunkPattern('Home'),
        adminChunk: routeChunkPattern('Admin'),
        forbiddenInitialChunks: routeChunkNames([
          'Admin',
          'ChatbotPDF',
          'FindDoctor',
          'Karpaltunnelsyndrom',
          'Schnappfinger',
          'PraktischeInformationen',
          'PostoperativeEntwicklung',
          'PatientTestimonials',
          'FAQ',
          'Kontakt',
          'HowItWorks',
          'Impressum',
          'Datenschutz',
        ]),
      },
    };

function appUrl(app, route = '') {
  return `${app.origin}${app.basePath}${route}`;
}

function routeChunkRequests(requests, pattern) {
  return requests.filter((url) => pattern.test(url));
}

async function waitForAppReady(page) {
  await expect(page.locator('#root')).not.toBeEmpty();
  await page.waitForTimeout(250);
}

for (const app of Object.values(APPS)) {
  test(`${app.name} avoids route-only chunks on mobile startup`, async ({
    browser,
  }) => {
    // A clean context prevents an earlier test or installed PWA from turning
    // a network assertion into a cache assertion.
    const context = await browser.newContext({
      viewport: MOBILE_VIEWPORT,
      serviceWorkers: 'block',
    });
    await context.setDefaultNavigationTimeout(15_000);
    const page = await context.newPage();
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));

    const response = await page.goto(appUrl(app), {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status()).toBe(200);
    await waitForAppReady(page);

    const initialRouteChunks = routeChunkRequests(
      requests,
      app.initialRouteChunks,
    );
    expect(
      initialRouteChunks,
      `${app.name} should load its public route chunk`,
    ).not.toHaveLength(0);

    const forbiddenInitialChunks = routeChunkRequests(
      requests,
      app.forbiddenInitialChunks,
    );
    expect(
      forbiddenInitialChunks,
      `${app.name} eagerly requested route-only code`,
    ).toEqual([]);

    await context.close();
  });

  test(`${app.name} loads its admin chunk only after navigation on mobile`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: MOBILE_VIEWPORT,
      serviceWorkers: 'block',
    });
    await context.setDefaultNavigationTimeout(15_000);
    const page = await context.newPage();

    await page.goto(appUrl(app), { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    const adminChunkRequest = page.waitForRequest(
      (request) => app.adminChunk.test(request.url()),
      { timeout: 10_000 },
    );
    const adminResponse = await page.goto(appUrl(app, 'admin'), {
      waitUntil: 'domcontentloaded',
    });
    expect(adminResponse?.status()).toBe(200);
    await adminChunkRequest;
    expect(new URL(page.url()).pathname).toBe(
      new URL(appUrl(app, 'admin')).pathname,
    );

    await context.close();
  });
}

test('Spirecut patient preserves the routed PWA base path and service worker', async ({
  browser,
}) => {
  const app = APPS.patient;
  const context = await browser.newContext({
    viewport: MOBILE_VIEWPORT,
    serviceWorkers: 'allow',
  });
  const page = await context.newPage();

  const response = await page.goto(appUrl(app), {
    waitUntil: 'domcontentloaded',
  });
  expect(response?.status()).toBe(200);

  const manifest = await page.evaluate(async (manifestPath) => {
    const response = await fetch(manifestPath);
    return { status: response.status, body: await response.json() };
  }, `${app.basePath}manifest.webmanifest`);
  expect(manifest.status).toBe(200);
  expect(manifest.body.start_url).toBe(app.basePath);
  expect(manifest.body.scope).toBe(app.basePath);

  const expectedScope = new URL(app.basePath, app.origin).href;
  const expectedProductionScript = new URL(
    `${app.basePath}sw.js`,
    app.origin,
  ).href;
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ expectedScope: scope, expectedProductionScript: script, dev }) => {
            return navigator.serviceWorker.getRegistrations().then((registrations) =>
              registrations.some((registration) => {
                const scriptURL =
                  registration.active?.scriptURL ??
                  registration.installing?.scriptURL ??
                  registration.waiting?.scriptURL ??
                  null;
                return (
                  registration.scope === scope &&
                  (dev ? /\/dev-sw\.js\?dev-sw$/.test(scriptURL ?? '') : scriptURL === script)
                );
              }),
            );
          },
          {
            expectedScope,
            expectedProductionScript,
            dev: isMountedPreview,
          },
        ),
      { timeout: 10_000 },
    )
    .toBe(true);

  await context.close();
});