/**
 * Expenses — amount-mismatch banner in the Edit modal
 *
 * What & Why
 * ──────────
 * The PUT handler calls `validateAndNormalizeBody` identically to POST, so the
 * server will reject a save with inconsistent amounts.  The UI must also surface
 * the amber advisory banner inside the Edit modal the moment it opens — i.e.
 * immediately, before the admin changes anything — so the inconsistency is
 * obvious and the admin knows to correct it before hitting Save.
 *
 * Scenario tested
 * ───────────────
 *  1. The expense list is seeded with one expense: net=100, tax=10, gross=200
 *     (net + tax = 110, which does not equal gross = 200).
 *  2. The admin clicks the Edit (pencil) button on that row.
 *  3. The Edit modal opens with the fields pre-filled from the expense.
 *  4. The amber "Amounts do not add up" banner appears immediately on open,
 *     without any further field interaction.
 *  5. The Save button remains enabled (the warning is advisory, not blocking).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/** An expense whose net + tax ≠ gross (100 + 10 ≠ 200). */
const MISMATCHED_EXPENSE = {
  id: 42,
  vendor_name: "ACME GmbH",
  invoice_date: "2024-03-15",
  invoice_number: "INV-001",
  category: "Software",
  net_amount: "100.00",
  tax_amount: "10.00",
  gross_amount: "200.00",
  currency: "EUR",
  source: "manual" as const,
  file_object_path: null,
  notes: null,
  created_at: "2024-03-15T10:00:00.000Z",
};

/**
 * Stub fetch so:
 *  - GET /api/admin/expenses       → returns [MISMATCHED_EXPENSE]
 *  - GET /api/admin/expenses/orphan-sweep-stats → 204 No Content
 *  - Everything else               → { ok: true, json: {} }
 */
function stubFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;

    if (url.includes("/api/admin/expenses/orphan-sweep-stats")) {
      return { ok: false, status: 204, json: async () => null } as unknown as Response;
    }
    if (url.includes("/api/admin/expenses/recurring-schedules")) {
      return { ok: true, json: async () => [] } as Response;
    }
    if (url.includes("/api/admin/expenses/datev-settings")) {
      return { ok: true, json: async () => ({ kontoMap: {}, gegenKonto: "1600" }) } as Response;
    }
    if (url.includes("/api/admin/expenses")) {
      return { ok: true, json: async () => [MISMATCHED_EXPENSE] } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

/** The server-side mismatch error message returned by PUT /api/admin/expenses/:id */
const SERVER_MISMATCH_ERROR =
  "Amount mismatch: net (100) + tax (10) = 110.00, but gross is 200. Please correct the amounts.";

/**
 * Stub fetch for the 422-on-PUT scenario:
 *  - Same as stubFetch for GET requests
 *  - PUT /api/admin/expenses/:id → 422 with mismatch error
 */
function stubFetchWith422Put() {
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
    // PUT on a specific expense → 422
    if (method === "PUT" && /\/api\/admin\/expenses\/\d+/.test(url)) {
      return {
        ok: false,
        status: 422,
        json: async () => ({ error: SERVER_MISMATCH_ERROR }),
      } as unknown as Response;
    }
    if (url.includes("/api/admin/expenses")) {
      return { ok: true, json: async () => [MISMATCHED_EXPENSE] } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

/** The schedules endpoint fails, but the regular expense endpoints remain available. */
function stubFetchWithScheduleFailure() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.includes("/api/admin/expenses/orphan-sweep-stats")) {
      return { ok: false, status: 204, json: async () => null } as unknown as Response;
    }
    if (url.includes("/api/admin/expenses/recurring-schedules")) {
      throw new Error("Recurring schedules unavailable");
    }
    if (url.includes("/api/admin/expenses/datev-settings")) {
      return { ok: true, json: async () => ({ kontoMap: {}, gegenKonto: "1600" }) } as Response;
    }
    if (method === "PUT" && /\/api\/admin\/expenses\/\d+/.test(url)) {
      return { ok: true, json: async () => MISMATCHED_EXPENSE } as Response;
    }
    if (url.includes("/api/admin/expenses")) {
      return { ok: true, json: async () => [MISMATCHED_EXPENSE] } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

/** The schedules endpoint fails once, then recovers when the admin retries. */
function stubFetchWithScheduleFailureThenSuccess() {
  let scheduleAttempts = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.includes("/api/admin/expenses/orphan-sweep-stats")) {
      return { ok: false, status: 204, json: async () => null } as unknown as Response;
    }
    if (url.includes("/api/admin/expenses/recurring-schedules")) {
      scheduleAttempts += 1;
      if (scheduleAttempts === 1) throw new Error("Recurring schedules unavailable");
      return { ok: true, json: async () => [] } as Response;
    }
    if (url.includes("/api/admin/expenses/datev-settings")) {
      return { ok: true, json: async () => ({ kontoMap: {}, gegenKonto: "1600" }) } as Response;
    }
    if (method === "PUT" && /\/api\/admin\/expenses\/\d+/.test(url)) {
      return { ok: true, json: async () => MISMATCHED_EXPENSE } as Response;
    }
    if (url.includes("/api/admin/expenses")) {
      return { ok: true, json: async () => [MISMATCHED_EXPENSE] } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

function stubFetchWithSlowScheduleRetry() {
  let scheduleAttempts = 0;
  let rejectRetry!: (reason: Error) => void;
  const retry = new Promise<Response>((_resolve, reject) => { rejectRetry = reject; });
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/api/admin/expenses/orphan-sweep-stats")) {
      return { ok: false, status: 204, json: async () => null } as unknown as Response;
    }
    if (url.includes("/api/admin/expenses/recurring-schedules")) {
      scheduleAttempts += 1;
      if (scheduleAttempts === 1) throw new Error("Recurring schedules unavailable");
      return retry;
    }
    if (url.includes("/api/admin/expenses/datev-settings")) {
      return { ok: true, json: async () => ({ kontoMap: {}, gegenKonto: "1600" }) } as Response;
    }
    if (url.includes("/api/admin/expenses")) {
      return { ok: true, json: async () => [MISMATCHED_EXPENSE] } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
  return {
    spy,
    rejectRetry,
    scheduleAttempts: () => scheduleAttempts,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Expenses — amount-mismatch banner in the Edit modal", () => {

  it("shows the amber banner immediately when the Edit modal opens with inconsistent amounts", async () => {
    stubFetch();
    const user = userEvent.setup();

    render(<Expenses />, { wrapper: Wrapper });

    // Wait for the expense row to appear (vendor name visible in the table).
    await waitFor(() =>
      expect(screen.getByText("ACME GmbH")).toBeInTheDocument(),
    );

    // Click the Edit (pencil) button for that expense.
    const editBtn = screen.getByRole("button", { name: /edit/i });
    await user.click(editBtn);

    // The Edit modal must open.
    await waitFor(() =>
      expect(screen.getByText(/Edit Expense/i)).toBeInTheDocument(),
    );

    // The amber banner must appear immediately — no additional field changes needed.
    expect(screen.getByText(/Amounts do not add up/i)).toBeInTheDocument();
  });

  it("shows the expected vs. actual amounts in the mismatch detail on modal open", async () => {
    stubFetch();
    const user = userEvent.setup();

    render(<Expenses />, { wrapper: Wrapper });

    await waitFor(() =>
      expect(screen.getByText("ACME GmbH")).toBeInTheDocument(),
    );

    const editBtn = screen.getByRole("button", { name: /edit/i });
    await user.click(editBtn);

    await waitFor(() =>
      expect(screen.getByText(/Edit Expense/i)).toBeInTheDocument(),
    );

    // The detail line must mention the correct sum (110.00) and the actual gross (200.00).
    expect(
      screen.getByText(/110\.00.*200\.00|200\.00.*110\.00/),
    ).toBeInTheDocument();
  });

  it("keeps the Save button enabled despite the pre-filled mismatch (non-blocking warning)", async () => {
    stubFetch();
    const user = userEvent.setup();

    render(<Expenses />, { wrapper: Wrapper });

    await waitFor(() =>
      expect(screen.getByText("ACME GmbH")).toBeInTheDocument(),
    );

    const editBtn = screen.getByRole("button", { name: /edit/i });
    await user.click(editBtn);

    // Wait for modal and banner to appear before asserting the button state.
    await waitFor(() =>
      expect(screen.getByText(/Amounts do not add up/i)).toBeInTheDocument(),
    );

    // Save button must NOT be disabled — the mismatch is advisory only.
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).not.toBeDisabled();
  });

  it("shows the 422 server error inline in the Edit modal when Save is clicked with mismatched amounts", async () => {
    stubFetchWith422Put();
    const user = userEvent.setup();

    render(<Expenses />, { wrapper: Wrapper });

    // Wait for expense row to appear.
    await waitFor(() =>
      expect(screen.getByText("ACME GmbH")).toBeInTheDocument(),
    );

    // Open the Edit modal.
    const editBtn = screen.getByRole("button", { name: /edit/i });
    await user.click(editBtn);

    await waitFor(() =>
      expect(screen.getByText(/Edit Expense/i)).toBeInTheDocument(),
    );

    // Click Save — the PUT returns 422.
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    await user.click(saveBtn);

    // The server error must appear inline inside the modal.
    await waitFor(() =>
      expect(screen.getByText(SERVER_MISMATCH_ERROR)).toBeInTheDocument(),
    );

    // The modal must still be open after the 422 (not closed on error).
    expect(screen.getByText(/Edit Expense/i)).toBeInTheDocument();
  });

  it("keeps expenses editable when recurring schedules fail to load", async () => {
    stubFetchWithScheduleFailure();
    const user = userEvent.setup();

    render(<Expenses />, { wrapper: Wrapper });

    // The independent expense request must still render its regular row.
    await waitFor(() =>
      expect(screen.getByText("ACME GmbH")).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /edit/i }));
    await waitFor(() =>
      expect(screen.getByText(/Edit Expense/i)).toBeInTheDocument(),
    );

    // Both cancel and save must remain safe while the schedules query is in error.
    await user.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(screen.queryByText(/Edit Expense/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /edit/i }));
    await waitFor(() =>
      expect(screen.getByText(/Edit Expense/i)).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() =>
      expect(screen.queryByText(/Edit Expense/i)).not.toBeInTheDocument(),
    );
  });

  it("shows a bilingual recovery status and retries the recurring schedules request", async () => {
    stubFetchWithScheduleFailureThenSuccess();
    const user = userEvent.setup();

    render(<Expenses />, { wrapper: Wrapper });

    await waitFor(() =>
      expect(screen.getByText(/Recurring reminders are temporarily unavailable/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/You can continue viewing and editing expenses/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() =>
      expect(screen.queryByText(/Recurring reminders are temporarily unavailable/i)).not.toBeInTheDocument(),
    );
    expect(screen.getByText("ACME GmbH")).toBeInTheDocument();
  });

  it("keeps a slow recurring-schedule retry visible and prevents duplicate requests", async () => {
    const request = stubFetchWithSlowScheduleRetry();
    render(<Expenses />, { wrapper: Wrapper });

    const retry = await screen.findByRole("button", { name: /try again/i });
    expect(request.scheduleAttempts()).toBe(1);
    fireEvent.click(retry);

    expect(request.scheduleAttempts()).toBe(2);
    expect(screen.getByText(/Recurring reminders are temporarily unavailable/i)).toBeInTheDocument();
    const loading = screen.getByRole("button", { name: /loading/i });
    expect(loading).toBeDisabled();
    fireEvent.click(loading);
    expect(request.scheduleAttempts()).toBe(2);

    request.rejectRetry(new Error("Still unavailable"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /try again/i })).not.toBeDisabled();
    });
    expect(request.scheduleAttempts()).toBe(2);
  });

});
