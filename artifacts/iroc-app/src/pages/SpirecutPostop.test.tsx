/**
 * Tests for SpirecutPostop — bulk-delete failure-count behaviour and
 * edit-rating dialog.
 *
 * Covered scenarios
 * ─────────────────
 * Bulk-delete:
 * 1. handleDeleteSelected — all deletes fail (network error):
 *    • error toast shows the full selection count
 *    • every entry remains in the table
 *
 * 2. handleDeleteSelected — partial failure (some ok, some network error):
 *    • error toast shows only the failed count
 *    • only the failed entries remain; successful ones are removed
 *    • error toast offers a retry for only the failed entries
 *
 * 3. handleDeleteSelected — partial failure (some ok, some non-2xx response):
 *    • non-ok HTTP responses are also counted as failures
 *    • failed entries remain; successful ones are removed
 *
 * 4. handleDeleteAll — partial failure:
 *    • error toast shows the failed count
 *    • failed entries remain; successful ones are removed
 *    • error toast offers a retry for only the failed entries
 *
 * 5. handleDeleteAll — all succeed:
 *    • success toast (no error)
 *    • table is empty
 *
 * 6. A bulk retry cannot send duplicate requests while the first retry is
 *    pending, and it shows localized progress feedback.
 *
 * Edit-rating dialog:
 * 7. Clicking the "Invalid" badge opens the dialog
 * 8. Dialog is pre-filled with the closest valid value for the stored raw value
 * 9. Saving sends PATCH with { rating: N } and closes the dialog
 * 10. After a successful save the row re-renders as stars with no amber background
 * 11. A failed PATCH shows an error toast and keeps the dialog open
 * 12. A failed keyboard save keeps Escape and Cancel recovery available
 * 13. A successful keyboard save closes the dialog and restores focus to the
 *     originating Invalid control
 *
 * Detail-view delete:
 * 14. A failed delete offers a localized retry action that reuses the same row
 *
 * Refresh recovery:
 * 15. A successful manual reload clears the stale-data warning after a failed
 *     post-save refresh and displays the corrected rating
 * 16. A second failed manual reload keeps the stale-data warning and reload
 *     action available
 * 17. An older aggregate-statistics response cannot replace the warning count
 *     from a newer reload
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactElement } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SpirecutPostop from "./SpirecutPostop";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

// The page reads the (admin-configurable) postop form config via react-query;
// stub the hook with the shared default config so no QueryClient is required.
vi.mock("@/hooks/use-postop-form-config", async () => {
  const { getDefaultPostopFormConfig } = await import("@workspace/spirecut-shared");
  return {
    POSTOP_FORM_CONFIG_QUERY_KEY: ["postop-form-config"],
    usePostopFormConfig: () => ({
      config: mockPostopFormConfig.current ?? getDefaultPostopFormConfig(),
      isLoading: false,
    }),
  };
});

const mockPostopFormConfig = vi.hoisted(() => ({
  current: null as {
    procedures: Array<{ key: string; labelDe: string; labelEn: string }>;
  } | null,
}));

const mockLanguage = vi.hoisted(() => ({ current: "de" as "de" | "en" }));
vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: mockLanguage.current }),
}));

vi.mock("@/hooks/use-site-urls", () => ({
  useSiteUrls: () => ({ spirecutUrl: "https://spirecut.example.com" }),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRow(id: string, procedure = "ct") {
  return {
    id,
    procedure,
    operationMonth: "2025-01",
    rating: 5,
    submittedAt: new Date().toISOString(),
  };
}

function makeArchivedRow(id: string) {
  return {
    ...makeRow(id, "removed-procedure"),
    procedureLabelDe: "Archivierter Eingriff",
    procedureLabelEn: "Archived procedure",
  };
}

const ROW_A = makeRow("row-a", "ct");
const ROW_B = makeRow("row-b", "tf");
const ROW_C = makeRow("row-c", "ct");

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Install a fetch spy that:
 * - GET    /api/admin/patient-postop-diagnostics → `{ submissions: rows, unreadableCount }`
 * - DELETE /api/admin/patient-postop/:id  → consults `deleteOutcomes`; if the
 *   id is in `networkFailIds` it throws (simulates offline); if the id is in
 *   `nonOkIds` it returns { ok: false }; otherwise returns { ok: true }.
 * - PATCH  /api/admin/patient-postop/:id  → `patchHandler` (optional); default
 *   is a successful 200 response echoing back { id, rating }.
 */
function installFetchSpy(
  rows: object[],
  networkFailIds: Set<string> = new Set(),
  nonOkIds: Set<string> = new Set(),
  patchHandler?: (id: string, body: unknown) => Response | Promise<Response>,
  statsSkippedInvalid?: number,
  unreadableCount = 0,
  deleteHandler?: (id: string) => Response | Promise<Response>,
) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
          ? input.toString()
          : (input as string);

      const method = (
        init?.method ??
        (input instanceof Request ? input.method : "GET")
      ).toUpperCase();

      if (method === "GET" && url.includes("/api/admin/patient-postop-diagnostics")) {
        return { ok: true, json: async () => ({ submissions: rows, unreadableCount }) } as Response;
      }

      if (method === "GET" && url.includes("/api/admin/patient-postop")) {
        return { ok: true, json: async () => rows } as Response;
      }

      if (method === "GET" && url.includes("/api/patient-postop-stats")) {
        const count = statsSkippedInvalid ?? rows.filter((row) => {
          const rating = (row as { rating?: unknown }).rating;
          return typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5;
        }).length;
        return { ok: true, json: async () => ({ skippedInvalid: count }) } as Response;
      }

      if (method === "DELETE" && url.includes("/api/admin/patient-postop/")) {
        const id = url.split("/api/admin/patient-postop/")[1];
        if (networkFailIds.has(id)) throw new Error("Network error (simulated)");
        if (nonOkIds.has(id)) return { ok: false } as Response;
        if (deleteHandler) return deleteHandler(id);
        return { ok: true } as Response;
      }

      if (method === "PATCH" && url.includes("/api/admin/patient-postop/")) {
        const id = url.split("/api/admin/patient-postop/")[1];
        let body: unknown;
        try { body = JSON.parse(init?.body as string ?? "{}"); } catch { body = {}; }
        if (patchHandler) return patchHandler(id, body);
        // Default: success
        const patch = body as { rating?: number };
        return {
          ok: true,
          json: async () => ({ message: "Rating corrected", id, rating: patch.rating }),
        } as Response;
      }

      throw new Error(`Unmocked fetch: ${method} ${url}`);
    });
}

/** Wait until the data table rows are visible (loading spinner gone). */
async function waitForRows() {
  await waitFor(() =>
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1)
  );
}

/** Select all visible rows through the page's accessible select-all control. */
async function selectAllRows() {
  await userEvent.click(
    screen.getByRole("button", { name: /^(Alle auswählen|Select all)$/i })
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  mockToast.mockClear();
  mockLanguage.current = "de";
  mockPostopFormConfig.current = null;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SpirecutPostop – bulk-delete failure count", () => {
  // ── 1. handleDeleteSelected — all fail (network) ───────────────────────────

  it("shows the full selection count in the error toast when all deletes fail with a network error", async () => {
    installFetchSpy(
      [ROW_A, ROW_B],
      new Set(["row-a", "row-b"]) // both throw
    );

    render(<SpirecutPostop />);
    await waitForRows();

    // Select all through the toolbar control
    await selectAllRows();

    // Confirm both rows are selected through the bulk-delete action count.
    expect(screen.getByRole("button", { name: /2 löschen/i })).toBeInTheDocument();

    // Click the "Delete N" button in the toolbar
    const deleteSelectedBtn = screen.getByRole("button", { name: /2 löschen/i });
    await userEvent.click(deleteSelectedBtn);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          title: expect.stringMatching(/^2/),
        })
      )
    );

    // Both rows must still be in the table
    await waitFor(() =>
      expect(screen.getAllByRole("row").length).toBeGreaterThan(2) // header + 2 data rows
    );
  });

  // ── 2. handleDeleteSelected — partial failure (network error) ──────────────

  it("shows only the failed count in the error toast and keeps failed rows when some deletes throw", async () => {
    installFetchSpy(
      [ROW_A, ROW_B, ROW_C],
      new Set(["row-b"]) // row-b throws; row-a and row-c succeed
    );

    render(<SpirecutPostop />);
    await waitForRows();

    // Select all three rows
    await selectAllRows();

    const deleteSelectedBtn = screen.getByRole("button", { name: /3 löschen/i });
    await userEvent.click(deleteSelectedBtn);

    // Error toast must report exactly 1 failure
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          title: expect.stringMatching(/^1/),
        })
      )
    );

    // Only row-b (the failed one) should remain — table has header + 1 data row
    await waitFor(() =>
      expect(screen.getAllByRole("row")).toHaveLength(2)
    );
  });

  it("retries only failed selected entries and removes them after the retry succeeds", async () => {
    const networkFailIds = new Set(["row-b"]);
    const fetchSpy = installFetchSpy([ROW_A, ROW_B, ROW_C], networkFailIds);

    render(<SpirecutPostop />);
    await waitForRows();
    await selectAllRows();
    await userEvent.click(screen.getByRole("button", { name: /3 löschen/i }));

    const failedToast = await waitFor(() => {
      const call = mockToast.mock.calls.find(([arg]) => arg?.variant === "destructive");
      expect(call).toBeDefined();
      return call![0];
    });
    const retryAction = failedToast.action as ReactElement<{ onClick?: () => void; children?: string }>;
    expect(retryAction.props.children).toBe("Erneut versuchen");

    networkFailIds.delete("row-b");
    await act(async () => {
      await retryAction.props.onClick?.();
    });

    await waitFor(() => expect(screen.queryAllByRole("row")).toHaveLength(0));
    const deleteCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(deleteCalls).toHaveLength(4);
    expect(deleteCalls.slice(-1).map(([input]) => input)).toEqual([
      "/api/admin/patient-postop/row-b",
    ]);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Ausgewählte Einträge gelöscht" }),
    );
  });

  // ── 3. handleDeleteSelected — partial failure (non-ok HTTP response) ────────

  it("counts non-ok HTTP responses as failures and keeps those rows", async () => {
    installFetchSpy(
      [ROW_A, ROW_B, ROW_C],
      new Set(),           // no network failures
      new Set(["row-c"])   // row-c returns { ok: false }
    );

    render(<SpirecutPostop />);
    await waitForRows();

    await selectAllRows();

    const deleteSelectedBtn = screen.getByRole("button", { name: /3 löschen/i });
    await userEvent.click(deleteSelectedBtn);

    // Error toast must report exactly 1 failure
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          title: expect.stringMatching(/^1/),
        })
      )
    );

    // row-a and row-b gone; row-c stays — header + 1 data row
    await waitFor(() =>
      expect(screen.getAllByRole("row")).toHaveLength(2)
    );
  });

  // ── 4. handleDeleteAll — partial failure ────────────────────────────────────

  it("shows the failed count in the error toast and keeps failed rows when handleDeleteAll has partial failures", async () => {
    installFetchSpy(
      [ROW_A, ROW_B, ROW_C],
      new Set(["row-a", "row-c"]) // 2 fail, 1 succeeds
    );

    render(<SpirecutPostop />);
    await waitForRows();

    // First click shows the confirmation prompt
    const deleteAllBtn = screen.getByRole("button", { name: /Alle löschen/i });
    await userEvent.click(deleteAllBtn);

    // Confirm
    const confirmBtn = screen.getByRole("button", { name: /Ja, alle löschen/i });
    await userEvent.click(confirmBtn);

    // Error toast must report exactly 2 failures
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          title: expect.stringMatching(/^2/),
        })
      )
    );

    // row-b succeeded and was removed; row-a and row-c remain — header + 2 rows
    await waitFor(() =>
      expect(screen.getAllByRole("row")).toHaveLength(3)
    );
  });

  it("retries only failed delete-all entries and removes them after the retry succeeds", async () => {
    const networkFailIds = new Set(["row-a", "row-c"]);
    const fetchSpy = installFetchSpy([ROW_A, ROW_B, ROW_C], networkFailIds);

    render(<SpirecutPostop />);
    await waitForRows();
    await userEvent.click(screen.getByRole("button", { name: /Alle löschen/i }));
    await userEvent.click(screen.getByRole("button", { name: /Ja, alle löschen/i }));

    const failedToast = await waitFor(() => {
      const call = mockToast.mock.calls.find(([arg]) => arg?.variant === "destructive");
      expect(call).toBeDefined();
      return call![0];
    });
    const retryAction = failedToast.action as ReactElement<{ onClick?: () => void; children?: string }>;
    expect(retryAction.props.children).toBe("Erneut versuchen");

    networkFailIds.clear();
    await act(async () => {
      await retryAction.props.onClick?.();
    });

    await waitFor(() => expect(screen.queryAllByRole("row")).toHaveLength(0));
    const deleteCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(deleteCalls).toHaveLength(5);
    expect(deleteCalls.slice(-2).map(([input]) => input)).toEqual([
      "/api/admin/patient-postop/row-a",
      "/api/admin/patient-postop/row-c",
    ]);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Alle Einträge gelöscht" }),
    );
  });

  it("does not duplicate a bulk retry while its request is pending and reports progress", async () => {
    const networkFailIds = new Set(["row-a"]);
    let resolveRetry: ((response: Response) => void) | undefined;
    const fetchSpy = installFetchSpy(
      [ROW_A],
      networkFailIds,
      new Set(),
      undefined,
      undefined,
      0,
      () => new Promise<Response>((resolve) => {
        resolveRetry = resolve;
      }),
    );

    render(<SpirecutPostop />);
    await waitForRows();
    await selectAllRows();
    await userEvent.click(screen.getByRole("button", { name: /1 löschen/i }));

    const failedToast = await waitFor(() => {
      const call = mockToast.mock.calls.find(([arg]) => arg?.variant === "destructive");
      expect(call).toBeDefined();
      return call![0];
    });
    const retryAction = failedToast.action as ReactElement<{ onClick?: () => void; children?: string }>;
    networkFailIds.delete("row-a");

    await act(async () => {
      retryAction.props.onClick?.();
    });
    await waitFor(() => {
      const deleteCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method === "DELETE");
      expect(deleteCalls).toHaveLength(2);
    });

    // A second click on the stale retry action must not issue another DELETE.
    await act(async () => {
      retryAction.props.onClick?.();
    });
    const deleteCallsWhilePending = fetchSpy.mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(deleteCallsWhilePending).toHaveLength(2);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Erneuter Löschversuch läuft…" }),
    );
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Erneuter Löschversuch läuft bereits" }),
    );

    resolveRetry?.({ ok: true } as Response);
    await waitFor(() => expect(screen.queryAllByRole("row")).toHaveLength(0));
  });

  // ── 5. handleDeleteAll — all succeed ────────────────────────────────────────

  it("shows a success toast and empties the table when all deletes succeed", async () => {
    installFetchSpy([ROW_A, ROW_B]); // no failures

    render(<SpirecutPostop />);
    await waitForRows();

    const deleteAllBtn = screen.getByRole("button", { name: /Alle löschen/i });
    await userEvent.click(deleteAllBtn);

    const confirmBtn = screen.getByRole("button", { name: /Ja, alle löschen/i });
    await userEvent.click(confirmBtn);

    // Success toast — no destructive variant
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringMatching(/gelöscht/i),
        })
      )
    );
    const toastCall = mockToast.mock.calls.find(([arg]) =>
      /gelöscht/i.test(arg?.title ?? "")
    );
    expect(toastCall?.[0]).not.toHaveProperty("variant", "destructive");

    // Table should show empty state (no data rows)
    await waitFor(() =>
      expect(screen.queryAllByRole("row")).toHaveLength(0)
    );
  });
});

describe("SpirecutPostop – narrow-screen toolbar", () => {
  it("keeps the toolbar and delete-all confirmation usable at 320px", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 320,
    });
    try {
      installFetchSpy([ROW_A]);

      render(<SpirecutPostop />);
      await waitForRows();

      const selectAllButton = screen.getByRole("button", {
        name: "Alle auswählen",
      });
      const actionGroup = selectAllButton.parentElement;
      const toolbar = actionGroup?.parentElement;

      expect(toolbar).toHaveClass("flex-wrap", "min-w-0");
      expect(actionGroup).toHaveClass("flex-wrap", "w-full", "min-w-0");

      await userEvent.click(
        screen.getByRole("button", { name: "Alle löschen" }),
      );

      const confirmationText = screen.getByText("Wirklich alle löschen?");
      const confirmationGroup = confirmationText.parentElement;
      expect(confirmationText).toBeVisible();
      expect(confirmationGroup).toHaveClass(
        "flex-wrap",
        "w-full",
        "min-w-0",
        "max-w-full",
      );

      // Exercise both controls while the confirmation row is active. This
      // catches regressions where a narrow layout leaves either button
      // underneath another wrapped item or outside the tappable viewport.
      await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
      expect(screen.queryByText("Wirklich alle löschen?")).not.toBeInTheDocument();

      await userEvent.click(
        screen.getByRole("button", { name: "Alle löschen" }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Ja, alle löschen" }),
      );

      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Alle Einträge gelöscht" }),
        ),
      );
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });
});

describe("SpirecutPostop – narrow-screen procedure filters", () => {
  it("keeps long configured German and English choices readable and usable at 320px", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 320,
    });
    mockPostopFormConfig.current = {
      procedures: [
        {
          key: "custom-de",
          labelDe: "Karpaltunnel-Operation mit zusätzlicher Sehnenfreilegung",
          labelEn: "Carpal tunnel release with additional tendon exposure",
        },
        {
          key: "custom-tf",
          labelDe: "Schnappfinger-Operation mit komplexer Ringbandspaltung",
          labelEn: "Trigger finger release with complex pulley reconstruction",
        },
      ],
    };

    try {
      installFetchSpy([
        makeRow("custom-row-de", "custom-de"),
        makeRow("custom-row-tf", "custom-tf"),
      ]);

      const { rerender } = render(<SpirecutPostop />);
      await waitForRows();

      const filterGroup = screen.getByRole("button", { name: "Alle" }).parentElement;
      expect(filterGroup).toHaveClass("flex-wrap", "min-w-0", "max-w-full");

      const germanChoice = screen.getByRole("button", {
        name: "Karpaltunnel-Operation mit zusätzlicher Sehnenfreilegung",
      });
      expect(germanChoice).toHaveClass(
        "min-w-0",
        "max-w-full",
        "whitespace-normal",
        "break-words",
      );
      expect(germanChoice).toBeVisible();
      await userEvent.click(germanChoice);
      expect(screen.getAllByRole("row")).toHaveLength(2);

      mockLanguage.current = "en";
      rerender(<SpirecutPostop />);

      const englishChoice = screen.getByRole("button", {
        name: "Trigger finger release with complex pulley reconstruction",
      });
      expect(englishChoice).toBeVisible();
      await userEvent.click(englishChoice);
      expect(screen.getAllByRole("row")).toHaveLength(2);
    } finally {
      mockPostopFormConfig.current = null;
      mockLanguage.current = "de";
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });
});

describe("SpirecutPostop – archived procedure labels", () => {
  it("keeps removed procedure names readable after refresh and language switching", async () => {
    const archivedRow = makeArchivedRow("row-archived");
    mockPostopFormConfig.current = {
      procedures: [{ key: "tf", labelDe: "Schnappfinger", labelEn: "Trigger Finger" }],
    };
    installFetchSpy([archivedRow]);

    const firstRender = render(<SpirecutPostop />);
    await waitForRows();
    expect(screen.getAllByText("Archivierter Eingriff")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Archivierter Eingriff" }));
    expect(screen.getAllByRole("row")).toHaveLength(2);
    firstRender.unmount();

    mockLanguage.current = "en";
    render(<SpirecutPostop />);
    await waitForRows();
    expect(screen.getAllByText("Archived procedure")).toHaveLength(2);
    expect(screen.queryByText("removed-procedure")).not.toBeInTheDocument();
  });
});

describe("SpirecutPostop – procedure filter configuration refresh", () => {
  it("refreshes configured filter labels when the saved procedure configuration changes", async () => {
    mockPostopFormConfig.current = {
      procedures: [
        { key: "custom", labelDe: "Alter Eingriff", labelEn: "Old procedure" },
      ],
    };
    installFetchSpy([makeRow("custom-row", "custom")]);

    const { rerender } = render(<SpirecutPostop />);
    await waitForRows();
    expect(screen.getByRole("button", { name: "Alter Eingriff" })).toBeInTheDocument();

    mockPostopFormConfig.current = {
      procedures: [
        { key: "custom", labelDe: "Neuer Eingriff", labelEn: "New procedure" },
      ],
    };
    rerender(<SpirecutPostop />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Neuer Eingriff" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Alter Eingriff" })).not.toBeInTheDocument();

    mockLanguage.current = "en";
    rerender(<SpirecutPostop />);
    expect(screen.getByRole("button", { name: "New procedure" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Neuer Eingriff" })).not.toBeInTheDocument();
  });

  it.each([
    {
      language: "de" as const,
      selectedLabel: "Entfernter Eingriff",
      remainingLabel: "Verbleibender Eingriff",
      allLabel: "Alle",
    },
    {
      language: "en" as const,
      selectedLabel: "Removed procedure",
      remainingLabel: "Remaining procedure",
      allLabel: "All",
    },
  ])("keeps a removed procedure available as a historical filter in $language", async ({
    language,
    selectedLabel,
    remainingLabel,
    allLabel,
  }) => {
    mockLanguage.current = language;
    mockPostopFormConfig.current = {
      procedures: [
        { key: "removed", labelDe: "Entfernter Eingriff", labelEn: "Removed procedure" },
        { key: "remaining", labelDe: "Verbleibender Eingriff", labelEn: "Remaining procedure" },
      ],
    };
    installFetchSpy([
      {
        ...makeRow("removed-row", "removed"),
        procedureLabelDe: "Entfernter Eingriff",
        procedureLabelEn: "Removed procedure",
      },
      makeRow("remaining-row", "remaining"),
    ]);

    const { rerender } = render(<SpirecutPostop />);
    await waitForRows();
    await userEvent.click(screen.getByRole("button", { name: selectedLabel }));
    expect(screen.getAllByRole("row")).toHaveLength(2);

    mockPostopFormConfig.current = {
      procedures: [
        { key: "remaining", labelDe: "Verbleibender Eingriff", labelEn: "Remaining procedure" },
      ],
    };
    rerender(<SpirecutPostop />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: selectedLabel })).toHaveClass("bg-primary", "text-white");
      expect(screen.getAllByRole("row")).toHaveLength(2);
    });
    expect(screen.getByRole("button", { name: allLabel })).not.toHaveClass("bg-primary");
    expect(screen.getByRole("button", { name: remainingLabel })).toBeInTheDocument();
  });
});

describe("SpirecutPostop – narrow-screen stats grid", () => {
  it("keeps all four stat cards in two columns and truncates long labels at 320px", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 320,
    });

    try {
      installFetchSpy([ROW_A]);

      render(<SpirecutPostop />);
      await waitForRows();

      const totalLabel = screen.getByText("Gesamt");
      const statsGrid = totalLabel.parentElement?.parentElement;
      expect(statsGrid).toHaveClass("grid", "min-w-0", "grid-cols-2");
      expect(statsGrid).not.toHaveClass("grid-cols-1");

      const statCards = Array.from(statsGrid?.children ?? []);
      expect(statCards).toHaveLength(4);
      for (const card of statCards) {
        expect(card).toHaveClass("min-w-0");
        expect(card).toBeVisible();
      }

      expect(statCards[3]?.querySelector("p.truncate")).toHaveTextContent(
        "Schnappfinger (Triggerfinger)",
      );
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });

  it("keeps a long custom procedure label inside its card at 320px", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 320,
    });
    const customLabel =
      "Karpaltunnel-Operation mit zusätzlicher Sehnenfreilegung und umfassender Nachbehandlung";
    mockPostopFormConfig.current = {
      procedures: [
        {
          key: "custom-procedure",
          labelDe: customLabel,
          labelEn: "Custom procedure",
        },
        {
          key: "second-procedure",
          labelDe: "Zweite Behandlung",
          labelEn: "Second procedure",
        },
      ],
    };

    try {
      installFetchSpy([makeRow("custom-procedure-row", "custom-procedure")]);

      render(<SpirecutPostop />);
      await waitForRows();

      const statsGrid = screen.getByText("Gesamt").parentElement?.parentElement;
      expect(statsGrid).toHaveClass("grid", "min-w-0", "grid-cols-2");
      expect(statsGrid).not.toHaveClass("grid-cols-1");

      const customLabelElement = within(statsGrid as HTMLElement).getByText(customLabel);
      const customCard = customLabelElement.parentElement;
      expect(customCard).toHaveClass("min-w-0");
      expect(customLabelElement).toHaveClass("truncate");
      expect(customCard).toBe(statsGrid?.children[2]);
      expect(customLabelElement).toBeVisible();
    } finally {
      mockPostopFormConfig.current = null;
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });
});

// ── Single-row delete failure ─────────────────────────────────────────────────

describe("SpirecutPostop – single-row delete failure", () => {
  it("shows a destructive error toast and leaves the row in the table when the per-row delete button throws a network error", async () => {
    // Arrange: only ROW_A is in the table; deleting it throws (server offline).
    installFetchSpy(
      [ROW_A],
      new Set(["row-a"]) // throws for row-a
    );

    // The trash button triggers window.confirm — auto-accept it.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<SpirecutPostop />);
    await waitForRows();

    // Act: click the per-row trash button (title="Löschen" in German).
    const dataRow = screen.getAllByRole("row")[1]; // index 0 is the header
    const trashBtn = within(dataRow).getByRole("button", { name: /löschen/i });
    await userEvent.click(trashBtn);

    // Assert: destructive toast was shown.
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" })
      )
    );

    // Assert: row is still in the table (header + 1 data row = 2 rows).
    expect(screen.getAllByRole("row")).toHaveLength(2);

    confirmSpy.mockRestore();
  });

  it("shows a destructive error toast and leaves the row in the table when the per-row delete returns a non-2xx response", async () => {
    // Arrange: ROW_A is in the table; deleting it returns a 500-like non-ok response.
    installFetchSpy(
      [ROW_A],
      new Set(),           // no network failures
      new Set(["row-a"])   // row-a returns { ok: false }
    );

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<SpirecutPostop />);
    await waitForRows();

    // Act: click the per-row trash button (title="Löschen" in German).
    const dataRow = screen.getAllByRole("row")[1];
    const trashBtn = within(dataRow).getByRole("button", { name: /löschen/i });
    await userEvent.click(trashBtn);

    // Assert: destructive toast was shown.
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" })
      )
    );

    // Assert: row is still in the table (header + 1 data row = 2 rows).
    expect(screen.getAllByRole("row")).toHaveLength(2);

    confirmSpy.mockRestore();
  });

  it("shows a destructive error toast and leaves the row in the table when the view panel delete returns a non-2xx response", async () => {
    // Arrange: ROW_A is in the table; deleting it from the detail panel returns
    // a 500-like non-ok response.
    installFetchSpy(
      [ROW_A],
      new Set(),           // no network failures
      new Set(["row-a"])   // row-a returns { ok: false }
    );

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<SpirecutPostop />);
    await waitForRows();

    // Open the row's detail panel through the Eye button.
    const dataRow = screen.getAllByRole("row")[1];
    await userEvent.click(within(dataRow).getByTitle(/alle daten anzeigen/i));

    // The panel has its own Delete button in addition to the table's trash button.
    const panelDeleteButton = screen
      .getAllByRole("button", { name: /löschen/i })
      .at(-1);
    expect(panelDeleteButton).toBeDefined();
    await userEvent.click(panelDeleteButton!);

    // Assert: the non-2xx response produces the same destructive toast.
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" })
      )
    );

    // The failed delete must retain the row, while the panel closes consistently
    // with the current view-panel delete flow.
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Schließen" })).not.toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("shows a destructive error toast and leaves the row in the table when the view panel delete throws a network error", async () => {
    // Arrange: ROW_A is in the table; deleting it from the detail panel throws
    // because the server is unreachable.
    installFetchSpy(
      [ROW_A],
      new Set(["row-a"]) // row-a throws a simulated network error
    );

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<SpirecutPostop />);
    await waitForRows();

    // Open the row's detail panel through the Eye button.
    const dataRow = screen.getAllByRole("row")[1];
    await userEvent.click(within(dataRow).getByTitle(/alle daten anzeigen/i));

    // The panel has its own Delete button in addition to the table's trash button.
    const panelDeleteButton = screen
      .getAllByRole("button", { name: /löschen/i })
      .at(-1);
    expect(panelDeleteButton).toBeDefined();
    await userEvent.click(panelDeleteButton!);

    // Assert: the rejected request produces the same destructive toast.
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" })
      )
    );

    // The failed delete must retain the row, while the panel closes consistently
    // with the current view-panel delete flow.
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Schließen" })).not.toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("offers a retry action after a failed view panel delete and removes the row after the retry succeeds", async () => {
    // Arrange: fail the first request, then let the same row succeed on retry.
    const networkFailIds = new Set(["row-a"]);
    const fetchSpy = installFetchSpy([ROW_A], networkFailIds);

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<SpirecutPostop />);
    await waitForRows();

    const dataRow = screen.getAllByRole("row")[1];
    await userEvent.click(within(dataRow).getByTitle(/alle daten anzeigen/i));

    const panelDeleteButton = screen
      .getAllByRole("button", { name: /löschen/i })
      .at(-1);
    expect(panelDeleteButton).toBeDefined();
    await userEvent.click(panelDeleteButton!);

    const failedToast = await waitFor(() => {
      const call = mockToast.mock.calls.find(([arg]) => arg?.variant === "destructive");
      expect(call).toBeDefined();
      return call![0];
    });
    const retryAction = failedToast.action as ReactElement<{ onClick?: () => void; children?: string }>;
    expect(retryAction).toBeDefined();
    expect(retryAction.props.children).toBe("Erneut versuchen");

    // Simulate the network recovering before the one-click retry.
    networkFailIds.delete("row-a");
    await act(async () => {
      await retryAction.props.onClick?.();
    });

    await waitFor(() => expect(screen.queryAllByRole("row")).toHaveLength(0));
    const deleteCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls.map(([input]) => input)).toEqual([
      "/api/admin/patient-postop/row-a",
      "/api/admin/patient-postop/row-a",
    ]);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Gelöscht" }),
    );

    confirmSpy.mockRestore();
  });

  it("does not duplicate a per-row retry while pending and allows a later retry", async () => {
    let deleteCalls = 0;
    let finishPendingRetry!: (response: Response) => void;
    const pendingRetry = new Promise<Response>((resolve) => {
      finishPendingRetry = resolve;
    });
    installFetchSpy(
      [ROW_A],
      new Set(),
      new Set(),
      undefined,
      0,
      0,
      async () => {
        deleteCalls++;
        if (deleteCalls === 1) return { ok: false } as Response;
        if (deleteCalls === 2) return pendingRetry;
        return { ok: true } as Response;
      },
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<SpirecutPostop />);
    await waitForRows();
    await userEvent.click(within(screen.getAllByRole("row")[1]).getByTitle("Löschen"));

    const firstFailure = await waitFor(() => {
      const call = mockToast.mock.calls.find(([arg]) => arg?.variant === "destructive");
      expect(call).toBeDefined();
      return call![0];
    });
    const retryAction = firstFailure.action as ReactElement<{ onClick?: () => void }>;
    act(() => {
      retryAction.props.onClick?.();
      retryAction.props.onClick?.();
    });

    expect(deleteCalls).toBe(2);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Löschvorgang läuft bereits" }),
    );

    await act(async () => {
      finishPendingRetry({ ok: false } as Response);
    });
    const laterFailure = await waitFor(() => {
      const failures = mockToast.mock.calls.filter(([arg]) => arg?.variant === "destructive");
      expect(failures.length).toBeGreaterThan(1);
      return failures.at(-1)![0];
    });
    const laterRetry = laterFailure.action as ReactElement<{ onClick?: () => void }>;
    await act(async () => {
      await laterRetry.props.onClick?.();
    });

    expect(deleteCalls).toBe(3);
    await waitFor(() => expect(screen.queryAllByRole("row")).toHaveLength(0));
    confirmSpy.mockRestore();
  });
});

// ── View-detail dialog ────────────────────────────────────────────────────────

describe("SpirecutPostop – view-detail dialog", () => {
  it("keeps independently scrollable detail content and every German action reachable in a narrow dialog", async () => {
    const user = userEvent.setup();
    installFetchSpy([{
      ...ROW_A,
      experience: "Sehr ausführlicher Erfahrungsbericht. ".repeat(80),
    }]);

    render(<SpirecutPostop />);
    await waitForRows();
    await user.click(within(screen.getAllByRole("row")[1]).getByRole("button", {
      name: /alle daten anzeigen/i,
    }));

    const dialog = await screen.findByRole("dialog", { name: "Eintragsdetails" });
    expect(dialog).toHaveClass("max-h-[calc(100dvh-2rem)]", "flex", "flex-col");
    const scrollableDetail = dialog.querySelector(".overflow-y-auto");
    expect(scrollableDetail).toHaveClass("min-h-0", "flex-1");

    const closeButtons = within(dialog).getAllByRole("button", { name: "Schließen" });
    const focusOrder = [
      closeButtons[0],
      closeButtons[1],
      within(dialog).getByRole("button", { name: "Bewertung korrigieren" }),
      within(dialog).getByRole("button", { name: "Löschen" }),
    ];
    expect(document.activeElement).toBe(focusOrder[0]);
    for (const expected of focusOrder.slice(1)) {
      await user.tab();
      expect(document.activeElement).toBe(expected);
    }
  });

  it("exposes dialog semantics and all actions as keyboard-accessible buttons", async () => {
    const user = userEvent.setup();
    installFetchSpy([ROW_A]);

    render(<SpirecutPostop />);
    await waitForRows();

    const dataRow = screen.getAllByRole("row")[1];
    const trigger = within(dataRow).getByRole("button", {
      name: /alle daten anzeigen/i,
    });
    trigger.focus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute(
      "aria-labelledby",
      "view-detail-dialog-title",
    );
    expect(
      within(dialog).getByRole("heading", { name: "Eintragsdetails" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getAllByRole("button", { name: "Schließen" }),
    ).toHaveLength(2);
    expect(
      within(dialog).getByRole("button", { name: "Löschen" }),
    ).toBeInTheDocument();

    // The footer Close action remains a native button and can close via Enter.
    const footerClose = within(dialog).getAllByRole("button", {
      name: "Schließen",
    })[1];
    footerClose.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("keeps the detail dialog keyboard-accessible with English labels", async () => {
    mockLanguage.current = "en";
    const user = userEvent.setup();
    installFetchSpy([ROW_A]);

    render(<SpirecutPostop />);
    await waitForRows();

    const dataRow = screen.getAllByRole("row")[1];
    const trigger = within(dataRow).getByRole("button", {
      name: "View all data",
    });
    trigger.focus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog", {
      name: "Entry details",
    });
    expect(dialog).toHaveAttribute("aria-labelledby", "view-detail-dialog-title");
    expect(
      within(dialog).getByRole("heading", { name: "Entry details" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getAllByRole("button", { name: "Close" }),
    ).toHaveLength(2);
    expect(
      within(dialog).getByRole("button", { name: "Correct rating" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Delete" }),
    ).toBeInTheDocument();

    const closeButtons = within(dialog).getAllByRole("button", {
      name: "Close",
    });
    const focusOrder = [
      closeButtons[0],
      closeButtons[1],
      within(dialog).getByRole("button", { name: "Correct rating" }),
      within(dialog).getByRole("button", { name: "Delete" }),
    ];

    expect(document.activeElement).toBe(focusOrder[0]);
    for (const expected of focusOrder.slice(1)) {
      await user.tab();
      expect(document.activeElement).toBe(expected);
    }

    await user.tab();
    expect(document.activeElement).toBe(focusOrder[0]);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(focusOrder.at(-1));

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps Tab focus inside the dialog and wraps in both directions", async () => {
    const user = userEvent.setup();
    const invalidRow = makeInvalidRow("row-view-focus-trap", 99);
    installFetchSpy([invalidRow]);

    render(<SpirecutPostop />);
    await waitForRows();

    const dataRow = screen.getAllByRole("row")[1];
    const trigger = within(dataRow).getByRole("button", {
      name: /alle daten anzeigen/i,
    });
    trigger.focus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog");
    const closeButtons = within(dialog).getAllByRole("button", {
      name: "Schließen",
    });
    const focusOrder = [
      closeButtons[0],
      closeButtons[1],
      within(dialog).getByRole("button", { name: /bewertung korrigieren/i }),
      within(dialog).getByRole("button", { name: "Löschen" }),
    ];

    expect(document.activeElement).toBe(focusOrder[0]);
    for (const expected of focusOrder.slice(1)) {
      await user.tab();
      expect(document.activeElement).toBe(expected);
    }

    // The last Tab wraps to the first focusable control.
    await user.tab();
    expect(document.activeElement).toBe(focusOrder[0]);

    // Shift+Tab from the first control wraps to the last one as well.
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(focusOrder.at(-1));
  });

  it("closes with Escape and returns focus to the row's Eye trigger", async () => {
    const user = userEvent.setup();
    installFetchSpy([ROW_A]);

    render(<SpirecutPostop />);
    await waitForRows();

    const dataRow = screen.getAllByRole("row")[1];
    const trigger = within(dataRow).getByRole("button", {
      name: /alle daten anzeigen/i,
    });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(trigger);
  });
});

// ── Edit-rating dialog ────────────────────────────────────────────────────────

/** A row whose stored rating is invalid (99 → out of range). */
function makeInvalidRow(id: string, rawRating: unknown) {
  return {
    id,
    procedure: "ct",
    operationMonth: "2025-03",
    rating: rawRating as number,
    submittedAt: new Date().toISOString(),
  };
}

describe("SpirecutPostop – edit-rating dialog", () => {
  // ── 6. Clicking the "Invalid" badge opens the dialog ─────────────────────

  it("opens the edit dialog when the Invalid badge is clicked", async () => {
    const invalidRow = makeInvalidRow("row-invalid", 99);
    installFetchSpy([invalidRow]);

    render(<SpirecutPostop />);
    await waitForRows();

    // The "Invalid" badge should be visible (rating 99 fails isValidRating)
    const badge = screen.getByRole("button", { name: /ungültig/i });
    await userEvent.click(badge);

    // The modal header should appear
    await waitFor(() =>
      expect(screen.getByText(/Bewertung korrigieren/i)).toBeInTheDocument()
    );
  });

  it("opens the edit dialog when a valid rating's pencil button is clicked", async () => {
    const validRow = { ...makeInvalidRow("row-valid", 1), rating: 1 };
    installFetchSpy([validRow]);

    render(<SpirecutPostop />);
    await waitForRows();

    const editButton = screen.getByRole("button", { name: "Bewertung korrigieren" });
    expect(editButton).toHaveAttribute("data-postop-edit", "row-valid");
    await userEvent.click(editButton);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Bewertung korrigieren/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "1 Stern" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps English star controls accessible after switching languages and saves the selected rating", async () => {
    const invalidRow = makeInvalidRow("row-english", 99);
    const fetchSpy = installFetchSpy([invalidRow]);
    const { rerender } = render(<SpirecutPostop />);
    await waitForRows();

    mockLanguage.current = "en";
    rerender(<SpirecutPostop />);

    await userEvent.click(
      screen.getByRole("button", { name: "Correct invalid rating" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Correct Rating")).toBeInTheDocument();

    for (const rating of [1, 2, 3, 4, 5]) {
      expect(
        within(dialog).getByRole("button", {
          name: `${rating} ${rating === 1 ? "star" : "stars"}`,
        }),
      ).toBeInTheDocument();
    }

    await userEvent.click(
      within(dialog).getByRole("button", { name: "4 stars" }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(([, init]) =>
        (init as RequestInit)?.method?.toUpperCase() === "PATCH"
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body).toEqual({ rating: 4 });
    });
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])("opens the English edit dialog with the keyboard %s key", async (_keyName, key) => {
    mockLanguage.current = "en";
    const invalidRow = makeInvalidRow(`row-english-keyboard-${_keyName}`, 99);
    const user = userEvent.setup();
    installFetchSpy([invalidRow]);

    render(<SpirecutPostop />);
    await waitForRows();

    const trigger = screen.getByRole("button", { name: "Correct invalid rating" });
    trigger.focus();
    await user.keyboard(key);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Correct Rating")).toBeInTheDocument();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Close" }),
    );
  });

  it("selects an English rating and saves from the keyboard, then restores trigger focus", async () => {
    mockLanguage.current = "en";
    const invalidRow = makeInvalidRow("row-english-keyboard-save", 99);
    const user = userEvent.setup();
    const fetchSpy = installFetchSpy([invalidRow]);

    render(<SpirecutPostop />);
    await waitForRows();

    const trigger = screen.getByRole("button", { name: "Correct invalid rating" });
    trigger.focus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog");
    const star4 = within(dialog).getByRole("button", { name: "4 stars" });
    const saveButton = within(dialog).getByRole("button", { name: "Save" });

    // The dialog opens at Close. Tab to the fourth star, select it with Space,
    // then tab through the remaining controls to Save.
    for (let i = 0; i < 4; i++) {
      await user.tab();
    }
    expect(document.activeElement).toBe(star4);
    await user.keyboard(" ");
    expect(star4).toHaveAttribute("aria-pressed", "true");

    await user.tab();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(saveButton);
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(trigger);

    const patchCall = fetchSpy.mock.calls.find(([, init]) =>
      (init as RequestInit)?.method?.toUpperCase() === "PATCH"
    );
    expect(patchCall).toBeDefined();
    expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({
      rating: 4,
    });
  });

  it("updates an open German dialog when the language changes to English and saves the selected rating", async () => {
    const invalidRow = makeInvalidRow("row-language-change", 99);
    const fetchSpy = installFetchSpy([invalidRow]);
    const { rerender } = render(<SpirecutPostop />);
    await waitForRows();

    await userEvent.click(
      screen.getByRole("button", { name: "Ungültige Bewertung korrigieren" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Bewertung korrigieren")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Abbrechen" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Speichern" })).toBeInTheDocument();

    mockLanguage.current = "en";
    rerender(<SpirecutPostop />);

    expect(within(dialog).getByText("Correct Rating")).toBeInTheDocument();
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(
        within(dialog).getByRole("button", {
          name: `${rating} ${rating === 1 ? "star" : "stars"}`,
        }),
      ).toBeInTheDocument();
    }
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeInTheDocument();

    await userEvent.click(
      within(dialog).getByRole("button", { name: "4 stars" }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(([, init]) =>
        (init as RequestInit)?.method?.toUpperCase() === "PATCH"
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body).toEqual({ rating: 4 });
    });
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])("opens the edit dialog with the keyboard %s key", async (_keyName, key) => {
    const invalidRow = makeInvalidRow(`row-keyboard-${_keyName}`, 99);
    const user = userEvent.setup();
    installFetchSpy([invalidRow]);

    render(<SpirecutPostop />);
    await waitForRows();

    const trigger = screen.getByRole("button", { name: /ungültig/i });
    trigger.focus();
    await user.keyboard(key);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/Bewertung korrigieren/i)).toBeInTheDocument();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Schließen" }),
    );
  });

  it("keeps Tab focus inside the dialog and wraps in both directions", async () => {
    const invalidRow = makeInvalidRow("row-focus-trap", 99);
    const user = userEvent.setup();
    installFetchSpy([invalidRow]);

    render(<SpirecutPostop />);
    await waitForRows();

    const trigger = screen.getByRole("button", { name: /ungültig/i });
    trigger.focus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog");
    const closeButton = within(dialog).getByRole("button", { name: "Schließen" });
    const starButtons = [1, 2, 3, 4, 5].map((rating) =>
      within(dialog).getByRole("button", {
        name: new RegExp(`^${rating} ${rating === 1 ? "Stern" : "Sterne"}$`),
      }),
    );
    const cancelButton = within(dialog).getByRole("button", { name: "Abbrechen" });
    const saveButton = within(dialog).getByRole("button", { name: "Speichern" });
    const focusOrder = [closeButton, ...starButtons, cancelButton, saveButton];

    expect(document.activeElement).toBe(closeButton);
    for (const expected of focusOrder.slice(1)) {
      await user.tab();
      expect(document.activeElement).toBe(expected);
    }

    // The last Tab wraps to the first focusable control.
    await user.tab();
    expect(document.activeElement).toBe(closeButton);

    // Shift+Tab from the first control wraps to the last one as well.
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(saveButton);
  });

  it("closes with Escape and returns focus to the Invalid trigger", async () => {
    const invalidRow = makeInvalidRow("row-escape", 99);
    const user = userEvent.setup();
    installFetchSpy([invalidRow]);

    render(<SpirecutPostop />);
    await waitForRows();

    const trigger = screen.getByRole("button", { name: /ungültig/i });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when the backdrop is clicked outside the dialog", async () => {
    const invalidRow = makeInvalidRow("row-backdrop", 99);
    const user = userEvent.setup();
    installFetchSpy([invalidRow]);

    render(<SpirecutPostop />);
    await waitForRows();

    const trigger = screen.getByRole("button", { name: /ungültig/i });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    const backdrop = dialog.parentElement;
    expect(backdrop).not.toBeNull();

    await user.click(backdrop!);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(trigger);
  });

  // ── 7. Dialog shows raw value and pre-fills closest valid value ──────────

  it("displays the raw invalid value and pre-selects the closest valid star", async () => {
    // raw rating 3.8 → rounds to 4
    const invalidRow = makeInvalidRow("row-float", 3.8);
    installFetchSpy([invalidRow]);

    render(<SpirecutPostop />);
    await waitForRows();

    await userEvent.click(screen.getByRole("button", { name: /ungültig/i }));

    await waitFor(() =>
      expect(screen.getByText(/Bewertung korrigieren/i)).toBeInTheDocument()
    );

    // Raw value is shown inside the dialog's <code> element
    // (the same value also appears in the "Invalid" badge so we target <code>)
    const codeEl = document.querySelector("code");
    expect(codeEl).not.toBeNull();
    expect(codeEl!.textContent).toBe("3.8");

    // The star button for "4" should look selected (primary style)
    // We can verify by checking the rendered star row — all five numbered buttons exist
    const starBtn4 = screen.getByRole("button", { name: /^4 Sterne$/ });
    expect(starBtn4).toBeInTheDocument();
  });

  it("pre-fills 1 when the raw value is not finite (e.g. 0 clamps to 1)", async () => {
    const invalidRow = makeInvalidRow("row-zero", 0);
    installFetchSpy([invalidRow]);

    render(<SpirecutPostop />);
    await waitForRows();

    await userEvent.click(screen.getByRole("button", { name: /ungültig/i }));

    await waitFor(() =>
      expect(screen.getByText(/Bewertung korrigieren/i)).toBeInTheDocument()
    );

    // Raw 0 clamps to 1 — the "1" star button should be rendered
    expect(screen.getByRole("button", { name: /^1 Stern$/ })).toBeInTheDocument();
  });

  // ── 8. Saving sends PATCH and closes the dialog ──────────────────────────

  it("sends PATCH /api/admin/patient-postop/:id with { rating: N } on save", async () => {
    const invalidRow = makeInvalidRow("row-patch", 99);
    const fetchSpy = installFetchSpy([invalidRow]);

    render(<SpirecutPostop />);
    await waitForRows();

    await userEvent.click(screen.getByRole("button", { name: /ungültig/i }));
    await waitFor(() =>
      expect(screen.getByText(/Bewertung korrigieren/i)).toBeInTheDocument()
    );

    // Click the "3" star button to select rating 3
    await userEvent.click(screen.getByRole("button", { name: /^3 Sterne$/ }));

    // Click Save
    const saveBtn = screen.getByRole("button", { name: /speichern/i });
    await userEvent.click(saveBtn);

    // Verify the PATCH call was made with the right payload
    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(([, init]) =>
        (init as RequestInit)?.method?.toUpperCase() === "PATCH"
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body).toEqual({ rating: 3 });
    });
  });

  it("closes the dialog after a successful save", async () => {
    const invalidRow = makeInvalidRow("row-close", 99);
    installFetchSpy([invalidRow]);

    render(<SpirecutPostop />);
    await waitForRows();

    await userEvent.click(screen.getByRole("button", { name: /ungültig/i }));
    await waitFor(() =>
      expect(screen.getByText(/Bewertung korrigieren/i)).toBeInTheDocument()
    );

    await userEvent.click(screen.getByRole("button", { name: /^2 Sterne$/ }));
    await userEvent.click(screen.getByRole("button", { name: /speichern/i }));

    // Dialog should disappear
    await waitFor(() =>
      expect(screen.queryByText(/Bewertung korrigieren/i)).not.toBeInTheDocument()
    );
  });

  it("restores focus to the Invalid control after a successful keyboard save", async () => {
    const invalidRow = makeInvalidRow("row-keyboard-save-success", 99);
    const user = userEvent.setup();
    const fetchSpy = installFetchSpy([invalidRow]);

    render(<SpirecutPostop />);
    await waitForRows();

    const trigger = screen.getByRole("button", { name: /ungültig/i });
    trigger.focus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog");
    const star4 = within(dialog).getByRole("button", { name: /^4 Sterne$/ });
    const saveButton = within(dialog).getByRole("button", { name: "Speichern" });

    // The dialog opens at its close button. Navigate to star 4, select it,
    // then continue through the remaining controls to Save.
    for (let i = 0; i < 4; i++) {
      await user.tab();
    }
    expect(document.activeElement).toBe(star4);
    await user.keyboard("{Enter}");
    await user.tab();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(saveButton);
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(trigger);

    const patchCall = fetchSpy.mock.calls.find(([, init]) =>
      (init as RequestInit)?.method?.toUpperCase() === "PATCH"
    );
    expect(patchCall).toBeDefined();
    expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({
      rating: 4,
    });
  });

  // ── 9. Row re-renders as stars with no amber background ─────────────────

  it("re-renders the corrected row as stars and removes the amber highlight", async () => {
    const invalidRow = makeInvalidRow("row-rerender", 99);
    // The component re-fetches after a successful PATCH; the second GET must
    // return the corrected row so the badge does not reappear.
    const correctedRow = { ...invalidRow, rating: 5 };
    let getCallCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          input instanceof Request
            ? input.url
            : input instanceof URL
            ? input.toString()
            : (input as string);
        const method = (
          init?.method ??
          (input instanceof Request ? input.method : "GET")
        ).toUpperCase();

        if (method === "GET" && url.includes("/api/admin/patient-postop")) {
          getCallCount++;
          const list = getCallCount === 1 ? [invalidRow] : [correctedRow];
          return { ok: true, json: async () => list } as Response;
        }

        if (method === "PATCH" && url.includes("/api/admin/patient-postop/")) {
          let body: Record<string, unknown> = {};
          try { body = JSON.parse(init?.body as string ?? "{}"); } catch { /* ignore */ }
          return {
            ok: true,
            json: async () => ({ message: "Rating corrected", id: "row-rerender", rating: body.rating }),
          } as Response;
        }

        throw new Error(`Unmocked fetch: ${method} ${url}`);
      }
    );

    render(<SpirecutPostop />);
    await waitForRows();

    // Confirm the amber "Invalid" badge is present before correction
    expect(screen.getByRole("button", { name: /ungültig/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /ungültig/i }));
    await waitFor(() =>
      expect(screen.getByText(/Bewertung korrigieren/i)).toBeInTheDocument()
    );

    // Select rating 5 and save
    await userEvent.click(screen.getByRole("button", { name: /^5 Sterne$/ }));
    await userEvent.click(screen.getByRole("button", { name: /speichern/i }));

    // After save the "Invalid" badge must be gone
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /ungültig/i })).not.toBeInTheDocument()
    );

    // Stars (★) should now appear in the row
    await waitFor(() =>
      expect(screen.getByText(/★{5}/)).toBeInTheDocument()
    );
  });

  // ── 11. Corrected valid rating persists after the list refresh ────────────

  it("shows a corrected valid rating after the list refresh and keeps its edit button", async () => {
    // The server initially has a valid rating (2), so this covers the regular
    // correction path rather than the invalid-rating recovery path.
    const initialRow = { ...makeInvalidRow("row-persist", 2), rating: 2 };
    const correctedRow = { ...initialRow, rating: 4 };

    let getCallCount = 0;
    let patchBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          input instanceof Request
            ? input.url
            : input instanceof URL
            ? input.toString()
            : (input as string);
        const method = (
          init?.method ??
          (input instanceof Request ? input.method : "GET")
        ).toUpperCase();

        // First GET → valid row; second GET (after PATCH) → corrected row
        if (method === "GET" && url.includes("/api/admin/patient-postop")) {
          getCallCount++;
          const list = getCallCount === 1 ? [initialRow] : [correctedRow];
          return { ok: true, json: async () => list } as Response;
        }

        // PATCH succeeds, echoing back the corrected rating
        if (method === "PATCH" && url.includes("/api/admin/patient-postop/")) {
          try {
            patchBody = JSON.parse(init?.body as string ?? "{}");
          } catch {
            patchBody = {};
          }
          return {
            ok: true,
            json: async () => ({ message: "Rating corrected", id: "row-persist", rating: patchBody?.rating }),
          } as Response;
        }

        throw new Error(`Unmocked fetch: ${method} ${url}`);
      }
    );

    render(<SpirecutPostop />);
    await waitForRows();

    // A valid row must expose the regular correction pencil.
    expect(screen.queryByRole("button", { name: /ungültig/i })).not.toBeInTheDocument();
    const editButton = screen.getByRole("button", { name: "Bewertung korrigieren" });
    expect(editButton).toHaveAttribute("data-postop-edit", "row-persist");

    // Open the valid row's edit dialog and confirm its current value is selected.
    await userEvent.click(editButton);
    await waitFor(() =>
      expect(screen.getByText(/Bewertung korrigieren/i)).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /^2 Sterne$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Change the rating to 4 and save.
    await userEvent.click(screen.getByRole("button", { name: /^4 Sterne$/ }));
    await userEvent.click(screen.getByRole("button", { name: /speichern/i }));

    // Dialog must close (save was successful)
    await waitFor(() =>
      expect(screen.queryByText(/Bewertung korrigieren/i)).not.toBeInTheDocument()
    );

    expect(patchBody).toEqual({ rating: 4 });

    // The re-fetch (second GET) must have been triggered — getCallCount should be 2
    expect(getCallCount).toBe(2);

    // The row remains valid after the refresh.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /ungültig/i })).not.toBeInTheDocument()
    );

    // The corrected rating should be visible in the table, with the pencil
    // still available for another correction.
    const refreshedRow = screen.getAllByRole("row")[1];
    await waitFor(() =>
      expect(within(refreshedRow).getByText("4/5")).toBeInTheDocument()
    );
    expect(
      within(refreshedRow).getByRole("button", { name: "Bewertung korrigieren" }),
    ).toHaveAttribute("data-postop-edit", "row-persist");
  });

  it("shows a corrected valid rating after the list refresh and keeps the English edit button", async () => {
    mockLanguage.current = "en";
    const initialRow = { ...makeInvalidRow("row-persist-en", 2), rating: 2 };
    const correctedRow = { ...initialRow, rating: 4 };

    let getCallCount = 0;
    let patchBody: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          input instanceof Request
            ? input.url
            : input instanceof URL
            ? input.toString()
            : (input as string);
        const method = (
          init?.method ??
          (input instanceof Request ? input.method : "GET")
        ).toUpperCase();

        if (method === "GET" && url.includes("/api/admin/patient-postop")) {
          getCallCount++;
          const list = getCallCount === 1 ? [initialRow] : [correctedRow];
          return { ok: true, json: async () => list } as Response;
        }

        if (method === "PATCH" && url.includes("/api/admin/patient-postop/")) {
          try {
            patchBody = JSON.parse(init?.body as string ?? "{}");
          } catch {
            patchBody = {};
          }
          return {
            ok: true,
            json: async () => ({
              message: "Rating corrected",
              id: "row-persist-en",
              rating: patchBody?.rating,
            }),
          } as Response;
        }

        throw new Error(`Unmocked fetch: ${method} ${url}`);
      },
    );

    render(<SpirecutPostop />);
    await waitForRows();

    expect(screen.getByRole("columnheader", { name: "Rating" })).toBeInTheDocument();
    const editButton = screen.getByRole("button", { name: "Correct rating" });
    expect(editButton).toHaveAttribute("data-postop-edit", "row-persist-en");

    await userEvent.click(editButton);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Correct Rating")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "2 stars" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await userEvent.click(within(dialog).getByRole("button", { name: "4 stars" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(patchBody).toEqual({ rating: 4 });
    expect(getCallCount).toBe(2);

    const refreshedRow = screen.getAllByRole("row")[1];
    await waitFor(() =>
      expect(within(refreshedRow).getByText("4/5")).toBeInTheDocument(),
    );
    expect(
      within(refreshedRow).getByRole("button", { name: "Correct rating" }),
    ).toHaveAttribute("data-postop-edit", "row-persist-en");
  });

  it("keeps the English stale-data warning and reload action when a manual reload fails again", async () => {
    mockLanguage.current = "en";
    const invalidRow = makeInvalidRow("row-refresh-fail", 99);
    let getCallCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          input instanceof Request
            ? input.url
            : input instanceof URL
            ? input.toString()
            : (input as string);
        const method = (
          init?.method ??
          (input instanceof Request ? input.method : "GET")
        ).toUpperCase();

        if (method === "GET" && url.includes("/api/admin/patient-postop-diagnostics")) {
          getCallCount++;
          if (getCallCount > 1) throw new Error("Refresh failed");
          return {
            ok: true,
            json: async () => [invalidRow],
          } as Response;
        }

        if (method === "GET" && url.includes("/api/patient-postop-stats")) {
          return {
            ok: true,
            json: async () => ({ skippedInvalid: 1 }),
          } as Response;
        }

        if (method === "PATCH" && url.includes("/api/admin/patient-postop/")) {
          return {
            ok: true,
            json: async () => ({ message: "Rating corrected", id: invalidRow.id, rating: 4 }),
          } as Response;
        }

        throw new Error(`Unmocked fetch: ${method} ${url}`);
      },
    );

    render(<SpirecutPostop />);
    await waitForRows();

    await userEvent.click(screen.getByRole("button", { name: /correct invalid rating/i }));
    await waitFor(() =>
      expect(screen.getByText(/Correct Rating/i)).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: /^4 stars$/ }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(screen.getByText(/List not refreshed/i)).toBeInTheDocument()
    );
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "destructive",
        title: "Rating saved, list not refreshed",
      }),
    );
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Rating corrected" }),
    );

    // The old row remains visible for context, but it is not presented as the
    // newly corrected value while the refresh has failed.
    expect(screen.getByRole("button", { name: /correct invalid rating/i })).toBeInTheDocument();
    expect(screen.queryByText("4/5")).not.toBeInTheDocument();

    const reloadButton = screen.getByRole("button", { name: /reload data/i });
    await userEvent.click(reloadButton);

    await waitFor(() => {
      expect(screen.getByText(/List not refreshed/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /reload data/i })).toBeInTheDocument();
    });
    expect(getCallCount).toBe(3);
  });

  it("clears the stale-data warning and shows the corrected rating after a successful manual reload", async () => {
    const invalidRow = makeInvalidRow("row-refresh-recovery", 99);
    const correctedRow = { ...invalidRow, rating: 4 };
    let diagnosticsCallCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          input instanceof Request
            ? input.url
            : input instanceof URL
            ? input.toString()
            : (input as string);
        const method = (
          init?.method ??
          (input instanceof Request ? input.method : "GET")
        ).toUpperCase();

        if (method === "GET" && url.includes("/api/admin/patient-postop-diagnostics")) {
          diagnosticsCallCount++;
          if (diagnosticsCallCount === 2) {
            throw new Error("Temporary refresh outage");
          }
          return {
            ok: true,
            json: async () => [diagnosticsCallCount === 1 ? invalidRow : correctedRow],
          } as Response;
        }

        if (method === "GET" && url.includes("/api/patient-postop-stats")) {
          return {
            ok: true,
            json: async () => ({ skippedInvalid: diagnosticsCallCount < 3 ? 1 : 0 }),
          } as Response;
        }

        if (method === "PATCH" && url.includes("/api/admin/patient-postop/")) {
          return {
            ok: true,
            json: async () => ({ message: "Rating corrected", id: invalidRow.id, rating: 4 }),
          } as Response;
        }

        throw new Error(`Unmocked fetch: ${method} ${url}`);
      },
    );

    render(<SpirecutPostop />);
    await waitForRows();

    await userEvent.click(screen.getByRole("button", { name: /ungültig/i }));
    await waitFor(() =>
      expect(screen.getByText(/Bewertung korrigieren/i)).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: /^4 Sterne$/ }));
    await userEvent.click(screen.getByRole("button", { name: /speichern/i }));

    const reloadButton = await screen.findByRole("button", { name: /erneut laden/i });
    expect(screen.getByText(/Liste nicht aktualisiert/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ungültig/i })).toBeInTheDocument();

    await userEvent.click(reloadButton);

    await waitFor(() => {
      expect(screen.queryByText(/Liste nicht aktualisiert/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /ungültig/i })).not.toBeInTheDocument();
      expect(within(screen.getAllByRole("row")[1]).getByText("4/5")).toBeInTheDocument();
    });
    expect(diagnosticsCallCount).toBe(3);
  });

  it("keeps the newest refresh failure visible when an older diagnostics response settles afterward", async () => {
    const invalidRow = makeInvalidRow("row-out-of-order", 99);
    const olderRow = { ...invalidRow, operationMonth: "2024-01", rating: 2 };
    const correctedRow = { ...invalidRow, rating: 4 };
    let diagnosticsCallCount = 0;
    let resolveOlderReload!: (response: Response) => void;
    let rejectNewerReload!: (reason?: unknown) => void;
    const olderReload = new Promise<Response>((resolve) => {
      resolveOlderReload = resolve;
    });
    const newerReload = new Promise<Response>((_resolve, reject) => {
      rejectNewerReload = reject;
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          input instanceof Request
            ? input.url
            : input instanceof URL
            ? input.toString()
            : (input as string);
        const method = (
          init?.method ??
          (input instanceof Request ? input.method : "GET")
        ).toUpperCase();

        if (method === "GET" && url.includes("/api/admin/patient-postop-diagnostics")) {
          diagnosticsCallCount++;
          if (diagnosticsCallCount === 2) throw new Error("Initial refresh failed");
          if (diagnosticsCallCount === 3) return olderReload;
          if (diagnosticsCallCount === 4) return newerReload;
          return {
            ok: true,
            json: async () => [diagnosticsCallCount === 1 ? invalidRow : correctedRow],
          } as Response;
        }

        if (method === "GET" && url.includes("/api/patient-postop-stats")) {
          return {
            ok: true,
            json: async () => ({ skippedInvalid: diagnosticsCallCount < 5 ? 1 : 0 }),
          } as Response;
        }

        if (method === "PATCH" && url.includes("/api/admin/patient-postop/")) {
          return {
            ok: true,
            json: async () => ({ message: "Rating corrected", id: invalidRow.id, rating: 4 }),
          } as Response;
        }

        throw new Error(`Unmocked fetch: ${method} ${url}`);
      },
    );

    render(<SpirecutPostop />);
    await waitForRows();

    await userEvent.click(screen.getByRole("button", { name: /ungültig/i }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /^4 Sterne$/ }));
    await userEvent.click(screen.getByRole("button", { name: /speichern/i }));

    const reloadButton = await screen.findByRole("button", { name: /erneut laden/i });
    await waitFor(() => expect(screen.getByText(/Liste nicht aktualisiert/i)).toBeInTheDocument());

    // Dispatch both reloads from the same rendered button before React removes
    // it after the first request starts.
    await act(async () => {
      reloadButton.click();
      reloadButton.click();
    });
    await waitFor(() => expect(diagnosticsCallCount).toBe(4));

    // The newer request fails first. An older success must not clear its
    // warning or replace the still-current row data.
    await act(async () => {
      rejectNewerReload(new Error("Newer refresh failed"));
    });
    await waitFor(() => expect(screen.getByText(/Liste nicht aktualisiert/i)).toBeInTheDocument());

    await act(async () => {
      resolveOlderReload({
        ok: true,
        json: async () => [olderRow],
      } as Response);
    });
    await waitFor(() => expect(screen.getByText(/Liste nicht aktualisiert/i)).toBeInTheDocument());
    expect(screen.queryByText("2/5")).not.toBeInTheDocument();

    // A later successful refresh is still allowed to clear the warning.
    await userEvent.click(screen.getByRole("button", { name: /erneut laden/i }));
    await waitFor(() => {
      expect(screen.queryByText(/Liste nicht aktualisiert/i)).not.toBeInTheDocument();
      expect(within(screen.getAllByRole("row")[1]).getByText("4/5")).toBeInTheDocument();
    });
    expect(diagnosticsCallCount).toBe(5);
  });

  it("keeps the newest statistics warning when an older stats response settles afterward", async () => {
    const validRow = makeRow("row-stats-out-of-order");
    let diagnosticsCallCount = 0;
    let statsCallCount = 0;
    let resolveOlderStats!: (response: Response) => void;
    const olderStats = new Promise<Response>((resolve) => {
      resolveOlderStats = resolve;
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          input instanceof Request
            ? input.url
            : input instanceof URL
            ? input.toString()
            : (input as string);
        const method = (
          init?.method ??
          (input instanceof Request ? input.method : "GET")
        ).toUpperCase();

        if (method === "GET" && url.includes("/api/admin/patient-postop-diagnostics")) {
          diagnosticsCallCount++;
          return {
            ok: true,
            json: async () => ({
              submissions: [validRow],
              unreadableCount: diagnosticsCallCount === 1 ? 1 : 0,
            }),
          } as Response;
        }

        if (method === "GET" && url.includes("/api/patient-postop-stats")) {
          statsCallCount++;
          if (statsCallCount === 1) return olderStats;
          return {
            ok: true,
            json: async () => ({ skippedInvalid: 2 }),
          } as Response;
        }

        throw new Error(`Unmocked fetch: ${method} ${url}`);
      },
    );

    render(<SpirecutPostop />);
    await waitForRows();

    // The diagnostics reload starts while the first aggregate request is still
    // pending, so both refreshes have overlapping stats requests.
    await userEvent.click(screen.getByRole("button", { name: /erneut laden/i }));
    await waitFor(() => expect(statsCallCount).toBe(2));
    const getInvalidRatingWarning = () =>
      screen
        .getAllByRole("alert")
        .find((alert) => /aus der Statistik ausgeschlossen/.test(alert.textContent ?? ""));
    await waitFor(() => {
      const warning = getInvalidRatingWarning();
      expect(warning).toBeDefined();
      expect(warning).toHaveTextContent("2");
    });

    // The first refresh is now stale. Its response must not replace the
    // warning count from the newer refresh.
    await act(async () => {
      resolveOlderStats({
        ok: true,
        json: async () => ({ skippedInvalid: 1 }),
      } as Response);
    });
    await waitFor(() => {
      const warning = getInvalidRatingWarning();
      expect(warning).toBeDefined();
      expect(warning).toHaveTextContent("2");
    });
    expect(diagnosticsCallCount).toBe(2);
    expect(statsCallCount).toBe(2);
  });

  // ── 10. Failed PATCH shows error toast and keeps dialog open ─────────────

  it("shows an error toast and keeps the dialog open when the PATCH request fails", async () => {
    const invalidRow = makeInvalidRow("row-fail", 99);
    installFetchSpy(
      [invalidRow],
      new Set(),
      new Set(),
      (_id, _body) =>
        ({
          ok: false,
          json: async () => ({ error: "rating must be an integer between 1 and 5" }),
        } as Response)
    );

    render(<SpirecutPostop />);
    await waitForRows();

    await userEvent.click(screen.getByRole("button", { name: /ungültig/i }));
    await waitFor(() =>
      expect(screen.getByText(/Bewertung korrigieren/i)).toBeInTheDocument()
    );

    await userEvent.click(screen.getByRole("button", { name: /^4 Sterne$/ }));
    await userEvent.click(screen.getByRole("button", { name: /speichern/i }));

    // Error toast should appear
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" })
      )
    );

    // Dialog must still be visible
    expect(screen.getByText(/Bewertung korrigieren/i)).toBeInTheDocument();
  });

  it("uses the selected language for successful save feedback after a mid-request switch", async () => {
    const invalidRow = makeInvalidRow("row-language-save-success", 99);
    let resolvePatch!: (response: Response) => void;
    const pendingPatch = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    const fetchSpy = installFetchSpy(
      [invalidRow],
      new Set(),
      new Set(),
      (_id, _body) => pendingPatch,
    );
    const { rerender } = render(<SpirecutPostop />);
    await waitForRows();

    await userEvent.click(screen.getByRole("button", { name: /ungültig/i }));
    await waitFor(() =>
      expect(screen.getByText(/Bewertung korrigieren/i)).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: /^4 Sterne$/ }));
    await userEvent.click(screen.getByRole("button", { name: /speichern/i }));

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(([, init]) =>
        (init as RequestInit)?.method?.toUpperCase() === "PATCH"
      );
      expect(patchCall).toBeDefined();
      expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({
        rating: 4,
      });
    });

    mockLanguage.current = "en";
    rerender(<SpirecutPostop />);
    resolvePatch({
      ok: true,
      json: async () => ({ message: "Rating corrected", id: invalidRow.id, rating: 4 }),
    } as Response);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Rating corrected" }),
      )
    );
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Bewertung korrigiert" }),
    );
  });

  it("uses the selected language for failed save feedback after a mid-request switch", async () => {
    const invalidRow = makeInvalidRow("row-language-save-failure", 99);
    let resolvePatch!: (response: Response) => void;
    const pendingPatch = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    const fetchSpy = installFetchSpy(
      [invalidRow],
      new Set(),
      new Set(),
      (_id, _body) => pendingPatch,
    );
    const { rerender } = render(<SpirecutPostop />);
    await waitForRows();

    await userEvent.click(screen.getByRole("button", { name: /ungültig/i }));
    await waitFor(() =>
      expect(screen.getByText(/Bewertung korrigieren/i)).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: /^4 Sterne$/ }));
    await userEvent.click(screen.getByRole("button", { name: /speichern/i }));

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(([, init]) =>
        (init as RequestInit)?.method?.toUpperCase() === "PATCH"
      );
      expect(patchCall).toBeDefined();
      expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({
        rating: 4,
      });
    });

    mockLanguage.current = "en";
    rerender(<SpirecutPostop />);
    resolvePatch({
      ok: false,
      json: async () => ({ error: "rating could not be saved" }),
    } as Response);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          title: "Save failed",
          description: "rating could not be saved",
        }),
      )
    );
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Fehler beim Speichern" }),
    );
  });

  it("keeps the stale-list warning in the selected language when PATCH and refresh settle after a language switch", async () => {
    const invalidRow = makeInvalidRow("row-language-refresh-warning", 99);
    let diagnosticsCallCount = 0;
    let resolvePatch!: (response: Response) => void;
    let rejectRefresh!: (error: Error) => void;
    const pendingPatch = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });
    const pendingRefresh = new Promise<Response>((_resolve, reject) => {
      rejectRefresh = reject;
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          input instanceof Request
            ? input.url
            : input instanceof URL
            ? input.toString()
            : (input as string);
        const method = (
          init?.method ??
          (input instanceof Request ? input.method : "GET")
        ).toUpperCase();

        if (method === "GET" && url.includes("/api/admin/patient-postop-diagnostics")) {
          diagnosticsCallCount++;
          if (diagnosticsCallCount === 1) {
            return { ok: true, json: async () => [invalidRow] } as Response;
          }
          return pendingRefresh;
        }

        if (method === "GET" && url.includes("/api/patient-postop-stats")) {
          return {
            ok: true,
            json: async () => ({ skippedInvalid: 1 }),
          } as Response;
        }

        if (method === "PATCH" && url.includes("/api/admin/patient-postop/")) {
          return pendingPatch;
        }

        throw new Error(`Unmocked fetch: ${method} ${url}`);
      },
    );

    const { rerender } = render(<SpirecutPostop />);
    await waitForRows();

    await userEvent.click(screen.getByRole("button", { name: /ungültig/i }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /^4 Sterne$/ }));
    await userEvent.click(screen.getByRole("button", { name: /speichern/i }));

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(([, init]) =>
        (init as RequestInit)?.method?.toUpperCase() === "PATCH"
      );
      expect(patchCall).toBeDefined();
      expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({
        rating: 4,
      });
    });

    // Change language while the save is still pending.
    mockLanguage.current = "en";
    rerender(<SpirecutPostop />);
    resolvePatch({
      ok: true,
      json: async () => ({ message: "Rating corrected", id: invalidRow.id, rating: 4 }),
    } as Response);

    await waitFor(() => expect(diagnosticsCallCount).toBeGreaterThanOrEqual(2));
    // Keep the refresh pending long enough to prove the warning uses the
    // language selected while both requests were in flight.
    rejectRefresh(new Error("Refresh failed"));

    await waitFor(() => {
      expect(screen.getByText("List not refreshed:")).toBeInTheDocument();
      expect(
        screen.getByText("The rating was saved, but the displayed data may be out of date. Please reload the list."),
      ).toBeInTheDocument();
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "destructive",
        title: "Rating saved, list not refreshed",
        description: "The displayed data may be out of date. Please reload the list.",
      }),
    );
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Bewertung gespeichert, Liste nicht aktualisiert",
      }),
    );
  });

  it("updates the stale-list warning and reload action when the language changes after a failed refresh", async () => {
    const invalidRow = makeInvalidRow("row-language-after-refresh-failure", 99);
    const correctedRow = { ...invalidRow, rating: 4 };
    let diagnosticsCallCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          input instanceof Request
            ? input.url
            : input instanceof URL
            ? input.toString()
            : (input as string);
        const method = (
          init?.method ??
          (input instanceof Request ? input.method : "GET")
        ).toUpperCase();

        if (method === "GET" && url.includes("/api/admin/patient-postop-diagnostics")) {
          diagnosticsCallCount++;
          if (diagnosticsCallCount === 1) {
            return { ok: true, json: async () => [invalidRow] } as Response;
          }
          if (diagnosticsCallCount === 2) {
            throw new Error("Refresh failed");
          }
          return { ok: true, json: async () => [correctedRow] } as Response;
        }

        if (method === "GET" && url.includes("/api/patient-postop-stats")) {
          return {
            ok: true,
            json: async () => ({ skippedInvalid: diagnosticsCallCount < 3 ? 1 : 0 }),
          } as Response;
        }

        if (method === "PATCH" && url.includes("/api/admin/patient-postop/")) {
          return {
            ok: true,
            json: async () => ({ message: "Rating corrected", id: invalidRow.id, rating: 4 }),
          } as Response;
        }

        throw new Error(`Unmocked fetch: ${method} ${url}`);
      },
    );

    const { rerender } = render(<SpirecutPostop />);
    await waitForRows();

    await userEvent.click(screen.getByRole("button", { name: /ungültig/i }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /^4 Sterne$/ }));
    await userEvent.click(screen.getByRole("button", { name: /speichern/i }));

    await waitFor(() => {
      expect(screen.getByText("Liste nicht aktualisiert:")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /erneut laden/i })).toBeInTheDocument();
    });

    mockLanguage.current = "en";
    rerender(<SpirecutPostop />);

    expect(screen.getByText("List not refreshed:")).toBeInTheDocument();
    expect(
      screen.getByText("The rating was saved, but the displayed data may be out of date. Please reload the list."),
    ).toBeInTheDocument();
    const reloadButton = screen.getByRole("button", { name: /reload data/i });
    expect(reloadButton).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /erneut laden/i })).not.toBeInTheDocument();

    await userEvent.click(reloadButton);

    await waitFor(() => {
      expect(screen.queryByText("List not refreshed:")).not.toBeInTheDocument();
      expect(within(screen.getAllByRole("row")[1]).getByText("4/5")).toBeInTheDocument();
    });
    expect(diagnosticsCallCount).toBe(3);
  });

  it.each([
    ["Escape", "escape"],
    ["Cancel", "cancel"],
  ])("keeps keyboard focus recoverable with %s after a failed save", async (_recovery, recovery) => {
    const invalidRow = makeInvalidRow(`row-keyboard-save-fail-${recovery}`, 99);
    const user = userEvent.setup();
    installFetchSpy(
      [invalidRow],
      new Set(),
      new Set(),
      () =>
        ({
          ok: false,
          json: async () => ({ error: "rating could not be saved" }),
        } as Response)
    );

    render(<SpirecutPostop />);
    await waitForRows();

    const trigger = screen.getByRole("button", { name: /ungültig/i });
    trigger.focus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog");
    const star4 = within(dialog).getByRole("button", { name: /^4 Sterne$/ });
    const cancelButton = within(dialog).getByRole("button", { name: "Abbrechen" });
    const saveButton = within(dialog).getByRole("button", { name: "Speichern" });

    // Move from the dialog's close button to star 4, select it, then tab to Save.
    for (let i = 0; i < 4; i++) {
      await user.tab();
    }
    expect(document.activeElement).toBe(star4);
    await user.keyboard("{Enter}");
    await user.tab();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(saveButton);
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" })
      )
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(star4).toHaveAttribute("aria-pressed", "true");

    if (recovery === "escape") {
      await user.keyboard("{Escape}");
    } else {
      cancelButton.focus();
      await user.keyboard("{Enter}");
    }

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect(document.activeElement).toBe(trigger);
  });

  it.each([
    ["Escape", "escape"],
    ["Cancel", "cancel"],
  ])("keeps English keyboard focus recoverable with %s after a failed save", async (_recovery, recovery) => {
    mockLanguage.current = "en";
    const invalidRow = makeInvalidRow(`row-english-keyboard-save-fail-${recovery}`, 99);
    const user = userEvent.setup();
    installFetchSpy(
      [invalidRow],
      new Set(),
      new Set(),
      () =>
        ({
          ok: false,
          json: async () => ({ error: "rating could not be saved" }),
        } as Response)
    );

    render(<SpirecutPostop />);
    await waitForRows();

    const trigger = screen.getByRole("button", { name: "Correct invalid rating" });
    trigger.focus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog");
    const star4 = within(dialog).getByRole("button", { name: "4 stars" });
    const cancelButton = within(dialog).getByRole("button", { name: "Cancel" });
    const saveButton = within(dialog).getByRole("button", { name: "Save" });

    // Move from the dialog's close button to star 4, select it, then tab to Save.
    for (let i = 0; i < 4; i++) {
      await user.tab();
    }
    expect(document.activeElement).toBe(star4);
    await user.keyboard("{Enter}");
    await user.tab();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(saveButton);
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          title: "Save failed",
          description: "rating could not be saved",
        }),
      )
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(star4).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(cancelButton).not.toBeDisabled());

    if (recovery === "escape") {
      await user.keyboard("{Escape}");
    } else {
      cancelButton.focus();
      await user.keyboard("{Enter}");
    }

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
    expect(document.activeElement).toBe(trigger);
  });
});

describe("SpirecutPostop – invalid-rating stats warning", () => {
  it("uses skippedInvalid from the aggregate stats endpoint and points admins to rating correction", async () => {
    // The admin list itself contains only one invalid row, but the aggregate
    // endpoint reports two excluded submissions. The banner must show the
    // authoritative endpoint value rather than recounting the list locally.
    installFetchSpy([ROW_A], new Set(), new Set(), undefined, 2);

    render(<SpirecutPostop />);
    await waitForRows();

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("2");
      expect(alert).toHaveTextContent(/Bewertungskorrektur-Tool/i);
    });
  });

  it("does not show the warning when the aggregate endpoint reports no excluded submissions", async () => {
    installFetchSpy([ROW_A], new Set(), new Set(), undefined, 0);

    render(<SpirecutPostop />);
    await waitForRows();

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});

describe("SpirecutPostop – unreadable-record warning", () => {
  it("shows the unreadable count and a reload action from the admin diagnostics endpoint", async () => {
    installFetchSpy([ROW_A], new Set(), new Set(), undefined, 0, 2);

    render(<SpirecutPostop />);
    await waitForRows();

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("2");
      expect(alert).toHaveTextContent(/nicht gelesen/i);
      expect(screen.getByRole("button", { name: /erneut laden/i })).toBeInTheDocument();
    });
  });

  it("does not show the unreadable warning when diagnostics report no unreadable records", async () => {
    installFetchSpy([ROW_A]);

    render(<SpirecutPostop />);
    await waitForRows();

    await waitFor(() => {
      expect(screen.queryByText(/gespeicherte Einsendung konnte nicht gelesen/i)).not.toBeInTheDocument();
    });
  });

  it("keeps the localized recovery warning visible during a delayed manual reload", async () => {
    let diagnosticsCalls = 0;
    let finishReload!: (response: Response) => void;
    const delayedReload = new Promise<Response>((resolve) => {
      finishReload = resolve;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes("/api/patient-postop-stats")) {
        return { ok: true, json: async () => ({ skippedInvalid: 0 }) } as Response;
      }
      if (url.includes("/api/admin/patient-postop-diagnostics")) {
        diagnosticsCalls++;
        if (diagnosticsCalls === 2) return delayedReload;
        return {
          ok: true,
          json: async () => ({ submissions: [ROW_A], unreadableCount: 1, unreadable: [] }),
        } as Response;
      }
      throw new Error(`Unmocked fetch: ${url}`);
    });

    render(<SpirecutPostop />);
    await waitForRows();
    await userEvent.click(screen.getByRole("button", { name: /erneut laden/i }));

    expect(screen.getByText(/gespeicherte Einsendung konnte nicht gelesen/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /wird neu geladen/i })).toBeInTheDocument();

    await act(async () => {
      finishReload({
        ok: true,
        json: async () => ({ submissions: [ROW_A], unreadableCount: 0, unreadable: [] }),
      } as Response);
    });
    await waitFor(() =>
      expect(screen.queryByText(/gespeicherte Einsendung konnte nicht gelesen/i)).not.toBeInTheDocument(),
    );
  });

  it("restores a verified backup and refreshes diagnostics", async () => {
    let diagnosticsCalls = 0;
    let recoveryBody: unknown;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes("/api/patient-postop-stats")) {
        return { ok: true, json: async () => ({ skippedInvalid: 0 }) } as Response;
      }
      if (url.includes("/api/admin/patient-postop-diagnostics")) {
        diagnosticsCalls++;
        return {
          ok: true,
          json: async () => diagnosticsCalls === 1
            ? {
                submissions: [ROW_A],
                unreadableCount: 1,
                unreadable: [{ key: "patient_postop_backup-row", reason: "invalid_json" }],
              }
            : { submissions: [ROW_A], unreadableCount: 0, unreadable: [] },
        } as Response;
      }
      if (url.includes("/api/admin/patient-postop-recovery/backup-row")) {
        recoveryBody = JSON.parse(String(init?.body));
        return { ok: true, json: async () => ({ id: "backup-row" }) } as Response;
      }
      throw new Error(`Unmocked fetch: ${url}`);
    });

    render(<SpirecutPostop />);
    await waitForRows();
    await userEvent.click(screen.getByRole("button", { name: /aus sicherung wiederherstellen/i }));
    const replacement = {
      id: "backup-row",
      procedure: "ct",
      operationMonth: "2024-01",
      rating: 5,
      submittedAt: "2024-01-15T10:00:00.000Z",
    };
    fireEvent.change(
      screen.getByRole("textbox", { name: /json aus geprüfter datensicherung/i }),
      { target: { value: JSON.stringify(replacement) } },
    );
    await userEvent.click(screen.getByRole("button", { name: /geprüfte sicherung wiederherstellen/i }));

    await waitFor(() => expect(diagnosticsCalls).toBe(2));
    expect(recoveryBody).toEqual({ verifiedBackup: true, submission: replacement });
    expect(screen.queryByText(/gespeicherte Einsendung konnte nicht gelesen/i)).not.toBeInTheDocument();
  });
});

describe("SpirecutPostop – aggregate statistics outage", () => {
  it("shows the row-derived fallback and clears the bilingual outage message after reload", async () => {
    mockLanguage.current = "en";
    let statsCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes("/api/admin/patient-postop-diagnostics")) {
        return {
          ok: true,
          json: async () => ({
            submissions: [{ ...ROW_A, rating: null }],
            unreadableCount: 0,
            unreadable: [],
          }),
        } as Response;
      }
      if (url.includes("/api/patient-postop-stats")) {
        statsCalls++;
        if (statsCalls === 1) return { ok: false, status: 503 } as Response;
        return { ok: true, json: async () => ({ skippedInvalid: 0 }) } as Response;
      }
      throw new Error(`Unmocked fetch: ${url}`);
    });

    render(<SpirecutPostop />);
    await waitForRows();
    expect(await screen.findByText(/Statistics temporarily unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/submission was excluded from statistics/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /reload data/i }));
    await waitFor(() =>
      expect(screen.queryByText(/Statistics temporarily unavailable/i)).not.toBeInTheDocument(),
    );
    expect(statsCalls).toBe(2);
  });
});
