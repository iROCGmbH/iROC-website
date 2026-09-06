/**
 * Regression coverage for the dashboard pending-training metric.
 *
 * Certifying a registration changes certifiedDoctorId, which is the field the
 * dashboard uses to count pending registrations. The registration page must
 * invalidate the dashboard query immediately so admins do not have to wait
 * for the dashboard's polling interval or reload the page.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import IrocWebsiteRegistrations from "./IrocWebsiteRegistrations";
import { IROC_DASHBOARD_QUERY_KEY } from "@/lib/query-keys";

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

vi.mock("@/components/CertificatePDF", () => ({
  CertificatePicker: () => null,
  formatTrainingDateInfo: () => null,
}));

vi.mock("@/components/CountrySelect", () => ({
  CountrySelect: () => null,
}));

vi.mock("wouter", () => ({
  Link: ({
    children,
    href,
  }: {
    children: ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const registration = {
  id: 7,
  salutation: null,
  medicalDegree: null,
  firstName: "Anna",
  lastName: "Example",
  specialty: "Orthopaedics",
  institutionName: "Example Clinic",
  city: "Berlin",
  country: "Germany",
  email: "anna@example.com",
  phone: null,
  instrument: "spirecut",
  trainingDateInfo: null,
  certifiedDoctorId: null,
  status: "confirmed",
  confirmedAt: "2026-08-21T10:00:00.000Z",
  createdAt: "2026-08-21T10:00:00.000Z",
  isCustomer: false,
  customerId: null,
};

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
}

function renderPage(queryClient: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }

  render(<IrocWebsiteRegistrations />, { wrapper: Wrapper });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IrocWebsiteRegistrations — dashboard refresh", () => {
  it("invalidates the dashboard query immediately after certification", async () => {
    const user = userEvent.setup();

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.toString()
            : input;
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.includes("/api/admin/training-registrations") && method === "GET") {
        return {
          ok: true,
          json: async () => [registration],
        } as unknown as Response;
      }

      if (url.includes("/api/admin/training-registrations/7/certify") && method === "POST") {
        return {
          ok: true,
          json: async () => ({ id: 42 }),
        } as unknown as Response;
      }

      return { ok: true, json: async () => ({}) } as unknown as Response;
    });

    const queryClient = makeQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    renderPage(queryClient);

    await waitFor(() => expect(screen.getByText("Anna Example")).toBeInTheDocument());
    const registrationRow = screen.getByText("Anna Example").closest("div.border-b");
    expect(registrationRow).not.toBeNull();
    const rowButtons = registrationRow!.querySelectorAll("button");
    await user.click(rowButtons[rowButtons.length - 1] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Certify" }));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: IROC_DASHBOARD_QUERY_KEY,
      });
    });
  });
});