/**
 * InvoicesList – automatic recovery after a window visibility change.
 *
 * A failed invoice request must show an error state. React Query's
 * refetchOnWindowFocus behavior should clear it and reveal rows when the tab
 * becomes visible again, without a manual refresh.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InvoicesList from "./InvoicesList";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const recoveredInvoice = {
  id: 51,
  invoiceNumber: "RE-2026-0051",
  customerName: "Recovery Customer",
  issueDate: "2026-08-22",
  dueDate: "2026-09-21",
  status: "draft",
  total: "100.00",
  invoiceType: "domestic",
  sallyGenerated: false,
};

function renderList() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <InvoicesList />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InvoicesList – visibilitychange recovery", () => {
  it("clears the error and shows invoice rows when the window regains focus", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([recoveredInvoice]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    renderList();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Failed to load invoices/i,
      ),
    );

    await act(async () => {
      window.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("RE-2026-0051")).toBeInTheDocument();
  });

  it("clears the error and shows invoice rows when the network comes back online", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([recoveredInvoice]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    renderList();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Failed to load invoices/i,
      ),
    );

    // Simulate a mobile browser reporting that connectivity was lost and then
    // restored. React Query's onlineManager should retry the failed query
    // without a manual QueryClient refetch or page refresh.
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("RE-2026-0051")).toBeInTheDocument();
  });
});

describe("InvoicesList – retry recovery", () => {
  it("retries without a page reload, prevents duplicate clicks, and shows recovered invoices", async () => {
    const user = userEvent.setup();
    let resolveRetry!: (response: Response) => void;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("Network error"))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveRetry = resolve;
          }),
      );

    renderList();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Failed to load invoices/i,
      ),
    );

    const getRetryButton = () =>
      screen.getByRole("button", { name: /Retry|Erneut versuchen/i });
    await user.click(getRetryButton());

    await waitFor(() => expect(getRetryButton()).toBeDisabled());
    expect(getRetryButton()).toHaveTextContent(/Retrying|Wird erneut geladen/i);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    resolveRetry(
      new Response(JSON.stringify([recoveredInvoice]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await waitFor(() =>
      expect(screen.getByText("RE-2026-0051")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});