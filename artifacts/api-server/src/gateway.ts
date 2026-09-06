import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import {
  runWithDatabaseScope,
  type DatabaseScope,
} from "@workspace/db";

export type GatewaySite = "iroc-website" | "spirecut-patient" | "iroc-portal" | "iroc-app";

export interface GatewayOptions {
  enabled?: boolean;
  trustedProxyCidrs?: string;
  assetsRoot?: string;
  interfaceAccessKey?: string;
  interfaceAllowedIps?: string;
}

const HOSTS: Record<string, GatewaySite> = {
  "i-roc.de": "iroc-website",
  "www.i-roc.de": "iroc-website",
  "spirecut.de": "spirecut-patient",
  "www.spirecut.de": "spirecut-patient",
  "spirecut.at": "spirecut-patient",
  "www.spirecut.at": "spirecut-patient",
  "doctors.i-roc.de": "iroc-portal",
  "patients.spirecut.de": "spirecut-patient",
  "patients.spirecut.at": "spirecut-patient",
  "internal.i-roc.de": "iroc-app",
};

const INTERNAL_PREFIXES = [
  "/iroc",
  "/admin",
  "/datev",
  "/expenses",
  "/tori",
  "/agent",
  "/gemini",
  "/sally",
  "/auth",
];

const PATIENT_ALIASES: Record<string, string> = {
  "/patients/social": "/patient-social",
  "/patients/media": "/patient-media",
  "/patients/testimonials": "/patient-testimonials",
  "/patients/postop": "/patient-postop",
  "/patients/postop/stats": "/patient-postop-stats",
  "/patients/postop/config": "/patient-postop-config",
};

const PATIENT_PATHS = new Set(Object.values(PATIENT_ALIASES));

function matchesPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function patientAliasTarget(pathname: string): string | undefined {
  const source = Object.keys(PATIENT_ALIASES).sort((a, b) => b.length - a.length)
    .find((alias) => matchesPath(pathname, alias));
  return source
    ? `${PATIENT_ALIASES[source]}${pathname.slice(source.length)}`
    : undefined;
}

function requestPath(req: Request): string {
  return req.path.startsWith("/api") ? req.path.slice(4) || "/" : req.path;
}

function isInternalPath(value: string): boolean {
  return value === "/internal" || value.startsWith("/internal/") ||
    INTERNAL_PREFIXES.some((prefix) => value === prefix || value.startsWith(`${prefix}/`));
}

function isSensitiveRequest(req: Request): boolean {
  const pathname = requestPath(req);
  if (matchesPath(pathname, "/storage")) {
    const publicRead = req.method === "GET" &&
      (matchesPath(pathname, "/storage/public-objects") ||
        matchesPath(pathname, "/storage/objects"));
    return !publicRead;
  }
  return isInternalPath(pathname);
}

function parseHost(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || !value || value.includes(",") || /[\s\x00-\x1f]/.test(value)) {
    return null;
  }
  try {
    const parsed = new URL(`http://${value}`);
    // URL parsing also rejects malformed ports; only a hostname[:port] is a Host value.
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return null;
    }
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostForRequest(req: Request): string | null {
  // Tenant selection is always the HTTP Host. Forwarded host is deliberately
  // ignored: it is client-controlled at the application boundary.
  return parseHost(req.headers.host);
}

function originAllowed(origin: string, enabled: boolean, requestHost?: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const canonical = parsed.protocol === "https:" && parsed.port === "" &&
      Boolean(HOSTS[parsed.hostname.toLowerCase()]);
    if (enabled) return canonical && parsed.hostname.toLowerCase() === requestHost;
    if (canonical) return true;
    const host = parsed.hostname.toLowerCase();
    // Local development and Replit previews are deliberately explicit rather
    // than reflecting arbitrary Origin headers.
    return host === "localhost" || host === "127.0.0.1" ||
      host === "::1" || host.endsWith(".replit.dev") || host.endsWith(".repl.co");
  } catch {
    return false;
  }
}

export function strictCors(enabled: boolean): RequestHandler {
  return (req, res, next): void => {
    const origin = req.get("origin");
    const requestHost = (req as Request & { gatewayHost?: string }).gatewayHost;
    if (origin && !originAllowed(origin, enabled, requestHost)) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    if (origin) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Access-Control-Allow-Credentials", "true");
      res.vary("Origin");
    }
    if (req.method === "OPTIONS") {
      const requestedHeaders = (req.get("access-control-request-headers") ?? "")
        .split(",")
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean);
      const allowedHeaders = new Set(["content-type", "authorization", "accept-language"]);
      if (requestedHeaders.some((header) => !allowedHeaders.has(header))) {
        res.status(403).json({ error: "CORS headers not allowed" });
        return;
      }
      res.set("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept-Language");
      res.sendStatus(204);
      return;
    }
    next();
  };
}

function keyMatches(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizedIp(value: string | undefined): string {
  return (value ?? "").replace(/^::ffff:/, "");
}

function splitPolicy(value: string | undefined): string[] {
  return (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function validIpOrCidr(value: string): boolean {
  const [address, prefix] = value.split("/");
  const family = net.isIP(address);
  if (!family || value.split("/").length > 2) return false;
  if (prefix === undefined) return true;
  return /^\d+$/.test(prefix) && Number(prefix) >= 0 && Number(prefix) <= (family === 4 ? 32 : 128);
}

export function hasValidIpPolicy(value: string | undefined): boolean {
  const entries = splitPolicy(value);
  return entries.length > 0 && entries.every(validIpOrCidr);
}

export function validateProductionGatewayConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment.MULTI_DOMAIN_GATEWAY_ENABLED !== "true") {
    throw new Error("MULTI_DOMAIN_GATEWAY_ENABLED=true is required in production.");
  }
  if (!environment.INTERFACE_ACCESS_KEY?.trim() &&
    !hasValidIpPolicy(environment.INTERFACE_ALLOWED_IPS)) {
    throw new Error("INTERFACE_ACCESS_KEY or a valid INTERFACE_ALLOWED_IPS policy is required in production.");
  }
}

function createIpPolicy(rules: string[]): net.BlockList {
  const blockList = new net.BlockList();
  for (const rule of rules) {
    const [address, rawPrefix] = rule.split("/");
    const type = net.isIP(address) === 4 ? "ipv4" : "ipv6";
    if (rawPrefix === undefined) {
      blockList.addAddress(address, type);
    } else {
      blockList.addSubnet(address, Number(rawPrefix), type);
    }
  }
  return blockList;
}

export function ipAllowedByPolicy(ip: string, policy: string | undefined): boolean {
  const normalized = normalizedIp(ip);
  const family = net.isIP(normalized);
  const rules = splitPolicy(policy);
  if (family === 0 || rules.length === 0 || !rules.every(validIpOrCidr)) return false;
  return createIpPolicy(rules).check(normalized, family === 4 ? "ipv4" : "ipv6");
}

/** This is intentionally installed before parsers and the API router. */
export function internalPerimeter(options: GatewayOptions): RequestHandler {
  const allowedIps = splitPolicy(options.interfaceAllowedIps).filter(validIpOrCidr);
  const ipPolicy = createIpPolicy(allowedIps);
  return (req: Request, res: Response, next: NextFunction): void => {
    const supplied = req.get("x-interface-access-key");
    const remoteIp = normalizedIp(options.trustedProxyCidrs ? req.ip : req.socket.remoteAddress);
    const internalSite = (req as Request & { gatewaySite?: GatewaySite }).gatewaySite === "iroc-app";
    if (!internalSite && !isSensitiveRequest(req)) {
      next();
      return;
    }
    const ipFamily = net.isIP(remoteIp);
    if (keyMatches(supplied, options.interfaceAccessKey) ||
      (ipFamily !== 0 && ipPolicy.check(remoteIp, ipFamily === 4 ? "ipv4" : "ipv6"))) {
      next();
      return;
    }
    // Never distinguish a missing key, incorrect key, or disallowed address.
    res.status(403).json({ error: "Forbidden" });
  };
}

function rewriteAliases(req: Request, _res: Response, next: NextFunction): void {
  const current = requestPath(req);
  let target: string | undefined;
  const site = (req as Request & { gatewaySite?: GatewaySite }).gatewaySite;
  if (site === "iroc-portal" && (current === "/doctors" || current.startsWith("/doctors/"))) {
    target = `/portal${current.slice("/doctors".length)}`;
  } else if (current === "/internal" || current.startsWith("/internal/")) {
    target = current.slice("/internal".length) || "/";
  } else {
    target = patientAliasTarget(current);
  }
  if (target) {
    const queryIndex = req.url.indexOf("?");
    const query = queryIndex === -1 ? "" : req.url.slice(queryIndex);
    req.url = `/api${target}${query}`;
  }
  next();
}

const DATABASE_SCOPES: Record<GatewaySite, DatabaseScope> = {
  "iroc-website": "public",
  "spirecut-patient": "patients",
  "iroc-portal": "doctors",
  "iroc-app": "internal",
};

function gatewayHostResolution(options: GatewayOptions): RequestHandler {
  return (req, res, next): void => {
    const host = hostForRequest(req);
    const site = host ? HOSTS[host] : undefined;
    if (!site) {
      res.status(421).json({ error: "Unknown host" });
      return;
    }
    (req as Request & { gatewaySite?: GatewaySite }).gatewaySite = site;
    (req as Request & { gatewayHost?: string }).gatewayHost = host!;
    // This keeps every downstream asynchronous route operation in the role
    // selected by the canonical host, without requiring route changes.
    runWithDatabaseScope(DATABASE_SCOPES[site])(req, res, next);
  };
}

function gatewayApiPolicy(): RequestHandler {
  return (req, res, next): void => {
    const site = (req as Request & { gatewaySite?: GatewaySite }).gatewaySite;
    if (!site) {
      res.status(421).json({ error: "Unknown host" });
      return;
    }
    if (!req.path.startsWith("/api")) {
      next();
      return;
    }
    const apiPath = requestPath(req);
    const isPortal = apiPath === "/portal" || apiPath.startsWith("/portal/") ||
      apiPath === "/doctors" || apiPath.startsWith("/doctors/");
    const patientOnly = [...PATIENT_PATHS].some((prefix) => matchesPath(apiPath, prefix)) ||
      Boolean(patientAliasTarget(apiPath)) ||
      matchesPath(apiPath, "/content/spirecut") || matchesPath(apiPath, "/doctors") ||
      matchesPath(apiPath, "/patient-settings") || matchesPath(apiPath, "/geocode-postal");
    const isPatient = patientOnly || matchesPath(apiPath, "/contact");
    const portalSharedRead = req.method === "GET" &&
      (matchesPath(apiPath, "/lookup-postal") || matchesPath(apiPath, "/website-settings"));
    const websiteRead = req.method === "GET" && [
      "/content/iroc",
      "/lookup-institution",
      "/lookup-postal",
      "/lookup-vat",
      "/certified-doctors",
      "/product-groups-public",
      "/products-public",
      "/website-settings",
      "/events",
      "/team",
      "/resources",
      "/storage/public-objects",
      "/storage/objects",
      "/healthz",
    ].some((prefix) => matchesPath(apiPath, prefix));
    const websiteWrite = req.method === "POST" && [
      "/contact",
      "/orders",
      "/training/register",
    ].some((prefix) => matchesPath(apiPath, prefix));
    const permitted = site === "iroc-portal" ? isPortal || portalSharedRead :
      site === "spirecut-patient" ? isPatient :
      site === "iroc-app" ? true :
      (websiteRead || websiteWrite) && !isInternalPath(apiPath) && !isPortal && !patientOnly;
    if (!permitted) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    next();
  };
}

export function installGateway(app: express.Express, options: GatewayOptions): void {
  const enabled = Boolean(options.enabled);
  if (!enabled) {
    app.use(strictCors(false));
    return;
  }

  const trustedProxyCidrs = hasValidIpPolicy(options.trustedProxyCidrs)
    ? splitPolicy(options.trustedProxyCidrs)
    : [];
  app.set("trust proxy", trustedProxyCidrs);
  const resolvedOptions = { ...options, trustedProxyCidrs: trustedProxyCidrs.join(",") };
  app.use(gatewayHostResolution(resolvedOptions));
  app.use(internalPerimeter(resolvedOptions));
  // Tenant and perimeter checks must precede CORS preflights too.
  app.use(strictCors(true));
  app.use(gatewayApiPolicy());
  app.use(rewriteAliases);
}

export function installSpaFallback(app: express.Express, options: GatewayOptions): void {
  if (!options.enabled) return;
  const workspaceAssets = path.resolve(process.cwd(), "artifacts");
  const assetsRoot = options.assetsRoot ??
    (fs.existsSync(workspaceAssets) ? workspaceAssets : path.resolve(process.cwd(), ".."));
  app.use((req, res, next): void => {
    if (req.path.startsWith("/api")) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const site = (req as Request & { gatewaySite?: GatewaySite }).gatewaySite;
    if (!site) {
      res.status(421).json({ error: "Unknown host" });
      return;
    }
    const distRoot = path.resolve(assetsRoot, site, "dist");
    // The web artifacts are built as dist/public. Retain dist as a small
    // compatibility fallback for deployments that use a flat static build.
    const publicRoot = path.join(distRoot, "public");
    const root = fs.existsSync(publicRoot) ? publicRoot : distRoot;
    if (!fs.existsSync(root)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    express.static(root, {
      index: false,
      setHeaders(response, filePath) {
        response.setHeader(
          "Cache-Control",
          /[-.][a-f0-9]{8,}\./i.test(path.basename(filePath))
            ? "public, max-age=31536000, immutable"
            : "public, max-age=3600",
        );
      },
    })(req, res, () => {
      res.set("Cache-Control", "no-cache");
      res.sendFile(path.join(root, "index.html"), (error) => {
        if (error) next(error);
      });
    });
  });
}