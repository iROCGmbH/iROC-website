import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Leads from "./Leads";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockNavigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/leads", mockNavigate],
}));

const registeredLead = {
  id: 7,
  salutation: "Dr.",
  medicalTitle: null,
  firstName: "Registered",
  lastName: "Doctor",
  specialty: "Orthopaedics",
  institutionName: "Test Clinic",
  zipCode: "80331",
  city: "Munich",
  country: "Germany",
  email: "registered@example.test",
  phone: null,
  website: null,
  contactWhere: "Training registration",
  firstContactDate: null,
  notes: null,
  status: "registered",
  createdAt: "2026-01-15T10:00:00.000Z",
  trainingOfferSaved: false,
  trainingOfferDownloadAvailable: false,
};

const savedOfferLead = {
  ...registeredLead,
  trainingOfferSaved: true,
};

function renderLeads() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Leads />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  mockNavigate.mockClear();
  mockToast.mockClear();
});

describe("Leads page – registered lead offers", () => {
  it("allows a registered lead without a saved offer to open the offer flow", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/iroc/leads") {
        return { ok: true, json: async () => [registeredLead] } as Response;
      }
      if (url === "/api/iroc/leads/7/invoice-config") {
        return {
          ok: true,
          json: async () => ({
            websiteCustomerId: null,
            allowedGroups: "service-only",
            customerCreated: false,
            isOffer: true,
            trainingDate: null,
            leadName: "Dr. Registered Doctor",
          }),
        } as Response;
      }
      throw new Error(`Unmocked fetch: ${url}`);
    });

    renderLeads();
    await waitFor(() => expect(screen.getByText("Dr. Registered Doctor")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actions" }));
    const createOffer = await screen.findByRole("menuitem", { name: "Create Offer" });
    expect(createOffer).toBeEnabled();

    await user.click(createOffer);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/iroc/leads/7/invoice-config",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining("/invoices/new?allowedGroups=service-only&isOffer=true&leadId=7"),
    );
  });

  it("converts an accepted saved offer into an invoice and customer flow", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/iroc/leads") {
        return { ok: true, json: async () => [savedOfferLead] } as Response;
      }
      if (url === "/api/iroc/leads/7") {
        return { ok: true, json: async () => ({ ...savedOfferLead, status: "qualified" }) } as Response;
      }
      if (url === "/api/iroc/leads/7/invoice-config") {
        return {
          ok: true,
          json: async () => ({
            websiteCustomerId: 42,
            allowedGroups: "service-only",
            customerCreated: true,
            isOffer: false,
            trainingDate: "2026-05-01",
            trainingOfferId: 17,
          }),
        } as Response;
      }
      throw new Error(`Unmocked fetch: ${url}`);
    });

    renderLeads();
    await waitFor(() => expect(screen.getByText("Dr. Registered Doctor")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Convert accepted offer to invoice" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/iroc/leads/7",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ status: "qualified" }),
      }),
    ));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining("/invoices/new?allowedGroups=service-only&isOffer=false&trainingDate=2026-05-01&websiteCustomerId=42&trainingOfferId=17"),
    ));
  });
});