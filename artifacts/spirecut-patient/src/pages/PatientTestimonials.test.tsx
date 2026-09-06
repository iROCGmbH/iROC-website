import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import PatientTestimonials from "./PatientTestimonials";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PatientTestimonials", () => {
  it("renders a published, valid YouTube testimonial as a privacy-enhanced embed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [{
        id: 1,
        titleDe: "Schnelle Genesung",
        titleEn: "A fast recovery",
        descriptionDe: "Persönliche Erfahrung",
        descriptionEn: "A personal experience",
        patientLabel: "M. S.",
        procedureDe: "Karpaltunnelsyndrom",
        procedureEn: "Carpal Tunnel Syndrome",
        videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        displayOrder: 0,
        published: true,
      }],
    } as Response);

    render(<PatientTestimonials />);

    await waitFor(() => expect(screen.getByText("Schnelle Genesung")).toBeInTheDocument());
    expect(screen.getByTitle("Schnelle Genesung")).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });

  it("shows the empty state when the API returns only an invalid video URL", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [{
        id: 2,
        titleDe: "Nicht einbetten",
        titleEn: "Do not embed",
        descriptionDe: "",
        descriptionEn: "",
        patientLabel: "",
        procedureDe: "",
        procedureEn: "",
        videoUrl: "https://unsafe.example/video",
        displayOrder: 0,
        published: true,
      }],
    } as Response);

    render(<PatientTestimonials />);

    await waitFor(() => expect(screen.getByText(/derzeit sind noch keine/i)).toBeInTheDocument());
    expect(screen.queryByTitle("Nicht einbetten")).toBeNull();
  });
});