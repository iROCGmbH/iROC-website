-- Preserve the lead details used in the issued offer so re-downloads do not
-- change when an administrator later edits the lead.
ALTER TABLE iroc_training_offers
  ADD COLUMN IF NOT EXISTS customer_snapshot text;