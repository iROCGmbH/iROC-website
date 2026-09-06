import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

import { describe, expect, it } from 'vitest';

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function lintNavLinksFixture(source: string) {
  const eslint = new ESLint({
    cwd: websiteRoot,
    overrideConfigFile: path.join(websiteRoot, 'eslint.config.js'),
  });

  const [result] = await eslint.lintText(source, {
    filePath: 'src/config/navLinks.ts',
  });

  return result.messages.filter(({ ruleId }) => ruleId === 'no-restricted-syntax');
}

describe('navLinks eager route guard', () => {
  it('rejects eager aliases and namespace members but accepts lazy routes', async () => {
    const messages = await lintNavLinksFixture(`
      import React, { lazy } from 'react';

      const pageModules = { Home: {} };
      const importedPage = {};
      const aliasedPage = importedPage;

      const routes = [
        { component: aliasedPage },
        { component: pageModules.Home },
        { component: lazy(() => import('@/pages/Home')) },
        { component: React.lazy(() => import('@/pages/Contact')) },
      ];
    `);

    expect(messages).toHaveLength(2);
    expect(messages.every(({ message }) =>
      message.includes('Route components in navLinks.ts must be wrapped in React.lazy'),
    )).toBe(true);
  });
});