import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
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
    .filter((entry) => entry.isFile() && /\.(?:yml|yaml)$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => resolve(workflowsDirectory, entry.name));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validationError(message, path = []) {
  return { message, path };
}

function isValidActionReference(reference) {
  if (typeof reference !== "string" || reference.trim() !== reference) {
    return false;
  }

  if (reference.startsWith("./")) {
    return reference.length > 2 && !/[\s@]/.test(reference);
  }

  const atIndex = reference.indexOf("@");
  if (atIndex <= 0 || atIndex === reference.length - 1) {
    return false;
  }

  const actionPath = reference.slice(0, atIndex);
  const ref = reference.slice(atIndex + 1);
  const actionSegments = actionPath.split("/");

  return (
    actionSegments.length >= 2 &&
    actionSegments.every((segment) => /^[A-Za-z0-9_.-]+$/.test(segment)) &&
    /^[A-Za-z0-9_./-]+$/.test(ref)
  );
}

function invalidActionReferenceError(location, reference, path) {
  return validationError(
    `${location} has invalid action reference "${reference}"; expected a local "./..." path or an "owner/repository[/path]@ref" reference.`,
    path,
  );
}

function validateWorkflow(workflow) {
  const errors = [];

  if (!isPlainObject(workflow)) {
    return [validationError("the workflow document must be a mapping.")];
  }

  if (!Object.hasOwn(workflow, "on")) {
    errors.push(
      validationError('the workflow is missing the required "on" key.'),
    );
  } else {
    const triggers = workflow.on;
    if (
      typeof triggers !== "string" &&
      !(
        Array.isArray(triggers) &&
        triggers.length > 0 &&
        triggers.every((trigger) => typeof trigger === "string")
      ) &&
      !(
        isPlainObject(triggers) &&
        Object.keys(triggers).length > 0 &&
        Object.values(triggers).every(
          (configuration) =>
            configuration === null || isPlainObject(configuration),
        )
      )
    ) {
      errors.push(
        validationError(
          'the "on" key must be an event name, a non-empty list of event names, or an event mapping.',
          ["on"],
        ),
      );
    }
  }

  if (!Object.hasOwn(workflow, "jobs")) {
    errors.push(
      validationError('the workflow is missing the required "jobs" key.'),
    );
    return errors;
  }

  if (
    !isPlainObject(workflow.jobs) ||
    Object.keys(workflow.jobs).length === 0
  ) {
    errors.push(
      validationError('the "jobs" key must be a non-empty mapping.', ["jobs"]),
    );
    return errors;
  }

  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    const jobPath = ["jobs", jobId];
    if (!isPlainObject(job)) {
      errors.push(
        validationError(`job "${jobId}" must be a mapping.`, jobPath),
      );
      continue;
    }

    const reusableJob = Object.hasOwn(job, "uses");
    if (reusableJob) {
      if (typeof job.uses !== "string" || job.uses.trim() === "") {
        errors.push(
          validationError(`job "${jobId}".uses must be a non-empty string.`, [
            ...jobPath,
            "uses",
          ]),
        );
      } else if (!isValidActionReference(job.uses)) {
        errors.push(
          invalidActionReferenceError(
            `job "${jobId}".uses`,
            job.uses,
            [...jobPath, "uses"],
          ),
        );
      }
      continue;
    }

    if (!Object.hasOwn(job, "runs-on")) {
      errors.push(
        validationError(
          `job "${jobId}" must define "runs-on" or "uses".`,
          jobPath,
        ),
      );
    } else if (
      typeof job["runs-on"] !== "string" &&
      !(
        Array.isArray(job["runs-on"]) &&
        job["runs-on"].length > 0 &&
        job["runs-on"].every((runner) => typeof runner === "string")
      )
    ) {
      errors.push(
        validationError(
          `job "${jobId}".runs-on must be a string or a non-empty list of strings.`,
          [...jobPath, "runs-on"],
        ),
      );
    }

    if (!Object.hasOwn(job, "steps")) {
      errors.push(
        validationError(
          `job "${jobId}" is missing the required "steps" key.`,
          jobPath,
        ),
      );
      continue;
    }

    if (!Array.isArray(job.steps) || job.steps.length === 0) {
      errors.push(
        validationError(`job "${jobId}".steps must be a non-empty list.`, [
          ...jobPath,
          "steps",
        ]),
      );
      continue;
    }

    for (const [stepIndex, step] of job.steps.entries()) {
      const stepPath = [...jobPath, "steps", stepIndex];
      if (!isPlainObject(step)) {
        errors.push(
          validationError(
            `job "${jobId}" step ${stepIndex + 1} must be a mapping.`,
            stepPath,
          ),
        );
        continue;
      }

      if (!Object.hasOwn(step, "run") && !Object.hasOwn(step, "uses")) {
        errors.push(
          validationError(
            `job "${jobId}" step ${stepIndex + 1} must define "run" or "uses".`,
            stepPath,
          ),
        );
      }
      for (const key of ["run", "uses"]) {
        if (Object.hasOwn(step, key) && typeof step[key] !== "string") {
          errors.push(
            validationError(
              `job "${jobId}" step ${stepIndex + 1}.${key} must be a string.`,
              [...stepPath, key],
            ),
          );
        } else if (
          key === "uses" &&
          Object.hasOwn(step, key) &&
          !isValidActionReference(step[key])
        ) {
          errors.push(
            invalidActionReferenceError(
              `job "${jobId}" step ${stepIndex + 1}.uses`,
              step[key],
              [...stepPath, key],
            ),
          );
        }
      }
    }
  }

  return errors;
}

function getNodeAtPath(root, path) {
  let node = root;
  let pair;

  for (const segment of path) {
    if (typeof segment === "number") {
      node = Array.isArray(node?.items) ? node.items[segment] : undefined;
      pair = undefined;
      continue;
    }

    pair = node?.items?.find((item) => item.key?.value === segment);
    node = pair?.value;
  }

  return { node, pair };
}

function getSourceOffset(document, path) {
  const { node, pair } = getNodeAtPath(document.contents, path);
  return pair?.key?.range?.[0] ?? node?.range?.[0];
}

function getLineAndColumn(source, offset) {
  const lineStart = Math.max(
    source.lastIndexOf("\n", offset - 1),
    source.lastIndexOf("\r", offset - 1),
  );
  const line = source.slice(0, offset).split(/\r\n|[\r\n]/).length;

  return {
    line,
    column: offset - lineStart,
  };
}

function formatError(
  workflowPath,
  message,
  source,
  document,
  path = [],
  sourceOffset,
) {
  const offset =
    sourceOffset === undefined ? getSourceOffset(document, path) : sourceOffset;
  if (offset === undefined) {
    return `${workflowPath}: ${message}`;
  }

  const { line, column } = getLineAndColumn(source, offset);
  return `${workflowPath}:${line}:${column}: ${message}`;
}

export function checkWorkflowSyntax(workflowSource, workflowPath) {
  const document = YAML.parseDocument(workflowSource, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
    version: "1.2",
  });

  if (document.errors.length > 0) {
    return document.errors.map((error) =>
      formatError(
        workflowPath,
        `invalid YAML: ${error.message}`,
        workflowSource,
        document,
        undefined,
        error.pos?.[0],
      ),
    );
  }

  try {
    return validateWorkflow(document.toJS()).map(({ message, path }) =>
      formatError(workflowPath, message, workflowSource, document, path),
    );
  } catch (error) {
    return [
      formatError(
        workflowPath,
        `could not validate workflow structure: ${
          error instanceof Error ? error.message : String(error)
        }`,
        workflowSource,
        document,
      ),
    ];
  }
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
    checkWorkflowSyntax(source, workflowPath.replace(`${repositoryRoot}/`, "")),
  );

  if (errors.length > 0) {
    console.error("CI workflow syntax check failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      `CI workflow syntax check passed for ${workflowPaths.length} workflows.`,
    );
  }
} catch (error) {
  console.error(
    `CI workflow syntax check could not run: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
}
