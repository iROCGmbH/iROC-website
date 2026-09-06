import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PatientGate } from "./PatientGate";
import { invalidateSpirecutSettingsCache } from "@/hooks/useSpirecutSettings";

const fetchPatientSettings = vi.hoisted(() => vi.fn());
const SAVED_GATE_URL = "https://spirecut.com/medical-professionals";
const DEFAULT_GATE_URL = "https://www.i-roc.de";

vi.stubGlobal("fetch", fetchPatientSettings);

afterEach(() => {
  sessionStorage.clear();
  invalidateSpirecutSettingsCache();
  fetchPatientSettings.mockReset();
});

describe("PatientGate", () => {
  it("uses the saved gate link after the patient settings are fetched again", async () => {
    fetchPatientSettings.mockResolvedValue({
      ok: true,
      json: async () => ({ sp_gate_link_url: SAVED_GATE_URL }),
    });

    const firstLoad = render(<PatientGate />);
    await screen.findByRole("dialog");
    await waitFor(() => {
      expect(screen.getByRole("link").getAttribute("href")).toBe(SAVED_GATE_URL);
    });

    firstLoad.unmount();
    sessionStorage.clear();
    fetchPatientSettings.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sp_gate_link_url: "" }),
    });
    invalidateSpirecutSettingsCache();

    render(<PatientGate />);
    await screen.findByRole("dialog");
    await waitFor(() => {
      expect(screen.getByRole("link").getAttribute("href")).toBe(DEFAULT_GATE_URL);
    });
  });

  it("keeps the previously trusted gate link when a settings refresh fails", async () => {
    fetchPatientSettings.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sp_gate_link_url: SAVED_GATE_URL }),
    });
    const firstLoad = render(<PatientGate />);
    await waitFor(() => {
      expect(screen.getByRole("link")).toHaveAttribute("href", SAVED_GATE_URL);
    });

    firstLoad.unmount();
    sessionStorage.clear();
    invalidateSpirecutSettingsCache();
    let rejectRefresh: (reason?: unknown) => void = () => {};
    fetchPatientSettings.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectRefresh = reject;
    }));

    render(<PatientGate />);
    // A refresh must not temporarily replace a trusted saved link with an
    // empty/malformed value or even a different fallback destination.
    expect(screen.getByRole("link")).toHaveAttribute("href", SAVED_GATE_URL);
    rejectRefresh(new Error("settings temporarily unavailable"));
    await waitFor(() => {
      expect(screen.getByRole("link")).toHaveAttribute("href", SAVED_GATE_URL);
    });
  });

  it("shows the bilingual patient warning when a session has not been confirmed", async () => {
    fetchPatientSettings.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    render(<PatientGate />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Diese Website richtet sich an Patienten und Interessierte.")).toBeInTheDocument();
    expect(screen.getByText("This website is intended for patients and interested individuals.")).toBeInTheDocument();
  });

  it("keeps the safe bilingual fallback CTA available when settings cannot be loaded", async () => {
    fetchPatientSettings.mockRejectedValue(new Error("Settings service unavailable"));

    render(<PatientGate />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Diese Website richtet sich an Patienten und Interessierte.")).toBeInTheDocument();
    expect(screen.getByText("This website is intended for patients and interested individuals.")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", DEFAULT_GATE_URL);
    expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();
  });

  it("dismisses the warning only after the visitor confirms", async () => {
    fetchPatientSettings.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    render(<PatientGate />);

    fireEvent.click(await screen.findByRole("button", { name: /weiter/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("spirecut_patient_gate_passed")).toBe("1");
  });
});
