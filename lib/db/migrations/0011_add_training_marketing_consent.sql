ALTER TABLE training_registrations
  ADD COLUMN IF NOT EXISTS marketing_consent boolean NOT NULL DEFAULT false;