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
  source: 'ytm' | 'yt';
  url: string;
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

type DownloadJobStatus =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'resolving' }
  | { kind: 'downloading'; progress: number; text: string }
  | { kind: 'done'; filename?: string; lrcPath?: string }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' };

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
          {status.lrcPath && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-600/80 dark:text-emerald-400/80">
              <span className="material-icons-round text-sm leading-none">lyrics</span>
              Lyrics saved as .lrc
            </p>
          )}
          {!status.lrcPath && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-font-color-black/40 dark:text-font-color-white/40">
              <span className="material-icons-round text-sm leading-none">lyrics</span>
              No lyrics available for this track
            </p>
          )}
        </div>
      </div>
    );
  }

  const configs = {
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
      text: 'Starting download…',
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

  const c = configs[status.kind as keyof typeof configs];
  if (!c) return null;

  return (
    <div className={`appear-from-bottom flex items-start gap-2.5 rounded-xl px-3 py-2.5 ${c.bg}`}>
      <span className={`material-icons-round text-base leading-none ${c.color}`}>{c.icon}</span>
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
      {/* Thumbnail */}
      <div className="relative h-11 w-[4.5rem] shrink-0 overflow-hidden rounded-lg bg-background-color-2 dark:bg-dark-background-color-2">
        {result.thumbnail ? (
          <img
            src={result.thumbnail}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
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

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-snug" title={result.title}>
          {result.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-font-color-black/55 dark:text-font-color-white/55">
          {[result.artist, result.album].filter(Boolean).join(' · ')}
        </p>
      </div>

      {/* Source badge */}
      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-font-color-black/25 dark:text-font-color-white/25">
        {result.source === 'ytm' ? 'YTM' : 'YT'}
      </span>

      {/* Download button */}
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
  const [jobStatus, setJobStatus] = useState<DownloadJobStatus>({ kind: 'idle' });
  const [ytdlpStatus, setYtdlpStatus] = useState<YtDlpStatus | null>(null);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [downloadedFiles, setDownloadedFiles] = useState<string[]>([]);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeJobId = useRef<string | null>(null);

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
      const { event, text, progress, outputPath, lrcPath } = data ?? {};
      if (event === 'progress') {
        setJobStatus({ kind: 'downloading', progress: progress ?? 0, text: text ?? 'Downloading…' });
      } else if (event === 'done') {
        const filename = outputPath
          ? (outputPath as string).split(/[\\/]/).pop()
          : undefined;
        setJobStatus({ kind: 'done', filename, lrcPath: lrcPath ?? undefined });
        setActiveUrl(null);
        activeJobId.current = null;
        refreshFiles();
      } else if (event === 'error') {
        setJobStatus({ kind: 'error', message: text ?? 'Unknown error' });
        setActiveUrl(null);
        activeJobId.current = null;
      } else if (event === 'cancelled') {
        setJobStatus({ kind: 'cancelled' });
        setActiveUrl(null);
        activeJobId.current = null;
      } else if (event === 'started') {
        setJobStatus({ kind: 'resolving' });
      }
    };

    const onYtdlpStatus = (_: unknown, data: any) => setYtdlpStatus(data);

    window.api.downloader.onProgress(onProgress);
    window.api.downloader.onYtdlpStatus?.(onYtdlpStatus);
    refreshFiles();

    return () => {
      window.api.downloader.removeOnProgress(onProgress);
      window.api.downloader.removeOnYtdlpStatus?.(onYtdlpStatus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshFiles = useCallback(async () => {
    try {
      const list = await window.api.downloader.listDownloads(downloadFolder || undefined);
      setDownloadedFiles(list ?? []);
    } catch { /* silent */ }
  }, [downloadFolder]);

  // ── Search ─────────────────────────────────────────────────────────────────
  const handleQueryChange = (value: string) => {
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
      } catch (err: any) {
        setJobStatus({ kind: 'error', message: err?.message ?? 'Search failed' });
      }
    }, 400);
  };

  // ── Download ───────────────────────────────────────────────────────────────
  const startDownload = useCallback(
    async (urlOrResult: string | SearchResult) => {
      const url =
        typeof urlOrResult === 'string' ? urlOrResult : urlOrResult.url;
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

  const isUrlMode = isUrl(query.trim());
  const isBusy =
    jobStatus.kind === 'downloading' ||
    jobStatus.kind === 'resolving' ||
    jobStatus.kind === 'searching';
  const formatKeys = Object.keys(formats);

  return (
    <MainContainer className="appear-from-bottom text-font-color-black dark:text-font-color-white">
      <TitleContainer title={t('sideBar.download') || 'Download'} />

      <div className="mr-8 flex flex-col gap-4">
        {/* yt-dlp setup banner */}
        <YtdlpBanner status={ytdlpStatus} />

        {/* ── Search / URL input ── */}
        <div className="relative">
          <span className="material-icons-round absolute top-1/2 left-3.5 -translate-y-1/2 text-base leading-none text-font-color-black/35 dark:text-font-color-white/35">
            {isUrlMode ? 'link' : 'search'}
          </span>
          <input
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isUrlMode && query.trim())
                startDownload(query.trim());
            }}
            placeholder="Search for a song, or paste a YouTube / SoundCloud URL"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
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

          {/* URL-mode download/cancel button sits at the end */}
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
                {isBusy ? 'stop' : 'download'}
              </span>
              {isBusy ? 'Cancel' : 'Download'}
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

        {/* ── Downloaded files ── */}
        {downloadedFiles.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-font-color-black/50 dark:text-font-color-white/50">
                In download folder
              </span>
              <button
                onClick={refreshFiles}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-font-color-black/45 transition-colors hover:bg-background-color-1 dark:text-font-color-white/45 dark:hover:bg-dark-background-color-1"
              >
                <span className="material-icons-round text-sm leading-none">refresh</span>
                Refresh
              </button>
            </div>
            <div className="rounded-xl border border-background-color-1 bg-background-color-2/40 dark:border-dark-background-color-1 dark:bg-dark-background-color-2/40">
              <div className="max-h-44 divide-y divide-background-color-1 overflow-y-auto dark:divide-dark-background-color-1">
                {downloadedFiles.map((file) => (
                  <div key={file} className="flex items-center gap-2 px-3 py-2">
                    <span
                      className={`material-icons-round text-sm leading-none ${
                        file.endsWith('.lrc')
                          ? 'text-font-color-highlight/60 dark:text-dark-font-color-highlight/60'
                          : 'text-font-color-black/25 dark:text-font-color-white/25'
                      }`}
                    >
                      {file.endsWith('.lrc') ? 'lyrics' : 'audio_file'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs">{file}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Empty state ── */}
        {!query && results.length === 0 && jobStatus.kind === 'idle' && (
          <div className="flex flex-col items-center gap-3 py-14 text-center text-font-color-black/25 dark:text-font-color-white/25">
            <span className="material-icons-round text-5xl leading-none">cloud_download</span>
            <div>
              <p className="text-sm font-medium">Search for a song or paste a URL</p>
              <p className="mt-1 text-xs">
                Supports YouTube, YouTube Music, SoundCloud, and more
              </p>
            </div>
          </div>
        )}
      </div>
    </MainContainer>
  );
}
