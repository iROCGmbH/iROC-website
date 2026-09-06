ALTER TABLE website_customers
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS house_number text,
  ADD COLUMN IF NOT EXISTS shipping_street text,
  ADD COLUMN IF NOT EXISTS shipping_house_number text;

ALTER TABLE training_registrations
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS house_number text;

ALTER TABLE iroc_customers
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS house_number text;

ALTER TABLE iroc_leads
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS house_number text;

ALTER TABLE iroc_invoices
  ADD COLUMN IF NOT EXISTS insurance_costs numeric(12, 2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS iroc_order_shipments (
  id serial PRIMARY KEY,
  order_id integer NOT NULL UNIQUE REFERENCES iroc_orders(id) ON DELETE CASCADE,
  invoice_id integer REFERENCES iroc_invoices(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'created',
  carrier text,
  service_code text,
  tracking_number text,
  label_url text,
  sendcloud_shipment_id text UNIQUE,
  quote_snapshot text NOT NULL,
  parcel_count integer NOT NULL DEFAULT 1,
  weight_kg numeric(8, 3) NOT NULL,
  length_cm numeric(8, 2),
  width_cm numeric(8, 2),
  height_cm numeric(8, 2),
  delivery_costs numeric(12, 2) NOT NULL DEFAULT 0,
  insurance_costs numeric(12, 2) NOT NULL DEFAULT 0,
  insured_value numeric(12, 2) NOT NULL DEFAULT 0,
  pickup_scheduled_for timestamp,
  pickup_reference text,
  created_at timestamp NOT NULL DEFAULT now()
);