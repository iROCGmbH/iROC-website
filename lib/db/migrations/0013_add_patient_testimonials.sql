-- Curated, admin-authored Spirecut patient video testimonials are kept separate
-- from anonymous postoperative survey data and its quote approval workflow.
CREATE TABLE IF NOT EXISTS patient_testimonials (
  id serial PRIMARY KEY,
  title_de text NOT NULL,
  title_en text NOT NULL,
  description_de text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  patient_label text NOT NULL DEFAULT '',
  procedure text NOT NULL DEFAULT '',
  video_url text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_testimonials_public_order_idx
  ON patient_testimonials (display_order, id)
  WHERE published = true;