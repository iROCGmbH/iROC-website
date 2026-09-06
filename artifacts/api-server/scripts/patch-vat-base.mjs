/**
 * One-off migration: recalculate vat_amount and total for domestic invoices
 * where VAT was incorrectly applied only to subtotal instead of (subtotal + delivery_costs).
 */
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const { rows } = await pool.query(`
  SELECT id, invoice_number, invoice_type,
         subtotal::numeric        AS subtotal,
         delivery_costs::numeric  AS delivery,
         vat_rate::numeric        AS vat_rate,
         vat_amount::numeric      AS vat_amount,
         total::numeric           AS total
  FROM iroc_invoices
  WHERE vat_rate::numeric > 0
  ORDER BY invoice_number
`);

let fixed = 0;
for (const row of rows) {
  const sub  = parseFloat(row.subtotal);
  const del  = parseFloat(row.delivery);
  const rate = parseFloat(row.vat_rate);

  const correctVat   = ((sub + del) * rate) / 100;
  const correctTotal = sub + del + correctVat;

  if (Math.abs(correctVat - parseFloat(row.vat_amount)) < 0.005) continue; // already correct

  console.log(
    `${row.invoice_number}  sub=${sub.toFixed(2)}  del=${del.toFixed(2)}  rate=${rate}%` +
    `  oldVat=${parseFloat(row.vat_amount).toFixed(2)} → newVat=${correctVat.toFixed(2)}` +
    `  oldTotal=${parseFloat(row.total).toFixed(2)} → newTotal=${correctTotal.toFixed(2)}`
  );

  await pool.query(
    `UPDATE iroc_invoices
        SET vat_amount = $1,
            total      = $2
      WHERE id = $3`,
    [correctVat.toFixed(2), correctTotal.toFixed(2), row.id],
  );
  fixed++;
}

console.log(`\nDone — patched ${fixed} invoice(s).`);
await pool.end();
