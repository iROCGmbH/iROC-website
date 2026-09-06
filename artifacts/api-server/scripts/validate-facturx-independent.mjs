import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MUSTANG_VERSION = "2.26.0";
const MUSTANG_SHA256 = "42d7868cb68264874a7b8cab4c3587b03b23ccc7cd72373da917f66758bb9736";
const MUSTANG_URL = `https://github.com/ZUGFeRD/mustangproject/releases/download/core-${MUSTANG_VERSION}/Mustang-CLI-${MUSTANG_VERSION}.jar`;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, "../../..");
const cacheDirectory = path.join(workspaceRoot, ".cache", "mustangproject");
const jarPath = path.join(cacheDirectory, `Mustang-CLI-${MUSTANG_VERSION}.jar`);

const sha256 = buffer => createHash("sha256").update(buffer).digest("hex");

async function ensureMustangCli() {
  await mkdir(cacheDirectory, { recursive: true });

  try {
    const existing = await readFile(jarPath);
    if (sha256(existing) === MUSTANG_SHA256) return;
    await rm(jarPath, { force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  console.log(`Downloading Mustangproject CLI ${MUSTANG_VERSION}...`);
  const response = await fetch(MUSTANG_URL, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Mustangproject download failed: HTTP ${response.status}`);
  }
  const downloaded = Buffer.from(await response.arrayBuffer());
  const actualChecksum = sha256(downloaded);
  if (actualChecksum !== MUSTANG_SHA256) {
    throw new Error(`Mustangproject checksum mismatch: expected ${MUSTANG_SHA256}, received ${actualChecksum}`);
  }

  const temporaryPath = `${jarPath}.tmp`;
  await writeFile(temporaryPath, downloaded);
  await rename(temporaryPath, jarPath);
}

const javaCheck = spawnSync("java", ["-version"], { encoding: "utf8" });
if (javaCheck.error || javaCheck.status !== 0) {
  console.error("Java is required for independent Factur-X validation. Reopen the Repl after the Java module is installed.");
  process.exit(1);
}

await ensureMustangCli();

const test = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "src/lib/facturx-independent-validator.test.ts"],
  {
    cwd: path.resolve(scriptDirectory, ".."),
    env: { ...process.env, MUSTANG_CLI_JAR: jarPath },
    stdio: "inherit",
  },
);

if (test.error) throw test.error;
process.exit(test.status ?? 1);