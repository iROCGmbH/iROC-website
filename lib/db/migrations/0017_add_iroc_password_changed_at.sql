ALTER TABLE "iroc_app_users"
  ADD COLUMN IF NOT EXISTS "password_changed_at" timestamp;