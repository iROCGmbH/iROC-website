/**
 * Shared admin authentication middleware.
 * Accepts a Replit Auth session, the raw ADMIN_PASSWORD bearer token, or a
 * valid iROC app JWT.
 * Import this instead of defining a local requireAdmin in each route file.
 */
import crypto from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { verifyToken } from "./iroc.js";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "iroc-admin-2024";
const SESSION_SECRET = process.env.SESSION_SECRET ?? "iroc-fallback-secret";
const ADMIN_ACTOR_MAX_LENGTH = 100;
const PASSWORD_ADMIN_TOKEN_TTL_SECONDS = 8 * 60 * 60;

export type AdminAuthContext = {
  actor: string;
  method: "password" | "jwt" | "replit";
};

function normalizeNamedActor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (
    !normalized
    || normalized.length > ADMIN_ACTOR_MAX_LENGTH
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function signNamedPasswordToken(actor: string): string {
  const data = Buffer.from(JSON.stringify({
    authMethod: "password",
    actor,
    exp: Math.floor(Date.now() / 1000) + PASSWORD_ADMIN_TOKEN_TTL_SECONDS,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
  return `${data}.${signature}`;
}

function verifyNamedPasswordToken(token: string): string | null {
  try {
    const [data, signature] = token.split(".");
    if (!data || !signature) return null;
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
    if (signature !== expected) return null;

    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as {
      authMethod?: unknown;
      actor?: unknown;
      exp?: unknown;
    };
    if (
      payload.authMethod !== "password"
      || typeof payload.exp !== "number"
      || Math.floor(Date.now() / 1000) >= payload.exp
    ) {
      return null;
    }
    return normalizeNamedActor(payload.actor);
  } catch {
    return null;
  }
}

export function getAdminAuthContext(req: Request): AdminAuthContext | null {
  const auth = req.headers.authorization;

  // The legacy shared password remains valid, but has no individual identity.
  if (auth === `Bearer ${ADMIN_PASSWORD}`) {
    return { actor: "admin", method: "password" };
  }

  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    const namedPasswordActor = verifyNamedPasswordToken(token);
    if (namedPasswordActor) {
      return { actor: `password:${namedPasswordActor}`, method: "password" };
    }

    const jwt = verifyToken(token);
    if (jwt) {
      const username = normalizeNamedActor(jwt.username);
      if (username) return { actor: `iroc:${username}`, method: "jwt" };
    }
  }

  // Replit Auth adds this method to the request when its middleware is active.
  if ("isAuthenticated" in req && typeof req.isAuthenticated === "function") {
    if (req.isAuthenticated()) return { actor: "admin", method: "replit" };
  }

  return null;
}

export function isAdminAuthenticated(req: Request): boolean {
  return getAdminAuthContext(req) !== null;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (isAdminAuthenticated(req)) { next(); return; }
  res.status(401).json({ error: "Unauthorized" });
}

async function namedAdminLogin(req: Request, res: Response): Promise<void> {
  const body = req.body as {
    actor?: unknown;
    name?: unknown;
    username?: unknown;
    password?: unknown;
  } | undefined;
  const password = body?.password;
  const actorInput = body?.actor ?? body?.name ?? body?.username;
  const actor = normalizeNamedActor(actorInput);

  if (typeof password !== "string" || password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  if (!actor) {
    res.status(400).json({ error: "A valid administrator name is required" });
    return;
  }

  // The token contains only the normalized actor label and an expiry. The
  // shared password is never returned or persisted in the audit trail.
  res.json({
    token: signNamedPasswordToken(actor),
    actor: `password:${actor}`,
  });
}

export const adminAuthRouter = Router();
adminAuthRouter.post(["/admin/login", "/admin/auth/login"], namedAdminLogin);
