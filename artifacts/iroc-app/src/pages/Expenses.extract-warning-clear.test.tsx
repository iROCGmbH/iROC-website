/**
 * Expenses — extractWarning clears when admin closes and reopens modal via Manual Entry
 *
 * What & Why
 * ──────────
 * When the admin cancels the extraction confirmation modal (which showed a
 * low-confidence warning) and then re-opens the modal via the "Manual Entry"
 * button, the stale `extractWarning` must be gone.  The cancelModal handler
 * calls setExtractWarning(''), and the Manual Entry onClick also calls
 * setExtractWarning('') — this test confirms both guards work together so
 * no stale AI-confidence banner leaks into a fresh manual-entry session.
 *
 * Scenario tested
 * ───────────────
 *  1. Stub fetch so /expenses/extract returns confidence:"low".
 *  2. Upload a fake PDF — extraction runs, modal opens in "confirm" mode.
 *  3. Assert the AI-confidence banner is present ("Low extraction confidence").
 *  4. Click the "Cancel" button inside the modal (triggers cancelModal).
 *  5. Assert the modal is gone.
 *  6. Click the "Manual Entry" button in the filter bar.
 *  7. Assert the manual-entry modal opens ("Add Expense Manually").
 *  8. Assert the AI-confidence banner is ABSENT in the fresh modal.
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
 * Stub fetch so the extraction endpoint returns low confidence.
 * Also handles the DELETE call cancelModal fires for orphan cleanup.
 */
function stubFetchWithLowConfidence() {
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
      return {
        ok: true,
        json: async () => ({
          fileObjectPath: "/objects/expense-receipts/test.pdf",
          extracted: {
            vendor_name: "Low Conf Vendor",
            invoice_date: "2024-03-10",
            invoice_number: "INV-LOW-001",
            category: "Software",
            net_amount: 50,
            tax_amount: 9.5,
            gross_amount: 59.5,
            currency: "EUR",
            confidence: "low",
            items: [],
          },
        }),
      } as Response;
    }
    // Orphan-file DELETE triggered by cancelModal
    if (url.includes("/api/admin/expenses/file") && method === "DELETE") {
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }
    // Generic expenses list
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
 * Trigger the hidden file input's onChange handler with a fake file.
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

describe("Expenses — extractWarning clears when modal is closed and reopened via Manual Entry", () => {

  it("shows the AI-confidence banner in the extraction modal after a low-confidence upload", async () => {
    stubFetchWithLowConfidence();
    render(<Expenses />, { wrapper: Wrapper });

    uploadFakeFile(makeFakePdf());

    await waitFor(
      () => expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );

    expect(screen.getByText(/Low extraction confidence/i)).toBeInTheDocument();
  });

  it("hides the AI-confidence banner when the admin cancels and reopens via Manual Entry", async () => {
    stubFetchWithLowConfidence();
    render(<Expenses />, { wrapper: Wrapper });

    // Step 1: upload triggers extraction → confirmation modal opens with warning
    uploadFakeFile(makeFakePdf());

    await waitFor(
      () => expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );

    // Confidence banner is visible in the confirmation modal
    expect(screen.getByText(/Low extraction confidence/i)).toBeInTheDocument();

    // Step 2: admin clicks the "Cancel" button inside the modal
    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButton);

    // Modal closes — "Review Extraction & Save" title is gone
    await waitFor(() =>
      expect(screen.queryByText(/Review Extraction & Save/i)).not.toBeInTheDocument(),
    );

    // Step 3: admin clicks "Manual Entry" to open a fresh modal
    const manualEntryButton = screen.getByRole("button", { name: /Manual Entry/i });
    fireEvent.click(manualEntryButton);

    // Manual-entry modal opens
    await waitFor(() =>
      expect(screen.getByText(/Add Expense Manually/i)).toBeInTheDocument(),
    );

    // Step 4: the AI-confidence banner must NOT appear in the fresh modal
    expect(screen.queryByText(/Low extraction confidence/i)).not.toBeInTheDocument();
  });

  it("does not show any amber AI-confidence banner div after cancel and Manual Entry reopen", async () => {
    stubFetchWithLowConfidence();
    render(<Expenses />, { wrapper: Wrapper });

    uploadFakeFile(makeFakePdf());

    await waitFor(
      () => expect(screen.getByText(/Review Extraction & Save/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );

    // Cancel the modal
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.queryByText(/Review Extraction & Save/i)).not.toBeInTheDocument(),
    );

    // Reopen via Manual Entry
    fireEvent.click(screen.getByRole("button", { name: /Manual Entry/i }));

    await waitFor(() =>
      expect(screen.getByText(/Add Expense Manually/i)).toBeInTheDocument(),
    );

    // No amber banner with "Low extraction confidence" text should exist anywhere
    expect(screen.queryByText(/Low extraction confidence/i)).not.toBeInTheDocument();

    // The modal body should not contain any element whose text includes the warning phrase
    const modal = document.querySelector("div[class*='rounded-2xl']");
    expect(modal).not.toBeNull();
    expect(modal!.textContent).not.toMatch(/Low extraction confidence/i);
  });

});
