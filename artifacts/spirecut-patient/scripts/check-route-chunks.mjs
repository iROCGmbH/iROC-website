import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const sourcePaths = [
  resolve(packageRoot, 'src/config/navLinks.ts'),
  resolve(packageRoot, 'src/App.tsx'),
];
const manifestPath = resolve(packageRoot, 'dist/public/.vite/manifest.json');
const bundleBudgets = {
  initialEntryBytes: 512 * 1024,
  onDemand: [
    {
      source: 'src/components/ChatbotPDF.tsx',
      label: 'chatbot PDF renderer',
      maxBytes: 1_600_000,
    },
  ],
};

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
const measuredChunks = [
  {
    label: 'initial entry',
    delivery: 'initial download',
    chunk: entryChunk,
    maxBytes: bundleBudgets.initialEntryBytes,
  },
];
for (const budget of bundleBudgets.onDemand) {
  const chunk = manifest[budget.source];
  if (!chunk) {
    failures.push(
      `${budget.label}: no production chunk exists for ${budget.source}`,
    );
    continue;
  }
  measuredChunks.push({
    label: budget.label,
    delivery: 'on-demand exception',
    chunk,
    maxBytes: budget.maxBytes,
  });
}

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

const measuredSizes = await Promise.all(
  measuredChunks.map(async ({ label, delivery, chunk, maxBytes }) => ({
    label,
    delivery,
    file: chunk.file,
    size: (await stat(resolve(packageRoot, 'dist/public', chunk.file))).size,
    maxBytes,
  })),
);
for (const { label, delivery, file, size, maxBytes } of measuredSizes) {
  const sizeInKiB = (size / 1024).toFixed(1);
  const budgetInKiB = (maxBytes / 1024).toFixed(1);
  console.info(
    `Spirecut patient ${delivery} budget: ${label} ${file} ${sizeInKiB} KiB / ${budgetInKiB} KiB`,
  );
  if (size > maxBytes) {
    failures.push(
      `${label} (${delivery}) is ${sizeInKiB} KiB, over the ${budgetInKiB} KiB budget`,
    );
  }
}

if (failures.length > 0) {
  throw new Error(
    `Spirecut patient production bundle check failed:\n- ${failures.join('\n- ')}`,
  );
}

console.info(
  `Spirecut patient route chunk and bundle budget checks passed for ${pageImports.length} routed pages.`,
);