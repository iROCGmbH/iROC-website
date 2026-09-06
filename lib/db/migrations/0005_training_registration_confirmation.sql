-- Email double-opt-in for training registrations
ALTER TABLE training_registrations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE training_registrations ADD COLUMN IF NOT EXISTS confirmation_token text UNIQUE;
ALTER TABLE training_registrations ADD COLUMN IF NOT EXISTS confirmed_at timestamp;

-- Registrations that existed before this feature are treated as confirmed
UPDATE training_registrations SET status = 'confirmed' WHERE confirmation_token IS NULL;
