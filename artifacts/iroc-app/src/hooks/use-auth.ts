import { useState, useEffect, useCallback } from "react";
import { resetSyncStatus } from "@/lib/sync-session";

// Simple global event emitter for cross-component state sync without Context
const listeners = new Set<() => void>();

let currentToken = localStorage.getItem("iroc_token");
let currentUsername = localStorage.getItem("iroc_username");

export const SESSION_EXPIRED_STORAGE_KEY = "iroc_session_expired";

// A page can have several requests in flight when a token expires. Only the
// first 401 should initiate the redirect and session-expired message.
let sessionExpirationHandled = false;

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Clear an expired session and report whether this call handled it first.
 * Keeping this in the auth module ensures hook consumers and API helpers use
 * the same in-memory state as well as the same localStorage values.
 */
export function expireAuthSession(): boolean {
  if (sessionExpirationHandled) return false;
  sessionExpirationHandled = true;

  localStorage.removeItem("iroc_token");
  localStorage.removeItem("iroc_username");
  localStorage.setItem(SESSION_EXPIRED_STORAGE_KEY, "1");
  currentToken = null;
  currentUsername = null;
  resetSyncStatus();
  emitChange();
  return true;
}

export function consumeSessionExpiredMessage(): boolean {
  const expired = localStorage.getItem(SESSION_EXPIRED_STORAGE_KEY) === "1";
  if (expired) {
    localStorage.removeItem(SESSION_EXPIRED_STORAGE_KEY);
  }
  return expired;
}

export function useAuth() {
  const [token, setToken] = useState(currentToken);
  const [username, setUsername] = useState(currentUsername);

  useEffect(() => {
    const handleSync = () => {
      setToken(currentToken);
      setUsername(currentUsername);
    };
    listeners.add(handleSync);
    return () => {
      listeners.delete(handleSync);
    };
  }, []);

  const setAuth = useCallback((newToken: string, newUsername: string) => {
    localStorage.setItem("iroc_token", newToken);
    localStorage.setItem("iroc_username", newUsername);
    localStorage.removeItem(SESSION_EXPIRED_STORAGE_KEY);
    currentToken = newToken;
    currentUsername = newUsername;
    sessionExpirationHandled = false;
    emitChange();
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("iroc_token");
    localStorage.removeItem("iroc_username");
    localStorage.removeItem(SESSION_EXPIRED_STORAGE_KEY);
    currentToken = null;
    currentUsername = null;
    sessionExpirationHandled = false;
    // Reset the sync-status flag so the next login session fires the
    // auto-promote sync again (without requiring a full page reload).
    resetSyncStatus();
    emitChange();
  }, []);

  return { token, username, setAuth, logout };
}
