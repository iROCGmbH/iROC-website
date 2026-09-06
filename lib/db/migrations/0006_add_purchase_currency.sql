-- Persist the currency the purchase price was entered in, plus the raw
-- (pre-discount, pre-conversion) amount, so the Edit Product form can
-- restore the user's original input. purchase_price remains the converted
-- effective EUR cost everywhere.
ALTER TABLE iroc_products
  ADD COLUMN IF NOT EXISTS purchase_currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS purchase_raw_price numeric(12, 2);
