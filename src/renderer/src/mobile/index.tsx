/**
 * mobile/index.tsx — Capacitor app entry point
 *
 * Imported by src/renderer/index.html when built with vite.mobile.config.ts.
 * Sets up window.__capacitorApi before the rest of the app loads, so
 * all window.api.* calls transparently use mobile implementations.
 *
 * NO download, plugin, or DJ references exist in this file or its imports.
 * The vite alias map in vite.mobile.config.ts ensures those modules are
 * replaced by stubs before tree-shaking.
 */

import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { IS_IOS } from '../platform';
import { mobileApi } from './mobileApi';

// ─── Attach mobile API shim BEFORE React renders ──────────────────────────────
// The Vite define maps `window.api` → `window.__capacitorApi || {}`
// so every call to window.api.* in shared components hits this object.
(window as any).__capacitorApi = mobileApi;

// ─── iOS-specific setup ───────────────────────────────────────────────────────
async function initCapacitor() {
  if (IS_IOS) {
    try {
      await StatusBar.setStyle({ style: Style.Default });
      await StatusBar.setOverlaysWebView({ value: false });
    } catch { /* StatusBar not available in web preview */ }
  }

  try {
    await SplashScreen.hide({ fadeOutDuration: 200 });
  } catch { /* SplashScreen not available in web */ }
}

// Kick off Capacitor setup (non-blocking — React renders in parallel)
initCapacitor().catch(() => {});

// ─── Boot the React app ───────────────────────────────────────────────────────
// Import the shared renderer entry (which renders <App /> via the router)
// The stubs from vite.mobile.config.ts aliases replace download/plugin pages.
import('../index');
