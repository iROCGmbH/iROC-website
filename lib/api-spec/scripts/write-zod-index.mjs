import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "..", "..");
const outputRoot = process.env.API_CODEGEN_OUTPUT_ROOT
  ? resolve(process.env.API_CODEGEN_OUTPUT_ROOT)
  : repoRoot;
const indexPath = resolve(outputRoot, "lib", "api-zod", "src", "index.ts");

mkdirSync(dirname(indexPath), { recursive: true });
writeFileSync(indexPath, 'export * from "./generated/api";\nexport * from "./iroc";\n');