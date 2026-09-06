import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const checkerPath = resolve(
  repositoryRoot,
  "scripts/check-ci-workflow-syntax.mjs",
);
const fixtureRoot = resolve(
  repositoryRoot,
  "scripts/test/fixtures/ci-workflow-syntax",
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

test("passes every checked-in GitHub Actions workflow", async () => {
  const workflowDirectory = resolve(repositoryRoot, ".github/workflows");
  const workflowNames = (await readdir(workflowDirectory))
    .filter((name) => /\.(?:yml|yaml)$/i.test(name))
    .sort();
  const result = await execFileAsync(process.execPath, [checkerPath], {
    cwd: repositoryRoot,
  });

  assert.equal(result.stderr, "");
  assert.match(
    result.stdout,
    new RegExp(
      `CI workflow syntax check passed for ${workflowNames.length} workflows\\.`,
    ),
  );
});

test("every checked-in workflow runs the syntax check in CI", async () => {
  const workflowDirectory = resolve(repositoryRoot, ".github/workflows");
  const workflowNames = (await readdir(workflowDirectory))
    .filter((name) => /\.(?:yml|yaml)$/i.test(name))
    .sort();

  for (const workflowName of workflowNames) {
    const workflow = await readFile(
      resolve(workflowDirectory, workflowName),
      "utf8",
    );
    assert.match(
      workflow,
      /run: pnpm run check:ci-workflow-syntax/,
      `${workflowName} must validate GitHub Actions syntax`,
    );
  }
});

test("rejects malformed YAML before workflow structure validation", async () => {
  const result = await runChecker("invalid-yaml.yml");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CI workflow syntax check failed:/);
  assert.match(
    result.stderr,
    /invalid-yaml\.yml:2:1: invalid YAML: Map keys must be unique/,
  );
});

test("rejects a workflow with an unsupported job shape", async () => {
  const result = await runChecker("invalid-job.yml");

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /invalid-job\.yml:7:3: job "build" must define "runs-on" or "uses"\./,
  );
});

test("rejects invalid action references with job and step context", async () => {
  const result = await runChecker("invalid-action-reference.yml");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CI workflow syntax check failed:/);
  assert.match(
    result.stderr,
    /invalid-action-reference\.yml:11:9: job "build" step 1\.uses has invalid action reference "actions\/checkout";/,
  );
  assert.match(
    result.stderr,
    /invalid-action-reference\.yml:14:5: job "reusable"\.uses has invalid action reference "octo-org\/example\/\.github\/workflows\/reusable\.yml";/,
  );
});
