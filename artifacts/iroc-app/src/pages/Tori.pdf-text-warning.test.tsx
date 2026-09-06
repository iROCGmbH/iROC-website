import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Tori from "./Tori";

const testState = vi.hoisted(() => ({
  lang: "en" as "en" | "de",
  toast: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => testState,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: testState.toast }),
}));

const SERVER_ERROR = "Tori could not read enough selectable text from this PDF.";
const SERVER_WARNING = {
  code: "PDF_TEXT_NOT_EXTRACTABLE",
  reason: "image_only_or_scanned_pdf",
  extracted_character_count: 0,
  guidance: "Upload a searchable text PDF or paste the document text manually.",
};

function installPdf422Response() {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);

    if (url.includes("/api/iroc/tori/extract-pdf")) {
      return {
        ok: false,
        status: 422,
        json: async () => ({ error: SERVER_ERROR, warning: SERVER_WARNING }),
      } as Response;
    }

    if (url.includes("/api/iroc/tori/pending-actions")) {
      return { ok: true, json: async () => [] } as Response;
    }

    return { ok: true, json: async () => ({}) } as Response;
  });

  return fetchMock;
}

afterEach(() => {
  cleanup();
  testState.lang = "en";
  testState.toast.mockClear();
  vi.restoreAllMocks();
});

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

describe("Tori image-only PDF guidance", () => {
  it.each([
    {
      language: "en" as const,
      kind: "invoice",
      inputIndex: 1,
      heading: "Invoice Analysis",
      contextPlaceholder: /Paste raw invoice text extracted from PDF/i,
      errorTitle: "PDF error",
    },
    {
      language: "de" as const,
      kind: "invoice",
      inputIndex: 1,
      heading: "Rechnungsanalyse",
      contextPlaceholder: /Rohen Rechnungstext hier einfügen/i,
      errorTitle: "PDF-Fehler",
    },
    {
      language: "en" as const,
      kind: "contract",
      inputIndex: 2,
      heading: "Distribution Contract Rules (optional)",
      contextPlaceholder: /Paste contract rules or upload a PDF/i,
      errorTitle: "PDF error",
    },
    {
      language: "de" as const,
      kind: "contract",
      inputIndex: 2,
      heading: "Vertragsregeln (optional)",
      contextPlaceholder: /Vertragsregeln einfügen oder PDF hochladen/i,
      errorTitle: "PDF-Fehler",
    },
  ])(
    "shows the server guidance and keeps the $kind context empty in $language mode",
    async ({ language, kind, inputIndex, heading, contextPlaceholder, errorTitle }) => {
      testState.lang = language;
      const fetchMock = installPdf422Response();
      const { container } = render(<Tori />);

      await waitFor(() => {
        expect(screen.getByText(heading)).toBeInTheDocument();
      });

      if (kind === "contract") {
        fireEvent.click(screen.getByRole("button", { name: heading }));
      }

      const fileInput = container.querySelectorAll('input[type="file"]')[inputIndex];
      expect(fileInput).toBeDefined();
      const file = new File(["image-only PDF"], `${kind}-scan.pdf`, {
        type: "application/pdf",
      });

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(testState.toast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: errorTitle,
            description: SERVER_ERROR,
            variant: "destructive",
          }),
        );
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/iroc/tori/extract-pdf",
        expect.objectContaining({ method: "POST" }),
      );
      expect(screen.queryByText(file.name)).not.toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByPlaceholderText(contextPlaceholder)).toHaveValue("");
      });
    },
  );
});