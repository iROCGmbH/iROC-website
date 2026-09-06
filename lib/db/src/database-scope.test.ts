import assert from "node:assert/strict";
import test from "node:test";
const {
  getDatabaseScope,
  runWithDatabaseScope,
} = await import(new URL("./database-scope.ts", import.meta.url).href);

test("database scope defaults to internal and survives async work", async () => {
  assert.equal(getDatabaseScope(), "internal");

  await runWithDatabaseScope("patients", async () => {
    await Promise.resolve();
    assert.equal(getDatabaseScope(), "patients");

    runWithDatabaseScope("doctors", () => {
      assert.equal(getDatabaseScope(), "doctors");
    });
    assert.equal(getDatabaseScope(), "patients");
  });

  assert.equal(getDatabaseScope(), "internal");
});