import type { Request } from "express";

/**
 * Canonical public base URL for links embedded in emails.
 *
 * SECURITY: never derive this from Host / X-Forwarded-Host request headers —
 * they are client-controlled, and an attacker could redirect approval links
 * (which carry bearer tokens) to their own host. REPLIT_DOMAINS is set by the
 * platform to the app's own domain both in development and in deployments.
 */
export function publicBaseUrl(_req?: Request): string {
  const domain = (process.env.REPLIT_DOMAINS ?? "").split(",")[0].trim();
  if (!domain) {
    throw new Error("REPLIT_DOMAINS is not set; cannot build public URLs for emails");
  }
  return `https://${domain}`;
}
