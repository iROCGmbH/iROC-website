ALTER TABLE iroc_invoices
  ADD COLUMN IF NOT EXISTS buyer_reference text,
  ADD COLUMN IF NOT EXISTS seller_vat_id text,
  ADD COLUMN IF NOT EXISTS buyer_vat_id text,
  ADD COLUMN IF NOT EXISTS payment_terms text;

ALTER TABLE iroc_invoice_items
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5, 2);

COMMENT ON COLUMN iroc_invoices.buyer_reference IS 'EN 16931 BT-10 buyer reference, including Leitweg-ID where applicable';
COMMENT ON COLUMN iroc_invoice_items.vat_rate IS 'Per-line VAT percentage; null preserves the legacy invoice-level VAT rate';