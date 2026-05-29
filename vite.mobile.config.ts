/**
 * vite.mobile.config.ts
 *
 * Vite config for the Capacitor (iOS / Android) build.
 *
 * VITE_PLATFORM env var must be set before running:
 *   VITE_PLATFORM=ios     → strips ALL download/plugin/DJ code
 *   VITE_PLATFORM=android → keeps all features, uses Capacitor APIs
 *
 * Output: out/renderer-mobile  (Capacitor's webDir)
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const platform = (process.env['VITE_PLATFORM'] as string) ?? 'android';
const isIos = platform === 'ios';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  define: {
    'import.meta.env.VITE_PLATFORM': JSON.stringify(platform),
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      // Stub out Electron-only modules so they never reach the mobile bundle
      ...(isIos
        ? {
            '@renderer/plugins/registry':
              resolve(__dirname, 'src/renderer/src/mobile/stubs/registry.stub.ts'),
            '@renderer/components/Download/DownloadPage':
              resolve(__dirname, 'src/renderer/src/mobile/stubs/null.stub.ts'),
            '@renderer/components/DjMode/DjModePage':
              resolve(__dirname, 'src/renderer/src/mobile/stubs/null.stub.ts'),
            '@renderer/components/PluginsPage/PluginsPage':
              resolve(__dirname, 'src/renderer/src/mobile/stubs/null.stub.ts'),
          }
        : {}),
    },
  },
  build: {
    outDir: resolve(__dirname, 'out/renderer-mobile'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html'),
      treeshake: {
        moduleSideEffects: false,
        propertyReadSideEffects: false,
      },
    },
    minify: 'esbuild',
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
  },
});
