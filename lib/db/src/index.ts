import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  isDatabaseGatewayEnabled,
  validateProductionDatabaseGatewayConfiguration,
} from "./database-gateway";
import {
  getDatabaseScope,
  type DatabaseScope,
  type DatabaseScopeMiddleware,
  runWithDatabaseScope,
} from "./database-scope";
import * as schema from "./schema";

const { Pool } = pg;

/**
 * The database role to use for work initiated by an HTTP request.  Keep this
 * list deliberately small: when MULTI_DOMAIN_GATEWAY_ENABLED=true, a new
 * externally reachable service must opt in to a role rather than inheriting
 * the internal database connection.
 */
type Database = ReturnType<typeof drizzle<typeof schema>>;
const scopedUrlEnvironmentNames: Record<DatabaseScope, string> = {
  public: "DATABASE_URL_PUBLIC",
  patients: "DATABASE_URL_PATIENTS",
  doctors: "DATABASE_URL_DOCTORS",
  internal: "DATABASE_URL_INTERNAL",
};

function getDatabaseUrl(scope: DatabaseScope): string {
  const environmentName = scopedUrlEnvironmentNames[scope];
  const url =
    scope === "internal"
      ? process.env.DATABASE_URL_INTERNAL ?? process.env.DATABASE_URL
      : process.env[environmentName];

  if (!url) {
    throw new Error(
      `${environmentName} must be set before using the ${scope} database role.`,
    );
  }

  return url;
}

const pools = new Map<DatabaseScope, pg.Pool>();
const databases = new Map<DatabaseScope, Database>();

function getActivePool(): pg.Pool {
  const scope = getDatabaseScope();
  let activePool = pools.get(scope);

  if (!activePool) {
    activePool = new Pool({ connectionString: getDatabaseUrl(scope) });
    pools.set(scope, activePool);
  }

  return activePool;
}

function getActiveDatabase(): Database {
  const scope = getDatabaseScope();
  let activeDatabase = databases.get(scope);

  if (!activeDatabase) {
    activeDatabase = drizzle(getActivePool(), { schema });
    databases.set(scope, activeDatabase);
  }

  return activeDatabase;
}

function createBoundFacade<T extends object>(getTarget: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const target = getTarget();
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    has(_target, property) {
      return Reflect.has(getTarget(), property);
    },
    ownKeys() {
      return Reflect.ownKeys(getTarget());
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(getTarget(), property);
      return descriptor
        ? { ...descriptor, configurable: true }
        : undefined;
    },
  });
}

/**
 * Typed facades retained for the existing @workspace/db API. Method access is
 * resolved at call time, so imports made by route modules automatically use
 * the connector selected by their request scope.
 */
export const pool: pg.Pool = createBoundFacade(getActivePool);
export const db: Database = createBoundFacade(getActiveDatabase);

export {
  getDatabaseScope,
  isDatabaseGatewayEnabled,
  runWithDatabaseScope,
  validateProductionDatabaseGatewayConfiguration,
};
export type { DatabaseScope, DatabaseScopeMiddleware };
export {
  databaseUrlEnvironmentKeys,
  databaseUrlForSchema,
  provisionMigrationBackedTestSchema,
  withDatabaseUrlsScopedToSchema,
} from "./test-schema";
export type { DatabaseUrlEnvironmentKey } from "./test-schema";

if (isDatabaseGatewayEnabled()) {
  validateProductionDatabaseGatewayConfiguration();
} else if (!process.env.DATABASE_URL_INTERNAL && !process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export * from "./schema";
