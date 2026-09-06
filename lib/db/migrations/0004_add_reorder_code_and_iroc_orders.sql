-- Reorder code on website customers (printed on invoices, used for reorders)
ALTER TABLE website_customers ADD COLUMN IF NOT EXISTS reorder_code text;
CREATE UNIQUE INDEX IF NOT EXISTS website_customers_reorder_code_unique
  ON website_customers (reorder_code) WHERE reorder_code IS NOT NULL;

-- Backfill codes for existing customers (unambiguous alphabet, 8 chars)
UPDATE website_customers wc
SET reorder_code = (
  SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (floor(random()*32))::int + 1, 1), '')
  FROM generate_series(1,8) g
  WHERE wc.id IS NOT NULL
)
WHERE reorder_code IS NULL;

-- Website orders with email approval flow
CREATE TABLE IF NOT EXISTS iroc_orders (
  id                  serial PRIMARY KEY,
  website_customer_id integer REFERENCES website_customers(id) ON DELETE SET NULL,
  customer_type       text NOT NULL,
  customer_nr         text,
  company_name        text,
  contact_name        text,
  contact_email       text NOT NULL,
  contact_phone       text,
  instrument          text NOT NULL,
  products            text,
  delivery_address    text,
  notes               text,
  approval_token      text NOT NULL UNIQUE,
  status              text NOT NULL DEFAULT 'pending',
  approved_at         timestamp,
  created_at          timestamp NOT NULL DEFAULT now()
);
