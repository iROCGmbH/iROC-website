import { readFile } from "node:fs/promises";
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
  "scripts/check-iroc-website-ci-triggers.mjs",
);
const fixtureRoot = resolve(
  repositoryRoot,
  "scripts/test/fixtures/iroc-website-ci-triggers",
);
const manifestPath = resolve(fixtureRoot, "package.json");

async function runChecker(workflowName) {
  const workflowPath = resolve(fixtureRoot, workflowName);

  try {
    const result = await execFileAsync(
      process.execPath,
      [checkerPath, manifestPath, workflowPath],
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

test("passes a workflow with push and pull-request triggers for every dependency", async () => {
  const result = await runChecker("complete.yml");

  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    /iROC Website CI trigger check passed for 2 workspace dependencies\./,
  );
  assert.equal(result.stderr, "");
});

test("accepts path lists indented deeper than the paths key", async () => {
  const result = await runChecker("valid-deeply-indented-paths.yml");

  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    /iROC Website CI trigger check passed for 2 workspace dependencies\./,
  );
  assert.equal(result.stderr, "");
});

test("accepts an inline comment on the paths declaration", async () => {
  const result = await runChecker("valid-inline-paths-comment.yml");

  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    /iROC Website CI trigger check passed for 2 workspace dependencies\./,
  );
  assert.equal(result.stderr, "");
});

test("reports the dependency missing from a push trigger", async () => {
  const result = await runChecker("missing-push.yml");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /iROC Website CI trigger check failed:/);
  assert.match(
    result.stderr,
    /The push trigger is missing "lib\/api-client-react\/\*\*" for @workspace\/api-client-react\./,
  );
});

test("reports the dependency missing from a pull-request trigger", async () => {
  const result = await runChecker("missing-pull-request.yml");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /iROC Website CI trigger check failed:/);
  assert.match(
    result.stderr,
    /The pull_request trigger is missing "lib\/object-storage-web\/\*\*" for @workspace\/object-storage-web\./,
  );
});

test("reports when the push paths block is missing", async () => {
  const result = await runChecker("missing-push-block.yml");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /iROC Website CI trigger check failed:/);
  assert.match(
    result.stderr,
    /The workflow is missing the on\.push\.paths block\./,
  );
});

test("reports when the pull-request paths block is missing", async () => {
  const result = await runChecker("missing-pull-request-block.yml");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /iROC Website CI trigger check failed:/);
  assert.match(
    result.stderr,
    /The workflow is missing the on\.pull_request\.paths block\./,
  );
});

test("reports a malformed push paths declaration before dependency checks", async () => {
  const result = await runChecker("malformed-push-paths.yml");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /iROC Website CI trigger check failed:/);
  assert.match(
    result.stderr,
    /The on\.push\.paths block is malformed; expected a non-empty list of path patterns\./,
  );
  assert.doesNotMatch(
    result.stderr,
    /The push trigger is missing "lib\/api-client-react\/\*\*"/,
  );
});

test("reports a malformed pull-request paths declaration before dependency checks", async () => {
  const result = await runChecker("malformed-pull-request-paths.yml");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /iROC Website CI trigger check failed:/);
  assert.match(
    result.stderr,
    /The on\.pull_request\.paths block is malformed; expected a non-empty list of path patterns\./,
  );
  assert.doesNotMatch(
    result.stderr,
    /The pull_request trigger is missing "lib\/api-client-react\/\*\*"/,
  );
});

test("reports a malformed push path list member before dependency checks", async () => {
  const result = await runChecker("malformed-push-path-entry.yml");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /iROC Website CI trigger check failed:/);
  assert.match(
    result.stderr,
    /The on\.push\.paths block is malformed; expected a non-empty list of path patterns\./,
  );
  assert.doesNotMatch(result.stderr, /The push trigger is missing/);
});

test("reports a malformed pull-request path list member before dependency checks", async () => {
  const result = await runChecker("malformed-pull-request-path-entry.yml");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /iROC Website CI trigger check failed:/);
  assert.match(
    result.stderr,
    /The on\.pull_request\.paths block is malformed; expected a non-empty list of path patterns\./,
  );
  assert.doesNotMatch(result.stderr, /The pull_request trigger is missing/);
});

test("reports a push paths declaration nested under another event property", async () => {
  const result = await runChecker("malformed-nested-push-paths.yml");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /iROC Website CI trigger check failed:/);
  assert.match(
    result.stderr,
    /The on\.push\.paths block is malformed; expected a non-empty list of path patterns\./,
  );
  assert.doesNotMatch(result.stderr, /The push trigger is missing/);
});

test("reports inconsistent pull-request path list indentation", async () => {
  const result = await runChecker(
    "malformed-pull-request-path-indentation.yml",
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /iROC Website CI trigger check failed:/);
  assert.match(
    result.stderr,
    /The on\.pull_request\.paths block is malformed; expected a non-empty list of path patterns\./,
  );
  assert.doesNotMatch(result.stderr, /The pull_request trigger is missing/);
});

test("reports a missing push paths declaration when the event section exists", async () => {
  const result = await runChecker("missing-push-paths.yml");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /iROC Website CI trigger check failed:/);
  assert.match(
    result.stderr,
    /The workflow is missing the on\.push\.paths block\./,
  );
});

test("reports a missing pull-request paths declaration when the event section exists", async () => {
  const result = await runChecker("missing-pull-request-paths.yml");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /iROC Website CI trigger check failed:/);
  assert.match(
    result.stderr,
    /The workflow is missing the on\.pull_request\.paths block\./,
  );
});

test("fixtures use the same workspace dependency manifest shape as the website", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assert.deepEqual(manifest.dependencies, {
    "@workspace/api-client-react": "workspace:*",
    "@workspace/object-storage-web": "workspace:*",
  });
});
