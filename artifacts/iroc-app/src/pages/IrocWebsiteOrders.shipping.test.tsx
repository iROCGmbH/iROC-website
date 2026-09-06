import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import IrocWebsiteOrders from "./IrocWebsiteOrders";
import { adminDelete, adminGet, adminPost } from "@/lib/admin-fetch";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/admin-fetch", () => ({
  adminGet: vi.fn(),
  adminPost: vi.fn(),
  adminPut: vi.fn(),
  adminDelete: vi.fn(),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
  useLocation: () => [window.location.pathname + window.location.search, vi.fn()],
}));

const order = {
  id: 47,
  websiteCustomerId: 13,
  customerType: "existing",
  customerNr: "WC-0013",
  companyName: "Example Clinic",
  contactName: "Ada Lovelace",
  contactEmail: "ada@example.com",
  contactPhone: null,
  instrument: "iroc",
  products: null,
  deliveryAddress: null,
  notes: null,
  status: "approved",
  approvedAt: null,
  createdAt: "2026-08-24T10:00:00.000Z",
  contactLanguage: "en",
  sallyReviewStatus: null,
  sallyReviewResult: null,
  invoice: { id: 91, invoiceNumber: "2026-0091", status: "draft" },
};

describe("Incoming Orders — pickup rate display", () => {
  beforeEach(() => {
    vi.mocked(adminGet).mockImplementation(async (path) => {
      if (path === "/api/iroc/orders") return [order];
      if (path.startsWith("/api/iroc/orders/47/shipping-rates")) {
        return {
          pickupWindow: "Mon/Wed/Fri 09:00–13:00 (when supported)",
          rates: [
            {
              id: "dhl-pickup",
              carrier: "DHL",
              serviceCode: "dhl:pickup",
              name: "Parcel pickup",
              price: 12.5,
              currency: "EUR",
              pickupSupported: true,
            },
            {
              id: "dhl-dropoff",
              carrier: "DHL",
              serviceCode: "dhl:dropoff",
              name: "Parcel drop-off",
              price: 8.5,
              currency: "EUR",
              pickupSupported: false,
            },
          ],
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the Mon/Wed/Fri 09:00–13:00 preference only on rates that support pickup", async () => {
    render(<IrocWebsiteOrders />);

    fireEvent.click(await screen.findByRole("button", { name: "Ship" }));
    fireEvent.click(screen.getByRole("button", { name: "Load rates" }));

    await waitFor(() => {
      expect(screen.getByText("Pickup Mon/Wed/Fri 09:00–13:00")).toBeInTheDocument();
    });

    expect(screen.getByText(/Parcel pickup/).closest("label")).toHaveTextContent("Pickup Mon/Wed/Fri 09:00–13:00");
    expect(screen.getByText(/Parcel drop-off/).closest("label")).not.toHaveTextContent("Pickup Mon/Wed/Fri 09:00–13:00");
    expect(vi.mocked(adminGet).mock.calls.some(([path]) => String(path).includes("includeInsurance=true"))).toBe(true);
  });

  it("requests and creates a shipment without insurance when excluded", async () => {
    vi.mocked(adminPost).mockResolvedValue({ trackingNumber: null });
    render(<IrocWebsiteOrders />);

    fireEvent.click(await screen.findByRole("button", { name: "Ship" }));
    fireEvent.click(screen.getByLabelText("Exclude insurance"));
    fireEvent.click(screen.getByRole("button", { name: "Load rates" }));

    await waitFor(() => {
      expect(vi.mocked(adminGet).mock.calls.some(([path]) => String(path).includes("includeInsurance=false"))).toBe(true);
    });
    fireEvent.click(screen.getByRole("button", { name: "Create confirmed shipment" }));

    await waitFor(() => {
      expect(adminPost).toHaveBeenCalledWith(
        "/api/iroc/orders/47/shipment",
        "test-token",
        expect.objectContaining({ includeInsurance: false, quotedInsuranceCost: 0 }),
      );
    });
  });

  it("deletes an existing order after confirmation and removes it from the list", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(adminDelete).mockResolvedValue();
    render(<IrocWebsiteOrders />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(adminDelete).toHaveBeenCalledWith("/api/iroc/orders/47", "test-token");
      expect(screen.queryByText("Example Clinic")).not.toBeInTheDocument();
    });
  });
});