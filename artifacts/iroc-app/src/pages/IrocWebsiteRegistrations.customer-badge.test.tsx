/**
 * Registration customer badge regression coverage.
 *
 * The badge is populated by the training-registrations response, not by the
 * customer-create response. Importing therefore needs to invalidate the
 * registrations query so the left-join result is reflected without a reload.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import IrocWebsiteRegistrations from "./IrocWebsiteRegistrations";
import { IROC_REGISTRATIONS_QUERY_KEY } from "@/lib/query-keys";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

const mockLanguage = vi.hoisted(() => ({ current: "en" }));
vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: mockLanguage.current }),
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

  return render(<IrocWebsiteRegistrations />, { wrapper: Wrapper });
}

afterEach(() => {
  mockLanguage.current = "en";
  vi.restoreAllMocks();
  mockToast.mockClear();
});

describe("IrocWebsiteRegistrations — In Customers badge", () => {
  it("appears after import, links to the imported customer, and disappears after refresh when the customer is deleted", async () => {
    const user = userEvent.setup();
    let customerExists = false;

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
          json: async () => [
            customerExists
              ? { ...registration, isCustomer: true, customerId: 42 }
              : { ...registration, isCustomer: false, customerId: null },
          ],
        } as unknown as Response;
      }

      if (url.includes("/api/iroc/website-customers") && method === "POST") {
        customerExists = true;
        return { ok: true, json: async () => ({ id: 42 }) } as unknown as Response;
      }

      return { ok: true, json: async () => ({}) } as unknown as Response;
    });

    const queryClient = makeQueryClient();
    renderPage(queryClient);

    await waitFor(() =>
      expect(screen.getByText("Anna Example")).toBeInTheDocument(),
    );
    expect(screen.queryByText("In Customers")).not.toBeInTheDocument();
    const importedStatValue = () =>
      screen.getByText("Imported", { selector: "p" }).previousElementSibling;
    expect(importedStatValue()).toHaveTextContent("0");

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Select all" }));
    await user.click(screen.getByRole("button", { name: /Import to Customers/ }));

    await waitFor(() => expect(importedStatValue()).toHaveTextContent("1"));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "In Customers" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "In Customers" })).toHaveAttribute(
      "href",
      "/customers/42",
    );

    await user.click(screen.getByRole("button", { name: "Imported" }));
    expect(screen.getByText("Anna Example")).toBeInTheDocument();

    // Simulate deleting that customer elsewhere, then refresh the registration
    // query. The left-join response no longer includes a customer id.
    customerExists = false;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: IROC_REGISTRATIONS_QUERY_KEY });
    });

    await waitFor(() =>
      expect(screen.queryByText("In Customers")).not.toBeInTheDocument(),
    );
  });

  it("shows only imported registrations in the Imported filter and keeps stats based on all registrations", async () => {
    const user = userEvent.setup();
    const importedRegistration = {
      ...registration,
      id: 8,
      firstName: "Imported",
      lastName: "Doctor",
      email: "imported@example.com",
      certifiedDoctorId: null,
      isCustomer: true,
      customerId: 100,
    };
    const unimportedRegistration = {
      ...registration,
      id: 9,
      firstName: "New",
      lastName: "Doctor",
      email: "new@example.com",
      certifiedDoctorId: 42,
      isCustomer: false,
      customerId: null,
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [importedRegistration, unimportedRegistration],
    } as unknown as Response);

    renderPage(makeQueryClient());

    await waitFor(() => {
      expect(screen.getByText("Imported Doctor")).toBeInTheDocument();
      expect(screen.getByText("New Doctor")).toBeInTheDocument();
    });

    const statValue = (label: string) =>
      screen.getByText(label, { selector: "p" }).previousElementSibling;

    expect(statValue("Total")).toHaveTextContent("2");
    expect(statValue("Pending")).toHaveTextContent("1");
    expect(statValue("Certified")).toHaveTextContent("1");

    await user.click(screen.getByRole("button", { name: "Imported" }));

    expect(screen.getByText("Imported Doctor")).toBeInTheDocument();
    expect(screen.getByText("In Customers")).toBeInTheDocument();
    expect(screen.queryByText("New Doctor")).not.toBeInTheDocument();
    expect(statValue("Total")).toHaveTextContent("2");
    expect(statValue("Pending")).toHaveTextContent("1");
    expect(statValue("Certified")).toHaveTextContent("1");

    await user.click(screen.getByRole("button", { name: "All" }));

    expect(screen.getByText("Imported Doctor")).toBeInTheDocument();
    expect(screen.getByText("New Doctor")).toBeInTheDocument();
    expect(screen.getByText("In Customers")).toBeInTheDocument();
  });

  it("refreshes the Imported card and filter after a mixed import, counting only successful creations", async () => {
    const user = userEvent.setup();
    const mixedRegistrations = [
      { ...registration, id: 10, firstName: "Successful", lastName: "Doctor", email: "successful@example.com" },
      { ...registration, id: 11, firstName: "Duplicate", lastName: "Doctor", email: "duplicate@example.com" },
      { ...registration, id: 12, firstName: "Failed", lastName: "Doctor", email: "failed@example.com" },
      { ...registration, id: 13, firstName: "Network", lastName: "Doctor", email: "network@example.com" },
    ];
    let registrationsFetches = 0;
    let importFinished = false;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.toString()
            : input;
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.includes("/api/admin/training-registrations") && method === "GET") {
        registrationsFetches++;
        return {
          ok: true,
          json: async () =>
            mixedRegistrations.map((mixedRegistration) =>
              importFinished && mixedRegistration.email === "successful@example.com"
                ? { ...mixedRegistration, isCustomer: true, customerId: 200 }
                : { ...mixedRegistration, isCustomer: false, customerId: null },
            ),
        } as unknown as Response;
      }

      if (url.includes("/api/iroc/website-customers") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        if (body.email === "duplicate@example.com") {
          return {
            ok: false,
            status: 409,
            json: async () => ({ existingId: 201 }),
          } as unknown as Response;
        }
        if (body.email === "failed@example.com") {
          return { ok: false, status: 500 } as unknown as Response;
        }
        if (body.email === "network@example.com") {
          throw new Error("network unavailable");
        }
        importFinished = true;
        return { ok: true, status: 201, json: async () => ({ id: 200 }) } as unknown as Response;
      }

      return { ok: true, json: async () => ({}) } as unknown as Response;
    });

    renderPage(makeQueryClient());

    await waitFor(() => {
      expect(screen.getByText("Successful Doctor")).toBeInTheDocument();
      expect(screen.getByText("Network Doctor")).toBeInTheDocument();
    });

    const importedStatValue = () =>
      screen.getByText("Imported", { selector: "p" }).previousElementSibling;
    expect(importedStatValue()).toHaveTextContent("0");

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Select all" }));
    await user.click(screen.getByRole("button", { name: /Import to Customers/ }));

    await waitFor(() => expect(registrationsFetches).toBe(2));
    await waitFor(() => expect(importedStatValue()).toHaveTextContent("1"));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Import complete",
        variant: "destructive",
      }),
    );

    const importToast = [...mockToast.mock.calls]
      .reverse()
      .find(([options]) => options?.title === "Import complete")?.[0];
    const toastRender = render(<>{importToast?.description}</>);
    expect(
      screen.getByText("1 imported · 1 skipped (email already exists) · 2 failed: Failed Doctor, Network Doctor"),
    ).toBeInTheDocument();
    toastRender.unmount();

    await user.click(screen.getByRole("button", { name: "Imported" }));
    expect(screen.getByText("Successful Doctor")).toBeInTheDocument();
    expect(screen.queryByText("Duplicate Doctor")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed Doctor")).not.toBeInTheDocument();
    expect(screen.queryByText("Network Doctor")).not.toBeInTheDocument();
  });

  it("keeps the German Imported card, filter, and partial-result summary accurate after a mixed import", async () => {
    mockLanguage.current = "de";
    const user = userEvent.setup();
    const mixedRegistrations = [
      { ...registration, id: 10, firstName: "Successful", lastName: "Doctor", email: "successful@example.com" },
      { ...registration, id: 11, firstName: "Duplicate", lastName: "Doctor", email: "duplicate@example.com" },
      { ...registration, id: 12, firstName: "Failed", lastName: "Doctor", email: "failed@example.com" },
      { ...registration, id: 13, firstName: "Network", lastName: "Doctor", email: "network@example.com" },
    ];
    let registrationsFetches = 0;
    let importFinished = false;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.toString()
            : input;
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.includes("/api/admin/training-registrations") && method === "GET") {
        registrationsFetches++;
        return {
          ok: true,
          json: async () =>
            mixedRegistrations.map((mixedRegistration) =>
              importFinished && mixedRegistration.email === "successful@example.com"
                ? { ...mixedRegistration, isCustomer: true, customerId: 200 }
                : { ...mixedRegistration, isCustomer: false, customerId: null },
            ),
        } as unknown as Response;
      }

      if (url.includes("/api/iroc/website-customers") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        if (body.email === "duplicate@example.com") {
          return {
            ok: false,
            status: 409,
            json: async () => ({ existingId: 201 }),
          } as unknown as Response;
        }
        if (body.email === "failed@example.com") {
          return { ok: false, status: 500 } as unknown as Response;
        }
        if (body.email === "network@example.com") {
          throw new Error("network unavailable");
        }
        importFinished = true;
        return { ok: true, status: 201, json: async () => ({ id: 200 }) } as unknown as Response;
      }

      return { ok: true, json: async () => ({}) } as unknown as Response;
    });

    renderPage(makeQueryClient());

    await waitFor(() => {
      expect(screen.getByText("Successful Doctor")).toBeInTheDocument();
      expect(screen.getByText("Network Doctor")).toBeInTheDocument();
    });

    const importedStatValue = () =>
      screen.getByText("Importiert", { selector: "p" }).previousElementSibling;
    expect(importedStatValue()).toHaveTextContent("0");

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Alle auswählen" }));
    await user.click(screen.getByRole("button", { name: /In Kundenliste/ }));

    await waitFor(() => expect(registrationsFetches).toBe(2));
    await waitFor(() => expect(importedStatValue()).toHaveTextContent("1"));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Import abgeschlossen",
        variant: "destructive",
      }),
    );

    const importToast = [...mockToast.mock.calls]
      .reverse()
      .find(([options]) => options?.title === "Import abgeschlossen")?.[0];
    const toastRender = render(<>{importToast?.description}</>);
    expect(
      screen.getByText("1 importiert · 1 übersprungen (E-Mail bereits vorhanden) · 2 fehlgeschlagen: Failed Doctor, Network Doctor"),
    ).toBeInTheDocument();
    toastRender.unmount();

    await user.click(screen.getByRole("button", { name: "Importiert" }));
    expect(screen.getByText("Successful Doctor")).toBeInTheDocument();
    expect(screen.queryByText("Duplicate Doctor")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed Doctor")).not.toBeInTheDocument();
    expect(screen.queryByText("Network Doctor")).not.toBeInTheDocument();
  });

  it("uses the selected language when a slow mixed import finishes after switching from German to English", async () => {
    mockLanguage.current = "de";
    const user = userEvent.setup();
    const mixedRegistrations = [
      { ...registration, id: 10, firstName: "Successful", lastName: "Doctor", email: "successful@example.com" },
      { ...registration, id: 11, firstName: "Duplicate", lastName: "Doctor", email: "duplicate@example.com" },
      { ...registration, id: 12, firstName: "Failed", lastName: "Doctor", email: "failed@example.com" },
      { ...registration, id: 13, firstName: "Network", lastName: "Doctor", email: "network@example.com" },
    ];
    let registrationsFetches = 0;
    let importFinished = false;
    let releaseSuccessfulImport: (() => void) | undefined;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.toString()
            : input;
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.includes("/api/admin/training-registrations") && method === "GET") {
        registrationsFetches++;
        return {
          ok: true,
          json: async () =>
            mixedRegistrations.map((mixedRegistration) =>
              importFinished && mixedRegistration.email === "successful@example.com"
                ? { ...mixedRegistration, isCustomer: true, customerId: 200 }
                : { ...mixedRegistration, isCustomer: false, customerId: null },
            ),
        } as unknown as Response;
      }

      if (url.includes("/api/iroc/website-customers") && method === "POST") {
        const body = JSON.parse(String(init?.body));
        if (body.email === "successful@example.com") {
          await new Promise<void>((resolve) => {
            releaseSuccessfulImport = resolve;
          });
          importFinished = true;
          return { ok: true, status: 201, json: async () => ({ id: 200 }) } as unknown as Response;
        }
        if (body.email === "duplicate@example.com") {
          return {
            ok: false,
            status: 409,
            json: async () => ({ existingId: 201 }),
          } as unknown as Response;
        }
        if (body.email === "failed@example.com") {
          return { ok: false, status: 500 } as unknown as Response;
        }
        if (body.email === "network@example.com") {
          throw new Error("network unavailable");
        }
      }

      return { ok: true, json: async () => ({}) } as unknown as Response;
    });

    const page = renderPage(makeQueryClient());

    await waitFor(() => {
      expect(screen.getByText("Successful Doctor")).toBeInTheDocument();
      expect(screen.getByText("Network Doctor")).toBeInTheDocument();
    });

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Alle auswählen" }));
    await user.click(screen.getByRole("button", { name: /In Kundenliste/ }));

    await waitFor(() => expect(releaseSuccessfulImport).toBeDefined());

    mockLanguage.current = "en";
    page.rerender(<IrocWebsiteRegistrations />);
    expect(screen.getByRole("button", { name: "Imported" })).toBeInTheDocument();

    releaseSuccessfulImport?.();

    await waitFor(() => expect(registrationsFetches).toBe(2));
    await waitFor(() =>
      expect(screen.getByText("Imported", { selector: "p" }).previousElementSibling).toHaveTextContent("1"),
    );
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Import complete",
        variant: "destructive",
      }),
    );

    const importToast = [...mockToast.mock.calls]
      .reverse()
      .find(([options]) => options?.title === "Import complete")?.[0];
    const toastRender = render(<>{importToast?.description}</>);
    expect(
      screen.getByText("1 imported · 1 skipped (email already exists) · 2 failed: Failed Doctor, Network Doctor"),
    ).toBeInTheDocument();
    expect(screen.queryByText("1 importiert · 1 übersprungen (E-Mail bereits vorhanden) · 2 fehlgeschlagen: Failed Doctor, Network Doctor"))
      .not.toBeInTheDocument();
    toastRender.unmount();

    await user.click(screen.getByRole("button", { name: "Imported" }));
    expect(screen.getByText("Successful Doctor")).toBeInTheDocument();
    expect(screen.queryByText("Duplicate Doctor")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed Doctor")).not.toBeInTheDocument();
    expect(screen.queryByText("Network Doctor")).not.toBeInTheDocument();
  });
});
