import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { getDatabaseScope } from "@workspace/db";
import {
  installGateway,
  installSpaFallback,
  ipAllowedByPolicy,
  strictCors,
  type GatewayOptions,
  validateProductionGatewayConfiguration,
} from "./gateway";

const temporaryDirectories: string[] = [];

function gatewayApp(options: GatewayOptions = {}): express.Express {
  const app = express();
  installGateway(app, { enabled: true, ...options });
  app.use("/api", (req, res, next) => {
    if (req.path === "/not-a-route") {
      next();
      return;
    }
    res.json({ path: req.path, scope: getDatabaseScope() });
  });
  installSpaFallback(app, { enabled: true, ...options });
  return app;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("multi-domain gateway", () => {
  it("matches complete IPv4 and IPv6 interface CIDR policies", () => {
    expect(ipAllowedByPolicy("203.0.113.44", "203.0.113.0/24")).toBe(true);
    expect(ipAllowedByPolicy("2001:db8:abcd::42", "2001:db8:abcd::/48")).toBe(true);
    expect(ipAllowedByPolicy("2001:db8:ffff::42", "2001:db8:abcd::/48")).toBe(false);
  });

  it("fails closed for incomplete production gateway configuration", () => {
    expect(() => validateProductionGatewayConfiguration({
      MULTI_DOMAIN_GATEWAY_ENABLED: "false",
      INTERFACE_ACCESS_KEY: "present",
    })).toThrow(/MULTI_DOMAIN_GATEWAY_ENABLED/);
    expect(() => validateProductionGatewayConfiguration({
      MULTI_DOMAIN_GATEWAY_ENABLED: "true",
      INTERFACE_ALLOWED_IPS: "not-an-ip",
    })).toThrow(/INTERFACE_ACCESS_KEY/);
    expect(() => validateProductionGatewayConfiguration({
      MULTI_DOMAIN_GATEWAY_ENABLED: "true",
      INTERFACE_ALLOWED_IPS: "203.0.113.0/24",
    })).not.toThrow();
  });

  it("maps only canonical hosts and enforces API classes", async () => {
    const app = gatewayApp({ interfaceAccessKey: "test-key" });
    await request(app).get("/api/doctors/me").set("Host", "doctors.i-roc.de")
      .expect(200).expect({ path: "/portal/me", scope: "doctors" });
    await request(app).get("/api/patients/social").set("Host", "patients.spirecut.at")
      .expect(200).expect({ path: "/patient-social", scope: "patients" });
    await request(app).get("/api/portal/me").set("Host", "patients.spirecut.de")
      .expect(404);
    await request(app).get("/api/healthz").set("Host", "unapproved.example")
      .expect(421);
    await request(app).get("/api/healthz").set("Host", "i-roc.de")
      .expect(200).expect({ path: "/healthz", scope: "public" });
    await request(app).get("/api/health").set("Host", "i-roc.de")
      .expect(404);
  });

  it("ignores forwarded hosts without configured hops and rejects malformed values", async () => {
    const app = gatewayApp();
    await request(app).get("/api/healthz")
      .set("Host", "unapproved.example")
      .set("X-Forwarded-Host", "i-roc.de")
      .expect(421);
    await request(app).get("/api/healthz")
      .set("Host", "i-roc.de")
      .set("X-Forwarded-Host", "patients.spirecut.de, evil.example")
      .expect(200);
    const proxied = gatewayApp({ trustedProxyCidrs: "10.0.0.0/8" });
    await request(proxied).get("/api/healthz")
      .set("Host", "unapproved.example")
      .set("X-Forwarded-Host", "i-roc.de")
      .expect(421);
    const ipProtected = gatewayApp({
      interfaceAllowedIps: "203.0.113.12",
      trustedProxyCidrs: "10.0.0.0/8",
    });
    await request(ipProtected).get("/api/healthz")
      .set("Host", "internal.i-roc.de")
      .set("X-Forwarded-For", "203.0.113.12")
      .expect(403);
  });

  it("uses an allowlist instead of reflecting arbitrary CORS origins", async () => {
    const app = gatewayApp();
    const allowed = await request(app).get("/api/patients/social")
      .set("Host", "patients.spirecut.de")
      .set("Origin", "https://patients.spirecut.de");
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://patients.spirecut.de");
    const denied = await request(app).get("/api/patients/social")
      .set("Host", "patients.spirecut.de")
      .set("Origin", "https://evil.example");
    expect(denied.status).toBe(403);
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    await request(app).get("/api/healthz").set("Host", "i-roc.de")
      .set("Origin", "https://spirecut.de").expect(403);
  });

  it("accepts only canonical production origins and fixed preflight headers", async () => {
    const app = gatewayApp();
    await request(app).get("/api/health").set("Host", "i-roc.de")
      .set("Origin", "https://i-roc.de:444").expect(403);
    await request(app).options("/api/healthz").set("Host", "i-roc.de")
      .set("Origin", "https://i-roc.de")
      .set("Access-Control-Request-Headers", "Content-Type, X-Custom")
      .expect(403);
    await request(app).options("/api/healthz").set("Host", "i-roc.de")
      .set("Origin", "https://i-roc.de")
      .set("Access-Control-Request-Headers", "Content-Type, Authorization, Accept-Language")
      .expect(204)
      .expect("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept-Language");

    const development = express();
    development.use(strictCors(false));
    development.get("/", (_req, res) => res.sendStatus(204));
    await request(development).get("/").set("Origin", "https://patients.spirecut.de")
      .expect(204).expect("Access-Control-Allow-Origin", "https://patients.spirecut.de");
    await request(development).get("/").set("Origin", "http://localhost:5173")
      .expect(204).expect("Access-Control-Allow-Origin", "http://localhost:5173");
  });

  it("gates direct and aliased internal routes before route handlers", async () => {
    const app = gatewayApp({ interfaceAccessKey: "test-key" });
    await request(app).get("/api/admin/verify").set("Host", "internal.i-roc.de")
      .expect(403);
    await request(app).get("/api/admin/verify").set("Host", "i-roc.de")
      .expect(403);
    await request(app).get("/api/internal/dashboard").set("Host", "internal.i-roc.de")
      .set("X-Interface-Access-Key", "test-key")
      .expect(200).expect({ path: "/dashboard", scope: "internal" });
    await request(app).get("/api/healthz").set("Host", "internal.i-roc.de")
      .expect(403);
    await request(app).options("/api/healthz").set("Host", "internal.i-roc.de")
      .set("Origin", "https://internal.i-roc.de")
      .expect(403);
  });

  it("serves a site's SPA only after API handling", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-"));
    temporaryDirectories.push(root);
    fs.mkdirSync(path.join(root, "iroc-website", "dist"), { recursive: true });
    fs.writeFileSync(path.join(root, "iroc-website", "dist", "index.html"), "website SPA");
    const app = gatewayApp({ assetsRoot: root });
    await request(app).get("/nested/client/route").set("Host", "i-roc.de")
      .expect(200).expect("website SPA");
    await request(app).get("/nested/client/route").set("Host", "internal.i-roc.de")
      .expect(403);
    await request(app).get("/api/not-a-route").set("Host", "i-roc.de")
      .expect(404).expect({ error: "Not found" });
  });

  it("permits the patient application's public API set, but not portal routes", async () => {
    const app = gatewayApp();
    await request(app).get("/api/content/spirecut").set("Host", "spirecut.de")
      .expect(200).expect({ path: "/content/spirecut", scope: "patients" });
    await request(app).get("/api/doctors?instrument=spirecut").set("Host", "spirecut.de")
      .expect(200).expect({ path: "/doctors", scope: "patients" });
    await request(app).get("/api/portal/me").set("Host", "spirecut.de")
      .expect(404);
  });

  it("preserves nested patient aliases and host-specific shared reads", async () => {
    const app = gatewayApp();
    await request(app).get("/api/patients/postop/stats/detail").set("Host", "spirecut.at")
      .expect(200).expect({ path: "/patient-postop-stats/detail", scope: "patients" });
    await request(app).get("/api/lookup-postal").set("Host", "doctors.i-roc.de")
      .expect(200).expect({ path: "/lookup-postal", scope: "doctors" });
    await request(app).get("/api/website-settings").set("Host", "doctors.i-roc.de")
      .expect(200).expect({ path: "/website-settings", scope: "doctors" });
    await request(app).post("/api/storage/uploads/request-url").set("Host", "i-roc.de")
      .expect(403);
    await request(app).get("/api/storage/public-objects/image.jpg").set("Host", "i-roc.de")
      .expect(200).expect({ path: "/storage/public-objects/image.jpg", scope: "public" });
    await request(app).get("/api/storage/objects/manual.pdf").set("Host", "i-roc.de")
      .expect(200).expect({ path: "/storage/objects/manual.pdf", scope: "public" });
    await request(app).delete("/api/storage/objects/manual.pdf").set("Host", "i-roc.de")
      .expect(403);
    await request(app).post("/api/contact").set("Host", "i-roc.de")
      .expect(200).expect({ path: "/contact", scope: "public" });
  });
});