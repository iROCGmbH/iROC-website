/**
 * Regression coverage for the "View customer" links in the bulk-import toast.
 *
 * A valid existingId should navigate by customer ID. If the API sends zero or
 * no readable response body, the link must still render and fall back to the
 * duplicate email rather than throwing during toast construction.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import IrocWebsiteRegistrations from "./IrocWebsiteRegistrations";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en" }),
}));

vi.mock("@/hooks/use-site-urls", () => ({
  useSiteUrls: () => ({ irocUrl: "https://example.com" }),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
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
    title,
  }: {
    children: ReactNode;
    href: string;
    title?: string;
  }) => (
    <a href={href} title={title}>
      {children}
    </a>
  ),
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

function renderPage() {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={makeQueryClient()}>
        {children}
      </QueryClientProvider>
    );
  }

  render(<IrocWebsiteRegistrations />, { wrapper: Wrapper });
}

function latestImportToastDescription(): ReactNode {
  const call = [...mockToast.mock.calls]
    .reverse()
    .find(([options]) => options?.title === "Import complete");
  return call?.[0]?.description;
}

async function importOneDuplicate(response: Response) {
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
    if (url.includes("/api/iroc/website-customers") && method === "POST") {
      return response;
    }
    return { ok: true, json: async () => ({}) } as unknown as Response;
  });

  renderPage();
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByText("Anna Example")).toBeInTheDocument());

  vi.spyOn(window, "confirm").mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: "Select all" }));
  await user.click(screen.getByRole("button", { name: /Import to Customers/ }));

  await waitFor(() => {
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Import complete" }),
    );
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  mockToast.mockClear();
});

describe("IrocWebsiteRegistrations — duplicate import links", () => {
  it("uses existingId for the View customer link and exposes it in the tooltip", async () => {
    await importOneDuplicate({
      status: 409,
      ok: false,
      json: async () => ({ error: "duplicate_email", existingId: 42 }),
    } as unknown as Response);

    render(<>{latestImportToastDescription()}</>);

    const link = screen.getByRole("link", { name: "View customer" });
    expect(link).toHaveAttribute(
      "href",
      "/iroc-website/customers?highlight=42",
    );
    expect(link).toHaveAttribute("title", "Jump to customer record (ID: 42)");
  });

  it.each([
    {
      label: "zero existingId",
      response: {
        status: 409,
        ok: false,
        json: async () => ({ error: "duplicate_email", existingId: 0 }),
      },
    },
    {
      label: "missing response body",
      response: {
        status: 409,
        ok: false,
        json: async () => {
          throw new Error("empty response body");
        },
      },
    },
  ])(
    "still renders a safe fallback link for $label",
    async ({ response }) => {
      await importOneDuplicate(response as unknown as Response);

      render(<>{latestImportToastDescription()}</>);

      const link = screen.getByRole("link", { name: "View customer" });
      expect(link).toHaveAttribute(
        "href",
        "/iroc-website/customers?search=anna%40example.com",
      );
      expect(link).toHaveAttribute("title", "Jump to customer record (ID: 0)");
    },
  );

  it("clearly reports that a delayed retry was already completed", async () => {
    await importOneDuplicate({
      status: 409,
      ok: false,
      json: async () => ({ error: "customer_already_imported", existingId: 42 }),
    } as unknown as Response);

    render(<>{latestImportToastDescription()}</>);

    expect(screen.getByText("1 already imported: Anna Example")).toBeInTheDocument();
  });

  it("clearly reports when the same registration is still being imported", async () => {
    await importOneDuplicate({
      status: 409,
      ok: false,
      json: async () => ({ error: "customer_import_in_progress", registrationId: 7 }),
    } as unknown as Response);

    render(<>{latestImportToastDescription()}</>);

    expect(screen.getByText("1 already in progress: Anna Example")).toBeInTheDocument();
  });
});