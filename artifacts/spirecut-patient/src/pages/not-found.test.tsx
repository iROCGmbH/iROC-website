/**
 * Tests for the 404 catch-all route in the Spirecut patient website.
 *
 * Verifies that:
 *   - The NotFound component renders the expected 404 UI elements
 *   - Completely unknown paths are caught and show the 404 page
 *   - Near-miss paths (typos of real routes) also reach the 404 page
 *   - A "back to home" link is present
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router, Switch, Route } from "wouter";
import NotFound from "./not-found";

// ── Helper: render the full catch-all switch at an arbitrary path ─────────────

/**
 * Returns a wouter location hook that always reports the given static path.
 * This lets us test routing without a real browser history.
 */
function staticHook(path: string): () => [string, (to: string) => void] {
  return () => [path, () => {}];
}

/**
 * Renders the same Switch configuration used in App.tsx but with only the
 * known nav routes stubbed out as empty fragments, so we can verify the
 * catch-all fires (or doesn't) for a given path.
 */
function renderRouterAt(path: string) {
  const knownPaths = [
    "/",
    "/arzt-finden",
    "/karpaltunnelsyndrom",
    "/schnappfinger",
    "/praktische-informationen",
    "/postoperative-entwicklung",
    "/faq",
    "/kontakt",
    "/so-funktioniert-es",
    "/impressum",
    "/datenschutz",
    "/admin",
  ];

  return render(
    <Router hook={staticHook(path)}>
      <Switch>
        {knownPaths.map((p) => (
          <Route key={p} path={p}>
            <div data-testid="known-page">known: {p}</div>
          </Route>
        ))}
        {/* Catch-all – must be last, same as App.tsx */}
        <Route component={NotFound} />
      </Switch>
    </Router>
  );
}

// ── Unit: NotFound component in isolation ────────────────────────────────────

describe("NotFound component", () => {
  it("renders the 404 heading", () => {
    render(
      <Router hook={staticHook("/nonexistent")}>
        <NotFound />
      </Router>
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("404");
  });

  it("renders the description text", () => {
    render(
      <Router hook={staticHook("/nonexistent")}>
        <NotFound />
      </Router>
    );
    expect(
      screen.getByText("Diese Seite wurde nicht gefunden.")
    ).toBeInTheDocument();
  });

  it("renders a link back to the homepage", () => {
    render(
      <Router hook={staticHook("/nonexistent")}>
        <NotFound />
      </Router>
    );
    const link = screen.getByRole("link", { name: /zur startseite/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/");
  });

  it("renders the AlertCircle icon container", () => {
    const { container } = render(
      <Router hook={staticHook("/nonexistent")}>
        <NotFound />
      </Router>
    );
    // The icon wrapper div always has a rounded-full class
    const iconWrapper = container.querySelector(".rounded-full");
    expect(iconWrapper).toBeInTheDocument();
  });
});

// ── Router integration: catch-all fires for unknown paths ────────────────────

describe("Router catch-all – unknown paths show 404", () => {
  it("shows the 404 page for a completely unknown path", () => {
    renderRouterAt("/this-does-not-exist");
    expect(screen.queryByTestId("known-page")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("404");
  });

  it("shows the 404 page for a path with a leading unknown segment", () => {
    renderRouterAt("/unknown/nested/path");
    expect(screen.queryByTestId("known-page")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("404");
  });

  it("shows known page for the exact root path /", () => {
    renderRouterAt("/");
    expect(screen.getByTestId("known-page")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "404" })).toBeNull();
  });

  it("shows known page for /kontakt", () => {
    renderRouterAt("/kontakt");
    expect(screen.getByTestId("known-page")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "404" })).toBeNull();
  });
});

// ── Near-miss paths ──────────────────────────────────────────────────────────

describe("Router catch-all – near-miss paths reach 404", () => {
  const nearMissPaths = [
    "/kontaktt",          // extra letter
    "/karpaltunnnel",     // typo
    "/schnappfingger",    // doubled letter
    "/impressumm",        // typo
    "/arzt-finde",        // truncated
    "/quote-typo",        // completely unrelated guess
  ];

  nearMissPaths.forEach((path) => {
    it(`shows 404 for near-miss path "${path}"`, () => {
      renderRouterAt(path);
      expect(screen.queryByTestId("known-page")).toBeNull();
      expect(
        screen.getByRole("heading", { level: 1 })
      ).toHaveTextContent("404");
    });
  });
});
