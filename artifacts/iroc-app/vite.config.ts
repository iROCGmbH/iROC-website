import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

export default defineConfig(async ({ command }) => {
  const isServing = command === 'serve';
  const rawPort = process.env.PORT;
  const basePath = isServing ? process.env.BASE_PATH : (process.env.BASE_PATH || '/');

  if (isServing && !rawPort) {
    throw new Error('PORT environment variable is required but was not provided.');
  }

  if (!basePath) {
    throw new Error('BASE_PATH environment variable is required but was not provided.');
  }

  const port = isServing ? Number(rawPort) : undefined;

  if (port !== undefined && (Number.isNaN(port) || port <= 0)) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(isServing && process.env.REPL_ID !== undefined
        ? [
            await import('@replit/vite-plugin-cartographer').then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, '..'),
              }),
            ),
            await import('@replit/vite-plugin-dev-banner').then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'attached_assets',
        ),
        // The localized picker is a source-only shared module outside this
        // artifact. Resolve its JSX runtime through the consuming artifact's
        // dependency boundary rather than looking for a non-existent
        // lib/node_modules/react installation.
        'react': path.resolve(import.meta.dirname, 'node_modules/react'),
        'react-dom': path.resolve(import.meta.dirname, 'node_modules/react-dom'),
        'react/jsx-runtime': path.resolve(import.meta.dirname, 'node_modules/react/jsx-runtime.js'),
        'react/jsx-dev-runtime': path.resolve(import.meta.dirname, 'node_modules/react/jsx-dev-runtime.js'),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
      manifest: true,
      // check-route-chunks.mjs enforces a 512 KiB initial entry budget. The PDF
      // renderer is intentionally isolated behind certificate actions with a
      // separate 1.6 MB budget.
      chunkSizeWarningLimit: 1600,
    },
    server: {
      port,
      strictPort: true,
      host: '0.0.0.0',
      allowedHosts: true,
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
      historyApiFallback: true,
    },
  };
});
