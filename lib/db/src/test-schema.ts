import type pg from "pg";

/**
 * The API integration suite uses this to make a schema that has the same
 * tables, columns, defaults, constraints, and indexes as the migrated
 * application schema.  Cloning the already-migrated public schema means a
 * newly applied migration is reflected here automatically; tests do not need
 * to maintain abbreviated CREATE TABLE statements beside production schema.
 */
export const databaseUrlEnvironmentKeys = [
  "DATABASE_URL",
  "DATABASE_URL_INTERNAL",
  "DATABASE_URL_PUBLIC",
  "DATABASE_URL_PATIENTS",
  "DATABASE_URL_DOCTORS",
] as const;

export type DatabaseUrlEnvironmentKey = (typeof databaseUrlEnvironmentKeys)[number];

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe PostgreSQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

export function databaseUrlForSchema(connectionString: string, schema: string): string {
  quoteIdentifier(schema);
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

/**
 * Creates an empty schema from the current, migration-backed public schema.
 * `INCLUDING ALL` intentionally carries production indexes and constraints
 * into the test schema, so test behavior cannot silently diverge when a
 * migration changes one of those definitions.
 */
export async function provisionMigrationBackedTestSchema(
  bootstrapPool: Pick<pg.Pool, "query">,
  schema: string,
): Promise<void> {
  const quotedSchema = quoteIdentifier(schema);
  await bootstrapPool.query(`CREATE SCHEMA ${quotedSchema}`);
  const { rows } = await bootstrapPool.query<{ tablename: string }>(
    `SELECT tablename
       FROM pg_catalog.pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename`,
  );

  for (const { tablename } of rows) {
    const quotedTable = quoteIdentifier(tablename);
    await bootstrapPool.query(
      `CREATE TABLE ${quotedSchema}.${quotedTable}
         (LIKE public.${quotedTable} INCLUDING ALL)`,
    );
  }
}

/**
 * Temporarily point every database-role URL at one private schema.  Restoring
 * all values (including absent variables) is important because route modules
 * may select any scoped role while a test imports the app.
 */
export async function withDatabaseUrlsScopedToSchema<T>(
  connectionString: string,
  schema: string,
  callback: () => Promise<T>,
): Promise<T> {
  const originalValues = Object.fromEntries(
    databaseUrlEnvironmentKeys.map((key) => [key, process.env[key]]),
  ) as Record<DatabaseUrlEnvironmentKey, string | undefined>;
  const isolatedUrl = databaseUrlForSchema(connectionString, schema);

  for (const key of databaseUrlEnvironmentKeys) {
    process.env[key] = isolatedUrl;
  }

  try {
    return await callback();
  } finally {
    for (const key of databaseUrlEnvironmentKeys) {
      const originalValue = originalValues[key];
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  }
}