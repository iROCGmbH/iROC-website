import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractEventPaths,
  workflowHasEvent,
} from "./ci-workflow-paths.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDirectory = resolve(repositoryRoot, ".github/workflows");
const workflowArguments = process.argv.slice(2);

async function getWorkflowPaths() {
  if (workflowArguments.length > 0) {
    return workflowArguments.map((workflowPath) =>
      resolve(repositoryRoot, workflowPath),
    );
  }

  const entries = await readdir(workflowsDirectory, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() && /\.(?:yml|yaml)$/i.test(entry.name),
    )
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => resolve(workflowsDirectory, entry.name));
}

function validateWorkflow(workflowSource, workflowPath) {
  const errors = [];
  for (const eventName of ["push", "pull_request"]) {
    if (!workflowHasEvent(workflowSource, eventName)) {
      continue;
    }

    const eventPaths = extractEventPaths(workflowSource, eventName);
    if (eventPaths?.error) {
      errors.push(`${workflowPath}: ${eventPaths.error}`);
    }
  }
  return errors;
}

try {
  const workflowPaths = await getWorkflowPaths();
  const workflowSources = await Promise.all(
    workflowPaths.map(async (workflowPath) => ({
      workflowPath,
      source: await readFile(workflowPath, "utf8"),
    })),
  );
  const errors = workflowSources.flatMap(({ source, workflowPath }) =>
    validateWorkflow(
      source,
      workflowPath.replace(`${repositoryRoot}/`, ""),
    ),
  );

  if (errors.length > 0) {
    console.error("CI workflow path check failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      `CI workflow path check passed for ${workflowPaths.length} workflows.`,
    );
  }
} catch (error) {
  console.error(
    `CI workflow path check could not run: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
}