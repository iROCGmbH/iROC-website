import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "..", "..");
const generatedTargets = [
  "lib/api-client-react/src/generated",
  "lib/api-zod/src/generated",
  "lib/api-zod/src/index.ts",
];

function listFiles(directory) {
  if (!existsSync(directory)) return new Map();
  const files = new Map();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [childPath, content] of listFiles(path)) {
        files.set(join(entry.name, childPath), content);
      }
    } else if (entry.isFile()) {
      files.set(entry.name, readFileSync(path));
    }
  }
  return files;
}

function compareDirectory(actualPath, expectedPath) {
  const actual = listFiles(actualPath);
  const expected = listFiles(expectedPath);
  const mismatches = [];
  for (const [path, content] of expected) {
    const current = actual.get(path);
    if (!current) mismatches.push(`missing ${path}`);
    else if (!current.equals(content)) mismatches.push(`changed ${path}`);
  }
  for (const path of actual.keys()) {
    if (!expected.has(path)) mismatches.push(`unexpected ${path}`);
  }
  return mismatches;
}

function comparePath(actualPath, expectedPath) {
  if (!existsSync(expectedPath)) {
    return existsSync(actualPath) ? ["unexpected output"] : [];
  }
  if (!existsSync(actualPath)) return ["missing output"];

  const expected = statSync(expectedPath);
  const actual = statSync(actualPath);
  if (expected.isFile() || actual.isFile()) {
    if (!expected.isFile() || !actual.isFile()) return ["changed output type"];
    return readFileSync(actualPath).equals(readFileSync(expectedPath))
      ? []
      : ["changed output"];
  }
  return compareDirectory(actualPath, expectedPath);
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "api-spec-codegen-check-"));
let exitCode = 1;
try {
  const customFetchSource = join(repoRoot, "lib", "api-client-react", "src", "custom-fetch.ts");
  const customFetchTarget = join(temporaryRoot, "lib", "api-client-react", "src", "custom-fetch.ts");
  mkdirSync(dirname(customFetchTarget), { recursive: true });
  cpSync(customFetchSource, customFetchTarget);

  const environment = { ...process.env, API_CODEGEN_OUTPUT_ROOT: temporaryRoot };
  const result = spawnSync("pnpm", ["exec", "orval", "--config", "./orval.config.ts"], {
    cwd: packageDir,
    stdio: "inherit",
    env: environment,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`Code generation failed with exit code ${result.status ?? 1}.`);
    exitCode = result.status ?? 1;
  } else {
    const indexResult = spawnSync(process.execPath, ["./scripts/write-zod-index.mjs"], {
      cwd: packageDir,
      stdio: "inherit",
      env: environment,
    });
    if (indexResult.error) throw indexResult.error;
    if (indexResult.status !== 0) {
      exitCode = indexResult.status ?? 1;
    } else {
      const mismatches = generatedTargets.flatMap((target) =>
        comparePath(join(repoRoot, target), join(temporaryRoot, target))
          .map((mismatch) => `${target}: ${mismatch}`),
      );
      if (mismatches.length > 0) {
        console.error("Generated files are out of date. Run the API codegen command and commit the result.");
        console.error(mismatches.map((mismatch) => `- ${mismatch}`).join("\n"));
        exitCode = 1;
      } else {
        const typecheck = spawnSync("pnpm", ["-w", "run", "typecheck:libs"], {
          cwd: repoRoot,
          stdio: "inherit",
        });
        if (typecheck.error) throw typecheck.error;
        exitCode = typecheck.status ?? 1;
        if (exitCode === 0) console.log("Generated API files are up to date.");
      }
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
process.exitCode = exitCode;