// @ts-check
/**
 * E2E: comparison values remain readable in the Reports print/PDF output.
 *
 * The report is intentionally rendered with deterministic current and previous
 * period data. That makes the PDF assertions independent of the development
 * database while still exercising the real iROC Reports page and print CSS.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { test, expect } from "@playwright/test";

const APP_ORIGIN = process.env.PLAYWRIGHT_APP_BASE_URL ?? "http://localhost:5906";
const APP_PATH = "/iroc-app";
const REPORTS_PATH = `${APP_PATH}/reports`;
const DIRECT_PREVIEW = process.env.PLAYWRIGHT_APP_DIRECT_PREVIEW === "1";

const PRODUCT_GROUPS = [
  { id: 1, key: "spirecut", nameEn: "Spirecut®", nameDe: "Spirecut®", sortOrder: 0 },
  { id: 2, key: "ministem", nameEn: "MiniStem®", nameDe: "MiniStem®", sortOrder: 1 },
];

const SALES = [
  {
    itemId: 1,
    invoiceId: 101,
    productName: "Current Spirecut",
    sku: "SC-CURRENT",
    quantity: 12,
    lineTotal: "12345.67",
    isDemo: false,
    issueDate: "2026-04-15",
    status: "paid",
    invoiceTotal: "12345.67",
    customerName: "Current Clinic",
    category: "spirecut",
  },
  {
    itemId: 2,
    invoiceId: 102,
    productName: "Current MiniStem",
    sku: "MS-CURRENT",
    quantity: 3,
    lineTotal: "3456.78",
    isDemo: false,
    issueDate: "2026-05-12",
    status: "paid",
    invoiceTotal: "3456.78",
    customerName: "Second Clinic",
    category: "ministem",
  },
  {
    itemId: 3,
    invoiceId: 201,
    productName: "Previous Spirecut",
    sku: "SC-PREVIOUS",
    quantity: 8,
    lineTotal: "8765.43",
    isDemo: false,
    issueDate: "2026-01-15",
    status: "paid",
    invoiceTotal: "8765.43",
    customerName: "Previous Clinic",
    category: "spirecut",
  },
  {
    itemId: 4,
    invoiceId: 202,
    productName: "Previous MiniStem",
    sku: "MS-PREVIOUS",
    quantity: 2,
    lineTotal: "2345.67",
    isDemo: false,
    issueDate: "2026-02-10",
    status: "paid",
    invoiceTotal: "2345.67",
    customerName: "Previous Clinic",
    category: "ministem",
  },
];

const LEADS = [
  {
    id: 1,
    firstName: "Current",
    lastName: "Lead",
    salutation: "Dr.",
    medicalTitle: null,
    status: "converted",
    createdAt: "2026-04-20T10:00:00.000Z",
    email: "current@example.com",
  },
  {
    id: 2,
    firstName: "Current",
    lastName: "Prospect",
    salutation: "Dr.",
    medicalTitle: null,
    status: "new",
    createdAt: "2026-05-20T10:00:00.000Z",
    email: "prospect@example.com",
  },
  {
    id: 3,
    firstName: "Previous",
    lastName: "Lead",
    salutation: "Dr.",
    medicalTitle: null,
    status: "qualified",
    createdAt: "2026-01-20T10:00:00.000Z",
    email: "previous@example.com",
  },
];

const EXPENSES = [
  {
    id: 1,
    vendor_name: "Current Supplier",
    invoice_date: "2026-04-08",
    invoice_number: "CUR-001",
    category: "Medical Equipment",
    net_amount: "4567.89",
    tax_amount: "867.90",
    gross_amount: "5435.79",
    currency: "EUR",
  },
  {
    id: 2,
    vendor_name: "Previous Supplier",
    invoice_date: "2026-01-08",
    invoice_number: "PRE-001",
    category: "Medical Equipment",
    net_amount: "2345.67",
    tax_amount: "445.68",
    gross_amount: "2791.35",
    currency: "EUR",
  },
];

const INVENTORY = [
  {
    id: 1,
    productId: 1,
    productSku: "SC-CURRENT",
    productNameEn: "Current Spirecut",
    productNameDe: "Current Spirecut",
    productCategory: "spirecut",
    productPurchasePrice: "300.00",
    lotNumber: "LOT-CURRENT",
    purchaseDate: "2026-01-01",
    expirationDate: null,
    description: "Current stock",
    quantityReceived: 20,
    quantityUsed: 4,
  },
];

const PRODUCTS = [
  {
    id: 1,
    sku: "SC-CURRENT",
    nameEn: "Current Spirecut",
    nameDe: "Current Spirecut",
    category: "spirecut",
    unitPrice: "1000.00",
    purchasePrice: "300.00",
  },
];

/**
 * Install API fixtures before the page loads. The real page still performs
 * its normal React Query fetches and derives all comparison tables itself.
 */
async function mockReportsApi(page) {
  if (DIRECT_PREVIEW) {
    // Vite preview serves the built files from its root while the artifact's
    // HTML keeps its mounted /iroc-app/ base URL. Serve the built asset bytes
    // directly so the test can exercise the direct preview as well.
    await page.route("**/iroc-app/assets/**", async (route) => {
      const url = new URL(route.request().url());
      const filename = basename(decodeURIComponent(url.pathname));
      const assetPath = resolve(import.meta.dirname, "../../iroc-app/dist/public/assets", filename);
      const contentType = filename.endsWith(".css")
        ? "text/css"
        : filename.endsWith(".js")
          ? "text/javascript"
          : filename.endsWith(".webm")
            ? "video/webm"
            : "application/octet-stream";
      await route.fulfill({ status: 200, contentType, body: readFileSync(assetPath) });
    });
  }
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === "/api/iroc/sales-summary") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SALES) });
      return;
    }
    if (path === "/api/iroc/inventory") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(INVENTORY) });
      return;
    }
    if (path === "/api/iroc/leads") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(LEADS) });
      return;
    }
    if (path === "/api/admin/expenses") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EXPENSES) });
      return;
    }
    if (path === "/api/iroc/products") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PRODUCTS) });
      return;
    }
    if (path === "/api/iroc/product-groups") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PRODUCT_GROUPS) });
      return;
    }
    if (path === "/api/iroc/leads/sync-status") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
      return;
    }
    if (path === "/api/iroc/me") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ username: "reports-pdf-test" }),
      });
      return;
    }
    if (path === "/api/iroc/notifications") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
      return;
    }
    if (path === "/api/iroc/nav-config") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
      return;
    }
    if (path === "/api/website-settings") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
      return;
    }

    await route.continue();
  });
}

async function openComparisonReport(page) {
  await page.addInitScript(() => {
    localStorage.setItem("iroc_token", "reports-pdf-test-token");
    localStorage.setItem("iroc_username", "reports-pdf-test");
    localStorage.setItem("iroc_lang", "en");
  });
  await mockReportsApi(page);
  await page.goto(`${APP_ORIGIN}${REPORTS_PATH}`);
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(page.getByText("Show comparison", { exact: true })).toBeVisible();
  await page.locator("#show-report-comparison").click();
  await expect(page.locator("#show-report-comparison")).toBeChecked();
  await expect(page.locator("#report-sales")).toContainText("Current");
  await expect(page.locator("#report-sales")).toContainText("Previous");
}

test("keeps Sales, Expenses, Leads, Top Products, and Profit current/previous values readable in an A4 PDF", async ({
  page,
}, testInfo) => {
  await openComparisonReport(page);

  // Match the narrow A4 content width used by Chromium's print layout. The
  // assertions below inspect the actual print-media DOM before the PDF is
  // captured, catching overflow even when a browser still produces a PDF.
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.emulateMedia({ media: "print" });

  const sections = ["sales", "expenses", "leads", "top-products", "profit"];
  for (const sectionId of sections) {
    const section = page.locator(`#report-${sectionId}`);
    await expect(section, `Missing report section: ${sectionId}`).toBeVisible();
    const table = section.locator("table").first();
    await expect(table, `Missing comparison table: ${sectionId}`).toBeVisible();

    const layout = await table.evaluate((element) => {
      const tableRect = element.getBoundingClientRect();
      const cells = [...element.querySelectorAll("th, td")].map((cell) => {
        const rect = cell.getBoundingClientRect();
        const style = getComputedStyle(cell);
        return {
          visible: style.display !== "none",
          right: rect.right,
          tableRight: tableRect.right,
          width: rect.width,
          fontSize: Number.parseFloat(style.fontSize),
        };
      });
      return {
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        cells,
      };
    });

    expect(layout.scrollWidth, `${sectionId} table has horizontal overflow`).toBeLessThanOrEqual(
      layout.clientWidth + 1,
    );
    expect(
      layout.cells
        .filter((cell) => cell.visible)
        .every((cell) => cell.width > 0 && cell.right <= cell.tableRight + 1 && cell.fontSize >= 10),
      `${sectionId} contains a clipped or unreadably small print cell`,
    ).toBe(true);
  }

  const pdfPath = testInfo.outputPath("reports-comparison-a4.pdf");
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
  });

  const pdfText = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });
  for (const sectionTitle of ["Sales", "Expenses", "Leads", "Top Products", "Profit"]) {
    expect(pdfText, `${sectionTitle} is missing from the generated PDF`).toContain(sectionTitle);
  }
  for (const value of [
    "Current Spirecut",
    "Previous Spirecut",
    "12.345,67",
    "8.765,43",
    "4.567,89",
    "2.345,67",
  ]) {
    expect(pdfText, `${value} is missing from the generated PDF`).toContain(value);
  }
});

test("prints only selected report sections and keeps their comparison values", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "print", { value: () => {}, configurable: true });
  });
  await openComparisonReport(page);
  await page.getByRole("button", { name: "Print / PDF" }).click();
  await page.getByLabel("Expenses", { exact: true }).click();
  await page.getByLabel("Customers", { exact: true }).click();
  await page.getByRole("button", { name: "Print", exact: true }).click();
  await expect(page.locator("#print-section-filter")).toHaveCount(1);
  await page.emulateMedia({ media: "print" });

  const pdfPath = testInfo.outputPath("reports-selected-sections.pdf");
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
  const pdfText = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });

  for (const selected of ["Inventory", "Sales", "Leads", "Top Products", "Profit"]) {
    expect(pdfText).toContain(selected);
  }
  expect(pdfText).not.toContain("Expenses");
  expect(pdfText).not.toContain("Customers");
  expect(pdfText).toContain("Current Spirecut");
  expect(pdfText).toContain("Previous Spirecut");
});

test("back-to-back exports replace and clean up their section filter", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "print", { value: () => {}, configurable: true });
  });
  await openComparisonReport(page);

  // First export: remove Expenses and Customers from the default selection.
  await page.getByRole("button", { name: "Print / PDF" }).click();
  await page.getByLabel("Expenses", { exact: true }).click();
  await page.getByLabel("Customers", { exact: true }).click();
  await page.getByRole("button", { name: "Print", exact: true }).click();
  await expect(page.locator("#print-section-filter")).toHaveCount(1);
  await page.emulateMedia({ media: "print" });
  const firstPdf = testInfo.outputPath("reports-first-filter.pdf");
  await page.pdf({ path: firstPdf, format: "A4", printBackground: true });
  expect(execFileSync("pdftotext", [firstPdf, "-"], { encoding: "utf8" })).not.toContain("Expenses");
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator("#print-section-filter")).toHaveCount(0);

  // Second export: invert the prior selection so its PDF cannot inherit it.
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "Print / PDF" }).click();
  await page.getByRole("button", { name: "None", exact: true }).click();
  for (const label of ["Expenses", "Customers"]) {
    await page.getByLabel(label, { exact: true }).click();
  }
  await page.getByRole("button", { name: "Print", exact: true }).click();
  await expect(page.locator("#print-section-filter")).toHaveCount(1);
  await page.emulateMedia({ media: "print" });
  const secondPdf = testInfo.outputPath("reports-second-filter.pdf");
  await page.pdf({ path: secondPdf, format: "A4", printBackground: true });
  const secondText = execFileSync("pdftotext", [secondPdf, "-"], { encoding: "utf8" });
  expect(secondText).toContain("Expenses");
  expect(secondText).toContain("Customers");
  expect(secondText).not.toContain("Inventory");
  expect(secondText).not.toContain("Sales");
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator("#print-section-filter")).toHaveCount(0);
});

test("repeats comparison table headers when long report tables cross pages", async ({ page }, testInfo) => {
  await openComparisonReport(page);
  await page.emulateMedia({ media: "print" });

  for (const id of ["sales", "expenses", "leads", "top-products", "profit"]) {
    const table = page.locator(`#report-${id} table`).first();
    await expect(table.locator("thead")).toHaveCSS("display", "table-header-group");
    await table.locator("tbody").evaluate((tbody) => {
      const sourceRows = [...tbody.querySelectorAll(":scope > tr")];
      for (let copy = 0; copy < 35; copy += 1) {
        for (const row of sourceRows) tbody.appendChild(row.cloneNode(true));
      }
    });
  }

  const pdfPath = testInfo.outputPath("reports-repeated-headers.pdf");
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
  const pdfText = execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8" });
  for (const header of ["Current", "Previous"]) {
    expect(pdfText.match(new RegExp(header, "g"))?.length ?? 0).toBeGreaterThan(10);
  }
  expect(pdfText).toContain("12.345,67");
  expect(pdfText).toContain("8.765,43");
});