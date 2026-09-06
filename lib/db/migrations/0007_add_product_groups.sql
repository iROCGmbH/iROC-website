-- Editable product groups. `key` matches iroc_products.category values.
CREATE TABLE IF NOT EXISTS iroc_product_groups (
  id serial PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name_en text NOT NULL,
  name_de text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_service boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Seed with the previously hardcoded groups.
INSERT INTO iroc_product_groups (key, name_en, name_de, sort_order, is_service) VALUES
  ('spirecut',  'Spirecut®',      'Spirecut®',          1, false),
  ('ministem',  'MiniStem®',      'MiniStem®',          2, false),
  ('other',     'Accessories',    'Zubehör',            3, false),
  ('services',  'Services',       'Dienstleistungen',   4, true)
ON CONFLICT (key) DO NOTHING;

-- Ensure every category value already used by products has a group row.
INSERT INTO iroc_product_groups (key, name_en, name_de, sort_order, is_service)
SELECT DISTINCT p.category, initcap(p.category), initcap(p.category), 99, false
FROM iroc_products p
WHERE p.category IS NOT NULL
ON CONFLICT (key) DO NOTHING;
