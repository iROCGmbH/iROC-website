-- Migration: add empty_at to iroc_inventory_lots
-- Tracks when a lot first reaches zero stock; cleared if stock is replenished.
ALTER TABLE iroc_inventory_lots
  ADD COLUMN IF NOT EXISTS empty_at TIMESTAMP;
