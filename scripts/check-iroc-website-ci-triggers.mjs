import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractEventPaths } from "./ci-workflow-paths.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [manifestArgument, workflowArgument] = process.argv.slice(2);
const manifestPath = resolve(
  repositoryRoot,
  manifestArgument ?? "artifacts/iroc-website/package.json",
);
const workflowPath = resolve(
  repositoryRoot,
  workflowArgument ?? ".github/workflows/iroc-website-ci.yml",
);

const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

function readWorkspaceDependencies(manifest) {
  return dependencySections
    .flatMap((section) => Object.entries(manifest[section] ?? {}))
    .filter(([, version]) => version === "workspace:*")
    .map(([packageName]) => {
      const prefix = "@workspace/";
      if (!packageName.startsWith(prefix)) {
        throw new Error(
          `Workspace dependency "${packageName}" does not map to a lib/<name> path.`,
        );
      }

      return {
        packageName,
        triggerPath: `lib/${packageName.slice(prefix.length)}/**`,
      };
    });
}

function validateTriggers(manifest, workflow) {
  const workspaceDependencies = readWorkspaceDependencies(manifest);
  const errors = [];

  for (const eventName of ["push", "pull_request"]) {
    const eventPaths = extractEventPaths(workflow, eventName);
    if (eventPaths === null) {
      errors.push(`The workflow is missing the on.${eventName}.paths block.`);
      continue;
    }
    if (eventPaths.error) {
      errors.push(eventPaths.error);
      continue;
    }

    for (const { packageName, triggerPath } of workspaceDependencies) {
      if (!eventPaths.paths.includes(triggerPath)) {
        errors.push(
          `The ${eventName} trigger is missing "${triggerPath}" for ${packageName}.`,
        );
      }
    }
  }

  return { errors, workspaceDependencies };
}

try {
  const [manifestSource, workflowSource] = await Promise.all([
    readFile(manifestPath, "utf8"),
    readFile(workflowPath, "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);
  const { errors, workspaceDependencies } = validateTriggers(
    manifest,
    workflowSource,
  );

  if (errors.length > 0) {
    console.error("iROC Website CI trigger check failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      `iROC Website CI trigger check passed for ${workspaceDependencies.length} workspace dependencies.`,
    );
  }
} catch (error) {
  console.error(
    `iROC Website CI trigger check could not run: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
}
