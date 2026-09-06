/**
 * DatevExport — exemption reasons survive a dismissed re-export confirmation.
 *
 * The exemption-reason controls are tied to selected 0 % VAT invoices. Closing
 * the confirmation dialog must not discard their values, including when an
 * invoice row is temporarily deselected and selected again.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DatevExport from "./DatevExport";

// Radix Select needs pointer-capture support unavailable in jsdom. A native
// select retains the component's controlled-value behavior for this test.
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
  const Select = ({ value, onValueChange, children }: SelectProps) =>
    React.createElement(
      "select",
      {
        role: "combobox",
        value: value ?? "",
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
          onValueChange?.(event.target.value),
      },
      children,
    );
  const SelectContent = ({ children }: ChildrenProps) => children;
  const SelectTrigger = ({ children }: ChildrenProps) => children;
  const SelectValue = ({ placeholder }: { placeholder?: string }) =>
    React.createElement("option", { value: "" }, placeholder ?? "");
  const SelectItem = ({ value, children }: ItemProps) =>
    React.createElement("option", { value }, children);
  return { Select, SelectContent, SelectTrigger, SelectValue, SelectItem };
});

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const FIRST_INVOICE = {
  id: 427,
  invoiceNumber: "INV-2026-0427",
  issueDate: "2026-08-01",
  total: "500.00",
  vatRate: "0.00",
  status: "sent" as const,
  invoiceType: "eu",
  customerName: "EU Customer GmbH",
};

const SECOND_INVOICE = {
  id: 428,
  invoiceNumber: "INV-2026-0428",
  issueDate: "2026-08-02",
  total: "350.00",
  vatRate: "0.00",
  status: "paid" as const,
  invoiceType: "noneu",
  customerName: "Export Customer Ltd.",
};

const FIRST_REASON =
  "Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1b UStG)";
const SECOND_REASON =
  "Steuerfreie Ausfuhrlieferung (§ 4 Nr. 1a UStG)";

function installFetchSpy() {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.toString()
            : input;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();

      if (url.includes("/api/iroc/datev/settings")) {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url.includes("/api/iroc/datev/exported-ids")) {
        return { ok: true, json: async () => ({ ids: [] }) } as Response;
      }
      if (url.includes("/api/iroc/datev/exports")) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (url.includes("/api/admin/expenses")) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (method === "GET" && url.includes("/api/iroc/datev/invoices")) {
        return {
          ok: true,
          json: async () => [FIRST_INVOICE, SECOND_INVOICE],
        } as Response;
      }
      if (method === "POST" && url.includes("/api/iroc/datev/export")) {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: "already_exported",
            invoiceNumbers: [FIRST_INVOICE.invoiceNumber, SECOND_INVOICE.invoiceNumber],
          }),
        } as unknown as Response;
      }

      throw new Error(`Unmocked fetch: ${method} ${url}`);
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DatevExport — retained exemption reasons", () => {
  it("keeps each reason after an invoice row is revisited and the re-export dialog is reopened", async () => {
    const user = userEvent.setup();
    installFetchSpy();

    render(<DatevExport />);

    await waitFor(() =>
      expect(screen.getAllByRole("combobox")).toHaveLength(2),
    );

    let reasonSelects = screen.getAllByRole("combobox");
    fireEvent.change(reasonSelects[0], { target: { value: FIRST_REASON } });
    fireEvent.change(reasonSelects[1], { target: { value: SECOND_REASON } });
    expect(reasonSelects[0]).toHaveValue(FIRST_REASON);
    expect(reasonSelects[1]).toHaveValue(SECOND_REASON);

    // Move away from the second selected invoice, then revisit it. Its reason
    // must return with the row rather than reverting to the empty placeholder.
    await user.click(screen.getAllByText(SECOND_INVOICE.invoiceNumber)[0]);
    await waitFor(() =>
      expect(screen.getAllByRole("combobox")).toHaveLength(1),
    );
    expect(screen.getByRole("combobox")).toHaveValue(FIRST_REASON);

    await user.click(screen.getAllByText(SECOND_INVOICE.invoiceNumber)[0]);
    await waitFor(() =>
      expect(screen.getAllByRole("combobox")).toHaveLength(2),
    );
    reasonSelects = screen.getAllByRole("combobox");
    expect(reasonSelects[0]).toHaveValue(FIRST_REASON);
    expect(reasonSelects[1]).toHaveValue(SECOND_REASON);

    await user.type(
      screen.getByPlaceholderText("buchhaltung@kanzlei.de"),
      "tax@firm.example",
    );
    const exportButton = screen.getByRole("button", {
      name: /Export.*invoices.*via Email/i,
    });

    // First export attempt opens the confirmation dialog. Closing it must keep
    // the controlled exemption-reason state on the underlying export page.
    await user.click(exportButton);
    await screen.findByText(/Previously exported invoices/i);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByText(/Previously exported invoices/i),
      ).not.toBeInTheDocument(),
    );

    // Reopen the confirmation dialog and confirm the reasons are still present.
    await user.click(exportButton);
    await screen.findByText(/Previously exported invoices/i);
    reasonSelects = screen.getAllByRole("combobox");
    expect(reasonSelects[0]).toHaveValue(FIRST_REASON);
    expect(reasonSelects[1]).toHaveValue(SECOND_REASON);
  });
});