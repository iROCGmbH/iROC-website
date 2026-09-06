import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Login from "./Login";

vi.mock("@/hooks/use-iroc-logo", () => ({
  useIrocLogo: () => null,
}));

vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ lang: "en", toggleLang: vi.fn() }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useIrocLogin: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/login", vi.fn()],
}));

describe("Login – expired session message", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("iroc_session_expired", "1");
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows a clear message and consumes the one-time redirect flag", async () => {
    render(<Login />);

    expect(
      await screen.findByText("Your session has expired, please log in again."),
    ).toBeInTheDocument();
    expect(localStorage.getItem("iroc_session_expired")).toBeNull();
  });
});