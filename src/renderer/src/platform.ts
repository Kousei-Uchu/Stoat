/**
 * platform.ts — single source of truth for build-time platform detection.
 *
 * VITE_PLATFORM is injected at build time:
 *   electron  →  normal desktop build (default)
 *   ios       →  Capacitor iOS build   (NO download/plugin code whatsoever)
 *   android   →  Capacitor Android build
 *
 * All guards should import from here — never read import.meta.env directly.
 */

export const PLATFORM = (import.meta.env.VITE_PLATFORM as string) || 'electron';

export const IS_ELECTRON = PLATFORM === 'electron';
export const IS_IOS = PLATFORM === 'ios';
export const IS_ANDROID = PLATFORM === 'android';
export const IS_MOBILE = IS_IOS || IS_ANDROID;
export const IS_CAPACITOR = IS_MOBILE;

/**
 * True when the platform supports the plugin system and downloading.
 * iOS NEVER supports this — not even the concept is exposed.
 */
export const SUPPORTS_PLUGINS = !IS_IOS;
