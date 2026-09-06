import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const INVOICE = {
  id: 311,
  invoiceNumber: "INV-2026-0311",
  issueDate: `${new Date().toISOString().slice(0, 7)}-09`,
  total: "119.00",
  vatRate: "19.00",
  status: "sent",
  invoiceType: "domestic",
  customerName: "Filter Test Clinic",
};

const INITIAL_EXPORT = {
  id: 1,
  exportedAt: "2026-03-04T10:00:00.000Z",
  bookkeeperEmail: "march@example.test",
  invoiceCount: 2,
  invoiceNumbers: ["INV-2026-0101", "INV-2026-0102"],
  status: "sent" as const,
};

const NEXT_EXPORT = {
  id: 2,
  exportedAt: "2026-03-03T10:00:00.000Z",
  bookkeeperEmail: "march@example.test",
  invoiceCount: 1,
  invoiceNumbers: ["INV-2026-0100"],
  status: "sent" as const,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DatevExport — history filters", () => {
  it("sends date and recipient filters, expands invoice numbers, and loads another page", async () => {
    const user = userEvent.setup();
    const historyUrls: string[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = input instanceof URL ? input.toString() : String(input);
        if (url.includes("/api/iroc/datev/settings")) {
          return { ok: true, json: async () => ({}) } as Response;
        }
        if (url.includes("/api/iroc/datev/exported-ids")) {
          return { ok: true, json: async () => ({ ids: [] }) } as Response;
        }
        if (url.includes("/api/iroc/datev/exports")) {
          historyUrls.push(url);
          const query = new URL(url, "http://test").searchParams;
          const offset = query.get("offset");
          return {
            ok: true,
            json: async () => offset === "1"
              ? { exports: [NEXT_EXPORT], hasMore: false }
              : { exports: [INITIAL_EXPORT], hasMore: true },
          } as Response;
        }
        if (url.includes("/api/iroc/datev/invoices")) {
          return { ok: true, json: async () => [INVOICE] } as Response;
        }
        if (url.includes("/api/admin/expenses")) {
          return { ok: true, json: async () => [] } as Response;
        }
        throw new Error(`Unmocked fetch: ${url}`);
      },
    );

    render(<DatevExport />);
    await waitFor(() => expect(screen.getByText(INITIAL_EXPORT.bookkeeperEmail)).toBeInTheDocument());
    expect(historyUrls[0]).toContain("limit=20&offset=0");

    const dateInputs = screen.getAllByDisplayValue("") as HTMLInputElement[];
    const historyDateInputs = dateInputs.filter((input) => input.type === "date").slice(-2);
    fireEvent.change(historyDateInputs[0], { target: { value: "2026-03-01" } });
    fireEvent.change(historyDateInputs[1], { target: { value: "2026-03-31" } });
    await user.type(screen.getByPlaceholderText("Search email"), "march@example.test");
    await user.click(screen.getByRole("button", { name: "Filter" }));

    await waitFor(() => {
      const latest = new URL(historyUrls.at(-1)!, "http://test").searchParams;
      expect(latest.get("from")).toBe("2026-03-01");
      expect(latest.get("to")).toBe("2026-03-31");
      expect(latest.get("email")).toBe("march@example.test");
    });

    await user.click(screen.getByRole("button", { name: "2 view" }));
    expect(screen.getByText("Included invoice numbers")).toBeInTheDocument();
    expect(screen.getByText("INV-2026-0101")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load more" }));
    await user.click(screen.getByRole("button", { name: "1 view" }));
    await waitFor(() => expect(screen.getByText("INV-2026-0100")).toBeInTheDocument());
    expect(new URL(historyUrls.at(-1)!, "http://test").searchParams.get("offset")).toBe("1");
  });
});