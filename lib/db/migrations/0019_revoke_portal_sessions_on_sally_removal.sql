-- Invalidate portal JWTs issued before a Sally certification is removed.
-- The API compares this timestamp with the token's iat claim, so revocation
-- remains effective across process restarts and multiple API instances.
ALTER TABLE sally_certified_doctors
  ADD COLUMN IF NOT EXISTS portal_sessions_revoked_at timestamp with time zone;