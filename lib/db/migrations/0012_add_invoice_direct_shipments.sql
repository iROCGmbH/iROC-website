-- A shipment can originate from either an approved website order or a manually
-- created draft invoice. Database uniqueness keeps either source from being
-- shipped twice, even if an administrator double-clicks the confirmation.
ALTER TABLE iroc_order_shipments
  ALTER COLUMN order_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS iroc_order_shipments_invoice_id_unique
  ON iroc_order_shipments (invoice_id)
  WHERE invoice_id IS NOT NULL;