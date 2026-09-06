/**
 * Expenses — AI-confidence banner and amount-mismatch banner coexist
 *
 * What & Why
 * ──────────
 * The extraction confirmation modal can show up to three stacked banners:
 *   1. Duplicate warning
 *   2. Amount-mismatch warning (amber, advisory)
 *   3. AI extraction-confidence warning (amber, advisory)
 *
 * When the AI returns low confidence AND the extracted amounts are inconsistent
 * (net + tax ≠ gross), both banners 2 and 3 must appear simultaneously as
 * separate, distinct DOM elements — not merged, hidden, or overlapping.
 *
 * Scenario tested
 * ───────────────
 *  1. Stub fetch so:
 *       • Upload-URL presign  → returns a dummy signed URL
 *       • GCS PUT             → ok
 *       • /expenses/extract   → confidence:"low", net=100, tax=10, gross=200
 *  2. Trigger a file-input change with a synthetic PDF file (≥ 64 bytes).
 *  3. Wait for the confirmation modal ("Review Extraction & Save") to open.
 *  4. Assert the AI-confidence banner is present ("Low extraction confidence").
 *  5. Assert the amount-mismatch banner is present ("Amounts do not add up").
 *  6. Assert they are two separate DOM elements (not the same node).
 *  7. Assert the Save button remains enabled (both warnings are advisory).
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
 * Stub fetch so the extraction endpoint returns low confidence with amounts
 * that also mismatch: net=100, tax=10, gross=200 (100+10 ≠ 200).
 *
 * Ordering matters — more specific URL checks must come before the generic
 * /api/admin/expenses catch-all.
 */
function stubFetchWithLowConfidenceMismatch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;

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
      // Presign step — return a signed GCS URL
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
      // GCS PUT — always ok
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }
    if (url.includes("/api/admin/expenses/extract")) {
      // Low confidence + mismatched amounts: net=100, tax=10, gross=200 → 110≠200
      return {
        ok: true,
        json: async () => ({
          fileObjectPath: "/objects/expense-receipts/test.pdf",
          extracted: {
            vendor_name: "Test Corp",
            invoice_date: "2024-01-15",
            invoice_number: "INV-TEST-001",
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
    // Generic expenses list
    if (url.includes("/api/admin/expenses")) {
      return { ok: true, json: async () => [] } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

/**
 * Create a fake PDF file that passes the component's 64-byte minimum size
 * check. Content is a simple ASCII string of 100 characters.
 */
function makeFakePdf(): File {
  const content = "A".repeat(100); // 100 bytes > 64-byte minimum
  return new File([content], "receipt.pdf", { type: "application/pdf" });
}

/**
 * Trigger the file input's onChange handler with a fake file using the
 * React Testing Library convention: set the `files` property on the
 * underlying DOM node, then fireEvent.change.
 */
function uploadFakeFile(file: File) {
  // The file input is hidden (className="hidden") but still in the DOM
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!fileInput) throw new Error("File input not found in DOM");

  // Testing-library approach: assign files via defineProperty then fire change
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

describe("Expenses — AI-confidence banner and amount-mismatch banner coexist", () => {

  it("shows both the AI-confidence banner and the amount-mismatch banner simultaneously", async () => {
    stubFetchWithLowConfidenceMismatch();
    render(<Expenses />, { wrapper: Wrapper });

    uploadFakeFile(makeFakePdf());

    // Wait for the confirmation modal to open (title = "Review Extraction & Save")
    await waitFor(
      () => expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );

    // Both banners must appear in the open modal
    const confidenceBanner = screen.getByText(/Low extraction confidence/i);
    const mismatchHeading  = screen.getByText(/Amounts do not add up/i);

    expect(confidenceBanner).toBeInTheDocument();
    expect(mismatchHeading).toBeInTheDocument();

    // They must be two distinct DOM nodes — not the same element
    expect(confidenceBanner).not.toBe(mismatchHeading);
  });

  it("renders the two banners as separate, non-overlapping container elements", async () => {
    stubFetchWithLowConfidenceMismatch();
    render(<Expenses />, { wrapper: Wrapper });

    uploadFakeFile(makeFakePdf());

    await waitFor(
      () => expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );

    const confidenceEl = screen.getByText(/Low extraction confidence/i);
    const mismatchEl   = screen.getByText(/Amounts do not add up/i);

    // Walk up to each banner's border-* container div
    const confidenceBannerDiv = confidenceEl.closest("div[class*='border']");
    const mismatchBannerDiv   = mismatchEl.closest("div[class*='border']");

    expect(confidenceBannerDiv).not.toBeNull();
    expect(mismatchBannerDiv).not.toBeNull();

    // They must be different container elements
    expect(confidenceBannerDiv).not.toBe(mismatchBannerDiv);

    // Neither banner contains the other
    expect(confidenceBannerDiv!.contains(mismatchBannerDiv)).toBe(false);
    expect(mismatchBannerDiv!.contains(confidenceBannerDiv)).toBe(false);
  });

  it("keeps the Save button enabled when both banners are showing (advisory only)", async () => {
    stubFetchWithLowConfidenceMismatch();
    render(<Expenses />, { wrapper: Wrapper });

    uploadFakeFile(makeFakePdf());

    await waitFor(
      () => expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );

    // Both advisory warnings visible
    expect(screen.getByText(/Low extraction confidence/i)).toBeInTheDocument();
    expect(screen.getByText(/Amounts do not add up/i)).toBeInTheDocument();

    // Primary action button must NOT be disabled — warnings are advisory only
    const saveBtn = screen.getByRole("button", { name: /save expense/i });
    expect(saveBtn).not.toBeDisabled();
  });

  it("the amount-mismatch detail line cites net+tax=110 vs actual gross=200", async () => {
    stubFetchWithLowConfidenceMismatch();
    render(<Expenses />, { wrapper: Wrapper });

    uploadFakeFile(makeFakePdf());

    await waitFor(
      () => expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );

    // Detail: net(100) + tax(10) = 110, but gross is 200
    expect(
      screen.getByText(/110\.00.*200\.00|200\.00.*110\.00/),
    ).toBeInTheDocument();
  });

});
