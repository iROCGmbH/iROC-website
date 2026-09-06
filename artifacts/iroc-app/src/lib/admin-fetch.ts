/**
 * Shared fetch helper for admin API calls from the iROC app.
 * Automatically attaches the iROC JWT token (which requireAdmin now accepts).
 */

import { expireAuthSession } from "@/hooks/use-auth";

export function adminHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/** API calls always go to the root-level API server, never relative to the app base path. */
export function adminUrl(path: string): string {
  return path;
}

function redirectToLogin(): void {
  const basePath = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';
  const loginPath = basePath ? `${basePath}/login` : '/login';

  // Use the browser history so the running SPA can switch routes without a
  // full reload. The login page will consume the session-expired message that
  // expireAuthSession stored before this navigation.
  if (window.location.pathname !== loginPath) {
    window.history.replaceState(null, '', loginPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

function handleUnauthorized(res: Response): void {
  if (res.status === 401 && expireAuthSession()) {
    redirectToLogin();
  }
}

/**
 * Make an admin request and apply the shared expired-session behavior.
 *
 * Callers that need endpoint-specific status codes, response bodies, or
 * binary data can use the returned Response directly. The higher-level
 * helpers below use this same function.
 */
export async function adminRequest(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(adminUrl(path), { ...init, headers });
  handleUnauthorized(res);
  return res;
}

export async function adminGet<T>(path: string, token: string): Promise<T> {
  const res = await adminRequest(path, token);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function adminPost<T>(
  path: string,
  token: string,
  body: unknown,
  options?: { signal?: AbortSignal },
): Promise<T> {
  const res = await adminRequest(path, token, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify(body),
    signal: options?.signal,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json() as { error?: string };
      if (typeof data?.error === 'string' && data.error.trim()) message = data.error;
    } catch { /* keep status-text fallback */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export async function adminDelete(path: string, token: string): Promise<void> {
  const res = await adminRequest(path, token, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json() as { error?: string };
      if (typeof data?.error === 'string' && data.error.trim()) message = data.error;
    } catch { /* keep status-text fallback */ }
    throw new Error(message);
  }
}

export async function adminPatch<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await adminRequest(path, token, {
    method: 'PATCH',
    headers: adminHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json() as { error?: string };
      if (typeof data?.error === 'string' && data.error.trim()) message = data.error;
    } catch { /* keep status-text fallback */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export async function adminPut<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await adminRequest(path, token, {
    method: 'PUT',
    headers: adminHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json() as { error?: string };
      if (typeof data?.error === 'string' && data.error.trim()) message = data.error;
    } catch { /* ignore — keep status-text fallback */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}
