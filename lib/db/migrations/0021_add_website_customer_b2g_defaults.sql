ALTER TABLE website_customers
  ADD COLUMN IF NOT EXISTS is_public_authority boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_buyer_reference text;

COMMENT ON COLUMN website_customers.is_public_authority IS 'Whether the customer is a public authority and may require B2G invoice handling';
COMMENT ON COLUMN website_customers.default_buyer_reference IS 'Default EN 16931 BT-10 buyer reference for this customer';