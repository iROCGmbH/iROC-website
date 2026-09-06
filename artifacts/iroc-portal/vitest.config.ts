import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const basePath = process.env.BASE_PATH ?? '/iroc-portal';

export default defineConfig({
  plugins: [react()],
  define: {
    __TEST_BASE_PATH__: JSON.stringify(basePath),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
});