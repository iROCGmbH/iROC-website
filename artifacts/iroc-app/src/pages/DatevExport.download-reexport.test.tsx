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
  issueDate: "2026-08-01",
  total: "500.00",
  vatRate: "19.00",
  status: "sent" as const,
  invoiceType: null,
  customerName: "Example Customer",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DatevExport ZIP download re-export confirmation", () => {
  it("opens the existing confirmation dialog and retries the ZIP download with force=true", async () => {
    const user = userEvent.setup();
    const downloadBodies: unknown[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();

        if (url.includes("/api/iroc/datev/settings")) {
          return { ok: true, json: async () => ({}) } as Response;
        }
        if (url.includes("/api/iroc/datev/exported-ids")) {
          return { ok: true, json: async () => ({ ids: [invoice.id] }) } as Response;
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
          const body = JSON.parse(init?.body as string);
          downloadBodies.push(body);
          if (downloadBodies.length === 1) {
            return {
              ok: false,
              status: 409,
              json: async () => ({
                error: "already_exported",
                invoiceNumbers: [invoice.invoiceNumber],
              }),
            } as Response;
          }
          return {
            ok: false,
            status: 422,
            json: async () => ({ error: "Test download error after confirmation." }),
          } as Response;
        }

        throw new Error(`Unmocked fetch: ${method} ${url}`);
      },
    );

    render(<DatevExport />);

    await screen.findByText(invoice.invoiceNumber);
    await user.click(screen.getByRole("button", { name: /Download ZIP \(Preview\)/i }));

    await waitFor(() =>
      expect(screen.getByText(/Previously exported invoices/i)).toBeInTheDocument(),
    );
    expect(screen.getAllByText(invoice.invoiceNumber)).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Download anyway/i })).toBeInTheDocument();
    expect(downloadBodies[0]).toMatchObject({
      invoiceIds: [invoice.id],
      force: false,
    });

    await user.click(screen.getByRole("button", { name: /Download anyway/i }));

    await waitFor(() => expect(downloadBodies).toHaveLength(2));
    expect(downloadBodies[1]).toMatchObject({
      invoiceIds: [invoice.id],
      force: true,
    });
    expect(screen.queryByText(/Previously exported invoices/i)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Test download error after confirmation.");
  });
});