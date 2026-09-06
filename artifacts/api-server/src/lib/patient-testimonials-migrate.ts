import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Keeps the curated Spirecut testimonial schema available before API traffic
 * starts. This is intentionally idempotent: existing databases may still have
 * the original single-language `procedure` column, while new databases start
 * directly with the current bilingual shape.
 */
export async function runPatientTestimonialsMigrations(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS patient_testimonials (
        id serial PRIMARY KEY,
        title_de text NOT NULL,
        title_en text NOT NULL,
        description_de text NOT NULL DEFAULT '',
        description_en text NOT NULL DEFAULT '',
        patient_label text NOT NULL DEFAULT '',
        procedure_de text NOT NULL DEFAULT '',
        procedure_en text NOT NULL DEFAULT '',
        video_url text NOT NULL,
        display_order integer NOT NULL DEFAULT 0,
        published boolean NOT NULL DEFAULT false,
        created_at timestamp with time zone NOT NULL DEFAULT now(),
        updated_at timestamp with time zone NOT NULL DEFAULT now()
      );

      ALTER TABLE patient_testimonials
        ADD COLUMN IF NOT EXISTS procedure_de text NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS procedure_en text NOT NULL DEFAULT '';

      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'patient_testimonials'
            AND column_name = 'procedure'
        ) THEN
          UPDATE patient_testimonials
          SET procedure_de = procedure,
              procedure_en = procedure
          WHERE procedure_de = ''
            AND procedure_en = '';

          ALTER TABLE patient_testimonials DROP COLUMN procedure;
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS patient_testimonials_public_order_idx
        ON patient_testimonials (display_order, id)
        WHERE published = true;
    `);
    logger.info("Patient testimonial migrations completed");
  } catch (err) {
    logger.error({ err }, "Patient testimonial migration failed");
    throw err;
  }
}