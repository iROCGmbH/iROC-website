ALTER TABLE "iroc_products" ADD COLUMN IF NOT EXISTS "purchase_discount" numeric(5,2);
ALTER TABLE "iroc_products" ADD COLUMN IF NOT EXISTS "recommended_price" numeric(12,2);
