/**
 * Tracks whether the auto-promote sync-status call has fired for the current
 * login session.  Lives in its own module so both App.tsx (which sets/checks
 * the flag) and use-auth.ts (which resets it on logout) can import it without
 * creating a circular dependency.
 */
let syncStatusFired = false;

export function isSyncStatusFired(): boolean {
  return syncStatusFired;
}

export function markSyncStatusFired(): void {
  syncStatusFired = true;
}

/** Reset when the admin logs out so the very next login re-runs the sync. */
export function resetSyncStatus(): void {
  syncStatusFired = false;
}

/** Only for use in tests. */
export function _resetSyncStatusFiredForTesting(): void {
  syncStatusFired = false;
}
