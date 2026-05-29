/**
 * Plugins Page — manage installed plugins and browse the store.
 * Built-in plugins (Downloader, DJ Mode) are always shown and can only
 * be disabled, not uninstalled.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MainContainer from '../MainContainer';
import TitleContainer from '../TitleContainer';
import {
  BUILTIN_PLUGINS,
  COMMUNITY_STORE_PLUGINS,
  OFFICIAL_STORE_PLUGINS,
  disablePlugin,
  enablePlugin,
  getInstalledPlugins,
  installPlugin,
  uninstallPlugin,
} from '../../plugins/registry';
import type { InstalledPlugin, NPluginManifest, StorePlugin } from '../../plugins/types';

// ─── Sub-components ───────────────────────────────────────────────────────────

function PluginIcon({ plugin }: { plugin: NPluginManifest }) {
  const icons: Record<string, string> = {
    downloader: 'cloud_download',
    player:     'radio',
    lyrics:     'lyrics',
    metadata:   'edit_note',
    sharing:    'share',
    visualizer: 'graphic_eq',
    theme:      'palette',
    utility:    'build',
  };
  const icon = icons[plugin.category] ?? 'extension';

  return plugin.iconUrl ? (
    <img src={plugin.iconUrl} alt={plugin.name} className="h-10 w-10 rounded-xl object-cover" />
  ) : (
    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-font-color-highlight/15 dark:bg-dark-font-color-highlight/15">
      <span className="material-icons-round text-xl text-font-color-highlight dark:text-dark-font-color-highlight">
        {icon}
      </span>
    </div>
  );
}

function SourceBadge({ source }: { source: NPluginManifest['source'] }) {
  const cfg = {
    builtin:   { label: 'Built-in', cls: 'bg-font-color-highlight/15 text-font-color-highlight dark:bg-dark-font-color-highlight/15 dark:text-dark-font-color-highlight' },
    official:  { label: 'Official', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
    community: { label: 'Community', cls: 'bg-background-color-2 text-font-color-black/55 dark:bg-dark-background-color-2 dark:text-font-color-white/55' },
  }[source];
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(i => (
        <span key={i} className={`material-icons-round text-xs leading-none ${i <= Math.round(rating) ? 'text-yellow-400' : 'text-font-color-black/20 dark:text-font-color-white/20'}`}>
          star
        </span>
      ))}
      <span className="ml-1 text-[10px] text-font-color-black/45 dark:text-font-color-white/45">
        {rating.toFixed(1)}
      </span>
    </div>
  );
}

// ─── Installed plugin card ────────────────────────────────────────────────────

function InstalledCard({
  plugin,
  onToggle,
  onUninstall,
}: {
  plugin: InstalledPlugin;
  onToggle: (id: string, enable: boolean) => void;
  onUninstall: (id: string) => void;
}) {
  const enabled = plugin.status === 'enabled';
  return (
    <div className={`flex items-start gap-3 rounded-xl p-3 transition-colors ${enabled ? 'bg-background-color-1 dark:bg-dark-background-color-1' : 'bg-background-color-1/50 opacity-60 dark:bg-dark-background-color-1/50'}`}>
      <PluginIcon plugin={plugin} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">{plugin.name}</span>
          <SourceBadge source={plugin.source} />
          <span className="text-[10px] text-font-color-black/35 dark:text-font-color-white/35">v{plugin.version}</span>
        </div>
        <p className="mt-0.5 text-xs text-font-color-black/55 dark:text-font-color-white/55 line-clamp-2">
          {plugin.description}
        </p>
        <p className="mt-1 text-[11px] text-font-color-black/35 dark:text-font-color-white/35">
          by {plugin.author}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        {/* Toggle */}
        <button
          onClick={() => onToggle(plugin.id, !enabled)}
          className={`relative h-5 w-10 rounded-full transition-colors ${enabled ? 'bg-font-color-highlight dark:bg-dark-font-color-highlight' : 'bg-background-color-2 dark:bg-dark-background-color-2'}`}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${enabled ? 'left-auto right-0.5' : 'left-0.5'}`} />
        </button>
        {/* Uninstall button (not for builtins) */}
        {!plugin.builtin && (
          <button
            onClick={() => onUninstall(plugin.id)}
            title="Uninstall"
            className="rounded p-0.5 text-font-color-black/25 hover:text-red-400 dark:text-font-color-white/25"
          >
            <span className="material-icons-round text-sm leading-none">delete_outline</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Store plugin card ────────────────────────────────────────────────────────

function StoreCard({
  plugin,
  onInstall,
  onUninstall,
}: {
  plugin: StorePlugin;
  onInstall: (p: NPluginManifest) => void;
  onUninstall: (id: string) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-background-color-1 p-3 dark:bg-dark-background-color-1">
      <PluginIcon plugin={plugin} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">{plugin.name}</span>
          <SourceBadge source={plugin.source} />
        </div>
        <p className="mt-0.5 text-xs text-font-color-black/55 dark:text-font-color-white/55 line-clamp-2">
          {plugin.description}
        </p>
        <div className="mt-1 flex items-center gap-3 flex-wrap">
          <p className="text-[11px] text-font-color-black/35 dark:text-font-color-white/35">
            by {plugin.author}
          </p>
          {plugin.rating !== undefined && <StarRating rating={plugin.rating} />}
          {plugin.downloads !== undefined && (
            <span className="text-[10px] text-font-color-black/30 dark:text-font-color-white/30">
              {plugin.downloads.toLocaleString()} installs
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0">
        {plugin.isInstalled ? (
          <div className="flex flex-col items-end gap-1.5">
            {plugin.updateAvailable && (
              <button onClick={() => onInstall(plugin)}
                className="rounded-lg bg-font-color-highlight px-2.5 py-1 text-xs font-medium text-white dark:bg-dark-font-color-highlight dark:text-font-color-black">
                Update
              </button>
            )}
            <span className="text-[10px] text-emerald-500 flex items-center gap-0.5">
              <span className="material-icons-round text-xs leading-none">check_circle</span>
              Installed
            </span>
            {!plugin.builtin && (
              <button onClick={() => onUninstall(plugin.id)}
                className="text-[10px] text-font-color-black/25 hover:text-red-400 dark:text-font-color-white/25">
                Remove
              </button>
            )}
          </div>
        ) : (
          <button onClick={() => onInstall(plugin)}
            className="rounded-lg bg-font-color-highlight px-3 py-1.5 text-xs font-medium text-white dark:bg-dark-font-color-highlight dark:text-font-color-black">
            Install
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = 'installed' | 'store';

export default function PluginsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('installed');
  const [search, setSearch] = useState('');
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>(getInstalledPlugins);
  const [selectedPlugin, setSelectedPlugin] = useState<NPluginManifest | null>(null);

  const handleToggle = useCallback((id: string, enable: boolean) => {
    setInstalledPlugins(enable ? enablePlugin(id) : disablePlugin(id));
  }, []);

  const handleUninstall = useCallback((id: string) => {
    setInstalledPlugins(uninstallPlugin(id));
  }, []);

  const handleInstall = useCallback((plugin: NPluginManifest) => {
    setInstalledPlugins(installPlugin(plugin));
    setTab('installed');
  }, []);

  const filteredInstalled = useMemo(() => {
    const q = search.toLowerCase();
    return installedPlugins.filter(
      (p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.tags?.some(t => t.includes(q))
    );
  }, [installedPlugins, search]);

  const installedIds = useMemo(() => new Set(installedPlugins.map((p) => p.id)), [installedPlugins]);

  const allStorePlugins: StorePlugin[] = useMemo(() => {
    const all = [...OFFICIAL_STORE_PLUGINS, ...COMMUNITY_STORE_PLUGINS];
    const seen = new Set<string>();
    return all
      .filter((p) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
      .map((p) => ({
        ...p,
        isInstalled: installedIds.has(p.id),
        installedVersion: installedPlugins.find((i) => i.id === p.id)?.version,
        status: installedIds.has(p.id)
          ? (installedPlugins.find((i) => i.id === p.id)?.status === 'enabled' ? 'enabled' : 'disabled')
          : 'not_installed',
      } as StorePlugin));
  }, [installedIds, installedPlugins]);

  const filteredStore = useMemo(() => {
    const q = search.toLowerCase();
    return allStorePlugins.filter(
      (p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.category.includes(q) || p.tags?.some(t => t.includes(q))
    );
  }, [allStorePlugins, search]);

  // Detail panel
  if (selectedPlugin) {
    return (
      <MainContainer className="appear-from-bottom text-font-color-black dark:text-font-color-white">
        <TitleContainer title={t('pluginsPage.title')} />
        <div className="mr-8 flex flex-col gap-4">
          <button onClick={() => setSelectedPlugin(null)}
            className="flex items-center gap-1.5 text-sm text-font-color-black/55 hover:text-font-color-black dark:text-font-color-white/55 dark:hover:text-font-color-white">
            <span className="material-icons-round text-base leading-none">arrow_back</span>
            Back
          </button>
          <div className="flex items-start gap-4">
            <PluginIcon plugin={selectedPlugin} />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold">{selectedPlugin.name}</h2>
                <SourceBadge source={selectedPlugin.source} />
              </div>
              <p className="text-sm text-font-color-black/55 dark:text-font-color-white/55">
                by {selectedPlugin.author} · v{selectedPlugin.version}
              </p>
            </div>
          </div>
          {selectedPlugin.readme ? (
            <div className="rounded-xl bg-background-color-1 p-4 dark:bg-dark-background-color-1">
              <pre className="whitespace-pre-wrap text-xs text-font-color-black/75 dark:text-font-color-white/75 font-sans leading-relaxed">
                {selectedPlugin.readme}
              </pre>
            </div>
          ) : (
            <p className="text-sm text-font-color-black/55 dark:text-font-color-white/55">
              {selectedPlugin.description}
            </p>
          )}
          {selectedPlugin.repoUrl && (
            <a href={selectedPlugin.repoUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 text-sm text-font-color-highlight dark:text-dark-font-color-highlight">
              <span className="material-icons-round text-base leading-none">open_in_new</span>
              View repository
            </a>
          )}
        </div>
      </MainContainer>
    );
  }

  return (
    <MainContainer className="appear-from-bottom text-font-color-black dark:text-font-color-white">
      <TitleContainer title={t('pluginsPage.title')} />

      <div className="mr-8 flex flex-col gap-4">
        {/* Tabs */}
        <div className="flex gap-1 rounded-xl bg-background-color-1 p-1 dark:bg-dark-background-color-1">
          {(['installed', 'store'] as Tab[]).map((t2) => (
            <button key={t2} onClick={() => { setTab(t2); setSearch(''); }}
              className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors ${tab === t2 ? 'bg-white shadow dark:bg-dark-background-color-2' : 'text-font-color-black/55 hover:text-font-color-black dark:text-font-color-white/55 dark:hover:text-font-color-white'}`}>
              {t2 === 'installed' ? t('pluginsPage.installed') : t('pluginsPage.store')}
              {t2 === 'installed' && (
                <span className="ml-1.5 rounded-full bg-font-color-highlight/15 px-1.5 py-px text-[10px] font-bold text-font-color-highlight dark:bg-dark-font-color-highlight/15 dark:text-dark-font-color-highlight">
                  {installedPlugins.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <span className="material-icons-round absolute top-1/2 left-3 -translate-y-1/2 text-base text-font-color-black/30 dark:text-font-color-white/30">search</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'installed' ? t('pluginsPage.searchInstalled') : t('pluginsPage.searchStore')}
            className="w-full rounded-xl border border-background-color-1 bg-background-color-2 py-2.5 pl-10 pr-4 text-sm outline-none placeholder:text-font-color-black/30 focus:border-font-color-highlight/40 dark:border-dark-background-color-1 dark:bg-dark-background-color-2 dark:placeholder:text-font-color-white/30 dark:focus:border-dark-font-color-highlight/40" />
        </div>

        {/* Installed tab */}
        {tab === 'installed' && (
          <div className="flex flex-col gap-2">
            {filteredInstalled.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-font-color-black/30 dark:text-font-color-white/30">
                <span className="material-icons-round text-4xl">extension_off</span>
                <p className="text-sm">{t('pluginsPage.noPlugins')}</p>
              </div>
            ) : (
              <>
                {/* Built-ins section */}
                {filteredInstalled.filter(p => p.builtin).length > 0 && (
                  <>
                    <p className="text-xs font-medium text-font-color-black/40 dark:text-font-color-white/40 mt-1">Built-in</p>
                    {filteredInstalled.filter(p => p.builtin).map(p => (
                      <InstalledCard key={p.id} plugin={p} onToggle={handleToggle} onUninstall={handleUninstall} />
                    ))}
                  </>
                )}
                {/* User-installed */}
                {filteredInstalled.filter(p => !p.builtin).length > 0 && (
                  <>
                    <p className="text-xs font-medium text-font-color-black/40 dark:text-font-color-white/40 mt-2">Installed</p>
                    {filteredInstalled.filter(p => !p.builtin).map(p => (
                      <InstalledCard key={p.id} plugin={p} onToggle={handleToggle} onUninstall={handleUninstall} />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Store tab */}
        {tab === 'store' && (
          <div className="flex flex-col gap-4">
            {/* Official */}
            {filteredStore.filter(p => p.source === 'official' || p.source === 'builtin').length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-font-color-black/40 dark:text-font-color-white/40 flex items-center gap-1">
                  <span className="material-icons-round text-xs leading-none text-emerald-500">verified</span>
                  {t('pluginsPage.official')}
                </p>
                {filteredStore.filter(p => p.source === 'official' || p.source === 'builtin').map(p => (
                  <button key={p.id} className="text-left w-full" onClick={() => setSelectedPlugin(p)}>
                    <StoreCard plugin={p} onInstall={handleInstall} onUninstall={handleUninstall} />
                  </button>
                ))}
              </div>
            )}
            {/* Community */}
            {filteredStore.filter(p => p.source === 'community').length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-font-color-black/40 dark:text-font-color-white/40 flex items-center gap-1">
                  <span className="material-icons-round text-xs leading-none">people</span>
                  {t('pluginsPage.community')}
                </p>
                {filteredStore.filter(p => p.source === 'community').map(p => (
                  <button key={p.id} className="text-left w-full" onClick={() => setSelectedPlugin(p)}>
                    <StoreCard plugin={p} onInstall={handleInstall} onUninstall={handleUninstall} />
                  </button>
                ))}
              </div>
            )}
            {filteredStore.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-font-color-black/30 dark:text-font-color-white/30">
                <span className="material-icons-round text-4xl">search_off</span>
                <p className="text-sm">No plugins found for "{search}"</p>
              </div>
            )}
          </div>
        )}
      </div>
    </MainContainer>
  );
}
