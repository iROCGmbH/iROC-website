import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CustomersList from "./CustomersList";

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

type LegacyCustomerFixture = {
  id: number;
  salutation: string | null;
  title: string | null;
  name: string;
  company: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  vatId: string | null;
  isEu: boolean;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: string;
};

const legacyCustomer: LegacyCustomerFixture = {
  id: 7,
  salutation: null,
  title: null,
  name: "Max Mustermann",
  company: "Muster Klinik",
  address: "Main Street 1",
  city: "Munich",
  postalCode: "80331",
  country: "Germany",
  vatId: null,
  isEu: false,
  email: "max@example.com",
  phone: "+49 89 123",
  notes: null,
  createdAt: "2026-08-22T00:00:00.000Z",
};

function response(json: unknown): Response {
  return { ok: true, json: async () => json } as Response;
}

function installFetchSpy(rows = [legacyCustomer]) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? "GET";
    let body: unknown;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    requests.push({ method, url, body });

    if (url.includes("/api/iroc/website-customers")) return response([]);
    if (url.includes("/api/iroc/customers") && method === "GET") return response(rows);
    if (url.includes("/api/iroc/product-groups")) return response([]);
    if (url.includes("/api/certified-doctors")) return response([]);
    if (url.includes("/api/lookup-")) return response([]);
    if (url.includes("/api/iroc/customers") && method === "POST") {
      return response({ ...legacyCustomer, ...(body as object), id: 8 });
    }
    if (url.includes("/api/iroc/customers/") && method === "PATCH") {
      return response({ ...legacyCustomer, ...(body as object) });
    }
    return response({});
  });
  return { fetchSpy, requests };
}

function legacyDialog() {
  return screen.getByRole("dialog");
}

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CustomersList legacy customer form", () => {
  it("creates a legacy customer with salutation and degree", async () => {
    const { requests } = installFetchSpy([]);
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole("button", { name: "Legacy customer" }));
    const dialog = legacyDialog();
    await user.selectOptions(within(dialog).getByLabelText("Salutation"), "Herr");
    await user.type(within(dialog).getByLabelText("Degree"), "Dr. med");
    await user.type(within(dialog).getByLabelText(/Name/), "Anna Example");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(requests.find(r => r.method === "POST" && r.url.endsWith("/api/iroc/customers"))?.body).toMatchObject({
        salutation: "Herr",
        title: "Dr. med",
        name: "Anna Example",
      });
    });
  });

  it("removes a duplicated academic title from the saved full name", async () => {
    const { requests } = installFetchSpy([]);
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByRole("button", { name: "Legacy customer" }));
    const dialog = legacyDialog();
    await user.type(within(dialog).getByLabelText("Degree"), "Dr. med");
    await user.type(within(dialog).getByLabelText(/Name/), "Dr. med Anna Example");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(requests.find(r => r.method === "POST" && r.url.endsWith("/api/iroc/customers"))?.body).toMatchObject({
        title: "Dr. med",
        name: "Anna Example",
      });
    });
  });

  it("shows an existing duplicated title only once", async () => {
    installFetchSpy([{
      ...legacyCustomer,
      title: "Prof. Dr.",
      name: "Prof Dr. Anna Example",
    }]);
    renderList();

    await waitFor(() => {
      expect(screen.getByText("Prof. Dr. Anna Example")).toBeInTheDocument();
    });
    expect(screen.queryByText("Prof. Dr. Prof Dr. Anna Example")).not.toBeInTheDocument();
  });

  it("edits and clears salutation and degree on an existing legacy customer", async () => {
    const { requests } = installFetchSpy([{
      ...legacyCustomer,
      salutation: "Frau",
      title: "Prof.",
    }]);
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByTitle("Edit"));
    const dialog = legacyDialog();
    await user.selectOptions(within(dialog).getByLabelText("Salutation"), "");
    await user.clear(within(dialog).getByLabelText("Degree"));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(requests.find(r => r.method === "PATCH" && r.url.endsWith("/api/iroc/customers/7"))?.body).toMatchObject({
        salutation: null,
        title: null,
      });
    });
  });
});