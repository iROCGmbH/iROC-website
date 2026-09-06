/**
 * DatevExport – exemption-reason round-trip through the re-export dialog
 *
 * Critical behaviour under test:
 *   When the server returns a 409 already_exported the component stores the
 *   current exemptionReasons map inside reexportPending and shows a
 *   confirmation dialog.  When the admin clicks "Export anyway" those saved
 *   reasons must appear verbatim in the force=true re-export request body —
 *   they must not be silently dropped, reset, or re-read from stale state.
 *
 * Covered scenarios
 * ─────────────────
 * 1. 409 → dialog appears → "Export anyway" → force re-export carries
 *    the original exemptionReasons map, closes the dialog, and shows success.
 * 2. "Cancel" on the dialog does NOT fire a second export request.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DatevExport from "./DatevExport";

// ── Radix UI Select doesn't support pointer-capture in jsdom — replace with ──
// ── a native <select> so value changes work reliably in the test environment ──
vi.mock("@/components/ui/select", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  type SelectProps = {
    value?: string;
    onValueChange?: (value: string) => void;
    children?: React.ReactNode;
  };
  type ChildrenProps = { children?: React.ReactNode };
  type ItemProps = ChildrenProps & { value: string };
  const Select = ({ value, onValueChange, children }: SelectProps) => {
    return React.createElement(
      "select",
      {
        role: "combobox",
        value: value ?? "",
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
          onValueChange?.(e.target.value),
      },
      children,
    );
  };
  const SelectContent = ({ children }: ChildrenProps) => children;
  const SelectTrigger = ({ children }: ChildrenProps) => children;
  const SelectValue = ({ placeholder }: { placeholder?: string }) =>
    React.createElement("option", { value: "" }, placeholder ?? "");
  const SelectItem = ({ value, children }: ItemProps) =>
    React.createElement("option", { value }, children);
  return { Select, SelectContent, SelectTrigger, SelectValue, SelectItem };
});

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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ZERO_VAT_INVOICE = {
  id: 42,
  invoiceNumber: "INV-2026-042",
  issueDate: "2026-08-01",
  total: "500.00",
  vatRate: "0.00",
  status: "sent" as const,
  customerName: "EU Customer GmbH",
};

const EXEMPTION_REASON =
  "Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1b UStG)";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Install a fetch spy that:
 * - Serves the DATEV settings / meta endpoints with empty defaults.
 * - Returns the provided invoices for the invoice-list query.
 * - On the first POST /api/iroc/datev/export returns a 409 already_exported.
 * - On the second POST (force=true) records the body in capturedBodies and
 *   returns a success response.
 */
function installFetchSpy(opts: {
  invoices?: object[];
}): {
  capturedBodies: unknown[];
  exportCallCount: () => number;
} {
  const { invoices = [ZERO_VAT_INVOICE] } = opts;
  const capturedBodies: unknown[] = [];
  let callCount = 0;

  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
          ? input.toString()
          : (input as string);

      const method = (
        init?.method ??
        (input instanceof Request ? input.method : "GET")
      ).toUpperCase();

      // ── DATEV meta / settings ───────────────────────────────────────────────
      if (url.includes("/api/iroc/datev/settings")) {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url.includes("/api/iroc/datev/exported-ids")) {
        return { ok: true, json: async () => ({ ids: [] }) } as Response;
      }
      if (url.includes("/api/iroc/datev/exports")) {
        return { ok: true, json: async () => [] } as Response;
      }

      // ── Invoice list ────────────────────────────────────────────────────────
      if (method === "GET" && url.includes("/api/iroc/datev/invoices")) {
        return { ok: true, json: async () => invoices } as Response;
      }

      // ── Export POST ─────────────────────────────────────────────────────────
      if (method === "POST" && url.includes("/api/iroc/datev/export")) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        capturedBodies.push(body);
        callCount++;

        if (callCount === 1) {
          // First attempt → simulate server-side 409
          return {
            ok: false,
            status: 409,
            json: async () => ({
              error: "already_exported",
              invoiceNumbers: [ZERO_VAT_INVOICE.invoiceNumber],
            }),
          } as unknown as Response;
        }

        // Subsequent attempts (force=true) → success
        return {
          ok: true,
          status: 200,
          json: async () => ({ exported: 1, skipped: [] }),
        } as unknown as Response;
      }

      throw new Error(`Unmocked fetch: ${method} ${url}`);
    },
  );

  return { capturedBodies, exportCallCount: () => callCount };
}

afterEach(() => {
  vi.restoreAllMocks();
  mockToast.mockClear();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DatevExport – exemption-reason round-trip through re-export dialog", () => {
  // ── 1. Reasons survive the confirmation dialog ──────────────────────────────
  it("includes the original exemptionReasons in the force=true re-export request body", async () => {
    const user = userEvent.setup();
    const { capturedBodies, exportCallCount } = installFetchSpy({});

    render(<DatevExport />);

    // Wait for the invoice list to appear (number appears in the table and in
    // the exemption-reason panel — use getAllByText and assert at least one)
    await waitFor(() =>
      expect(screen.getAllByText("INV-2026-042").length).toBeGreaterThan(0),
    );

    // The 0 % VAT invoice triggers the exemption-reason block.
    // The Select is mocked as a native <select>; change its value directly.
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: EXEMPTION_REASON } });

    // Fill in the bookkeeper email
    const emailInput = screen.getByPlaceholderText("buchhaltung@kanzlei.de");
    await user.clear(emailInput);
    await user.type(emailInput, "tax@firm.example");

    // Click the email-export button
    const exportBtn = screen.getByRole("button", {
      name: /Export.*invoice.*via Email/i,
    });
    await user.click(exportBtn);

    // ── First request: 409 → dialog should appear ───────────────────────────
    await waitFor(() =>
      expect(
        screen.getByText(/Previously exported invoices/i),
      ).toBeInTheDocument(),
    );

    // Verify first request did NOT carry force=true
    const firstBody = capturedBodies[0] as { force: boolean };
    expect(firstBody.force).toBe(false);

    // ── Confirm re-export ───────────────────────────────────────────────────
    const confirmBtn = screen.getByRole("button", { name: /Export anyway/i });
    await user.click(confirmBtn);

    // Wait for the second fetch to fire
    await waitFor(() => expect(exportCallCount()).toBe(2));

    // ── Assert the re-export body ───────────────────────────────────────────
    const reexportBody = capturedBodies[1] as {
      force: boolean;
      invoiceIds: number[];
      bookkeeperEmail: string;
      exemptionReasons: Record<number, string>;
    };

    expect(reexportBody.force).toBe(true);
    expect(reexportBody.invoiceIds).toContain(ZERO_VAT_INVOICE.id);
    expect(reexportBody.bookkeeperEmail).toBe("tax@firm.example");

    // The exemption reason for the 0 % VAT invoice must be preserved.
    expect(reexportBody.exemptionReasons).toEqual({
      [ZERO_VAT_INVOICE.id]: EXEMPTION_REASON,
    });

    // A successful forced export must leave the page in its completed state:
    // the confirmation dialog is dismissed and the email-export success banner
    // is visible to the admin.
    await waitFor(() =>
      expect(
        screen.queryByText(/Previously exported invoices/i),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Email sent successfully! 1 invoice exported\./i),
    ).toBeInTheDocument();
  });

  // ── 2. Cancelling does not fire a second export ─────────────────────────────
  it("does not fire a second export request when the admin cancels the re-export dialog", async () => {
    const user = userEvent.setup();
    const { exportCallCount } = installFetchSpy({});

    render(<DatevExport />);

    await waitFor(() =>
      expect(screen.getAllByText("INV-2026-042").length).toBeGreaterThan(0),
    );

    // Fill email and export (no exemption reason needed for this scenario)
    const emailInput = screen.getByPlaceholderText("buchhaltung@kanzlei.de");
    await user.clear(emailInput);
    await user.type(emailInput, "tax@firm.example");

    const exportBtn = screen.getByRole("button", {
      name: /Export.*invoice.*via Email/i,
    });
    await user.click(exportBtn);

    // Wait for dialog
    await waitFor(() =>
      expect(
        screen.getByText(/Previously exported invoices/i),
      ).toBeInTheDocument(),
    );

    // Cancel
    const cancelBtn = screen.getByRole("button", { name: /Cancel/i });
    await user.click(cancelBtn);

    // Dialog should disappear
    await waitFor(() =>
      expect(
        screen.queryByText(/Previously exported invoices/i),
      ).not.toBeInTheDocument(),
    );

    // Only the one initial request was made
    expect(exportCallCount()).toBe(1);
  });
});
