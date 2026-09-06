import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const packageRoot = resolve(import.meta.dirname, '..');
const navLinksPath = resolve(packageRoot, 'src/config/navLinks.ts');
const manifestPath = resolve(packageRoot, 'dist/public/.vite/manifest.json');
const bundleBudgets = {
  initialEntryBytes: 512 * 1024,
  onDemand: [
    {
      source: 'src/components/CertificatePDF.tsx',
      label: 'certificate PDF renderer',
      maxBytes: 1_600_000,
    },
  ],
};

const [navLinksSource, manifestSource] = await Promise.all([
  readFile(navLinksPath, 'utf8'),
  readFile(manifestPath, 'utf8'),
]);
const manifest = JSON.parse(manifestSource);
const pageImports = [
  ...new Set(
    [...navLinksSource.matchAll(/import\(['"]@\/pages\/([^'"]+)['"]\)/g)].map(
      ([, page]) => page,
    ),
  ),
];

if (pageImports.length === 0) {
  throw new Error('No lazy route imports were found in src/config/navLinks.ts.');
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

const routeChunks = new Map();
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
  const previousPage = routeChunks.get(chunk.file);
  if (previousPage) {
    failures.push(
      `${page}: shares route chunk ${chunk.file} with ${previousPage}`,
    );
  } else {
    routeChunks.set(chunk.file, page);
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
    `iROC ${delivery} budget: ${label} ${file} ${sizeInKiB} KiB / ${budgetInKiB} KiB`,
  );
  if (size > maxBytes) {
    failures.push(
      `${label} (${delivery}) is ${sizeInKiB} KiB, over the ${budgetInKiB} KiB budget`,
    );
  }
}

if (failures.length > 0) {
  throw new Error(`iROC production bundle check failed:\n- ${failures.join('\n- ')}`);
}

console.info(
  `iROC route chunk and bundle budget checks passed for ${pageImports.length} routed pages.`,
);