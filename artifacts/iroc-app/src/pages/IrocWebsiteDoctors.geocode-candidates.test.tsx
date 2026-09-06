import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IrocWebsiteDoctors from "./IrocWebsiteDoctors";
import { adminPatch, adminPost } from "@/lib/admin-fetch";

const { languageState } = vi.hoisted(() => ({
  languageState: { lang: "en" as "de" | "en" },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => languageState,
}));

vi.mock("@/hooks/use-site-urls", () => ({
  useSiteUrls: () => ({ irocUrl: "https://example.com" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/CertificatePDF", () => ({
  CertificatePicker: () => null,
  CertificateDocument: () => null,
  formatCertDate: (date: string) => date,
  formatTrainingDateInfo: () => null,
  getAssetBase: () => "",
}));

vi.mock("@react-pdf/renderer", () => ({
  pdf: vi.fn(),
}));

vi.mock("@/lib/admin-fetch", () => ({
  adminGet: vi.fn(),
  adminPost: vi.fn(),
  adminDelete: vi.fn(),
  adminPatch: vi.fn(),
}));

vi.mock("@workspace/spirecut-shared", () => ({
  hasUsableDoctorCoordinates: (doctor: { lat?: number | null; lon?: number | null }) =>
    Number.isFinite(doctor.lat) && Number.isFinite(doctor.lon),
}));

const doctor = {
  id: 17,
  title: "Dr.",
  firstName: "Anna",
  lastName: "Beispiel",
  specialty: "Orthopädie",
  institutionName: "Praxis Beispiel",
  city: "München",
  postalCode: "80331",
  country: "Deutschland",
  phone: null,
  email: "anna@example.com",
  websiteUrl: null,
  lat: null,
  lon: null,
  certifications: [{ instrument: "spirecut", certifiedDate: "2026-01-01" }],
};

const candidates = [
  { lat: 48.137154, lon: 11.576124, displayName: "München Altstadt" },
  { lat: 48.1391, lon: 11.5802, displayName: "München Zentrum" },
];

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <IrocWebsiteDoctors />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  languageState.lang = "en";
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => [doctor],
  } as Response);
  vi.mocked(adminPost).mockResolvedValue({
    status: "ambiguous",
    candidates,
  });
  vi.mocked(adminPatch).mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IrocWebsiteDoctors geocode candidates", () => {
  it("shows candidates, carries the selected coordinates into review, and waits for Save", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Dr. Anna Beispiel")).toBeInTheDocument());
    await user.click(screen.getByTestId("button-geocode-doctor-17"));

    await waitFor(() => {
      expect(screen.getByTestId("geocode-candidate-0")).toHaveTextContent("München Altstadt");
      expect(screen.getByText("48.137154, 11.576124")).toBeInTheDocument();
      expect(screen.getByText("48.139100, 11.580200")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("geocode-candidate-1"));
    expect(screen.getByTestId("text-geocode-display-name")).toHaveTextContent("München Zentrum");
    expect(screen.getByTestId("text-geocode-latitude")).toHaveTextContent("48.139100");
    expect(screen.getByTestId("text-geocode-longitude")).toHaveTextContent("11.580200");

    await user.click(screen.getByTestId("button-use-geocode-suggestion"));

    await waitFor(() => expect(screen.getByDisplayValue("48.1391")).toBeInTheDocument());
    expect(screen.getByDisplayValue("11.5802")).toBeInTheDocument();
    expect(adminPatch).not.toHaveBeenCalled();
  });

  it("updates the optional map preview when a different candidate is selected", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Dr. Anna Beispiel")).toBeInTheDocument());
    await user.click(screen.getByTestId("button-geocode-doctor-17"));
    await waitFor(() => expect(screen.getByTestId("geocode-candidate-0")).toBeInTheDocument());

    await user.click(screen.getByTestId("button-toggle-geocode-map"));
    expect(screen.getByTestId("geocode-map-preview").querySelector("iframe"))
      .toHaveAttribute("src", expect.stringContaining("marker=48.137154,11.576124"));

    await user.click(screen.getByTestId("geocode-candidate-1"));
    expect(screen.getByTestId("geocode-map-preview").querySelector("iframe"))
      .toHaveAttribute("src", expect.stringContaining("marker=48.139100,11.580200"));
    expect(screen.getByTestId("geocode-map-preview")).toBeInTheDocument();
    expect(adminPatch).not.toHaveBeenCalled();
  });

  it("shows coordinates and keeps the OpenStreetMap link when the embed fails", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Dr. Anna Beispiel");
    await user.click(screen.getByTestId("button-geocode-doctor-17"));
    await screen.findByTestId("geocode-candidate-0");
    await user.click(screen.getByTestId("button-toggle-geocode-map"));

    const preview = screen.getByTestId("geocode-map-preview");
    fireEvent.error(preview.querySelector("iframe")!);

    expect(await screen.findByRole("alert")).toHaveTextContent("The map preview could not be loaded.");
    expect(screen.getByRole("alert")).toHaveTextContent("48.137154, 11.576124");
    expect(screen.getByRole("link", { name: /Open larger map/ })).toHaveAttribute(
      "href",
      expect.stringContaining("mlat=48.137154"),
    );
    // A provider/blocking failure must not turn the reviewed coordinates into
    // a persisted doctor edit. Continuing only opens the editable form.
    await user.click(screen.getByTestId("button-use-geocode-suggestion"));
    expect(await screen.findByDisplayValue("48.137154")).toBeInTheDocument();
    expect(screen.getByDisplayValue("11.576124")).toBeInTheDocument();
    expect(adminPatch).not.toHaveBeenCalled();
  });

  it("shows the map failure fallback in German", async () => {
    languageState.lang = "de";
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Dr. Anna Beispiel");
    await user.click(screen.getByTestId("button-geocode-doctor-17"));
    await screen.findByTestId("geocode-candidate-0");
    await user.click(screen.getByTestId("button-toggle-geocode-map"));

    const preview = screen.getByTestId("geocode-map-preview");
    fireEvent.error(preview.querySelector("iframe")!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Kartenvorschau konnte nicht geladen werden.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("48.137154, 11.576124");
    expect(screen.getByRole("link", { name: /Größere Karte/ })).toHaveAttribute(
      "href",
      expect.stringContaining("mlat=48.137154"),
    );
    expect(adminPatch).not.toHaveBeenCalled();
  });

  it("leaves the doctor unchanged when the candidate chooser is cancelled", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Dr. Anna Beispiel")).toBeInTheDocument());
    await user.click(screen.getByTestId("button-geocode-doctor-17"));
    await waitFor(() => expect(screen.getByText("München Zentrum")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Possible locations")).not.toBeInTheDocument();
    expect(screen.getByText("Location data missing or invalid")).toBeInTheDocument();
    expect(adminPatch).not.toHaveBeenCalled();
  });

  it("leaves the doctor unchanged when the candidate chooser is closed", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText("Dr. Anna Beispiel")).toBeInTheDocument());
    await user.click(screen.getByTestId("button-geocode-doctor-17"));
    await waitFor(() => expect(screen.getByText("München Zentrum")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByText("Possible locations")).not.toBeInTheDocument();
    expect(screen.getByText("Location data missing or invalid")).toBeInTheDocument();
    expect(adminPatch).not.toHaveBeenCalled();
  });
});