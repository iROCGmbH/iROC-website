import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CustomersList from "./CustomersList";
import { adminGet } from "@/lib/admin-fetch";

let currentLang: "de" | "en" = "en";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: currentLang }),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListIrocInvoices: () => ({ data: [] }),
}));

vi.mock("@/components/CountrySelect", () => ({
  CountrySelect: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="DE">DE</option>
      <option value="AT">AT</option>
    </select>
  ),
}));

vi.mock("@/lib/admin-fetch", () => ({
  adminGet: vi.fn(),
  adminPost: vi.fn(),
  adminDelete: vi.fn(),
  adminPatch: vi.fn(),
}));

const customer = {
  id: 41,
  customerNr: "C-0041",
  salutation: "Dr.",
  title: null,
  firstName: "Erika",
  lastName: "Example",
  institutionName: "Existing Practice",
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

type PendingLookup = {
  url: string;
  signal: AbortSignal | undefined;
  resolve: (value: Response) => void;
};

let pendingLookups: PendingLookup[] = [];

function response(json: unknown): Response {
  return { ok: true, json: async () => json } as Response;
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

function controlForLabel(container: HTMLElement, label: RegExp): HTMLInputElement | HTMLSelectElement {
  const labelNode = within(container).getAllByText(label)[0];
  const control = labelNode.parentElement?.querySelector("input, select");
  if (!control) throw new Error(`No form control found for ${label}`);
  return control as HTMLInputElement | HTMLSelectElement;
}

async function waitForLookup(fragment: string, value: string) {
  const readableUrl = (url: string) => decodeURIComponent(url.replace(/\+/g, " "));
  await waitFor(() => {
    expect(
      pendingLookups.some(({ url }) => url.includes(fragment) && readableUrl(url).includes(value)),
      `Pending lookups: ${pendingLookups.map(({ url }) => readableUrl(url)).join(", ")}`,
    ).toBe(true);
  }, { timeout: 2500 });
  const index = pendingLookups.findIndex(
    ({ url }) => url.includes(fragment) && readableUrl(url).includes(value),
  );
  return pendingLookups.splice(index, 1)[0];
}

async function verifyStaleResponsesAreIgnored(dialog: HTMLElement, labels: {
  institution: RegExp;
  city: RegExp;
  country: RegExp;
  suggestion: string;
}) {
  const institution = controlForLabel(dialog, labels.institution);
  fireEvent.change(institution, { target: { value: "Old Clinic" } });
  const oldInstitution = await waitForLookup("/api/lookup-institution", "Old Clinic");
  fireEvent.change(institution, { target: { value: "New Clinic" } });
  const newInstitution = await waitForLookup("/api/lookup-institution", "New Clinic");
  await waitFor(() => expect(oldInstitution.signal?.aborted).toBe(true));

  newInstitution.resolve(response([{
    displayName: "New Clinic, Austria",
    address: "New Street 2",
    postalCode: "2222",
    city: "New City",
    countryCode: "AT",
  }]));
  expect(await within(dialog).findByText("New Clinic")).toBeInTheDocument();

  oldInstitution.resolve(response([{
    displayName: "Old Clinic, Austria",
    address: "Old Street 1",
    postalCode: "1111",
    city: "Old City",
    countryCode: "AT",
  }]));
  await waitFor(() => expect(within(dialog).queryByText("Old Clinic")).not.toBeInTheDocument());

  const postalCode = controlForLabel(dialog, /^PLZ$/);
  fireEvent.change(postalCode, { target: { value: "1111" } });
  const oldPostal = await waitForLookup("/api/lookup-postal", "1111");
  fireEvent.change(postalCode, { target: { value: "2222" } });
  const newPostal = await waitForLookup("/api/lookup-postal", "2222");
  await waitFor(() => expect(oldPostal.signal?.aborted).toBe(true));

  newPostal.resolve(response({ city: "Current City", countryCode: "DE", postcode: "2222" }));
  expect(await within(dialog).findByText("Current City")).toBeInTheDocument();
  expect(within(dialog).getByText((_, node) =>
    node?.tagName === "SPAN" && Boolean(node.textContent?.includes(labels.suggestion)),
  )).toBeInTheDocument();
  oldPostal.resolve(response({ city: "Stale City", countryCode: "DE", postcode: "1111" }));
  await waitFor(() => expect(within(dialog).queryByText("Stale City")).not.toBeInTheDocument());

  const country = controlForLabel(dialog, labels.country);
  fireEvent.change(country, { target: { value: "AT" } });
  fireEvent.change(institution, { target: { value: "VAT Clinic" } });
  const vatLookup = await waitForLookup("/api/lookup-vat", "VAT Clinic");

  const vat = controlForLabel(dialog, /^USt-IdNr\./);
  fireEvent.change(vat, { target: { value: "AT-MANUAL-123" } });
  await waitFor(() => expect(vatLookup.signal?.aborted).toBe(true));
  vatLookup.resolve(response({ vatId: "AT-STALE-999" }));

  await waitFor(() => expect(vat).toHaveValue("AT-MANUAL-123"));
  expect(within(dialog).queryByText("AT-STALE-999")).not.toBeInTheDocument();
}

beforeEach(() => {
  pendingLookups = [];
  vi.mocked(adminGet).mockImplementation(async (path) => {
    if (path === "/api/iroc/website-customers") return [customer];
    return [];
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/api/certified-doctors")) return response([]);
    if (url.includes("/api/lookup-")) {
      return new Promise<Response>((resolve) => pendingLookups.push({
        url,
        signal: init?.signal ?? (input instanceof Request ? input.signal : undefined),
        resolve,
      }));
    }
    return response([]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CustomersList stale suggestions", () => {
  it("keeps newer institution/postal suggestions and a manual VAT edit in the English new-customer form", async () => {
    currentLang = "en";
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "New Customer" }));
    const dialog = screen.getByRole("dialog");

    await verifyStaleResponsesAreIgnored(dialog, {
      institution: /^Institution Name$/,
      city: /^City$/,
      country: /^Country$/,
      suggestion: "Suggestion:",
    });
  }, 15_000);

  it("keeps newer institution/postal suggestions and a manual VAT edit in the German edit-customer form", async () => {
    currentLang = "de";
    renderList();
    fireEvent.click(await screen.findByTitle("Bearbeiten"));
    const dialog = screen.getByRole("dialog");

    await verifyStaleResponsesAreIgnored(dialog, {
      institution: /^Institution \/ Praxis$/,
      city: /^Stadt$/,
      country: /^Land$/,
      suggestion: "Vorschlag:",
    });
  }, 15_000);
});