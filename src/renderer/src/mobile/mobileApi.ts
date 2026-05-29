/**
 * mobileApi.ts — Capacitor API shim
 *
 * On mobile (iOS/Android) there is no Electron preload and no window.api.
 * This module provides the same interface shape but implemented with
 * Capacitor plugins (Filesystem, Media, etc.).
 *
 * It is imported by mobile/index.tsx and attached to window.__capacitorApi
 * so the Vite define('window.api', 'window.__capacitorApi || {}') in
 * vite.mobile.config.ts routes calls here transparently.
 *
 * Note: The downloader and plugin-registry sections are completely absent
 * — they are not referenced, not imported, not present in any form.
 */

import { IS_IOS } from '../platform';

// ─── Stub helpers ─────────────────────────────────────────────────────────────

function notAvailable(name: string) {
  return (..._args: unknown[]) => {
    if (!IS_IOS) {
      console.warn(`[Nora mobile] ${name} is not available on mobile.`);
    }
    return Promise.resolve(undefined);
  };
}

// ─── properties ──────────────────────────────────────────────────────────────

const properties = {
  isInDevelopment: import.meta.env.DEV,
  appVersion: '1.0.0',
};

// ─── playerControls ──────────────────────────────────────────────────────────
// On mobile, media controls go through the OS media session (handled in
// useMediaSession hook which already uses the Web Media Session API).

const playerControls = {
  setDiscordRpcActivity: notAvailable('setDiscordRpcActivity'),
  updateSongPlaybackState: notAvailable('updateSongPlaybackState'),
};

// ─── windowControls ──────────────────────────────────────────────────────────

const windowControls = {
  changePlayerType: notAvailable('changePlayerType'),
  minimizeApp: notAvailable('minimizeApp'),
  maximizeApp: notAvailable('maximizeApp'),
  closeApp: () => {
    // On iOS/Android, use the native back-button / home gesture
    if (!IS_IOS && typeof (window as any).Capacitor !== 'undefined') {
      (window as any).Capacitor?.Plugins?.App?.exitApp?.();
    }
  },
};

// ─── settings ────────────────────────────────────────────────────────────────

const settings = {
  getUserSettings: notAvailable('getUserSettings'),
  updateDiscordRpcState: notAvailable('updateDiscordRpcState'),
  updateSongScrobblingToLastFMState: notAvailable('updateSongScrobblingToLastFMState'),
  updateSongFavoritesToLastFMState: notAvailable('updateSongFavoritesToLastFMState'),
  updateNowPlayingSongDataToLastFMState: notAvailable('updateNowPlayingSongDataToLastFMState'),
};

// ─── songs ───────────────────────────────────────────────────────────────────

const songs = {
  getAllSongs: notAvailable('getAllSongs'),
};

// ─── songUpdates ─────────────────────────────────────────────────────────────

const songUpdates = {
  reParseSong: notAvailable('reParseSong'),
  updateSongId3Tags: notAvailable('updateSongId3Tags'),
  getSongId3Tags: notAvailable('getSongId3Tags'),
  getImgFileLocation: notAvailable('getImgFileLocation'),
  revealSongInFileExplorer: notAvailable('revealSongInFileExplorer'),
};

// ─── Assemble ─────────────────────────────────────────────────────────────────

export const mobileApi = {
  properties,
  playerControls,
  windowControls,
  settings,
  songs,
  songUpdates,
};

export type MobileApi = typeof mobileApi;
