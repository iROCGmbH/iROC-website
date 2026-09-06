import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const routeConfigPath = resolve(packageRoot, 'src/config/routeConfig.ts');
const manifestPath = resolve(packageRoot, 'dist/public/.vite/manifest.json');
const bundleBudgets = {
  initialEntryBytes: 512 * 1024,
  onDemand: [
    {
      sourceSuffix: '@react-pdf/renderer/lib/react-pdf.browser.js',
      label: 'PDF renderer',
      maxBytes: 1_600_000,
    },
  ],
};

const [routeConfigSource, manifestSource] = await Promise.all([
  readFile(routeConfigPath, 'utf8'),
  readFile(manifestPath, 'utf8'),
]);
const manifest = JSON.parse(manifestSource);
const pageImports = [
  ...new Set(
    [
      ...routeConfigSource.matchAll(
        /import\(\s*['"]@\/pages\/([^'"]+)['"]\s*\)/g,
      ),
    ].map(([, page]) => page),
  ),
];

if (pageImports.length === 0) {
  throw new Error('No lazy route imports were found in src/config/routeConfig.ts.');
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
  const match = Object.entries(manifest).find(([source, chunk]) =>
    source.endsWith(budget.sourceSuffix) && chunk.isDynamicEntry,
  );
  if (!match) {
    failures.push(
      `${budget.label}: no dynamic production chunk exists for ${budget.sourceSuffix}`,
    );
    continue;
  }
  measuredChunks.push({
    label: budget.label,
    delivery: 'on-demand exception',
    chunk: match[1],
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
    `iROC app ${delivery} budget: ${label} ${file} ${sizeInKiB} KiB / ${budgetInKiB} KiB`,
  );
  if (size > maxBytes) {
    failures.push(
      `${label} (${delivery}) is ${sizeInKiB} KiB, over the ${budgetInKiB} KiB budget`,
    );
  }
}

if (failures.length > 0) {
  throw new Error(`iROC app production bundle check failed:\n- ${failures.join('\n- ')}`);
}

console.info(
  `iROC app route chunk and bundle budget checks passed for ${pageImports.length} routed pages.`,
);