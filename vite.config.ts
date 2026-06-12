import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

function createClientManualChunks(id: string) {
  if (!id.includes('node_modules')) {
    return undefined;
  }

  if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
    return 'vendor-react';
  }

  if (id.includes('/@tanstack/')) {
    return 'vendor-tanstack';
  }

  if (id.includes('/lucide-react/')) {
    return 'vendor-icons';
  }

  if (
    id.includes('/@hookform/') ||
    id.includes('/react-hook-form/') ||
    id.includes('/zod/')
  ) {
    return 'vendor-forms';
  }

  if (id.includes('/i18next/') || id.includes('/react-i18next/')) {
    return 'vendor-i18n';
  }

  if (id.includes('/qrcode/') || id.includes('/yaml/')) {
    return 'vendor-io';
  }

  if (id.includes('/zustand/') || id.includes('/clsx/') || id.includes('/tailwind-merge/')) {
    return 'vendor-ui-utils';
  }

  return 'vendor-misc';
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: env.VITE_ASSET_BASE || '/',
    build: {
      rollupOptions: {
        output: {
          manualChunks: createClientManualChunks
        }
      }
    },
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
