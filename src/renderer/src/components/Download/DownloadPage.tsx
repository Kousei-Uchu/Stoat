import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MainContainer from '../MainContainer';
import TitleContainer from '../TitleContainer';
import storage from '../../utils/localStorage';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchResult {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  thumbnail: string;
  source: 'ytm' | 'yt' | 'spotify';
  url: string;
  matchScore?: number;
}

interface YtDlpStatus {
  ready: boolean;
  downloading: boolean;
  error: string | null;
}

interface FormatDef {
  label: string;
  ext: string;
}

interface RecentDownload {
  id: string;
  title: string;
  artist?: string;
  filename?: string;
  lrcPath?: string;
  timestamp: number;
  status: 'done' | 'error' | 'cancelled';
  errorMsg?: string;
  // Batch
  batchTotal?: number;
  batchSuccess?: number;
  batchFail?: number;
}

type DownloadJobStatus =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'resolving'; text?: string }
  | { kind: 'downloading'; progress: number; text: string }
  | { kind: 'batch'; current: number; total: number; text: string; progress: number }
  | { kind: 'done'; filename?: string; lrcPath?: string }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' };

// Detect URL type
type UrlKind = 'none' | 'youtube' | 'spotify_track' | 'spotify_album' | 'spotify_playlist' | 'spotify_artist' | 'generic';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(seconds: number) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function isUrl(v: string) {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function detectUrlKind(v: string): UrlKind {
  if (!v.trim()) return 'none';
  try {
    const u = new URL(v);
    if (u.hostname.includes('spotify.com')) {
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] === 'track') return 'spotify_track';
      if (parts[0] === 'album') return 'spotify_album';
      if (parts[0] === 'playlist') return 'spotify_playlist';
      if (parts[0] === 'artist') return 'spotify_artist';
      return 'generic';
    }
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be') ||
        u.hostname.includes('music.youtube.com') || u.hostname.includes('soundcloud.com')) {
      return 'youtube';
    }
    if (u.protocol === 'http:' || u.protocol === 'https:') return 'generic';
  } catch { /* not a URL */ }
  return 'none';
}

function urlKindLabel(kind: UrlKind): string {
  switch (kind) {
    case 'spotify_track': return 'Spotify Track';
    case 'spotify_album': return 'Spotify Album';
    case 'spotify_playlist': return 'Spotify Playlist';
    case 'spotify_artist': return "Artist's Discography";
    case 'youtube': return 'YouTube / SoundCloud URL';
    case 'generic': return 'Direct URL';
    default: return '';
  }
}

function urlKindIcon(kind: UrlKind): string {
  switch (kind) {
    case 'spotify_track': return 'music_note';
    case 'spotify_album': return 'album';
    case 'spotify_playlist': return 'queue_music';
    case 'spotify_artist': return 'person';
    case 'youtube': return 'smart_display';
    case 'generic': return 'link';
    default: return 'search';
  }
}

// ─── yt-dlp setup banner ─────────────────────────────────────────────────────

function YtdlpBanner({ status }: { status: YtDlpStatus | null }) {
  if (!status || status.ready) return null;
  if (status.downloading) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl bg-font-color-highlight/10 px-3 py-2.5 dark:bg-dark-font-color-highlight/10">
        <span className="material-icons-round animate-spin-ease text-base leading-none text-font-color-highlight dark:text-dark-font-color-highlight">
          downloading
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-font-color-highlight dark:text-dark-font-color-highlight">
            Setting up downloader…
          </p>
          <p className="mt-0.5 text-xs text-font-color-black/55 dark:text-font-color-white/55">
            Downloading yt-dlp — this only happens once (~10 MB)
          </p>
        </div>
      </div>
    );
  }
  if (status.error) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl bg-red-500/10 px-3 py-2.5">
        <span className="material-icons-round text-base leading-none text-red-500">error</span>
        <div>
          <p className="text-sm font-medium text-red-500">Downloader setup failed</p>
          <p className="mt-0.5 text-xs text-font-color-black/55 dark:text-font-color-white/55">
            {status.error}
          </p>
        </div>
      </div>
    );
  }
  return null;
}

// ─── Status bar ───────────────────────────────────────────────────────────────

function StatusBar({ status }: { status: DownloadJobStatus }) {
  if (status.kind === 'idle') return null;

  if (status.kind === 'downloading') {
    return (
      <div className="appear-from-bottom rounded-xl bg-background-color-1 p-3 dark:bg-dark-background-color-1">
        <div className="mb-2 flex items-center gap-2">
          <span className="material-icons-round animate-spin-ease text-base leading-none text-font-color-highlight dark:text-dark-font-color-highlight">
            sync
          </span>
          <span className="text-sm font-medium">{status.text || 'Downloading…'}</span>
          {status.progress > 0 && (
            <span className="ml-auto text-xs tabular-nums opacity-60">
              {Math.round(status.progress)}%
            </span>
          )}
        </div>
        {status.progress > 0 && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-background-color-2 dark:bg-dark-background-color-2">
            <div
              className="h-full rounded-full bg-font-color-highlight transition-all duration-300 ease-out dark:bg-dark-font-color-highlight"
              style={{ width: `${status.progress}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  if (status.kind === 'batch') {
    const pct = status.total > 0 ? Math.round((status.current / status.total) * 100) : 0;
    return (
      <div className="appear-from-bottom rounded-xl bg-background-color-1 p-3 dark:bg-dark-background-color-1">
        <div className="mb-2 flex items-center gap-2">
          <span className="material-icons-round animate-spin-ease text-base leading-none text-font-color-highlight dark:text-dark-font-color-highlight">
            sync
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{status.text}</span>
          <span className="shrink-0 text-xs tabular-nums opacity-60">
            {status.current}/{status.total}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-background-color-2 dark:bg-dark-background-color-2">
          <div
            className="h-full rounded-full bg-font-color-highlight transition-all duration-300 ease-out dark:bg-dark-font-color-highlight"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  if (status.kind === 'done') {
    return (
      <div className="appear-from-bottom flex items-start gap-2.5 rounded-xl bg-emerald-500/10 px-3 py-2.5">
        <span className="material-icons-round text-base leading-none text-emerald-500">
          check_circle
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-emerald-500">Download complete</p>
          {status.filename && (
            <p className="mt-0.5 truncate text-xs text-font-color-black/55 dark:text-font-color-white/55">
              {status.filename}
            </p>
          )}
          {status.lrcPath ? (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-600/80 dark:text-emerald-400/80">
              <span className="material-icons-round text-sm leading-none">lyrics</span>
              Lyrics saved as .lrc
            </p>
          ) : (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-font-color-black/40 dark:text-font-color-white/40">
              <span className="material-icons-round text-sm leading-none">lyrics</span>
              No lyrics available for this track
            </p>
          )}
        </div>
      </div>
    );
  }

  const configs: Record<string, { icon: string; color: string; bg: string; text: string }> = {
    searching: {
      icon: 'search',
      color: 'text-font-color-highlight dark:text-dark-font-color-highlight',
      bg: 'bg-background-color-1 dark:bg-dark-background-color-1',
      text: 'Searching…',
    },
    resolving: {
      icon: 'sync',
      color: 'text-font-color-highlight dark:text-dark-font-color-highlight',
      bg: 'bg-background-color-1 dark:bg-dark-background-color-1',
      text: (status as any).text ?? 'Starting download…',
    },
    error: {
      icon: 'error',
      color: 'text-red-500',
      bg: 'bg-red-500/10',
      text: (status as any).message ?? 'Unknown error',
    },
    cancelled: {
      icon: 'cancel',
      color: 'text-font-color-black/50 dark:text-font-color-white/50',
      bg: 'bg-background-color-1 dark:bg-dark-background-color-1',
      text: 'Cancelled',
    },
  };

  const c = configs[status.kind];
  if (!c) return null;

  return (
    <div className={`appear-from-bottom flex items-start gap-2.5 rounded-xl px-3 py-2.5 ${c.bg}`}>
      <span className={`material-icons-round text-base ${status.kind === 'resolving' ? 'animate-spin-ease' : ''} leading-none ${c.color}`}>{c.icon}</span>
      <p className={`text-sm font-medium ${c.color}`}>{c.text}</p>
    </div>
  );
}

// ─── Search result card ───────────────────────────────────────────────────────

function ResultCard({
  result,
  onDownload,
  isDownloading,
}: {
  result: SearchResult;
  onDownload: (result: SearchResult) => void;
  isDownloading: boolean;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-background-color-1 dark:hover:bg-dark-background-color-1">
      <div className="relative h-11 w-[4.5rem] shrink-0 overflow-hidden rounded-lg bg-background-color-2 dark:bg-dark-background-color-2">
        {result.thumbnail ? (
          <img src={result.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="material-icons-round text-sm text-font-color-black/20 dark:text-font-color-white/20">
              music_note
            </span>
          </div>
        )}
        {result.duration > 0 && (
          <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 py-px text-[9px] font-medium text-white">
            {fmtDuration(result.duration)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-snug" title={result.title}>
          {result.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-font-color-black/55 dark:text-font-color-white/55">
          {[result.artist, result.album].filter(Boolean).join(' · ')}
        </p>
        {result.matchScore !== undefined && (
          <div className="mt-1 flex items-center gap-1.5">
            <div className="h-1 w-16 overflow-hidden rounded-full bg-background-color-2 dark:bg-dark-background-color-2">
              <div
                className="h-full rounded-full bg-font-color-highlight/60 dark:bg-dark-font-color-highlight/60"
                style={{ width: `${Math.round(result.matchScore * 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-font-color-black/35 dark:text-font-color-white/35">
              {Math.round(result.matchScore * 100)}% match
            </span>
          </div>
        )}
      </div>
      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-font-color-black/25 dark:text-font-color-white/25">
        {result.source === 'ytm' ? 'YTM' : result.source === 'spotify' ? 'SPT' : 'YT'}
      </span>
      <button
        onClick={() => onDownload(result)}
        disabled={isDownloading}
        title="Download"
        className="shrink-0 rounded-lg p-2 text-font-color-black/35 transition-all hover:bg-background-color-2 hover:text-font-color-highlight disabled:pointer-events-none disabled:opacity-30 dark:text-font-color-white/35 dark:hover:bg-dark-background-color-2 dark:hover:text-dark-font-color-highlight"
      >
        <span className="material-icons-round text-xl leading-none">download</span>
      </button>
    </div>
  );
}

// ─── Recent downloads section ─────────────────────────────────────────────────

function RecentDownloads({ items }: { items: RecentDownload[] }) {
  if (items.length === 0) return null;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-font-color-black/50 dark:text-font-color-white/50">
          Recent downloads
        </span>
        <span className="text-xs text-font-color-black/30 dark:text-font-color-white/30">
          {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="rounded-xl border border-background-color-1 bg-background-color-2/40 dark:border-dark-background-color-1 dark:bg-dark-background-color-2/40">
        <div className="max-h-52 divide-y divide-background-color-1 overflow-y-auto dark:divide-dark-background-color-1">
          {items.map((item) => (
            <div key={item.id} className="flex items-start gap-2.5 px-3 py-2.5">
              <span
                className={`material-icons-round mt-px shrink-0 text-base leading-none ${
                  item.status === 'done'
                    ? 'text-emerald-500'
                    : item.status === 'error'
                    ? 'text-red-400'
                    : 'text-font-color-black/25 dark:text-font-color-white/25'
                }`}
              >
                {item.status === 'done'
                  ? item.batchTotal
                    ? 'library_music'
                    : 'audio_file'
                  : item.status === 'error'
                  ? 'error_outline'
                  : 'cancel'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium leading-snug">
                  {item.title}
                </p>
                {item.artist && (
                  <p className="mt-0.5 truncate text-[11px] text-font-color-black/45 dark:text-font-color-white/45">
                    {item.artist}
                  </p>
                )}
                {item.batchTotal != null && (
                  <p className="mt-0.5 text-[11px] text-font-color-black/45 dark:text-font-color-white/45">
                    {item.batchSuccess ?? 0}/{item.batchTotal} tracks downloaded
                    {item.batchFail ? ` · ${item.batchFail} failed` : ''}
                  </p>
                )}
                {item.errorMsg && (
                  <p className="mt-0.5 truncate text-[11px] text-red-400">{item.errorMsg}</p>
                )}
                {item.lrcPath && (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-emerald-500/70">
                    <span className="material-icons-round text-xs leading-none">lyrics</span>
                    Lyrics saved
                  </p>
                )}
              </div>
              <span className="shrink-0 text-[10px] text-font-color-black/25 dark:text-font-color-white/25">
                {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Toggle chip ──────────────────────────────────────────────────────────────

function ToggleChip({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-font-color-highlight text-white dark:bg-dark-font-color-highlight dark:text-font-color-black'
          : 'bg-background-color-1 text-font-color-black/65 hover:bg-background-color-2 dark:bg-dark-background-color-1 dark:text-font-color-white/65 dark:hover:bg-dark-background-color-2'
      }`}
    >
      <span className="material-icons-round text-sm leading-none">{icon}</span>
      {label}
    </button>
  );
}

// ─── URL kind pill ────────────────────────────────────────────────────────────

function UrlKindPill({ kind }: { kind: UrlKind }) {
  if (kind === 'none') return null;
  const isBatch = kind === 'spotify_album' || kind === 'spotify_playlist' || kind === 'spotify_artist';
  return (
    <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium
      ${isBatch
        ? 'bg-font-color-highlight/10 text-font-color-highlight dark:bg-dark-font-color-highlight/10 dark:text-dark-font-color-highlight'
        : 'bg-background-color-1 text-font-color-black/55 dark:bg-dark-background-color-1 dark:text-font-color-white/55'
      }`}
    >
      <span className="material-icons-round text-sm leading-none">{urlKindIcon(kind)}</span>
      {urlKindLabel(kind)}
      {isBatch && (
        <span className="rounded bg-font-color-highlight/20 px-1 py-px text-[10px] dark:bg-dark-font-color-highlight/20">
          batch
        </span>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DownloadPage() {
  const { t } = useTranslation();

  const [downloadFolder] = useState(
    () => (storage.preferences.getPreferences('downloadFolder') as string | null) || ''
  );

  const [query, setQuery] = useState('');
  const [format, setFormat] = useState('mp3_320');
  const [downloadLyrics, setDownloadLyrics] = useState(true);
  const [formats, setFormats] = useState<Record<string, FormatDef>>({
    mp3_320: { label: 'MP3 320kbps', ext: 'mp3' },
    mp3_192: { label: 'MP3 192kbps', ext: 'mp3' },
    mp3_128: { label: 'MP3 128kbps', ext: 'mp3' },
    flac:    { label: 'FLAC', ext: 'flac' },
    wav:     { label: 'WAV', ext: 'wav' },
    ogg:     { label: 'OGG', ext: 'ogg' },
    aac:     { label: 'AAC', ext: 'aac' },
    m4a:     { label: 'M4A', ext: 'm4a' },
    opus:    { label: 'Opus', ext: 'opus' },
  });
  const [results, setResults] = useState<SearchResult[]>([]);
  const [spotifyResolveError, setSpotifyResolveError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<DownloadJobStatus>({ kind: 'idle' });
  const [ytdlpStatus, setYtdlpStatus] = useState<YtDlpStatus | null>(null);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [recentDownloads, setRecentDownloads] = useState<RecentDownload[]>([]);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeJobId = useRef<string | null>(null);
  const currentJobLabel = useRef<string>('');

  const urlKind = detectUrlKind(query.trim());
  const isUrlMode = urlKind !== 'none' && isUrl(query.trim());

  // ── Mount ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    window.api.downloader.getYtdlpStatus?.().then(setYtdlpStatus).catch(() => null);
    window.api.downloader
      .getFormats?.()
      .then((f) => {
        if (f && Object.keys(f).length > 0) setFormats(f as Record<string, FormatDef>);
      })
      .catch(() => null);

    const onProgress = (_: unknown, data: any) => {
      const { event, text, progress, outputPath, lrcPath, batchTotal, batchCurrent, batchSuccessCount, batchFailCount } = data ?? {};

      if (event === 'progress') {
        setJobStatus({ kind: 'downloading', progress: progress ?? 0, text: text ?? 'Downloading…' });
      } else if (event === 'batch_start') {
        setJobStatus({ kind: 'batch', current: 0, total: batchTotal ?? 0, text: text ?? 'Starting batch…', progress: 0 });
      } else if (event === 'batch_progress') {
        setJobStatus({ kind: 'batch', current: batchCurrent ?? 0, total: batchTotal ?? 0, text: text ?? '…', progress: batchTotal ? (batchCurrent / batchTotal) * 100 : 0 });
      } else if (event === 'done') {
        const filename = outputPath ? (outputPath as string).split(/[/\\]/).pop() : undefined;
        setJobStatus({ kind: 'done', filename, lrcPath: lrcPath ?? undefined });
        setActiveUrl(null);
        const id = activeJobId.current ?? randomId();
        activeJobId.current = null;
        setRecentDownloads((prev) => [
          {
            id,
            title: currentJobLabel.current || filename || 'Unknown',
            filename,
            lrcPath: lrcPath ?? undefined,
            timestamp: Date.now(),
            status: 'done',
            batchSuccess: batchSuccessCount,
            batchFail: batchFailCount,
            batchTotal: batchTotal,
          },
          ...prev.slice(0, 49),
        ]);
      } else if (event === 'error') {
        setJobStatus({ kind: 'error', message: text ?? 'Unknown error' });
        setActiveUrl(null);
        const id = activeJobId.current ?? randomId();
        activeJobId.current = null;
        setRecentDownloads((prev) => [
          {
            id,
            title: currentJobLabel.current || 'Failed download',
            timestamp: Date.now(),
            status: 'error',
            errorMsg: text ?? undefined,
          },
          ...prev.slice(0, 49),
        ]);
      } else if (event === 'cancelled') {
        setJobStatus({ kind: 'cancelled' });
        setActiveUrl(null);
        activeJobId.current = null;
      } else if (event === 'started') {
        setJobStatus({ kind: 'resolving' });
      } else if (event === 'resolving') {
        setJobStatus({ kind: 'resolving', text: text ?? 'Resolving…' });
      } else if (event === 'batch_track_error') {
        // update batch status text only
        setJobStatus((prev) => prev.kind === 'batch' ? { ...prev, text: text ?? prev.text } : prev);
      }
    };

    const onYtdlpStatus = (_: unknown, data: any) => setYtdlpStatus(data);

    window.api.downloader.onProgress(onProgress);
    window.api.downloader.onYtdlpStatus?.(onYtdlpStatus);

    return () => {
      window.api.downloader.removeOnProgress(onProgress);
      window.api.downloader.removeOnYtdlpStatus?.(onYtdlpStatus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Search ─────────────────────────────────────────────────────────────────
  const handleQueryChange = useCallback((value: string) => {
    // Allow spaces in the input (previously broken)
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!value.trim() || isUrl(value.trim())) {
      setResults([]);
      if (!value.trim()) setJobStatus({ kind: 'idle' });
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setJobStatus({ kind: 'searching' });
      setResults([]);
      try {
        const res = await window.api.downloader.search(value.trim());
        setResults((res as SearchResult[]) ?? []);
        setJobStatus({ kind: 'idle' });
        setSpotifyResolveError(null);
      } catch (err: any) {
        setJobStatus({ kind: 'error', message: err?.message ?? 'Search failed' });
      }
    }, 400);
  }, []);

  // If the query is a Spotify URL, attempt to resolve metadata early to detect network/blocking issues
  useEffect(() => {
    let cancelled = false;
    async function tryResolve() {
      if (!isUrlMode || !query.trim()) return setSpotifyResolveError(null);
      if (!(urlKind === 'spotify_track' || urlKind === 'spotify_album' || urlKind === 'spotify_playlist' || urlKind === 'spotify_artist')) {
        setSpotifyResolveError(null);
        return;
      }
      try {
        setSpotifyResolveError(null);
        await window.api.downloader.resolveSpotify(query.trim());
      } catch (err: any) {
        if (cancelled) return;
        const msg = err?.message || 'Failed to resolve Spotify URL. Network may be blocking Spotify.';
        setSpotifyResolveError(msg);
      }
    }
    tryResolve();
    return () => { cancelled = true; };
  }, [isUrlMode, query, urlKind]);

  // ── Download ───────────────────────────────────────────────────────────────
  const startDownload = useCallback(
    async (urlOrResult: string | SearchResult) => {
      const url = typeof urlOrResult === 'string' ? urlOrResult : urlOrResult.url;
      if (!url.trim() || activeUrl) return;

      setActiveUrl(url);
      setJobStatus({ kind: 'resolving' });

      const meta =
        typeof urlOrResult === 'object'
          ? {
              title: urlOrResult.title,
              artist: urlOrResult.artist,
              album: urlOrResult.album,
            }
          : {};

      // Set label for recent downloads
      currentJobLabel.current =
        typeof urlOrResult === 'object'
          ? `${urlOrResult.title}${urlOrResult.artist ? ' — ' + urlOrResult.artist : ''}`
          : url;

      try {
        const id = await window.api.downloader.startDownload({
          url,
          format,
          quality: 'best',
          provider: 'generic',
          destination: downloadFolder || undefined,
          downloadLyrics,
          ...meta,
        });
        activeJobId.current = id;
      } catch (err: any) {
        setJobStatus({ kind: 'error', message: err?.message ?? 'Failed to start' });
        setActiveUrl(null);
      }
    },
    [activeUrl, downloadFolder, format, downloadLyrics]
  );

  const cancelDownload = useCallback(async () => {
    if (activeJobId.current) {
      await window.api.downloader.cancelDownload(activeJobId.current);
      activeJobId.current = null;
    }
    setJobStatus({ kind: 'cancelled' });
    setActiveUrl(null);
  }, []);

  const isBusy =
    jobStatus.kind === 'downloading' ||
    jobStatus.kind === 'batch' ||
    jobStatus.kind === 'resolving' ||
    jobStatus.kind === 'searching';

  const formatKeys = Object.keys(formats);
  const isBatch = urlKind === 'spotify_album' || urlKind === 'spotify_playlist' || urlKind === 'spotify_artist';

  return (
    <MainContainer className="appear-from-bottom text-font-color-black dark:text-font-color-white">
      <TitleContainer title={t('sideBar.download') || 'Download'} />

      <div className="mr-8 flex flex-col gap-4">
        {/* yt-dlp setup banner */}
        <YtdlpBanner status={ytdlpStatus} />

        {/* ── Search / URL input ── */}
        <div className="relative">
          <span className="material-icons-round absolute top-1/2 left-3.5 -translate-y-1/2 text-base leading-none text-font-color-black/35 dark:text-font-color-white/35">
            {isUrlMode ? urlKindIcon(urlKind) : 'search'}
          </span>
          <input
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isUrlMode && query.trim())
                startDownload(query.trim());
            }}
            placeholder="Search for a song, or paste a URL (YouTube, Spotify, SoundCloud…)"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            // Fix for spaces: use defaultValue-style or make sure React controls value
            className="w-full rounded-xl border border-background-color-1 bg-background-color-2 py-2.5 pr-10 pl-10 text-sm outline-none placeholder:text-font-color-black/35 transition-colors focus:border-font-color-highlight/40 dark:border-dark-background-color-1 dark:bg-dark-background-color-2 dark:placeholder:text-font-color-white/35 dark:focus:border-dark-font-color-highlight/40"
          />
          {query.length > 0 && (
            <button
              onClick={() => {
                setQuery('');
                setResults([]);
                setJobStatus({ kind: 'idle' });
              }}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-font-color-black/30 hover:text-font-color-black/60 dark:text-font-color-white/30 dark:hover:text-font-color-white/60"
            >
              <span className="material-icons-round text-base leading-none">close</span>
            </button>
          )}
        </div>

        {/* URL kind pill */}
        {isUrlMode && (
          <div className="flex items-center gap-2">
            <UrlKindPill kind={urlKind} />
            {isBatch && (
              <p className="text-xs text-font-color-black/45 dark:text-font-color-white/45">
                All tracks will be downloaded automatically
              </p>
            )}
          </div>
        )}

        {/* ── Format row ── */}
        <div className="flex flex-wrap items-center gap-2">
          {formatKeys.map((key) => (
            <button
              key={key}
              onClick={() => setFormat(key)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                format === key
                  ? 'bg-font-color-highlight text-white dark:bg-dark-font-color-highlight dark:text-font-color-black'
                  : 'bg-background-color-1 text-font-color-black/65 hover:bg-background-color-2 dark:bg-dark-background-color-1 dark:text-font-color-white/65 dark:hover:bg-dark-background-color-2'
              }`}
            >
              {formats[key]?.label ?? key}
            </button>
          ))}
        </div>

        {/* ── Options row ── */}
        <div className="flex flex-wrap items-center gap-2">
          <ToggleChip
            icon="lyrics"
            label="Download lyrics"
            active={downloadLyrics}
            onClick={() => setDownloadLyrics((v) => !v)}
          />

          {spotifyResolveError && (
            <div className="ml-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">
              <div className="flex items-center gap-2">
                <span className="material-icons-round">warning</span>
                <div className="min-w-0">
                  <p className="text-xs font-medium">Spotify lookup failed</p>
                  <p className="text-[11px] opacity-70">{spotifyResolveError}</p>
                </div>
                <div className="ml-4">
                  <button
                    onClick={async () => {
                      try {
                        setJobStatus({ kind: 'resolving', text: 'Using local render-service…' });
                        const resp = await fetch('http://localhost:3001/api/download', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ url: query.trim(), format: format })
                        });
                        const data = await resp.json();
                        if (resp.ok && data.ok) {
                          setJobStatus({ kind: 'done', filename: data.path ?? undefined });
                          setRecentDownloads((prev) => [
                            {
                              id: String(Date.now()),
                              title: query.trim(),
                              timestamp: Date.now(),
                              status: 'done',
                              filename: undefined,
                            },
                            ...prev.slice(0, 49),
                          ]);
                        } else {
                          setJobStatus({ kind: 'error', message: data.error || 'Render service failed' });
                        }
                      } catch (err: any) {
                        setJobStatus({ kind: 'error', message: err?.message ?? 'Render service error' });
                      }
                    }}
                    className="ml-2 rounded bg-font-color-highlight/10 px-2 py-1 text-xs text-font-color-highlight"
                  >
                    Use local render-service
                  </button>
                </div>
              </div>
            </div>
          )}

          {isUrlMode && (
            <button
              onClick={() => (isBusy ? cancelDownload() : startDownload(query.trim()))}
              disabled={!ytdlpStatus?.ready && !isBusy}
              className={`ml-auto flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                isBusy
                  ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
                  : 'bg-font-color-highlight text-white hover:bg-font-color-highlight/80 dark:bg-dark-font-color-highlight dark:text-font-color-black'
              }`}
            >
              <span className="material-icons-round text-base leading-none">
                {isBusy ? 'stop' : isBatch ? 'library_add' : 'download'}
              </span>
              {isBusy ? 'Cancel' : isBatch ? 'Download all' : 'Download'}
            </button>
          )}
        </div>

        {/* ── Status ── */}
        {jobStatus.kind !== 'idle' && <StatusBar status={jobStatus} />}

        {/* ── Search results ── */}
        {results.length > 0 && (
          <div className="rounded-xl border border-background-color-1 bg-background-color-2/40 dark:border-dark-background-color-1 dark:bg-dark-background-color-2/40">
            <div className="border-b border-background-color-1 px-3 py-2 dark:border-dark-background-color-1">
              <span className="text-xs font-medium text-font-color-black/45 dark:text-font-color-white/45">
                {results.length} results · click ↓ to download
              </span>
            </div>
            <div className="max-h-[26rem] divide-y divide-background-color-1 overflow-y-auto p-1 dark:divide-dark-background-color-1">
              {results.map((r) => (
                <ResultCard
                  key={r.id}
                  result={r}
                  onDownload={startDownload}
                  isDownloading={isBusy}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Recent downloads ── */}
        <RecentDownloads items={recentDownloads} />

        {/* ── Empty state ── */}
        {!query && results.length === 0 && jobStatus.kind === 'idle' && recentDownloads.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-14 text-center text-font-color-black/25 dark:text-font-color-white/25">
            <span className="material-icons-round text-5xl leading-none">cloud_download</span>
            <div>
              <p className="text-sm font-medium">Search for a song or paste a URL</p>
              <p className="mt-1 text-xs">
                Supports YouTube, YouTube Music, Spotify, SoundCloud, and more
              </p>
            </div>
          </div>
        )}
      </div>
    </MainContainer>
  );
}

function randomId() {
  return Math.random().toString(36).slice(2);
}
