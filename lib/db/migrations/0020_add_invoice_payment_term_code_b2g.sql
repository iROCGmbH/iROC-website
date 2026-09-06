ALTER TABLE iroc_invoices
  ADD COLUMN IF NOT EXISTS payment_term_code text,
  ADD COLUMN IF NOT EXISTS is_b2g boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN iroc_invoices.payment_term_code IS 'Stable invoice payment term code; legacy localized text remains in payment_terms';
COMMENT ON COLUMN iroc_invoices.is_b2g IS 'Whether the invoice is a public-sector B2G invoice requiring BT-10 buyer reference';