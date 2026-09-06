import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IrocWebsiteCustomers from "./IrocWebsiteCustomers";

const { adminGet, adminPost, toast } = vi.hoisted(() => ({
  adminGet: vi.fn(),
  adminPost: vi.fn(),
  toast: vi.fn(),
}));

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
  useToast: () => ({ toast }),
}));

vi.mock("wouter", () => ({
  useSearch: () => "",
}));

vi.mock("@/lib/admin-fetch", () => ({
  adminGet,
  adminPost,
  adminDelete: vi.fn(),
  adminPatch: vi.fn(),
}));

const missingCodeCustomer = {
  id: 42,
  customerNr: "2025-0001",
  reorderCode: null,
  salutation: null,
  title: null,
  firstName: "Anna",
  lastName: "Missing",
  specialty: null,
  institutionName: "Example Clinic",
  institutionType: null,
  address: null,
  postalCode: null,
  city: "Berlin",
  country: "DE",
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
  createdAt: "2025-12-20T10:00:00.000Z",
};

const codedCustomer = {
  ...missingCodeCustomer,
  id: 99,
  firstName: "Ben",
  lastName: "Protected",
  email: "ben@example.com",
  reorderCode: "KEPT2345",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IrocWebsiteCustomers — missing reorder-code backfill", () => {
  it("filters missing codes, confirms the selected customers, and refreshes without exposing a code", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    adminGet
      .mockResolvedValueOnce([missingCodeCustomer, codedCustomer])
      .mockResolvedValueOnce([{ ...missingCodeCustomer, reorderCode: "NEW23456" }, codedCustomer]);
    adminPost.mockResolvedValue({ requested: 1, assigned: 1, skipped: 0, notFound: 0 });

    render(<IrocWebsiteCustomers />);

    await screen.findByText("Anna Missing");
    expect(screen.getByText("Missing code")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Missing code (1)" }));
    expect(screen.queryByText("Ben Protected")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Select all" }));
    await user.click(screen.getByRole("button", { name: "Assign missing codes (1)" }));

    await waitFor(() => {
      expect(adminPost).toHaveBeenCalledWith(
        "/api/iroc/website-customers/reorder-codes",
        "test-token",
        { customerIds: [42] },
      );
    });
    expect(window.confirm).toHaveBeenCalledWith(
      "Assign a unique reorder code to 1 customer(s) without one? Existing codes will not be changed.",
    );
    expect(adminGet).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledWith({ title: "1 reorder code(s) assigned" });
    expect(JSON.stringify(toast.mock.calls)).not.toContain("NEW23456");
  });
});