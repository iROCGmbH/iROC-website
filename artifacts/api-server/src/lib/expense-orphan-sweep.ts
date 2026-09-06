/**
 * Expense receipt orphan sweep
 *
 * Scans all GCS objects under the "expense-receipts/" prefix and deletes any
 * that are older than ORPHAN_AGE_MINUTES and have no corresponding row in
 * iroc_expenses.file_object_path.  These files accumulate when:
 *   - the server crashes after upload but before the extract response arrives
 *   - the admin closes the browser tab before saving (and the DELETE /file
 *     cleanup call never fires)
 *
 * Call sweepExpenseOrphans() from the startup sequence and/or the cron tick.
 */

import { pool } from "@workspace/db";
import { logger } from "./logger.js";
import { ObjectStorageService } from "./objectStorage.js";

const SWEEP_STATS_KEY = "expense_orphan_sweep_last_result";

async function saveSweepStats(stats: {
  scanned: number;
  deleted: number;
  errors: number;
  last_run: string;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [SWEEP_STATS_KEY, JSON.stringify(stats)],
    );
  } catch (err) {
    logger.error({ err }, "expense-orphan-sweep: failed to persist sweep stats to settings");
  }
}

/** Files uploaded more than this many minutes ago are eligible for cleanup. */
const ORPHAN_AGE_MINUTES = 30;

export async function sweepExpenseOrphans(
  // Allow injection in tests; production always uses the real service.
  objectStorage: Pick<ObjectStorageService, "listFilesInSubdir"> = new ObjectStorageService(),
): Promise<{
  scanned: number;
  deleted: number;
  errors: number;
}> {
  // We accumulate the result here and persist it before every return so the
  // admin health panel always reflects the latest sweep outcome, regardless of
  // which early-exit path is taken.
  let result = { scanned: 0, deleted: 0, errors: 0 };

  const persist = async (r: typeof result): Promise<typeof result> => {
    await saveSweepStats({ ...r, last_run: new Date().toISOString() });
    return r;
  };

  const cutoff = new Date(Date.now() - ORPHAN_AGE_MINUTES * 60 * 1000);

  // 1. List every file under the expense-receipts prefix.
  let candidates: Awaited<ReturnType<typeof objectStorage.listFilesInSubdir>>;
  try {
    candidates = await objectStorage.listFilesInSubdir("expense-receipts");
  } catch (err) {
    logger.error({ err }, "expense-orphan-sweep: failed to list expense-receipts objects");
    return persist({ scanned: 0, deleted: 0, errors: 1 });
  }

  if (candidates.length === 0) {
    logger.debug("expense-orphan-sweep: no files found under expense-receipts/");
    return persist({ scanned: 0, deleted: 0, errors: 0 });
  }

  // 2. Filter to files whose GCS creation time predates the cutoff.
  //    (timeCreated is an ISO-8601 string in GCS metadata.)
  const aged: typeof candidates = [];
  let errors = 0;

  for (const { file, normalizedPath } of candidates) {
    let meta: Record<string, unknown> | null = null;
    try {
      [meta] = await file.getMetadata();
    } catch (err) {
      errors++;
      logger.error(
        { err, normalizedPath },
        "expense-orphan-sweep: failed to read metadata for expense receipt",
      );
      continue;
    }
    const created = meta?.timeCreated ? new Date(meta.timeCreated as string) : null;
    if (created && created < cutoff) {
      aged.push({ file, normalizedPath });
    }
  }

  if (aged.length === 0) {
    logger.debug(
      { scanned: candidates.length, errors },
      "expense-orphan-sweep: no aged orphans found",
    );
    return persist({ scanned: candidates.length, deleted: 0, errors });
  }

  // 3. Fetch the set of file_object_path values currently saved in iroc_expenses.
  //    We only look at paths under the expense-receipts prefix so the query is cheap.
  const { rows: linkedRows } = await pool.query<{ file_object_path: string }>(
    `SELECT file_object_path
     FROM   iroc_expenses
     WHERE  file_object_path LIKE '/objects/expense-receipts/%'`,
  );
  const linked = new Set(linkedRows.map((r) => r.file_object_path));

  // 4. Delete every aged file that is NOT linked to any expense row.
  //    We do a final per-file DB recheck immediately before each deletion to
  //    guard against a concurrent POST /admin/expenses that saves the receipt
  //    between when we took the snapshot and when we issue the GCS DELETE.
  let deleted = 0;

  for (const { file, normalizedPath } of aged) {
    if (linked.has(normalizedPath)) continue; // skip if linked at snapshot time

    // Final recheck — the row might have been created since the snapshot.
    try {
      const { rows: recheckRows } = await pool.query<{ id: number }>(
        "SELECT id FROM iroc_expenses WHERE file_object_path = $1 LIMIT 1",
        [normalizedPath],
      );
      if (recheckRows.length > 0) continue; // linked between snapshot and now
    } catch (err) {
      errors++;
      logger.error(
        { err, normalizedPath },
        "expense-orphan-sweep: DB recheck failed; skipping file to be safe",
      );
      continue;
    }

    try {
      await file.delete();
      deleted++;
      logger.info(
        { normalizedPath, ageMinutes: ORPHAN_AGE_MINUTES },
        "expense-orphan-sweep: deleted orphaned expense receipt",
      );
    } catch (err) {
      errors++;
      logger.error(
        { err, normalizedPath },
        "expense-orphan-sweep: failed to delete orphaned expense receipt",
      );
    }
  }

  logger.info(
    { scanned: candidates.length, aged: aged.length, deleted, errors },
    "expense-orphan-sweep: sweep complete",
  );

  result = { scanned: candidates.length, deleted, errors };
  return persist(result);
}
