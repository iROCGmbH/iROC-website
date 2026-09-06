/**
 * Expenses — POST 422 mismatch error surfaced inline in the Add modal
 *
 * What & Why
 * ──────────
 * The POST /api/admin/expenses path in `handleSave` calls the same
 * `validateAndNormalizeBody` guard on the server side as PUT.  When the
 * amounts are inconsistent the server returns 422 with a plain-English
 * error.  The UI must surface that error inline inside the open modal
 * (via `saveError`) instead of swallowing it.  The modal must also stay
 * open so the admin can correct the values and retry.
 *
 * Scenario tested
 * ───────────────
 *  1. The admin clicks "Manual Entry" to open the Add modal.
 *  2. The admin fills in net, tax, and gross amounts that do not add up,
 *     plus a vendor name so the basic form validation passes.
 *  3. The admin clicks "Save Expense".
 *  4. The stubbed POST returns 422 { error: SERVER_MISMATCH_ERROR }.
 *  5. The error message appears inline inside the modal.
 *  6. The modal header ("Add Expense Manually") is still visible — the
 *     modal was not closed on error.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

/** The server-side mismatch error message returned by POST /api/admin/expenses */
const SERVER_MISMATCH_ERROR =
  "Amount mismatch: net (100) + tax (10) = 110.00, but gross is 200. Please correct the amounts.";

/**
 * Base fetch stub:
 *  - GET /api/admin/expenses/orphan-sweep-stats → 204 No Content
 *  - GET /api/admin/expenses/datev-settings     → { kontoMap: {}, gegenKonto: "1600" }
 *  - GET /api/admin/expenses                    → []  (empty list)
 *  - Everything else                            → { ok: true, json: {} }
 */
function stubFetchWithEmptyList() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url    = typeof input === "string" ? input : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.includes("/api/admin/expenses/orphan-sweep-stats")) {
      return { ok: false, status: 204, json: async () => null } as unknown as Response;
    }
    if (url.includes("/api/admin/expenses/recurring-schedules")) {
      return { ok: true, json: async () => [] } as Response;
    }
    if (url.includes("/api/admin/expenses/datev-settings")) {
      return { ok: true, json: async () => ({ kontoMap: {}, gegenKonto: "1600" }) } as Response;
    }
    // POST on the collection → 422 mismatch
    if (method === "POST" && url.endsWith("/api/admin/expenses")) {
      return {
        ok: false,
        status: 422,
        json: async () => ({ error: SERVER_MISMATCH_ERROR }),
      } as unknown as Response;
    }
    if (url.includes("/api/admin/expenses")) {
      return { ok: true, json: async () => [] } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

const EXISTING_EXPENSE = {
  id: 42,
  vendor_name: "Existing Expense Vendor",
  invoice_date: "2026-08-22",
  invoice_number: "EXISTING-42",
  category: "Software",
  net_amount: "100.00",
  tax_amount: "19.00",
  gross_amount: "119.00",
  shipping_cost: "0.00",
  currency: "EUR",
  invoice_date_original: null,
  date_ambiguous: false,
  date_reviewed: true,
  net_amount_eur: "100.00",
  tax_amount_eur: "19.00",
  gross_amount_eur: "119.00",
  shipping_cost_eur: "0.00",
  exchange_rate: "1.00",
  exchange_rate_date: "2026-08-22",
  conversion_status: "not_needed" as const,
  source: "manual" as const,
  file_object_path: null,
  notes: null,
  created_at: "2026-08-22T09:00:00.000Z",
};

function stubFetchWithExistingExpenseAndPost422() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.includes("/api/admin/expenses/orphan-sweep-stats")) {
      return { ok: false, status: 204, json: async () => null } as unknown as Response;
    }
    if (url.includes("/api/admin/expenses/datev-settings")) {
      return { ok: true, json: async () => ({ kontoMap: {}, gegenKonto: "1600" }) } as Response;
    }
    if (url.includes("/api/admin/expenses/recurring-schedules")) {
      return { ok: true, json: async () => [] } as Response;
    }
    if (method === "POST" && url.endsWith("/api/admin/expenses")) {
      return {
        ok: false,
        status: 422,
        json: async () => ({ error: SERVER_MISMATCH_ERROR }),
      } as unknown as Response;
    }
    if (url.includes("/api/admin/expenses")) {
      return { ok: true, json: async () => [EXISTING_EXPENSE] } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Expenses — POST 422 mismatch error in the Add (manual) modal", () => {

  it("shows the 422 server error inline when Save Expense returns a mismatch", async () => {
    stubFetchWithEmptyList();
    const user = userEvent.setup();

    render(<Expenses />, { wrapper: Wrapper });

    // Wait for the page to settle (empty state message should appear).
    await waitFor(() =>
      expect(screen.getByText(/No expenses yet/i)).toBeInTheDocument(),
    );

    // Open the manual-entry modal.
    const manualBtn = screen.getByRole("button", { name: /Manual Entry/i });
    await user.click(manualBtn);

    // The modal must open with the Add title.
    await waitFor(() =>
      expect(screen.getByText(/Add Expense Manually/i)).toBeInTheDocument(),
    );

    // Fill in a vendor name so the basic "at least one field" guard passes.
    const vendorInput = screen.getByPlaceholderText("ACME GmbH");
    await user.clear(vendorInput);
    await user.type(vendorInput, "Test Vendor");

    // Click "Save Expense" — the POST returns 422.
    const saveBtn = screen.getByRole("button", { name: /Save Expense/i });
    await user.click(saveBtn);

    // The server error must appear inline inside the modal.
    await waitFor(() =>
      expect(screen.getByText(SERVER_MISMATCH_ERROR)).toBeInTheDocument(),
    );

    // The modal must still be open after the 422 (not closed on error).
    expect(screen.getByText(/Add Expense Manually/i)).toBeInTheDocument();
  });

  it("keeps the modal open and does not call toast on a 422 POST response", async () => {
    stubFetchWithEmptyList();
    const user = userEvent.setup();

    render(<Expenses />, { wrapper: Wrapper });

    await waitFor(() =>
      expect(screen.getByText(/No expenses yet/i)).toBeInTheDocument(),
    );

    const manualBtn = screen.getByRole("button", { name: /Manual Entry/i });
    await user.click(manualBtn);

    await waitFor(() =>
      expect(screen.getByText(/Add Expense Manually/i)).toBeInTheDocument(),
    );

    // Fill in vendor so the early-return guard passes.
    const vendorInput = screen.getByPlaceholderText("ACME GmbH");
    await user.type(vendorInput, "Test Vendor");

    mockToast.mockClear();

    const saveBtn = screen.getByRole("button", { name: /Save Expense/i });
    await user.click(saveBtn);

    // Wait for the inline error to appear.
    await waitFor(() =>
      expect(screen.getByText(SERVER_MISMATCH_ERROR)).toBeInTheDocument(),
    );

    // The success toast must NOT have been called — the save failed.
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/Expense saved/i) }),
    );

    // The modal remains open.
    expect(screen.getByText(/Add Expense Manually/i)).toBeInTheDocument();
  });

  it("keeps the existing expense visible and shows no toast after cancelling a failed save", async () => {
    stubFetchWithExistingExpenseAndPost422();
    const user = userEvent.setup();

    render(<Expenses />, { wrapper: Wrapper });

    // The original list entry is loaded before the failed mutation begins.
    await waitFor(() =>
      expect(screen.getByText(EXISTING_EXPENSE.vendor_name)).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /Manual Entry/i }));
    await waitFor(() =>
      expect(screen.getByText(/Add Expense Manually/i)).toBeInTheDocument(),
    );

    const vendorInput = screen.getByPlaceholderText("ACME GmbH");
    await user.type(vendorInput, "Rejected Expense Vendor");
    await user.click(screen.getByRole("button", { name: /Save Expense/i }));

    await waitFor(() =>
      expect(screen.getByText(SERVER_MISMATCH_ERROR)).toBeInTheDocument(),
    );

    // Dismissing the failed form must not emit a follow-up error toast.
    mockToast.mockClear();
    await user.click(screen.getByRole("button", { name: /^Cancel$/i }));

    await waitFor(() =>
      expect(screen.queryByText(/Add Expense Manually/i)).not.toBeInTheDocument(),
    );
    expect(screen.getByText(EXISTING_EXPENSE.vendor_name)).toBeInTheDocument();
    expect(mockToast).not.toHaveBeenCalled();
  });

});
