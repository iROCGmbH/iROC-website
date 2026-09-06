-- Immutable offer snapshots for the lead training-payment workflow.
-- This table is intentionally separate from invoices so sending an offer never
-- consumes an invoice number or creates an invoice draft.
CREATE TABLE IF NOT EXISTS iroc_training_offers (
  id serial PRIMARY KEY,
  lead_id integer NOT NULL REFERENCES iroc_leads(id) ON DELETE CASCADE,
  website_customer_id integer REFERENCES website_customers(id) ON DELETE SET NULL,
  invoice_type text NOT NULL,
  language text NOT NULL DEFAULT 'de',
  issue_date text NOT NULL,
  due_date text,
  training_date text,
  order_number text,
  reference_number text,
  shipping_method text,
  reason_for_export text,
  terms_of_delivery text,
  delivery_costs numeric(12, 2) NOT NULL DEFAULT 0,
  vat_rate numeric(5, 2) NOT NULL DEFAULT 0,
  notes text,
  vat_note text,
  items_snapshot text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  qualified_at timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS iroc_training_offers_lead_id_unique
  ON iroc_training_offers(lead_id);