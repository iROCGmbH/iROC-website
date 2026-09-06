import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DatevExport from "./DatevExport";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const invoice = {
  id: 42,
  invoiceNumber: "INV-2026-042",
  issueDate: "",
  total: "500.00",
  vatRate: "19.00",
  status: "sent" as const,
  invoiceType: null,
  customerName: "Example Customer",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DatevExport download errors", () => {
  it("shows the server validation message and returns to idle after dismissal", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();

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
          return { ok: true, json: async () => [invoice] } as Response;
        }
        if (method === "POST" && url.includes("/api/iroc/datev/download")) {
          return {
            ok: false,
            status: 422,
            json: async () => ({
              details: ["INV-2026-042 is missing an issue date."],
            }),
          } as Response;
        }

        throw new Error(`Unmocked fetch: ${method} ${url}`);
      },
    );

    render(<DatevExport />);

    await screen.findByText(invoice.invoiceNumber);
    const downloadButton = screen.getByRole("button", {
      name: /Download ZIP \(Preview\)/i,
    });
    await user.click(downloadButton);

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Download failed");
    expect(error).toHaveTextContent("INV-2026-042 is missing an issue date.");

    await user.click(screen.getByRole("button", { name: /Dismiss download error/i }));

    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(downloadButton).toBeEnabled();
  });
});