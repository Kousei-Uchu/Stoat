/**
 * Nora Plugin System — type definitions
 *
 * A NPlugin is a self-contained feature that can be:
 *  - Built-in (ships with Nora, always available on supported platforms)
 *  - Official (published by Sorren/@Kousei-Uchu, reviewed and signed)
 *  - Community (published by third-party developers)
 *
 * Plugins are never present on iOS — the entire plugin system is excluded
 * from the iOS build at compile time.
 */

export type PluginCategory =
  | 'downloader'
  | 'player'
  | 'lyrics'
  | 'metadata'
  | 'sharing'
  | 'visualizer'
  | 'theme'
  | 'utility';

export type PluginSource = 'builtin' | 'official' | 'community';

export type PluginStatus = 'enabled' | 'disabled' | 'not_installed' | 'update_available';

/** Metadata stored in the plugin registry / store listing */
export interface NPluginManifest {
  /** Unique reverse-domain identifier, e.g. "dev.nora.downloader" */
  id: string;
  /** Display name */
  name: string;
  /** Semantic version */
  version: string;
  /** One-line description */
  description: string;
  /** Full description (markdown) */
  readme?: string;
  author: string;
  authorUrl?: string;
  /** URL to icon (square, min 64×64) */
  iconUrl?: string;
  /** Repository / homepage */
  repoUrl?: string;
  source: PluginSource;
  category: PluginCategory;
  /** Minimum Nora version required */
  minNoraVersion?: string;
  /** If true, cannot be uninstalled (only disabled) */
  builtin: boolean;
  /** Tags for search */
  tags?: string[];
  /** Download count (store only) */
  downloads?: number;
  /** Store rating 0–5 */
  rating?: number;
  /** Whether a newer version is available in the store */
  updateAvailable?: boolean;
  latestVersion?: string;
}

/** A plugin entry as stored in the local registry */
export interface InstalledPlugin extends NPluginManifest {
  status: 'enabled' | 'disabled';
  installedAt: number;
  /** Path to the plugin's JS bundle inside userData */
  bundlePath?: string;
}

/** The full plugin store catalog entry */
export interface StorePlugin extends NPluginManifest {
  isInstalled: boolean;
  installedVersion?: string;
  status?: PluginStatus;
}
