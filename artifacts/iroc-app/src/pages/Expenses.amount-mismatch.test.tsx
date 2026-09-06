/**
 * Expenses — amount-mismatch warning in the confirmation modal
 *
 * What & Why
 * ──────────
 * When AI extraction returns inconsistent figures (net + tax ≠ gross) the
 * component computes `amountMismatchWarning` and renders an amber banner inside
 * the confirmation modal.  The banner must be visible but the Save button must
 * remain enabled — the warning is advisory, not blocking.
 *
 * Scenario tested
 * ───────────────
 *  1. Open the "Manual Entry" modal (same JSX path as the extraction modal).
 *  2. Pre-fill net = 100, tax = 10, gross = 200  (mismatch: 100+10 ≠ 200).
 *  3. Assert the amber "Amounts do not add up" heading appears.
 *  4. Assert the detail line mentions the expected vs. actual amounts.
 *  5. Assert the Save button is NOT disabled (non-blocking warning).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

/** Stub fetch: the expenses list returns [] so the page renders without errors. */
function stubFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/api/admin/expenses")) {
      return { ok: true, json: async () => [] } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Expenses — amount-mismatch warning in modal", () => {

  it("shows the amber 'Amounts do not add up' banner when net+tax ≠ gross", async () => {
    stubFetch();
    const user = userEvent.setup();

    render(<Expenses />, { wrapper: Wrapper });

    // Open the modal via the Manual Entry button.
    const manualBtn = await screen.findByRole("button", { name: /manual entry/i });
    await user.click(manualBtn);

    // Modal should now be open (title visible).
    await waitFor(() =>
      expect(screen.getByText(/Add Expense Manually/i)).toBeInTheDocument()
    );

    // Fill: net = 100, tax = 10, gross = 200  →  100 + 10 ≠ 200  (mismatch)
    const inputs = screen.getAllByRole("spinbutton"); // type="number" inputs
    // inputs[0] = Net Amount, [1] = Tax/VAT Amount, [2] = Gross Amount
    fireEvent.change(inputs[0], { target: { value: "100" } });
    fireEvent.change(inputs[1], { target: { value: "10"  } });
    fireEvent.change(inputs[2], { target: { value: "200" } });

    // The amber banner heading must appear.
    await waitFor(() =>
      expect(screen.getByText(/Amounts do not add up/i)).toBeInTheDocument()
    );

    // The detail message must mention the expected sum and the actual gross.
    expect(screen.getByText(/110\.00.*200\.00|200\.00.*110\.00/)).toBeInTheDocument();
  });

  it("keeps the Save button enabled despite the amount mismatch (non-blocking)", async () => {
    stubFetch();
    const user = userEvent.setup();

    render(<Expenses />, { wrapper: Wrapper });

    const manualBtn = await screen.findByRole("button", { name: /manual entry/i });
    await user.click(manualBtn);

    await waitFor(() =>
      expect(screen.getByText(/Add Expense Manually/i)).toBeInTheDocument()
    );

    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[0], { target: { value: "100" } });
    fireEvent.change(inputs[1], { target: { value: "10"  } });
    fireEvent.change(inputs[2], { target: { value: "200" } });

    // Wait for the warning to appear (ensures state has settled).
    await waitFor(() =>
      expect(screen.getByText(/Amounts do not add up/i)).toBeInTheDocument()
    );

    // The primary action button must NOT be disabled.
    const saveBtn = screen.getByRole("button", { name: /save expense/i });
    expect(saveBtn).not.toBeDisabled();
  });

  it("does NOT show the mismatch banner when amounts are consistent (net+tax = gross)", async () => {
    stubFetch();
    const user = userEvent.setup();

    render(<Expenses />, { wrapper: Wrapper });

    const manualBtn = await screen.findByRole("button", { name: /manual entry/i });
    await user.click(manualBtn);

    await waitFor(() =>
      expect(screen.getByText(/Add Expense Manually/i)).toBeInTheDocument()
    );

    // net=100, tax=19, gross=119  →  consistent
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[0], { target: { value: "100" } });
    fireEvent.change(inputs[1], { target: { value: "19"  } });
    fireEvent.change(inputs[2], { target: { value: "119" } });

    // Banner must be absent.
    expect(screen.queryByText(/Amounts do not add up/i)).toBeNull();
  });

  it("does NOT show the mismatch banner when only some amount fields are filled", async () => {
    stubFetch();
    const user = userEvent.setup();

    render(<Expenses />, { wrapper: Wrapper });

    const manualBtn = await screen.findByRole("button", { name: /manual entry/i });
    await user.click(manualBtn);

    await waitFor(() =>
      expect(screen.getByText(/Add Expense Manually/i)).toBeInTheDocument()
    );

    // Only net and tax filled — gross is blank → no banner (partial data)
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[0], { target: { value: "100" } });
    fireEvent.change(inputs[1], { target: { value: "10"  } });
    // inputs[2] (gross) left empty

    expect(screen.queryByText(/Amounts do not add up/i)).toBeNull();
  });

});
