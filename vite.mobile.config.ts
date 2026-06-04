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

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const platform = (process.env['VITE_PLATFORM'] as string) ?? 'android';
const isIos = platform === 'ios';

/**
 * Rewrites the HTML entry so it loads mobile/index.tsx instead of index.tsx,
 * and injects the mobile viewport meta tag (with viewport-fit=cover for
 * iPhone notch / Dynamic Island support).
 *
 * This runs at transform time on the HTML file itself, before any JS is
 * bundled, so the Electron entry is never imported and never reaches the
 * mobile bundle.
 */
function mobileEntryPlugin(): Plugin {
  return {
    name: 'mobile-entry',
    transformIndexHtml(html) {
      return html
        // Swap Electron entry for mobile entry
        .replace(
          '<script type="module" src="/src/index.tsx"></script>',
          '<script type="module" src="/src/mobile/index.tsx"></script>'
        )
        // Inject viewport meta (required for correct mobile rendering;
        // viewport-fit=cover makes env(safe-area-inset-*) work on iOS notch/Dynamic Island)
        .replace(
          '<meta charset="UTF-8" />',
          '<meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />'
        )
        // Pre-seed window.__capacitorApi so the Vite define fallback
        // (window.__capacitorApi ?? {}) never resolves to a bare {} that
        // has no .log namespace. Any code that fires before mobile/index.tsx
        // attaches the real shim will get a no-op proxy instead of a crash.
        // The real mobileApi object overwrites this in mobile/index.tsx.
        .replace(
          '</head>',
          `  <script>
    /* Capacitor API bootstrap — guarantees window.__capacitorApi exists before
       any ES module evaluates, so (window.__capacitorApi??{}).log.sendLogs
       never throws "undefined is not an object". The real mobileApi shim
       (attached in mobile/index.tsx) overwrites this proxy on first import. */
    (function() {
      var noop = function() { return Promise.resolve(undefined); };
      var ns = new Proxy({}, {
        get: function(_, prop) {
          return prop === 'then' ? undefined : new Proxy(noop, {
            get: function(fn, p) { return p === 'then' ? undefined : ns[p] ?? noop; },
            apply: function() { return Promise.resolve(undefined); }
          });
        }
      });
      window.__capacitorApi = ns;
    })();
  </script>
</head>`
        )
    },
  };
}

export default defineConfig({
  plugins: [mobileEntryPlugin(), react()],
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  define: {
    'import.meta.env.VITE_PLATFORM': JSON.stringify(platform),
    // Route all window.api.* calls to the Capacitor shim set up by mobile/index.tsx
    'window.api': '(window.__capacitorApi ?? {})',
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
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