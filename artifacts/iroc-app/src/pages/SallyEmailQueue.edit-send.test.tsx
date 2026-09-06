/**
 * Regression test: the Sally reply editor saves changes before approving.
 *
 * A successful approve request alone is not enough — the UI must await the
 * PUT response before issuing the approve POST, otherwise the original draft
 * can be sent during a fast click or slow save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SallyEmailQueue from "./SallyEmailQueue";
import { adminGet, adminPost, adminPut, adminRequest } from "@/lib/admin-fetch";

const language = vi.hoisted(() => ({ lang: "en" as "en" | "de" }));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => language,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/admin-fetch", () => ({
  adminGet: vi.fn(),
  adminPost: vi.fn(),
  adminPut: vi.fn(),
  adminRequest: vi.fn(),
}));

const pendingReply = {
  id: 493,
  recipient_email: "customer@example.com",
  subject: "Original subject",
  body: "Original body",
  trigger_type: "inbound_reply",
  status: "pending" as const,
  related_lead_id: null,
  related_doctor_id: null,
  related_order_id: null,
  created_at: "2026-08-30T12:00:00.000Z",
  message_id: null,
  in_reply_to: null,
  detected_language: "en",
  detected_formality: "formal" as const,
  inbound_from: "customer@example.com",
  inbound_body: "Original customer message",
  escalation_forward_status: "unconfirmed" as string,
};

const callOrder: string[] = [];
let queueItems = [pendingReply];

function renderQueue() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SallyEmailQueue />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, "", "/iroc-app/sally/email-queue");
  callOrder.length = 0;
  language.lang = "en";
  queueItems = [pendingReply];
  vi.mocked(adminGet).mockImplementation(async (path: string) => {
    if (path.includes("reconciliation-actors")) return ["iroc:alice"];
    if (path.includes("reconciliation-history")) return [];
    return queueItems;
  });
  vi.mocked(adminPut).mockImplementation(async (_path, _token, body) => {
    callOrder.push("put");
    return {
      ...pendingReply,
      ...(body as { subject: string; body: string }),
    };
  });
  vi.mocked(adminPost).mockImplementation(async () => {
    callOrder.push("post");
    return { ok: true };
  });
  vi.mocked(adminRequest).mockReset();
});


afterEach(() => {
  window.history.replaceState({}, "", "/iroc-app/sally/email-queue");
  vi.clearAllMocks();
});

describe("SallyEmailQueue — edited reply approval", () => {
  it("disables approval and shows a warning when the body is empty", async () => {
    const user = userEvent.setup();
    renderQueue();

    await user.click(await screen.findByTitle("Preview"));

    const body = screen.getByDisplayValue("Original body");
    await user.clear(body);

    expect(screen.getByRole("button", { name: /approve & send/i })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Body cannot be empty");
    expect(adminPut).not.toHaveBeenCalled();
    expect(adminPost).not.toHaveBeenCalled();
  });

  it("disables approval and shows a warning when the subject is empty", async () => {
    const user = userEvent.setup();
    renderQueue();

    await user.click(await screen.findByTitle("Preview"));

    const subject = screen.getByDisplayValue("Original subject");
    await user.clear(subject);

    expect(screen.getByRole("button", { name: /approve & send/i })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Subject cannot be empty");
    expect(adminPut).not.toHaveBeenCalled();
    expect(adminPost).not.toHaveBeenCalled();
  });

  it("awaits saving edited fields before approving the draft", async () => {
    const user = userEvent.setup();
    renderQueue();

    await user.click(await screen.findByTitle("Preview"));

    const subject = await screen.findByDisplayValue("Original subject");
    const body = screen.getByDisplayValue("Original body");
    await user.clear(subject);
    await user.type(subject, "Final edited subject");
    await user.clear(body);
    await user.type(body, "Final edited body");

    await user.click(screen.getByRole("button", { name: /approve & send/i }));

    await waitFor(() => {
      expect(adminPut).toHaveBeenCalledWith(
        "/api/admin/sally/email-queue/493",
        "test-token",
        { subject: "Final edited subject", body: "Final edited body" },
      );
      expect(adminPost).toHaveBeenCalledWith(
        "/api/admin/sally/email-queue/493/approve",
        "test-token",
        {},
      );
    });

    expect(callOrder).toEqual(["put", "post"]);
  });

  it("downloads the selected reply's read-only reconciliation history", async () => {
    const user = userEvent.setup();
    const click = vi.fn();
    const appendChild = vi.spyOn(document.body, "appendChild");
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:history");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.mocked(adminGet).mockImplementation(async (path: string) => path.includes("reconciliation-history")
      ? [{
          id: 7,
          queue_item_id: pendingReply.id,
          action: "confirm_delivery",
          previous_status: "unconfirmed",
          resulting_status: "confirmed",
          actor: "iroc:alice",
          acknowledged_duplicate_risk: false,
          created_at: "2026-08-30T12:00:00.000Z",
        }]
      : [pendingReply]);
    vi.mocked(adminRequest).mockResolvedValue(new Response("csv", { status: 200 }));

    renderQueue();
    await user.click(await screen.findByTitle("Preview"));
    await screen.findByText("Reconciliation history");
    await user.click(await screen.findByRole("button", { name: /export context/i }));

    await waitFor(() => expect(adminRequest).toHaveBeenCalledWith(
      "/api/admin/sally/email-queue/493/reconciliation-history/export",
      "test-token",
    ));
    expect(click).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:history");
    expect(appendChild).toHaveBeenCalled();

    appendChild.mockRestore();
    anchorClick.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("allows exporting delivery context when reconciliation history is empty", async () => {
    const user = userEvent.setup();
    const click = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:context");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.mocked(adminGet).mockImplementation(async (path: string) => path.includes("reconciliation-history")
      ? []
      : [pendingReply]);
    vi.mocked(adminRequest).mockResolvedValue(new Response("csv", { status: 200 }));

    renderQueue();
    await user.click(await screen.findByTitle("Preview"));
    await screen.findByText("No reconciliation actions yet.");

    const exportButton = screen.getByRole("button", { name: /export context/i });
    expect(exportButton).toBeEnabled();
    await user.click(exportButton);

    await waitFor(() => expect(adminRequest).toHaveBeenCalledWith(
      "/api/admin/sally/email-queue/493/reconciliation-history/export",
      "test-token",
    ));
    expect(click).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:context");

    anchorClick.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("requests the queue with the selected reconciliation outcome and actor", async () => {
    const user = userEvent.setup();
    renderQueue();

    const outcome = await screen.findByLabelText("Delivery reconciliation");
    await user.selectOptions(outcome, "confirmed");
    const actor = await screen.findByLabelText("Actor from reconciliation history");
    await user.selectOptions(actor, "iroc:alice");

    await waitFor(() => expect(adminGet).toHaveBeenCalledWith(
      "/api/admin/sally/email-queue?status=pending&reconciliationOutcome=confirmed&reconciliationActor=iroc%3Aalice",
      "test-token",
    ));
    expect(screen.getByText("All outcomes")).toBeInTheDocument();
    expect(screen.getByText("Previously handled")).toBeInTheDocument();
  });

  it("restores queue filters from the URL and clears only the selected filter parameters", async () => {
    const user = userEvent.setup();
    window.history.replaceState(
      {},
      "",
      "/iroc-app/sally/email-queue?status=sent&reconciliationOutcome=failed&reconciliationActor=iroc%3Aalice",
    );

    renderQueue();

    expect(await screen.findByLabelText("Delivery reconciliation")).toHaveValue("failed");
    expect(screen.getByLabelText("Actor from reconciliation history")).toHaveValue("iroc:alice");
    await waitFor(() => expect(adminGet).toHaveBeenCalledWith(
      "/api/admin/sally/email-queue?status=sent&reconciliationOutcome=failed&reconciliationActor=iroc%3Aalice",
      "test-token",
    ));

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(window.location.search).toBe("?status=sent");
    expect(screen.getByLabelText("Delivery reconciliation")).toHaveValue("all");
    expect(screen.getByLabelText("Actor from reconciliation history")).toHaveValue("");
  });

  it("removes malformed shared-link filters and never sends them to the API", async () => {
    window.history.replaceState(
      {},
      "",
      "/iroc-app/sally/email-queue?status=evil&reconciliationOutcome=broken&reconciliationActor=%0Aadmin",
    );

    renderQueue();

    await waitFor(() => expect(window.location.search).toBe(""));
    expect(await screen.findByLabelText("Delivery reconciliation")).toHaveValue("all");
    expect(screen.getByLabelText("Actor from reconciliation history")).toHaveValue("");
    expect(adminGet).toHaveBeenCalledWith(
      "/api/admin/sally/email-queue?status=pending",
      "test-token",
    );
    expect(vi.mocked(adminGet).mock.calls.some(([path]) =>
      String(path).includes("evil") || String(path).includes("broken") || String(path).includes("%0A"),
    )).toBe(false);
  });

  it("supports keyboard selection and multi-delivery export", async () => {
    const user = userEvent.setup();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:bulk");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.mocked(adminRequest).mockResolvedValue(new Response("csv", { status: 200 }));
    renderQueue();

    const row = await screen.findByRole("checkbox", {
      name: "customer@example.com: Original subject",
    });
    row.focus();
    await user.keyboard("{Enter}");
    expect(row).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("button", { name: "Export selected reconciliation histories" }));
    await waitFor(() => expect(adminRequest).toHaveBeenCalledWith(
      "/api/admin/sally/email-queue/reconciliation-history/export",
      "test-token",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ ids: [493] }),
      }),
    ));
    expect(anchorClick).toHaveBeenCalled();

    anchorClick.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("applies an actor selected from reconciliation history", async () => {
    const user = userEvent.setup();
    renderQueue();

    await screen.findByRole("option", { name: "iroc:alice" });
    const actorSelect = screen.getByLabelText("Actor from reconciliation history");
    await user.selectOptions(actorSelect, "iroc:alice");

    expect(window.location.search).toBe("?reconciliationActor=iroc%3Aalice");
    await waitFor(() => expect(adminGet).toHaveBeenCalledWith(
      "/api/admin/sally/email-queue?status=pending&reconciliationActor=iroc%3Aalice",
      "test-token",
    ));
  });

  it("explains when no reconciliation actors are available", async () => {
    vi.mocked(adminGet).mockImplementation(async (path: string) =>
      path.includes("reconciliation-actors") ? [] : [pendingReply],
    );

    renderQueue();

    expect(await screen.findByText("No reconciliation actors have been recorded yet.")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "No actors in reconciliation history" })).toBeDisabled();
  });

  it("renders the unconfirmed delivery explanation in English and German", async () => {
    const user = userEvent.setup();
    const view = renderQueue();

    await user.click(await screen.findByTitle("Preview"));
    expect(await screen.findByText(
      "The escalation email may already have been accepted, but its final status was not safely recorded. Check the customer-service mailbox before choosing an action.",
    )).toBeInTheDocument();

    view.unmount();
    language.lang = "de";
    renderQueue();

    await user.click(await screen.findByTitle("Vorschau"));
    expect(await screen.findByText(
      "Die Eskalations-E-Mail kann bereits angenommen worden sein, aber der abschließende Status wurde nicht sicher gespeichert. Prüfen Sie das Kundenservice-Postfach, bevor Sie eine Aktion wählen.",
    )).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zustellung bestätigen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trotz Risiko erneut senden" })).toBeInTheDocument();
  });

  it("requires duplicate-risk acknowledgement before resending and calls the intended endpoints", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderQueue();

    await user.click(await screen.findByTitle("Preview"));
    await user.click(screen.getByRole("button", { name: "Resend despite risk" }));

    expect(confirm).toHaveBeenCalledWith(
      "The original escalation may already have been delivered. Resending can create a duplicate message. Resend anyway?",
    );
    expect(adminPost).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Resend despite risk" }));

    await waitFor(() => expect(adminPost).toHaveBeenCalledWith(
      "/api/admin/sally/email-queue/493/resend-escalation",
      "test-token",
      { acknowledgeDuplicateRisk: true },
    ));

    queueItems = [{ ...pendingReply, escalation_forward_status: "confirmed" }];
    confirm.mockRestore();
  });

  it("confirms delivery and refreshes the visible queue state after success", async () => {
    const user = userEvent.setup();
    vi.mocked(adminPost).mockImplementation(async (path: string) => {
      callOrder.push("post");
      if (path.endsWith("/confirm-escalation")) {
        queueItems = [{ ...pendingReply, escalation_forward_status: "confirmed" }];
      }
      return { ok: true };
    });
    renderQueue();

    await user.click(await screen.findByTitle("Preview"));
    await user.click(screen.getByRole("button", { name: "Confirm delivery" }));

    await waitFor(() => expect(adminPost).toHaveBeenCalledWith(
      "/api/admin/sally/email-queue/493/confirm-escalation",
      "test-token",
      {},
    ));
    expect(await screen.findByText("Delivery confirmed")).toBeInTheDocument();
    expect(screen.queryByText("Delivery unconfirmed")).not.toBeInTheDocument();
  });

  it("writes the selected status filter to the queue URL", async () => {
    const user = userEvent.setup();
    renderQueue();

    await user.click(screen.getByRole("button", { name: /^Sent$/ }));

    expect(window.location.search).toBe("?status=sent");
  });
});
