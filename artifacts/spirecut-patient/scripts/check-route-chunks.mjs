import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const sourcePaths = [
  resolve(packageRoot, 'src/config/navLinks.ts'),
  resolve(packageRoot, 'src/App.tsx'),
];
const manifestPath = resolve(packageRoot, 'dist/public/.vite/manifest.json');

const [sourceFiles, manifestSource] = await Promise.all([
  Promise.all(sourcePaths.map((path) => readFile(path, 'utf8'))),
  readFile(manifestPath, 'utf8'),
]);
const manifest = JSON.parse(manifestSource);
const pageImports = [
  ...new Set(
    sourceFiles.flatMap((source) =>
      [...source.matchAll(/import\(\s*['"]@\/pages\/([^'"]+)['"]\s*\)/g)].map(
        ([, page]) => page,
      ),
    ),
  ),
];

if (pageImports.length === 0) {
  throw new Error('No lazy page imports were found in the patient route sources.');
}

const entryChunk = Object.values(manifest).find((chunk) => chunk.isEntry);
if (!entryChunk) {
  throw new Error('The production manifest does not contain an entry chunk.');
}

const failures = [];
for (const page of pageImports) {
  const source = `src/pages/${page}.tsx`;
  const chunk = manifest[source];
  if (!chunk) {
    failures.push(`${page}: no production chunk exists for ${source}`);
    continue;
  }
  if (!chunk.isDynamicEntry) {
    failures.push(`${page}: ${chunk.file} is not a lazy-loaded dynamic entry`);
  }
  if (chunk.file === entryChunk.file) {
    failures.push(`${page}: route code was merged into entry chunk ${entryChunk.file}`);
  }
}

if (failures.length > 0) {
  throw new Error(
    `Spirecut patient route chunk check failed:\n- ${failures.join('\n- ')}`,
  );
}

console.info(
  `Spirecut patient route chunk check passed for ${pageImports.length} routed pages.`,
);