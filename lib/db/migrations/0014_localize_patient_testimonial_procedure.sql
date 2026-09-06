-- Procedure/category labels are public-facing text and must be available in
-- both patient-site languages. Preserve any existing label while editors add
-- an English translation.
ALTER TABLE patient_testimonials
  ADD COLUMN IF NOT EXISTS procedure_de text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS procedure_en text NOT NULL DEFAULT '';

UPDATE patient_testimonials
  SET procedure_de = procedure,
      procedure_en = procedure
  WHERE procedure_de = ''
    AND procedure_en = '';

ALTER TABLE patient_testimonials
  DROP COLUMN IF EXISTS procedure;