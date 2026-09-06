import assert from "node:assert/strict";
import test from "node:test";
const {
  isDatabaseGatewayEnabled,
  validateProductionDatabaseGatewayConfiguration,
} = await import(new URL("./database-gateway.ts", import.meta.url).href);

const validEnvironment: NodeJS.ProcessEnv = {
  DATABASE_URL_INTERNAL: "postgres://internal",
  DATABASE_URL_PUBLIC: "postgres://public",
  DATABASE_URL_PATIENTS: "postgres://patients",
  DATABASE_URL_DOCTORS: "postgres://doctors",
};

test("only the multi-domain gateway flag enables database isolation", () => {
  assert.equal(isDatabaseGatewayEnabled({}), false);
  assert.equal(
    isDatabaseGatewayEnabled({ DATABASE_GATEWAY_ENABLED: "true" }),
    false,
  );
  assert.equal(
    isDatabaseGatewayEnabled({ MULTI_DOMAIN_GATEWAY_ENABLED: "true" }),
    true,
  );
});

test("gateway validation accepts separate scoped connectors", () => {
  assert.doesNotThrow(() =>
    validateProductionDatabaseGatewayConfiguration(validEnvironment),
  );
});

test("gateway validation rejects missing or internal scoped connectors", () => {
  assert.throws(
    () =>
      validateProductionDatabaseGatewayConfiguration({
        DATABASE_URL_INTERNAL: "postgres://internal",
      }),
    /DATABASE_URL_PUBLIC/,
  );
  assert.throws(
    () =>
      validateProductionDatabaseGatewayConfiguration({
        ...validEnvironment,
        DATABASE_URL_DOCTORS: "postgres://internal",
      }),
    /DATABASE_URL_DOCTORS.*DATABASE_URL_INTERNAL/,
  );
});

test("gateway validation rejects connector reuse between scoped roles", () => {
  assert.throws(
    () =>
      validateProductionDatabaseGatewayConfiguration({
        ...validEnvironment,
        DATABASE_URL_PATIENTS: "postgres://public",
      }),
    /DATABASE_URL_PATIENTS.*DATABASE_URL_PUBLIC/,
  );
  assert.throws(
    () =>
      validateProductionDatabaseGatewayConfiguration({
        ...validEnvironment,
        DATABASE_URL_DOCTORS: "postgres://patients",
      }),
    /DATABASE_URL_DOCTORS.*DATABASE_URL_PATIENTS/,
  );
});