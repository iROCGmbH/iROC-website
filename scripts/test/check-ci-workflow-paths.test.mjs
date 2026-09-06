import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import { extractEventPaths } from "../ci-workflow-paths.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const checkerPath = resolve(
  repositoryRoot,
  "scripts/check-ci-workflow-paths.mjs",
);
const fixtureRoot = resolve(
  repositoryRoot,
  "scripts/test/fixtures/iroc-website-ci-triggers",
);

async function runChecker(...workflowNames) {
  const workflowPaths = workflowNames.map((workflowName) =>
    resolve(fixtureRoot, workflowName),
  );

  try {
    const result = await execFileAsync(
      process.execPath,
      [checkerPath, ...workflowPaths],
      { cwd: repositoryRoot },
    );

    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      status: error.code,
      stdout: error.stdout,
      stderr: error.stderr,
    };
  }
}

test("passes every checked-in CI workflow with path filters", async () => {
  const result = await runChecker();
  const workflowCount = (await readdir(
    resolve(repositoryRoot, ".github/workflows"),
  )).filter((name) => /\.(?:yml|yaml)$/i.test(name)).length;

  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    new RegExp(`CI workflow path check passed for ${workflowCount} workflows\\.`),
  );
  assert.equal(result.stderr, "");
});

test("reports malformed push paths before any dependency-level checks", async () => {
  const result = await runChecker("malformed-push-paths.yml");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CI workflow path check failed:/);
  assert.match(
    result.stderr,
    /The on\.push\.paths block is malformed; expected a non-empty list of path patterns\./,
  );
});

test("reports an inline event declaration instead of skipping it", async () => {
  const result = await runChecker("malformed-inline-push-event.yml");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CI workflow path check failed:/);
  assert.match(
    result.stderr,
    /The workflow is missing the on\.push\.paths block\./,
  );
});

test("reports a missing pull-request paths declaration", async () => {
  const result = await runChecker("missing-pull-request-paths.yml");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CI workflow path check failed:/);
  assert.match(
    result.stderr,
    /The workflow is missing the on\.pull_request\.paths block\./,
  );
});

test("every path-filtered CI workflow runs the shared path check", async () => {
  const workflowDirectory = resolve(repositoryRoot, ".github/workflows");
  const workflowNames = (await readdir(workflowDirectory))
    .filter((name) => /\.(?:yml|yaml)$/i.test(name))
    .sort();

  for (const workflowName of workflowNames) {
    const workflow = await readFile(
      resolve(workflowDirectory, workflowName),
      "utf8",
    );
    if (!/\n  (?:push|pull_request):/.test(workflow)) {
      continue;
    }
    assert.match(
      workflow,
      /run: pnpm run check:ci-workflow-paths/,
      `${workflowName} must validate its path filters`,
    );
  }
});

test("iROC Portal CI tracks only its workspace dependency inputs", async () => {
  const workflow = await readFile(
    resolve(repositoryRoot, ".github/workflows/iroc-portal-ci.yml"),
    "utf8",
  );
  const requiredPaths = [
    "artifacts/iroc-portal/**",
    "lib/api-client-react/**",
    "lib/localized-date-picker/**",
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "tsconfig.base.json",
    "scripts/check-ci-workflow-paths.mjs",
    "scripts/check-ci-workflow-syntax.mjs",
    "scripts/ci-workflow-paths.mjs",
    ".github/workflows/iroc-portal-ci.yml",
  ];

  for (const eventName of ["push", "pull_request"]) {
    const result = extractEventPaths(workflow, eventName);
    assert.ok(result && "paths" in result, `${eventName} must declare paths`);
    assert.deepEqual(
      result.paths,
      requiredPaths,
      `${eventName} must track the Portal's complete dependency inputs`,
    );
  }
});
