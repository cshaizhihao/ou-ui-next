import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: env.VITE_ASSET_BASE || '/',
    plugins: [react()],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      pool: 'forks',
      fileParallelism: false,
      poolOptions: {
        forks: {
          singleFork: true,
          minForks: 1,
          maxForks: 1
        }
      }
    }
  };
});
