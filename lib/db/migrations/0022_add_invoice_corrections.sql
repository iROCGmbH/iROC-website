ALTER TABLE iroc_invoices
  ADD COLUMN IF NOT EXISTS correction_of_invoice_id integer REFERENCES iroc_invoices(id),
  ADD COLUMN IF NOT EXISTS correction_reason text,
  ADD COLUMN IF NOT EXISTS original_invoice_number text,
  ADD COLUMN IF NOT EXISTS original_invoice_date text,
  ADD COLUMN IF NOT EXISTS customer_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS inventory_restored_at timestamp;

ALTER TABLE iroc_invoice_items
  ADD COLUMN IF NOT EXISTS correction_source_item_id integer REFERENCES iroc_invoice_items(id);

CREATE INDEX IF NOT EXISTS iroc_invoices_correction_of_invoice_id_idx
  ON iroc_invoices (correction_of_invoice_id);
CREATE INDEX IF NOT EXISTS iroc_invoice_items_correction_source_item_id_idx
  ON iroc_invoice_items (correction_source_item_id);

COMMENT ON COLUMN iroc_invoices.correction_of_invoice_id IS
  'Original finalized invoice corrected by this separately numbered Rechnungskorrektur';
COMMENT ON COLUMN iroc_invoices.inventory_restored_at IS
  'Exactly-once returned inventory restoration marker';