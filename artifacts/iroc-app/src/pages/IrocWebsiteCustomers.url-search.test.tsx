/**
 * Regression coverage for duplicate-import navigation.
 *
 * The duplicate-import toast falls back to ?search=<email> when the API does
 * not provide a usable existingId. The customer page must use that query
 * parameter as the initial value of its controlled search input.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import IrocWebsiteCustomers from "./IrocWebsiteCustomers";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

vi.mock("@/hooks/use-site-urls", () => ({
  useSiteUrls: () => ({ irocUrl: "https://example.com" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("wouter", () => ({
  useSearch: () => "?search=anna%40example.com",
}));

const customers = [
  {
    id: 42,
    customerNr: "2026-0001",
    reorderCode: null,
    salutation: null,
    title: null,
    firstName: "Anna",
    lastName: "Example",
    specialty: null,
    institutionName: "Example Clinic",
    institutionType: null,
    address: null,
    postalCode: null,
    city: "Berlin",
    country: "Germany",
    phone: null,
    fax: null,
    email: "anna@example.com",
    website: null,
    referenceNumber: null,
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
    createdAt: "2026-08-21T10:00:00.000Z",
  },
  {
    id: 99,
    customerNr: "2026-0002",
    reorderCode: null,
    salutation: null,
    title: null,
    firstName: "Bernd",
    lastName: "Other",
    specialty: null,
    institutionName: "Other Clinic",
    institutionType: null,
    address: null,
    postalCode: null,
    city: "Munich",
    country: "Germany",
    phone: null,
    fax: null,
    email: "bernd@example.com",
    website: null,
    referenceNumber: null,
    ustIdNr: null,
    instrument: "ministem",
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
    createdAt: "2026-08-20T10:00:00.000Z",
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IrocWebsiteCustomers — URL search prefill", () => {
  it("initializes the customer search from ?search=", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => customers,
    } as unknown as Response);

    render(<IrocWebsiteCustomers />);

    const searchInput = await screen.findByRole("textbox");
    expect(searchInput).toHaveValue("anna@example.com");

    await waitFor(() => {
      expect(screen.getByText("Anna Example")).toBeInTheDocument();
    });
    expect(screen.queryByText("Bernd Other")).not.toBeInTheDocument();
  });
});