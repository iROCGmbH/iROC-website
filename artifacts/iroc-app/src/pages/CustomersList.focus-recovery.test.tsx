/**
 * CustomersList – automatic recovery after a window visibility change.
 *
 * A failed customer request must be visible to the administrator instead of
 * looking like an empty list. Once the tab becomes visible again, React Query
 * should refetch the stale error and render the recovered rows automatically.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CustomersList from "./CustomersList";
import { adminGet } from "@/lib/admin-fetch";

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

vi.mock("@workspace/api-client-react", () => ({
  useListIrocInvoices: () => ({ data: [] }),
}));

vi.mock("@/lib/admin-fetch", () => ({
  adminGet: vi.fn(),
  adminPost: vi.fn(),
  adminDelete: vi.fn(),
  adminPatch: vi.fn(),
}));

const recoveredCustomer = {
  id: 41,
  customerNr: "C-0041",
  salutation: "Dr.",
  title: null,
  firstName: "Erika",
  lastName: "Recovery",
  institutionName: "Recovery Praxis",
  institutionType: "Praxis",
  specialty: null,
  email: "erika@example.com",
  phone: null,
  fax: null,
  website: null,
  referenceNumber: null,
  address: "Main Street 1",
  postalCode: "10115",
  city: "Berlin",
  country: "DE",
  ustIdNr: null,
  instrument: "spirecut",
  notes: null,
  shippingFirstName: null,
  shippingLastName: null,
  shippingInstitutionName: null,
  shippingAddress: null,
  shippingPostalCode: null,
  shippingCity: null,
  shippingCountry: null,
  shippingPhone: null,
  shippingEmail: null,
  createdAt: "2026-08-22T00:00:00.000Z",
};

function renderList() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CustomersList />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  let websiteRequestCount = 0;
  vi.mocked(adminGet).mockImplementation(async (path) => {
    if (path === "/api/iroc/website-customers") {
      if (websiteRequestCount++ === 0) {
        throw new Error("Network error");
      }
      return [recoveredCustomer];
    }
    if (path === "/api/iroc/customers") return [];
    if (path === "/api/iroc/product-groups") return [];
    return [];
  });

  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CustomersList – visibilitychange recovery", () => {
  it("clears the error and shows customer rows when the window regains focus", async () => {
    renderList();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Failed to load customers/i,
      ),
    );

    await act(async () => {
      window.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Erika Recovery")).toBeInTheDocument();
  });

  it("clears the error and shows customer rows when the network comes back online", async () => {
    renderList();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Failed to load customers/i,
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
    expect(screen.getByText("Erika Recovery")).toBeInTheDocument();
  });
});

describe("CustomersList – retry recovery", () => {
  it("retries without a page reload, prevents duplicate clicks, and shows recovered customers", async () => {
    const user = userEvent.setup();
    let websiteRequestCount = 0;
    let resolveRetry!: (rows: Array<typeof recoveredCustomer>) => void;

    vi.mocked(adminGet).mockImplementation(async (path) => {
      if (path === "/api/iroc/website-customers") {
        websiteRequestCount += 1;
        if (websiteRequestCount === 1) {
          throw new Error("Network error");
        }
        return new Promise<Array<typeof recoveredCustomer>>((resolve) => {
          resolveRetry = resolve;
        });
      }
      if (path === "/api/iroc/customers") return [];
      if (path === "/api/iroc/product-groups") return [];
      return [];
    });

    renderList();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Failed to load customers/i,
      ),
    );

    const getRetryButton = () =>
      screen.getByRole("button", { name: /Retry|Erneut versuchen/i });
    await user.click(getRetryButton());

    await waitFor(() => expect(getRetryButton()).toBeDisabled());
    expect(getRetryButton()).toHaveTextContent(/Retrying|Wird erneut geladen/i);
    expect(websiteRequestCount).toBe(2);

    resolveRetry([recoveredCustomer]);

    await waitFor(() =>
      expect(screen.getByText("Erika Recovery")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});