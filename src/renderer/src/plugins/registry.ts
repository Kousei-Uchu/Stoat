/**
 * Plugin Registry — manages installed plugins and their enabled/disabled state.
 * State is persisted to localStorage under the key 'plugin_registry'.
 *
 * This file is ONLY imported on non-iOS platforms.
 * The iOS build never touches this module.
 */

import type { InstalledPlugin, NPluginManifest } from './types';

const STORAGE_KEY = 'nora_plugin_registry';

function loadRegistry(): InstalledPlugin[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as InstalledPlugin[]) : [];
  } catch {
    return [];
  }
}

function saveRegistry(plugins: InstalledPlugin[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plugins));
}

/** Get all installed plugins */
export function getInstalledPlugins(): InstalledPlugin[] {
  const stored = loadRegistry();
  // Merge with built-ins, ensuring built-ins always appear
  const builtinIds = new Set(BUILTIN_PLUGINS.map((p) => p.id));
  const storedNonBuiltin = stored.filter((p) => !builtinIds.has(p.id));
  const storedBuiltins = stored.filter((p) => builtinIds.has(p.id));

  return [
    ...BUILTIN_PLUGINS.map((bp) => {
      const persisted = storedBuiltins.find((s) => s.id === bp.id);
      return persisted ?? { ...bp, status: 'enabled' as const, installedAt: Date.now() };
    }),
    ...storedNonBuiltin,
  ];
}

/** Enable a plugin */
export function enablePlugin(id: string): InstalledPlugin[] {
  const plugins = getInstalledPlugins();
  const updated = plugins.map((p) => (p.id === id ? { ...p, status: 'enabled' as const } : p));
  saveRegistry(updated);
  return updated;
}

/** Disable a plugin */
export function disablePlugin(id: string): InstalledPlugin[] {
  const plugins = getInstalledPlugins();
  const updated = plugins.map((p) =>
    p.id === id && !p.builtin ? { ...p, status: 'disabled' as const } : p
  );
  saveRegistry(updated);
  return updated;
}

/** Install a plugin from a store manifest */
export function installPlugin(manifest: NPluginManifest): InstalledPlugin[] {
  const plugins = getInstalledPlugins();
  const existing = plugins.findIndex((p) => p.id === manifest.id);
  const entry: InstalledPlugin = { ...manifest, status: 'enabled', installedAt: Date.now() };
  const updated = existing >= 0 ? plugins.map((p, i) => (i === existing ? entry : p)) : [...plugins, entry];
  saveRegistry(updated);
  return updated;
}

/** Uninstall a non-builtin plugin */
export function uninstallPlugin(id: string): InstalledPlugin[] {
  const plugins = getInstalledPlugins();
  const updated = plugins.filter((p) => p.id !== id || p.builtin);
  saveRegistry(updated);
  return updated;
}

/** Check if a plugin is currently enabled */
export function isPluginEnabled(id: string): boolean {
  return getInstalledPlugins().some((p) => p.id === id && p.status === 'enabled');
}

// ─── Built-in plugin definitions ─────────────────────────────────────────────
// These are always present in the registry. They cannot be uninstalled,
// only disabled.

export const BUILTIN_PLUGINS: NPluginManifest[] = [
  {
    id: 'dev.nora.downloader',
    name: 'Nora Downloader',
    version: '1.0.0',
    description:
      'Download songs from YouTube, YouTube Music, Spotify, SoundCloud and more. Supports playlists, albums, and full artist discographies. Uses yt-dlp under the hood — auto-downloaded on first use.',
    readme: `## Nora Downloader\n\nSearch for any song by name, or paste a URL from YouTube, YouTube Music, Spotify, SoundCloud, or any yt-dlp–supported service.\n\n**Spotify support** (no login required) — paste a track, album, playlist, or artist URL and Nora resolves it using Spotify's public metadata API, then finds the best matching version on YouTube Music using confidence scoring to avoid instrumentals, covers, remixes, etc.\n\n**Batch downloads** — albums, playlists, and artist discographies all download automatically track by track.\n\n**Lyrics** — synced .lrc files are downloaded alongside audio and appear in the Lyrics tab automatically.\n\n**Formats** — MP3 (128/192/320kbps), FLAC, WAV, OGG, AAC, M4A, Opus.`,
    author: 'Sorren (@Kousei-Uchu)',
    authorUrl: 'https://github.com/Kousei-Uchu',
    repoUrl: 'https://github.com/Kousei-Uchu/Nora',
    iconUrl: undefined,
    source: 'official',
    category: 'downloader',
    builtin: true,
    tags: ['download', 'youtube', 'spotify', 'soundcloud', 'yt-dlp', 'lyrics'],
  },
  {
    id: 'dev.nora.dj',
    name: 'DJ Mode',
    version: '1.0.0',
    description:
      'AI-powered DJ with voice announcements between tracks, mood-based queuing, crossfade, and loudness normalisation. Uses on-device TTS — no audio leaves your device.',
    author: 'Sorren (@Kousei-Uchu)',
    authorUrl: 'https://github.com/Kousei-Uchu',
    source: 'official',
    category: 'player',
    builtin: true,
    tags: ['dj', 'ai', 'tts', 'crossfade', 'announcements'],
  },
];

// ─── Official store catalog ───────────────────────────────────────────────────
// In a real deployment this would be fetched from a remote endpoint.
// For now it's a static list merged with installed state.

export const OFFICIAL_STORE_PLUGINS: NPluginManifest[] = [
  ...BUILTIN_PLUGINS,
  {
    id: 'dev.nora.scrobbler',
    name: 'Last.fm Scrobbler',
    version: '1.0.0',
    description: 'Scrobble every song you listen to on Last.fm.',
    author: 'Sorren (@Kousei-Uchu)',
    source: 'official',
    category: 'sharing',
    builtin: false,
    tags: ['lastfm', 'scrobbling', 'social'],
    downloads: 4200,
    rating: 4.8,
  },
  {
    id: 'dev.nora.discord-rpc',
    name: 'Discord Rich Presence',
    version: '1.0.0',
    description: 'Show what you\'re listening to in Discord.',
    author: 'Sorren (@Kousei-Uchu)',
    source: 'official',
    category: 'sharing',
    builtin: false,
    tags: ['discord', 'rpc', 'social'],
    downloads: 3800,
    rating: 4.7,
  },
  {
    id: 'dev.nora.lrclib',
    name: 'LRClib Lyrics',
    version: '1.0.0',
    description: 'Fetch synced and unsynced lyrics from LRClib.net.',
    author: 'Sorren (@Kousei-Uchu)',
    source: 'official',
    category: 'lyrics',
    builtin: false,
    tags: ['lyrics', 'lrclib', 'synced'],
    downloads: 5100,
    rating: 4.9,
  },
];

export const COMMUNITY_STORE_PLUGINS: NPluginManifest[] = [
  {
    id: 'community.nora.visualizer',
    name: 'Audio Visualizer',
    version: '0.9.2',
    description: 'Adds a real-time audio visualizer to the now-playing screen.',
    author: 'wavydev',
    source: 'community',
    category: 'visualizer',
    builtin: false,
    tags: ['visualizer', 'waveform', 'bars'],
    downloads: 1230,
    rating: 4.3,
  },
  {
    id: 'community.nora.sleep-timer',
    name: 'Sleep Timer',
    version: '1.1.0',
    description: 'Automatically pause playback after a set duration.',
    author: 'nightcoder',
    source: 'community',
    category: 'utility',
    builtin: false,
    tags: ['timer', 'sleep', 'utility'],
    downloads: 890,
    rating: 4.5,
  },
  {
    id: 'community.nora.musixmatch',
    name: 'Musixmatch Lyrics',
    version: '2.0.1',
    description: 'Fetch lyrics from Musixmatch (requires Musixmatch account).',
    author: 'lyricsdev',
    source: 'community',
    category: 'lyrics',
    builtin: false,
    tags: ['lyrics', 'musixmatch', 'synced'],
    downloads: 2100,
    rating: 4.1,
  },
  {
    id: 'community.nora.spotify-sync',
    name: 'Spotify Library Sync',
    version: '0.7.0',
    description: 'Sync your Spotify liked songs and playlists to your local library.',
    author: 'syncmaster',
    source: 'community',
    category: 'metadata',
    builtin: false,
    tags: ['spotify', 'sync', 'library', 'playlists'],
    downloads: 670,
    rating: 3.9,
  },
];
