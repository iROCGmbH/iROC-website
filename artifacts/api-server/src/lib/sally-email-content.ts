/**
 * Shared validation for Sally queue content.
 *
 * Queue producers must not persist drafts that cannot be reviewed or sent.
 * Keep this independent from sally-cron so inbound reply processing can use it
 * without creating a cron ↔ reply module cycle.
 */
export function invalidSallyEmailContentField(
  subject: unknown,
  body: unknown,
): "subject" | "body" | null {
  if (subject !== undefined && (typeof subject !== "string" || !subject.trim())) return "subject";
  if (body !== undefined && (typeof body !== "string" || !body.trim())) return "body";
  return null;
}