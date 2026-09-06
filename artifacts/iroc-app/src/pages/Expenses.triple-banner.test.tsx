/**
 * Expenses — all three banners stack correctly when a duplicate warning
 * joins low-confidence extraction + amount-mismatch warnings
 *
 * What & Why
 * ──────────
 * The extraction confirmation modal can show up to three stacked banners:
 *   1. Duplicate warning        (orange) — triggered by a 409 on POST /expenses
 *   2. Amount-mismatch warning  (orange) — net + tax ≠ gross
 *   3. AI-confidence warning    (amber)  — extraction confidence = "low"
 *
 * This file tests the fully-stacked state: banners 2 and 3 appear after the
 * extraction, then the admin clicks "Save Expense" and receives a 409, which
 * adds banner 1. All three must be simultaneously visible as separate, distinct
 * DOM elements — no overlap, no hidden element.
 *
 * Scenario tested
 * ───────────────
 *  1. Stub fetch so:
 *       • Upload-URL presign    → returns a dummy signed URL
 *       • GCS PUT               → ok
 *       • /expenses/extract     → confidence:"low", net=100, tax=10, gross=200
 *       • POST /expenses        → 409 with a duplicate message
 *  2. Trigger a file-input change with a synthetic PDF file (≥ 64 bytes).
 *  3. Wait for the confirmation modal ("Review Extraction & Save") to open.
 *  4. Assert both advisory banners are visible (confidence + mismatch).
 *  5. Click "Save Expense" — the POST returns 409.
 *  6. Assert all three banner divs are now visible and distinct.
 *  7. Assert the "Save anyway" button replaced "Save Expense".
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Expenses from "./Expenses";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={makeQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

/**
 * Stub fetch so:
 *   - extraction returns low confidence with mismatched amounts
 *   - POST /expenses returns 409 with a duplicate message
 *
 * Ordering matters — more specific URL checks must come before the generic
 * /api/admin/expenses catch-all.
 */
function stubFetchWithLowConfidenceMismatchAnd409() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.includes("/api/admin/expenses/orphan-sweep-stats")) {
      return { ok: false, status: 204, json: async () => null } as unknown as Response;
    }
    if (url.includes("/api/admin/expenses/datev-settings")) {
      return {
        ok: true,
        json: async () => ({ kontoMap: {}, gegenKonto: "1600" }),
      } as Response;
    }
    if (url.includes("/api/admin/expenses/upload-url")) {
      return {
        ok: true,
        json: async () => ({
          uploadURL:
            "https://storage.googleapis.com/bucket/expense-receipts/test.pdf?sig=abc",
          objectPath: "/objects/expense-receipts/test.pdf",
        }),
      } as Response;
    }
    if (url.includes("storage.googleapis.com")) {
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }
    if (url.includes("/api/admin/expenses/extract")) {
      // Low confidence + mismatched amounts: net=100, tax=10, gross=200 → 110 ≠ 200
      return {
        ok: true,
        json: async () => ({
          fileObjectPath: "/objects/expense-receipts/test.pdf",
          extracted: {
            vendor_name: "Duplicate Corp",
            invoice_date: "2024-03-20",
            invoice_number: "INV-DUP-001",
            category: "Software",
            net_amount: 100,
            tax_amount: 10,
            gross_amount: 200,
            currency: "EUR",
            confidence: "low",
          },
        }),
      } as Response;
    }
    // POST /expenses → 409 duplicate
    if (url.match(/\/api\/admin\/expenses$/) && method === "POST") {
      return {
        ok: false,
        status: 409,
        json: async () => ({
          message: "A similar expense already exists. Save anyway?",
        }),
      } as unknown as Response;
    }
    // Generic expenses list (GET)
    if (url.includes("/api/admin/expenses")) {
      return { ok: true, json: async () => [] } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

/**
 * Create a fake PDF file that passes the component's 64-byte minimum size check.
 */
function makeFakePdf(): File {
  const content = "A".repeat(100); // 100 bytes > 64-byte minimum
  return new File([content], "receipt.pdf", { type: "application/pdf" });
}

/**
 * Trigger the hidden file input's onChange with a fake file.
 */
function uploadFakeFile(file: File) {
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!fileInput) throw new Error("File input not found in DOM");
  Object.defineProperty(fileInput, "files", {
    value: [file],
    writable: true,
    configurable: true,
  });
  fireEvent.change(fileInput);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Expenses — all three banners stack when duplicate warning joins low-confidence + mismatch", () => {

  it("shows all three banners simultaneously after a 409 response", async () => {
    stubFetchWithLowConfidenceMismatchAnd409();
    render(<Expenses />, { wrapper: Wrapper });

    uploadFakeFile(makeFakePdf());

    // Wait for the extraction modal to open
    await waitFor(
      () => expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );

    // Banners 2 and 3 must already be visible before clicking Save
    expect(screen.getByText(/Low extraction confidence/i)).toBeInTheDocument();
    expect(screen.getByText(/Amounts do not add up/i)).toBeInTheDocument();

    // Click "Save Expense" — the POST returns 409, adding the duplicate banner
    const saveBtn = screen.getByRole("button", { name: /save expense/i });
    fireEvent.click(saveBtn);

    // Banner 1: duplicate warning
    await waitFor(
      () => expect(screen.getByText(/Possible duplicate detected/i)).toBeInTheDocument(),
      { timeout: 5000 },
    );

    // Banner 2: amount mismatch still visible
    expect(screen.getByText(/Amounts do not add up/i)).toBeInTheDocument();

    // Banner 3: AI confidence warning still visible
    expect(screen.getByText(/Low extraction confidence/i)).toBeInTheDocument();
  });

  it("renders all three banners as separate, non-overlapping container elements", async () => {
    stubFetchWithLowConfidenceMismatchAnd409();
    render(<Expenses />, { wrapper: Wrapper });

    uploadFakeFile(makeFakePdf());

    await waitFor(
      () => expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );

    fireEvent.click(screen.getByRole("button", { name: /save expense/i }));

    await waitFor(
      () => expect(screen.getByText(/Possible duplicate detected/i)).toBeInTheDocument(),
      { timeout: 5000 },
    );

    const duplicateEl  = screen.getByText(/Possible duplicate detected/i);
    const mismatchEl   = screen.getByText(/Amounts do not add up/i);
    const confidenceEl = screen.getByText(/Low extraction confidence/i);

    // Each heading must be a distinct DOM node
    expect(duplicateEl).not.toBe(mismatchEl);
    expect(duplicateEl).not.toBe(confidenceEl);
    expect(mismatchEl).not.toBe(confidenceEl);

    // Walk up to each banner's border-* container div
    const duplicateBannerDiv  = duplicateEl.closest("div[class*='border']");
    const mismatchBannerDiv   = mismatchEl.closest("div[class*='border']");
    const confidenceBannerDiv = confidenceEl.closest("div[class*='border']");

    expect(duplicateBannerDiv).not.toBeNull();
    expect(mismatchBannerDiv).not.toBeNull();
    expect(confidenceBannerDiv).not.toBeNull();

    // All three must be different container elements
    expect(duplicateBannerDiv).not.toBe(mismatchBannerDiv);
    expect(duplicateBannerDiv).not.toBe(confidenceBannerDiv);
    expect(mismatchBannerDiv).not.toBe(confidenceBannerDiv);

    // No banner contains another
    expect(duplicateBannerDiv!.contains(mismatchBannerDiv)).toBe(false);
    expect(duplicateBannerDiv!.contains(confidenceBannerDiv)).toBe(false);
    expect(mismatchBannerDiv!.contains(duplicateBannerDiv)).toBe(false);
    expect(mismatchBannerDiv!.contains(confidenceBannerDiv)).toBe(false);
    expect(confidenceBannerDiv!.contains(duplicateBannerDiv)).toBe(false);
    expect(confidenceBannerDiv!.contains(mismatchBannerDiv)).toBe(false);
  });

  it("replaces 'Save Expense' with 'Save anyway' once the duplicate banner appears", async () => {
    stubFetchWithLowConfidenceMismatchAnd409();
    render(<Expenses />, { wrapper: Wrapper });

    uploadFakeFile(makeFakePdf());

    await waitFor(
      () => expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );

    // Before clicking Save: "Save Expense" button is present, "Save anyway" is not
    expect(screen.getByRole("button", { name: /save expense/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save anyway/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /save expense/i }));

    await waitFor(
      () => expect(screen.getByRole("button", { name: /save anyway/i })).toBeInTheDocument(),
      { timeout: 5000 },
    );

    // "Save Expense" must be gone once the duplicate banner is showing
    expect(screen.queryByRole("button", { name: /save expense/i })).toBeNull();
  });

  it("the 'Save anyway' button is enabled while all three banners are visible", async () => {
    stubFetchWithLowConfidenceMismatchAnd409();
    render(<Expenses />, { wrapper: Wrapper });

    uploadFakeFile(makeFakePdf());

    await waitFor(
      () => expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );

    fireEvent.click(screen.getByRole("button", { name: /save expense/i }));

    await waitFor(
      () => expect(screen.getByRole("button", { name: /save anyway/i })).toBeInTheDocument(),
      { timeout: 5000 },
    );

    // All three banners present
    expect(screen.getByText(/Possible duplicate detected/i)).toBeInTheDocument();
    expect(screen.getByText(/Amounts do not add up/i)).toBeInTheDocument();
    expect(screen.getByText(/Low extraction confidence/i)).toBeInTheDocument();

    // "Save anyway" must be enabled — the duplicate override path is available
    expect(screen.getByRole("button", { name: /save anyway/i })).not.toBeDisabled();
  });

  it("'Save anyway' clears all three banners and closes the modal on a successful retry", async () => {
    // Track how many times POST /expenses has been called so we can flip from
    // 409 (first attempt) to 200 (retry after "Save anyway").
    let postExpensesCallCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.includes("/api/admin/expenses/orphan-sweep-stats")) {
        return { ok: false, status: 204, json: async () => null } as unknown as Response;
      }
      if (url.includes("/api/admin/expenses/datev-settings")) {
        return {
          ok: true,
          json: async () => ({ kontoMap: {}, gegenKonto: "1600" }),
        } as Response;
      }
      if (url.includes("/api/admin/expenses/upload-url")) {
        return {
          ok: true,
          json: async () => ({
            uploadURL:
              "https://storage.googleapis.com/bucket/expense-receipts/test.pdf?sig=abc",
            objectPath: "/objects/expense-receipts/test.pdf",
          }),
        } as Response;
      }
      if (url.includes("storage.googleapis.com")) {
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      if (url.includes("/api/admin/expenses/extract")) {
        return {
          ok: true,
          json: async () => ({
            fileObjectPath: "/objects/expense-receipts/test.pdf",
            extracted: {
              vendor_name: "Duplicate Corp",
              invoice_date: "2024-03-20",
              invoice_number: "INV-DUP-001",
              category: "Software",
              net_amount: 100,
              tax_amount: 10,
              gross_amount: 200,
              currency: "EUR",
              confidence: "low",
            },
          }),
        } as Response;
      }
      // POST /expenses: first call → 409, subsequent calls → 200
      if (url.match(/\/api\/admin\/expenses$/) && method === "POST") {
        postExpensesCallCount += 1;
        if (postExpensesCallCount === 1) {
          return {
            ok: false,
            status: 409,
            json: async () => ({
              message: "A similar expense already exists. Save anyway?",
            }),
          } as unknown as Response;
        }
        // Second call (the "Save anyway" retry): success
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 42 }),
        } as unknown as Response;
      }
      // Generic expenses list (GET)
      if (url.includes("/api/admin/expenses")) {
        return { ok: true, json: async () => [] } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    mockToast.mockClear();

    render(<Expenses />, { wrapper: Wrapper });
    uploadFakeFile(makeFakePdf());

    // Wait for the extraction modal to open
    await waitFor(
      () => expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );

    // Both advisory banners must be visible before the first save attempt
    expect(screen.getByText(/Low extraction confidence/i)).toBeInTheDocument();
    expect(screen.getByText(/Amounts do not add up/i)).toBeInTheDocument();

    // First save attempt → 409 adds the duplicate banner
    fireEvent.click(screen.getByRole("button", { name: /save expense/i }));

    await waitFor(
      () => expect(screen.getByText(/Possible duplicate detected/i)).toBeInTheDocument(),
      { timeout: 5000 },
    );

    // Confirm all three banners are present before clicking "Save anyway"
    expect(screen.getByText(/Amounts do not add up/i)).toBeInTheDocument();
    expect(screen.getByText(/Low extraction confidence/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save anyway/i })).toBeInTheDocument();

    // Click "Save anyway" — the retry POST returns 200
    fireEvent.click(screen.getByRole("button", { name: /save anyway/i }));

    // The modal should close (title disappears) and all banners should be gone
    await waitFor(
      () => expect(screen.queryByText(/Review Extraction & Save/i)).not.toBeInTheDocument(),
      { timeout: 5000 },
    );

    expect(screen.queryByText(/Possible duplicate detected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Amounts do not add up/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Low extraction confidence/i)).not.toBeInTheDocument();

    // No destructive toast must have been shown
    const destructiveCalls = mockToast.mock.calls.filter(
      ([arg]) => arg && (arg as { variant?: string }).variant === "destructive",
    );
    expect(destructiveCalls).toHaveLength(0);
  });

  it("'Save anyway' keeps the modal open and shows an error when the retry fails", async () => {
    // The first save exposes the duplicate override. The override retry then
    // receives a server error, which must remain visible to the admin.
    let postExpensesCallCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.includes("/api/admin/expenses/orphan-sweep-stats")) {
        return { ok: false, status: 204, json: async () => null } as unknown as Response;
      }
      if (url.includes("/api/admin/expenses/datev-settings")) {
        return {
          ok: true,
          json: async () => ({ kontoMap: {}, gegenKonto: "1600" }),
        } as Response;
      }
      if (url.includes("/api/admin/expenses/upload-url")) {
        return {
          ok: true,
          json: async () => ({
            uploadURL:
              "https://storage.googleapis.com/bucket/expense-receipts/test.pdf?sig=abc",
            objectPath: "/objects/expense-receipts/test.pdf",
          }),
        } as Response;
      }
      if (url.includes("storage.googleapis.com")) {
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      if (url.includes("/api/admin/expenses/extract")) {
        return {
          ok: true,
          json: async () => ({
            fileObjectPath: "/objects/expense-receipts/test.pdf",
            extracted: {
              vendor_name: "Duplicate Corp",
              invoice_date: "2024-03-20",
              invoice_number: "INV-DUP-001",
              category: "Software",
              net_amount: 100,
              tax_amount: 10,
              gross_amount: 200,
              currency: "EUR",
              confidence: "low",
            },
          }),
        } as Response;
      }
      if (url.match(/\/api\/admin\/expenses$/) && method === "POST") {
        postExpensesCallCount += 1;
        if (postExpensesCallCount === 1) {
          return {
            ok: false,
            status: 409,
            json: async () => ({
              message: "A similar expense already exists. Save anyway?",
            }),
          } as unknown as Response;
        }
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "The expense could not be saved. Please try again." }),
        } as unknown as Response;
      }
      if (url.includes("/api/admin/expenses")) {
        return { ok: true, json: async () => [] } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(<Expenses />, { wrapper: Wrapper });
    uploadFakeFile(makeFakePdf());

    await waitFor(
      () => expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );

    fireEvent.click(screen.getByRole("button", { name: /save expense/i }));
    await waitFor(
      () => expect(screen.getByRole("button", { name: /save anyway/i })).toBeInTheDocument(),
      { timeout: 5000 },
    );

    fireEvent.click(screen.getByRole("button", { name: /save anyway/i }));

    await waitFor(
      () => expect(screen.getByText(/The expense could not be saved\. Please try again\./i)).toBeInTheDocument(),
      { timeout: 5000 },
    );

    expect(postExpensesCallCount).toBe(2);
    expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument();
    // The retry clears the duplicate banner before sending, then replaces it
    // with the server error instead of silently closing the modal.
    expect(screen.queryByText(/Possible duplicate detected/i)).not.toBeInTheDocument();
  });

});
