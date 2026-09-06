CREATE TABLE IF NOT EXISTS iroc_customer_website_links (
  website_customer_id integer PRIMARY KEY REFERENCES website_customers(id) ON DELETE CASCADE,
  iroc_customer_id integer NOT NULL UNIQUE REFERENCES iroc_customers(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Backfill only email identities that occur exactly once in each customer table.
-- Ambiguous or missing emails remain unlinked for an administrator to resolve,
-- rather than risking invoices being assigned to the wrong customer.
WITH website_email_counts AS (
  SELECT lower(btrim(email)) AS email, count(*) AS count
  FROM website_customers
  WHERE btrim(email) <> ''
  GROUP BY lower(btrim(email))
),
legacy_email_counts AS (
  SELECT lower(btrim(email)) AS email, count(*) AS count
  FROM iroc_customers
  WHERE email IS NOT NULL AND btrim(email) <> ''
  GROUP BY lower(btrim(email))
),
unambiguous_matches AS (
  SELECT wc.id AS website_customer_id, ic.id AS iroc_customer_id
  FROM website_customers wc
  JOIN iroc_customers ic
    ON lower(btrim(wc.email)) = lower(btrim(ic.email))
  JOIN website_email_counts wec
    ON wec.email = lower(btrim(wc.email)) AND wec.count = 1
  JOIN legacy_email_counts lec
    ON lec.email = lower(btrim(ic.email)) AND lec.count = 1
)
INSERT INTO iroc_customer_website_links (website_customer_id, iroc_customer_id)
SELECT website_customer_id, iroc_customer_id
FROM unambiguous_matches
ON CONFLICT DO NOTHING;

UPDATE iroc_invoices invoice
SET website_customer_id = link.website_customer_id
FROM iroc_customer_website_links link
WHERE invoice.website_customer_id IS NULL
  AND invoice.customer_id = link.iroc_customer_id;