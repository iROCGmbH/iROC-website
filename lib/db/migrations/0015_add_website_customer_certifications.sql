-- A doctor may be certified for more than one iROC product system. Keep the
-- legacy primary instrument for older integrations while storing the complete
-- set in a first-class array.
ALTER TABLE website_customers
  ADD COLUMN IF NOT EXISTS certifications text[];

UPDATE website_customers
SET certifications = CASE
  WHEN lower(btrim(instrument)) = 'both' THEN ARRAY['spirecut', 'ministem']
  ELSE ARRAY(
    SELECT DISTINCT btrim(value)
    FROM unnest(string_to_array(instrument, ',')) AS value
    WHERE btrim(value) <> ''
  )
END
WHERE certifications IS NULL OR cardinality(certifications) = 0;

ALTER TABLE website_customers
  ALTER COLUMN certifications SET DEFAULT ARRAY[]::text[],
  ALTER COLUMN certifications SET NOT NULL;

-- SQL defaults cannot reference another column. This trigger ensures that any
-- direct insert still starts with the legacy instrument as its certification.
CREATE OR REPLACE FUNCTION website_customers_default_certifications()
RETURNS trigger AS $$
BEGIN
  IF NEW.certifications IS NULL OR cardinality(NEW.certifications) = 0 THEN
    NEW.certifications := CASE
      WHEN lower(btrim(NEW.instrument)) = 'both' THEN ARRAY['spirecut', 'ministem']
      ELSE ARRAY(
        SELECT DISTINCT btrim(value)
        FROM unnest(string_to_array(NEW.instrument, ',')) AS value
        WHERE btrim(value) <> ''
      )
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS website_customers_default_certifications_trigger
  ON website_customers;

CREATE TRIGGER website_customers_default_certifications_trigger
BEFORE INSERT ON website_customers
FOR EACH ROW
EXECUTE FUNCTION website_customers_default_certifications();