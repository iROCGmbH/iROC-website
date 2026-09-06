import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import IrocWebsiteRegistrations from "./IrocWebsiteRegistrations";
import { adminGet, adminPost } from "@/lib/admin-fetch";
import { LEADS_QUERY_KEY } from "@/lib/query-keys";

const toast = vi.fn();
const state = vi.hoisted(() => ({ confirmed: false }));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

vi.mock("@/hooks/use-site-urls", () => ({
  useSiteUrls: () => ({ irocUrl: "https://iroc.example.test" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("@/lib/admin-fetch", () => ({
  adminGet: vi.fn(),
  adminPost: vi.fn(),
  adminDelete: vi.fn(),
  adminPatch: vi.fn(),
  adminHeaders: vi.fn(),
  adminUrl: vi.fn((path: string) => path),
}));

vi.mock("@/components/CertificatePDF", () => ({
  CertificatePicker: () => null,
  formatTrainingDateInfo: (value: string) => value,
}));

const registration = {
  id: 73,
  salutation: "Herr",
  medicalDegree: "Dr. med.",
  firstName: "Confirm",
  lastName: "Doctor",
  specialty: "Orthopaedics",
  institutionName: "Test Clinic",
  city: "Munich",
  country: "Germany",
  email: "confirm-doctor@example.test",
  phone: null,
  instrument: "spirecut",
  trainingDateInfo: "2026-11-14 08:30 – Aschheim",
  certifiedDoctorId: null,
  status: "pending",
  confirmedAt: null,
  createdAt: "2026-08-27T10:00:00.000Z",
  isCustomer: false,
  customerId: null,
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <IrocWebsiteRegistrations />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  state.confirmed = false;
  vi.mocked(adminGet).mockImplementation(async (path) => {
    if (path === "/api/admin/training-registrations") {
      return [{ ...registration, status: state.confirmed ? "confirmed" : "pending" }];
    }
    return [];
  });
  vi.mocked(adminPost).mockImplementation(async (path) => {
    if (path !== "/api/admin/training-registrations/73/confirm") {
      throw new Error(`Unexpected request: ${path}`);
    }
    state.confirmed = true;
    return {
      registrationId: 73,
      status: "confirmed",
      confirmedAt: "2026-08-27T10:01:00.000Z",
      leadId: 18,
      leadCreated: true,
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Training Registrations — admin confirmation", () => {
  it("shows the Confirm action only while a registration is unconfirmed and refreshes it after success", async () => {
    const { client } = renderPage();
    client.setQueryData(LEADS_QUERY_KEY, [{ id: 18 }]);

    const confirmButton = await screen.findByRole("button", { name: "Confirm" });
    expect(screen.getByText("Unconfirmed")).toBeInTheDocument();

    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(adminPost).toHaveBeenCalledWith(
        "/api/admin/training-registrations/73/confirm",
        "test-token",
        {},
      );
      expect(screen.getByText("Confirmed")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(client.getQueryState(LEADS_QUERY_KEY)?.isInvalidated).toBe(true);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Registration confirmed",
      description: "The contact was added to Leads as registered.",
    }));
  });
});