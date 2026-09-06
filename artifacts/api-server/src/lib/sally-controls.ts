import { pool } from "@workspace/db";

export const SALLY_AUTOMATION_MASTER_KEY = "sally_automation_enabled";
export const SALLY_AUTO_INVOICE_KEY = "sally_auto_invoice_enabled";

/**
 * Missing controls default to enabled so existing installations keep their
 * current behavior until an administrator explicitly pauses a process.
 */
export async function isSallyAutomationEnabled(processKey?: string): Promise<boolean> {
  const keys = processKey
    ? [SALLY_AUTOMATION_MASTER_KEY, processKey]
    : [SALLY_AUTOMATION_MASTER_KEY];
  const { rows } = await pool.query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key = ANY($1)",
    [keys],
  );
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  return settings.get(SALLY_AUTOMATION_MASTER_KEY) !== "false"
    && (!processKey || settings.get(processKey) !== "false");
}