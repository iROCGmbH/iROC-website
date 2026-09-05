function parsePathPattern(source) {
  const singleQuoted = source.match(/^'((?:[^']|'')*)'(?:\s+#.*)?$/);
  if (singleQuoted) {
    return singleQuoted[1].replace(/''/g, "'");
  }

  const doubleQuoted = source.match(/^("(?:[^"\\]|\\.)*")(?:\s+#.*)?$/);
  if (doubleQuoted) {
    try {
      return JSON.parse(doubleQuoted[1]);
    } catch {
      return null;
    }
  }

  if (/^['"]/.test(source)) {
    return null;
  }

  const value = source.replace(/\s+#.*$/, "").trim();
  if (
    value === "" ||
    /^(?:null|true|false|~)$/i.test(value) ||
    /^[-+]?(?:(?:0|[1-9][0-9_]*)(?:\.[0-9_]*)?(?:e[-+]?[0-9_]+)?|0x[0-9a-f_]+|0o[0-7_]+|\.inf|\.nan)$/i.test(
      value,
    ) ||
    /^[{[>|*&]/.test(value) ||
    /^-\s/.test(value) ||
    /:\s/.test(value)
  ) {
    return null;
  }

  return value;
}

export function extractEventPaths(workflow, eventName) {
  const lines = workflow.split(/\r?\n/);
  const eventDeclaration = new RegExp(`^  ${eventName}:`);
  const eventStart = lines.findIndex(
    (line) => eventDeclaration.test(line),
  );

  if (eventStart === -1) {
    return null;
  }

  const eventLines = [];
  for (const line of lines.slice(eventStart + 1)) {
    if (/^(?:\S|  \S)/.test(line)) {
      break;
    }
    eventLines.push(line);
  }

  const eventProperties = eventLines
    .filter((line) => line.trim() !== "" && !/^\s*#/.test(line))
    .map((line) => line.match(/^ */)[0].length);
  const eventPropertyIndent = Math.min(...eventProperties);
  const paths = [];
  let insidePaths = false;
  let hasPathsDeclaration = false;
  let malformed = false;
  let pathsIndent = 0;
  let pathEntryIndent = null;

  for (const line of eventLines) {
    const pathsDeclaration = line.match(/^( +)paths:(.*)$/);
    if (pathsDeclaration) {
      hasPathsDeclaration = true;
      pathsIndent = pathsDeclaration[1].length;
      insidePaths = pathsIndent === eventPropertyIndent;
      if (!insidePaths) {
        malformed = true;
      }
      const declarationSuffix = pathsDeclaration[2];
      if (declarationSuffix !== "" && !/^\s+#/.test(declarationSuffix)) {
        malformed = true;
      }
      continue;
    }

    if (insidePaths) {
      if (line.trim() === "" || /^\s*#/.test(line)) {
        continue;
      }

      const indentation = line.match(/^ */)[0].length;
      if (indentation <= pathsIndent) {
        insidePaths = false;
        continue;
      }

      const pathEntry = line.match(/^( +)-\s+(.+?)\s*$/);
      if (pathEntry && pathEntry[1].length > pathsIndent) {
        const indentation = pathEntry[1].length;
        pathEntryIndent ??= indentation;
        const pathPattern = parsePathPattern(pathEntry[2]);
        if (indentation !== pathEntryIndent || pathPattern === null) {
          malformed = true;
        } else {
          paths.push(pathPattern);
        }
      } else {
        malformed = true;
      }
    }
  }

  if (!hasPathsDeclaration) {
    return {
      error: `The workflow is missing the on.${eventName}.paths block.`,
    };
  }

  if (malformed || paths.length === 0) {
    return {
      error: `The on.${eventName}.paths block is malformed; expected a non-empty list of path patterns.`,
    };
  }

  return { paths };
}

export function workflowHasEvent(workflow, eventName) {
  const eventDeclaration = new RegExp(`^  ${eventName}:`);
  return workflow
    .split(/\r?\n/)
    .some((line) => eventDeclaration.test(line));
}