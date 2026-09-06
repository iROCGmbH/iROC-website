import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/use-auth";
import { adminGet, adminPost, adminRequest } from "./admin-fetch";

const APP_BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "") || "";
const LOGIN_PATH = `${APP_BASE_PATH}/login`;

function seedAuthenticatedSession() {
  const { result, unmount } = renderHook(() => useAuth());
  act(() => {
    result.current.setAuth("expired-token", "admin");
  });
  unmount();
  window.history.replaceState(null, "", `${APP_BASE_PATH}/`);
}

function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    statusText: "Unauthorized",
    headers: { "Content-Type": "application/json" },
  });
}

describe("admin fetch helpers – expired sessions", () => {
  beforeEach(() => {
    localStorage.clear();
    seedAuthenticatedSession();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(unauthorizedResponse());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    window.history.replaceState(null, "", `${APP_BASE_PATH}/`);
  });

  it("clears auth and redirects to login when adminGet receives 401", async () => {
    await expect(adminGet("/api/iroc/customers-combined", "expired-token"))
      .rejects.toThrow("401 Unauthorized");

    expect(localStorage.getItem("iroc_token")).toBeNull();
    expect(localStorage.getItem("iroc_username")).toBeNull();
    expect(localStorage.getItem("iroc_session_expired")).toBe("1");
    expect(window.location.pathname).toBe(LOGIN_PATH);
  });

  it("clears auth and redirects to login when adminPost receives 401", async () => {
    await expect(adminPost("/api/admin/website-settings", "expired-token", {}))
      .rejects.toThrow("Unauthorized");

    expect(localStorage.getItem("iroc_token")).toBeNull();
    expect(localStorage.getItem("iroc_session_expired")).toBe("1");
    expect(window.location.pathname).toBe(LOGIN_PATH);
  });

  it("clears auth and redirects to login when an adminRequest receives 401", async () => {
    const response = await adminRequest("/api/admin/expenses/upload-url", "expired-token", {
      method: "POST",
    });

    expect(response.status).toBe(401);
    expect(localStorage.getItem("iroc_token")).toBeNull();
    expect(localStorage.getItem("iroc_session_expired")).toBe("1");
    expect(window.location.pathname).toBe(LOGIN_PATH);
  });
});