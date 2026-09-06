import { AsyncLocalStorage } from "node:async_hooks";

export type DatabaseScope = "public" | "patients" | "doctors" | "internal";

export type DatabaseScopeMiddleware = (
  request: unknown,
  response: unknown,
  next: (error?: unknown) => void,
) => void;

const storage = new AsyncLocalStorage<DatabaseScope>();

export function runWithDatabaseScope<T>(
  scope: DatabaseScope,
  callback: () => T,
): T;
export function runWithDatabaseScope(
  scope: DatabaseScope,
): DatabaseScopeMiddleware;
export function runWithDatabaseScope<T>(
  scope: DatabaseScope,
  callback?: () => T,
): T | DatabaseScopeMiddleware {
  if (callback) {
    return storage.run(scope, callback);
  }

  return (_request, _response, next) => {
    storage.run(scope, () => {
      try {
        next();
      } catch (error) {
        next(error);
      }
    });
  };
}

export function getDatabaseScope(): DatabaseScope {
  return storage.getStore() ?? "internal";
}