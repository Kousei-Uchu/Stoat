/**
 * mobileApi.ts — Capacitor API shim
 *
 * On mobile (iOS/Android) there is no Electron preload and no window.api.
 * This module provides the same interface shape but implemented with
 * Capacitor plugins or safe no-ops, so shared components never throw when
 * they call window.api.*.
 *
 * Attached to window.__capacitorApi by mobile/index.tsx.
 * vite.mobile.config.ts defines:   window.api = window.__capacitorApi ?? {}
 *
 * Namespaces that have real mobile implementations are filled in;
 * everything else returns notAvailable() which resolves to undefined and
 * logs a single warning in non-iOS builds.
 */

import { IS_IOS } from '../platform';

// ─── Stub factory ─────────────────────────────────────────────────────────────

function notAvailable(name: string) {
  return (..._args: unknown[]): Promise<undefined> => {
    if (!IS_IOS) console.warn(`[Nora mobile] ${name} is not available on mobile.`);
    return Promise.resolve(undefined);
  };
}

/** Makes every property of an object a notAvailable stub. Saves boilerplate. */
function stubNamespace<T extends Record<string, unknown>>(
  ns: string,
  keys: (keyof T)[]
): T {
  return Object.fromEntries(keys.map((k) => [k, notAvailable(`${ns}.${String(k)}`)])) as T;
}

// ─── properties ───────────────────────────────────────────────────────────────

const properties = {
  isInDevelopment: import.meta.env.DEV,
  commandLineArgs: [] as string[],
  platform: 'mobile' as string,
  appVersion: '1.0.0',
};

// ─── playerControls ───────────────────────────────────────────────────────────
// Media controls go through the OS media session (useMediaSession hook uses
// the standard Web Media Session API — no IPC needed).

const playerControls = {
  songPlaybackStateChange: notAvailable('playerControls.songPlaybackStateChange'),
  setDiscordRpcActivity: notAvailable('playerControls.setDiscordRpcActivity'),
  toggleLikeSongs: notAvailable('playerControls.toggleLikeSongs'),
  toggleSongPlayback: notAvailable('playerControls.toggleSongPlayback'),
  skipForwardToNextSong: notAvailable('playerControls.skipForwardToNextSong'),
  skipBackwardToPreviousSong: notAvailable('playerControls.skipBackwardToPreviousSong'),
  sendSongPosition: notAvailable('playerControls.sendSongPosition'),
  removeTogglePlaybackStateEvent: notAvailable('playerControls.removeTogglePlaybackStateEvent'),
  removeSkipBackwardToPreviousSongEvent: notAvailable('playerControls.removeSkipBackwardToPreviousSongEvent'),
  removeSkipForwardToNextSongEvent: notAvailable('playerControls.removeSkipForwardToNextSongEvent'),
};

// ─── windowControls ───────────────────────────────────────────────────────────

const windowControls = {
  minimizeApp: notAvailable('windowControls.minimizeApp'),
  toggleMaximizeApp: notAvailable('windowControls.toggleMaximizeApp'),
  hideApp: notAvailable('windowControls.hideApp'),
  showApp: notAvailable('windowControls.showApp'),
  changePlayerType: notAvailable('windowControls.changePlayerType'),
  onWindowFocus: notAvailable('windowControls.onWindowFocus'),
  onWindowBlur: notAvailable('windowControls.onWindowBlur'),
  closeApp: () => {
    if (!IS_IOS && typeof (window as any).Capacitor !== 'undefined') {
      (window as any).Capacitor?.Plugins?.App?.exitApp?.();
    }
  },
};

// ─── appControls ──────────────────────────────────────────────────────────────

const appControls = {
  restartRenderer: notAvailable('appControls.restartRenderer'),
  openExternalLink: (url: string) => {
    // On mobile, open in the system browser
    window.open(url, '_blank');
    return Promise.resolve();
  },
};

// ─── theme ────────────────────────────────────────────────────────────────────

const theme = {
  changeAppTheme: notAvailable('theme.changeAppTheme'),
  listenForSystemThemeChanges: notAvailable('theme.listenForSystemThemeChanges'),
  stoplisteningForSystemThemeChanges: notAvailable('theme.stoplisteningForSystemThemeChanges'),
};

// ─── settings ─────────────────────────────────────────────────────────────────

const MOBILE_SETTINGS_KEY = 'nora_mobile_settings';

function loadMobileSettings(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(MOBILE_SETTINGS_KEY) ?? '{}');
  } catch { return {}; }
}

function saveMobileSettings(patch: Record<string, unknown>) {
  const current = loadMobileSettings();
  localStorage.setItem(MOBILE_SETTINGS_KEY, JSON.stringify({ ...current, ...patch }));
}

const settings = {
  getUserSettings: (): Promise<Record<string, unknown>> => {
    const s = loadMobileSettings();
    return Promise.resolve({
      language: 'en',
      isDarkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
      ...s,
    });
  },
  saveUserSettings: (patch: Record<string, unknown>): Promise<void> => {
    saveMobileSettings(patch);
    return Promise.resolve();
  },
  updateDiscordRpcState: notAvailable('settings.updateDiscordRpcState'),
  updateSongScrobblingToLastFMState: notAvailable('settings.updateSongScrobblingToLastFMState'),
  updateSongFavoritesToLastFMState: notAvailable('settings.updateSongFavoritesToLastFMState'),
  updateNowPlayingSongDataToLastFMState: notAvailable('settings.updateNowPlayingSongDataToLastFMState'),
  updateOpenWindowAsHiddenOnSystemStart: notAvailable('settings.updateOpenWindowAsHiddenOnSystemStart'),
  updateHideWindowOnCloseState: notAvailable('settings.updateHideWindowOnCloseState'),
  updateSaveVerboseLogs: notAvailable('settings.updateSaveVerboseLogs'),
};

// ─── settingsHelpers ──────────────────────────────────────────────────────────

const settingsHelpers = {
  networkStatusChange: (isOnline: boolean) => {
    // No-op on mobile — network state is handled by Capacitor Network plugin if needed
    if (import.meta.env.DEV) console.debug('[Nora mobile] network status:', isOnline);
    return Promise.resolve();
  },
  toggleAutoLaunch: notAvailable('settingsHelpers.toggleAutoLaunch'),
  loginToLastFmInBrowser: notAvailable('settingsHelpers.loginToLastFmInBrowser'),
};

// ─── userData ─────────────────────────────────────────────────────────────────

const userData = {
  saveUserData: (key: string, value: unknown): Promise<void> => {
    saveMobileSettings({ [key]: value });
    return Promise.resolve();
  },
  getUserData: settings.getUserSettings,
};

// ─── songs / audioLibraryControls ─────────────────────────────────────────────

const songs = stubNamespace('songs', [
  'getAllSongs', 'getSongInfo', 'getSongLyrics', 'addToFavorites',
  'removeFromFavorites', 'updateSongListeningData',
]);

const audioLibraryControls = stubNamespace('audioLibraryControls', [
  'addMusicFolder', 'removeMusicFolder', 'rescanLibrary',
  'restoreBlacklistedSongs', 'restoreBlacklistedFolder',
  'checkForNewSongs', 'startLibraryScan', 'abortLibraryScan',
  'onSongAdded', 'onSongRemoved', 'onLibraryScanComplete',
  'removeOnSongAdded', 'removeOnSongRemoved', 'removeOnLibraryScanComplete',
  'blacklistSongs', 'deleteSongsFromSystem',
  'getSongInfo', 'getAllSongs', 'updateSongId3Tags',
]);

// ─── songUpdates ──────────────────────────────────────────────────────────────

const songUpdates = stubNamespace('songUpdates', [
  'reParseSong', 'updateSongId3Tags', 'getSongId3Tags',
  'getImgFileLocation', 'revealSongInFileExplorer',
]);

// ─── artistsData ──────────────────────────────────────────────────────────────

const artistsData = stubNamespace('artistsData', [
  'getArtistData', 'getAllArtists', 'toggleLikeArtists',
  'getArtistInfoFromNet', 'fetchArtistData',
]);

// ─── albumsData ───────────────────────────────────────────────────────────────

const albumsData = stubNamespace('albumsData', [
  'getAlbumData', 'getAllAlbums', 'fetchAlbumData',
]);

// ─── genresData ───────────────────────────────────────────────────────────────

const genresData = stubNamespace('genresData', [
  'getGenreData', 'getAllGenres', 'getGenresInfo',
]);

// ─── playlistsData ────────────────────────────────────────────────────────────

const playlistsData = stubNamespace('playlistsData', [
  'getAllPlaylists', 'getPlaylistData', 'sendPlaylistData',
  'addNewPlaylist', 'removePlaylists', 'addSongsToPlaylist',
  'removeSongFromPlaylist', 'renameAPlaylist', 'addArtworkToPlaylist',
  'exportPlaylist', 'importPlaylist',
]);

// ─── lyrics ───────────────────────────────────────────────────────────────────

const lyrics = stubNamespace('lyrics', [
  'getSongLyrics', 'saveLyricsToSong', 'getTranslatedLyrics',
  'convertLyricsToPinyin', 'romanizeLyrics', 'convertLyricsToRomaja',
  'resetLyrics',
]);

// ─── search ───────────────────────────────────────────────────────────────────

const search = stubNamespace('search', [
  'searchSongMetadataResultsInInternet', 'getSearchResults',
  'clearSearchHistory',
]);

// ─── utils ────────────────────────────────────────────────────────────────────

const utils = {
  getBaseName: (filePath: string): string => filePath.split(/[\\/]/).pop() ?? filePath,
  getExtension: (filePath: string): string => filePath.split('.').pop() ?? '',
  ...stubNamespace('utils', [
    'openInFileBrowser', 'revealInFileExplorer', 'getStorageUsage',
  ]),
};

// ─── log ──────────────────────────────────────────────────────────────────────

const log = {
  // Called by src/renderer/src/utils/log.ts on every log event
  sendLogs: (
    message: unknown,
    data: unknown,
    logType: string,
    _forceWindowRestart: boolean,
    _forceMainRestart: boolean
  ) => {
    if (logType === 'ERROR') console.error('[Nora]', message, data);
    else if (logType === 'WARN') console.warn('[Nora]', message, data);
    else console.log('[Nora]', message, data);
  },
  openLogFile: notAvailable('log.openLogFile'),
  exportDownloadLogs: notAvailable('log.exportDownloadLogs'),
};

// ─── folderData ───────────────────────────────────────────────────────────────

const folderData = stubNamespace('folderData', [
  'getFolderStructures', 'getMusicFolderData', 'revealFolderInFileExplorer',
  'blacklistFolders', 'restoreBlacklistedFolders',
]);

// ─── dataUpdates ──────────────────────────────────────────────────────────────

const dataUpdates = stubNamespace('dataUpdates', [
  'onDataUpdate', 'removeOnDataUpdate',
]);

// ─── messages ─────────────────────────────────────────────────────────────────

const messages = stubNamespace('messages', [
  'onMessageEvent', 'removeOnMessageEvent',
]);

// ─── quitEvent ────────────────────────────────────────────────────────────────

const quitEvent = stubNamespace('quitEvent', [
  'onQuit', 'removeOnQuit',
]);

// ─── fullscreen ───────────────────────────────────────────────────────────────

const fullscreen = {
  toggleFullscreen: notAvailable('fullscreen.toggleFullscreen'),
  isFullscreen: () => Promise.resolve(false),
};

// ─── storageData ──────────────────────────────────────────────────────────────

const storageData = stubNamespace('storageData', [
  'getStorageUsage', 'clearTempArtworks',
]);

// ─── queue ────────────────────────────────────────────────────────────────────

const queue = stubNamespace('queue', [
  'getQueueInfo', 'clearQueue', 'addToQueue', 'removeFromQueue',
]);

// ─── miniPlayer ───────────────────────────────────────────────────────────────

const miniPlayer = stubNamespace('miniPlayer', [
  'toggleMiniPlayerAlwaysOnTop', 'openMiniPlayer', 'closeMiniPlayer',
]);

// ─── unknownSource ────────────────────────────────────────────────────────────

const unknownSource = stubNamespace('unknownSource', [
  'getUnknownSongs', 'resolveUnknownSongs',
]);

// ─── Assemble ─────────────────────────────────────────────────────────────────

export const mobileApi = {
  properties,
  playerControls,
  windowControls,
  appControls,
  theme,
  settings,
  settingsHelpers,
  userData,
  songs,
  audioLibraryControls,
  songUpdates,
  artistsData,
  albumsData,
  genresData,
  playlistsData,
  lyrics,
  search,
  utils,
  log,
  folderData,
  dataUpdates,
  messages,
  quitEvent,
  fullscreen,
  storageData,
  queue,
  miniPlayer,
  unknownSource,
};

export type MobileApi = typeof mobileApi;