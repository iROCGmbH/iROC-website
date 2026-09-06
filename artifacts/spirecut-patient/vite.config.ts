import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icons/*.png'],
        manifest: {
          name: 'Spirecut for Patients',
          short_name: 'Spirecut',
          description: 'Bilingual patient information and support for Spirecut treatments.',
          theme_color: '#C41230',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait',
          start_url: basePath,
          scope: basePath,
          icons: [
            {
              src: 'icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webm}'],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          navigateFallback: null,
        },
        devOptions: {
          // Keep the routed preview installable as well, so Android and iOS
          // onboarding can be verified against the same manifest used in builds.
          enabled: true,
        },
      }),
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
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
      manifest: true,
      // check-route-chunks.mjs enforces a 512 KiB initial entry budget. Chatbot
      // PDF generation is loaded only after a completed conversation and has a
      // separate 1.6 MB budget.
      chunkSizeWarningLimit: 1600,
    },
    server: {
      port,
      strictPort: true,
      host: '0.0.0.0',
      allowedHosts: true,
      // Vite dev server automatically falls back to index.html for unknown paths
      // when appType is "spa" (the default), so the React router handles 404s.
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
      // Vite preview also falls back to index.html for unknown paths by default
      // when appType is "spa" (the default).  No additional configuration needed.
    },
  };
});
