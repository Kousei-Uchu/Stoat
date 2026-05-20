/**
 * Stoat Downloader — fully self-contained, no user-installed dependencies.
 *
 * On first launch, yt-dlp is automatically downloaded from GitHub into the
 * app's userData directory (~10 MB) and reused on subsequent launches.
 *
 * Search uses YouTube's internal InnerTube API directly from the main process
 * (no CORS issues, no API key required).
 */

import { app, BrowserWindow } from 'electron';
import { existsSync, mkdirSync, readdirSync, chmodSync, unlinkSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import https from 'node:https';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DownloadOptions {
  url: string;
  format?: string;       // key from DOWNLOAD_FORMATS
  quality?: string;
  destination?: string;
  provider?: 'youtube' | 'ytmusic' | 'soundcloud' | 'spotify' | 'generic';
  extractAudio?: boolean;
  searchQuery?: string;
  // Metadata from search results — passed to ffmpeg so the file is tagged correctly
  title?: string;
  artist?: string;
  album?: string;
  // Extra options
  downloadLyrics?: boolean;
}

export interface SearchResult {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // seconds
  thumbnail: string;
  source: 'ytm' | 'yt';
  url: string;
}

export interface YtDlpStatus {
  ready: boolean;
  downloading: boolean;
  error: string | null;
}

interface DownloadTask {
  id: string;
  url: string;
  destination: string;
  status: 'pending' | 'started' | 'progress' | 'done' | 'error' | 'cancelled';
  progress: number;
  error?: string;
  outputPath?: string;
  lrcPath?: string;
  process?: import('child_process').ChildProcessWithoutNullStreams;
}

// ─── Format definitions ───────────────────────────────────────────────────────

export const DOWNLOAD_FORMATS: Record<string, { label: string; ext: string; ytdlpArgs: string[] }> = {
  mp3_320: { label: 'MP3 320kbps', ext: 'mp3',  ytdlpArgs: ['--audio-format', 'mp3', '--audio-quality', '0'] },
  mp3_192: { label: 'MP3 192kbps', ext: 'mp3',  ytdlpArgs: ['--audio-format', 'mp3', '--audio-quality', '5'] },
  mp3_128: { label: 'MP3 128kbps', ext: 'mp3',  ytdlpArgs: ['--audio-format', 'mp3', '--audio-quality', '7'] },
  flac:    { label: 'FLAC',        ext: 'flac', ytdlpArgs: ['--audio-format', 'flac'] },
  wav:     { label: 'WAV',         ext: 'wav',  ytdlpArgs: ['--audio-format', 'wav'] },
  ogg:     { label: 'OGG Vorbis',  ext: 'ogg',  ytdlpArgs: ['--audio-format', 'vorbis'] },
  aac:     { label: 'AAC',         ext: 'aac',  ytdlpArgs: ['--audio-format', 'aac'] },
  m4a:     { label: 'M4A',         ext: 'm4a',  ytdlpArgs: ['--audio-format', 'm4a'] },
  opus:    { label: 'Opus',        ext: 'opus', ytdlpArgs: ['--audio-format', 'opus'] },
};

// ─── InnerTube constants ──────────────────────────────────────────────────────

const YTM_BASE = 'https://music.youtube.com/youtubei/v1';
const YT_BASE  = 'https://www.youtube.com/youtubei/v1';
const INNERTUBE_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-KFXT3HLxw';

const YTM_CONTEXT = {
  client: { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00', hl: 'en', gl: 'US' },
};
const YT_CONTEXT = {
  client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en', gl: 'US' },
};

// ─── State ────────────────────────────────────────────────────────────────────

const downloadTasks = new Map<string, DownloadTask>();

let ytdlpBinaryPath: string | null = null;
let ytdlpStatus: YtDlpStatus = { ready: false, downloading: false, error: null };
let mainWindowRef: BrowserWindow | null = null;

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function httpsGet(
  url: string,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; body: string; location?: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'Stoat/1.0', ...headers } },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          return resolve({
            statusCode: res.statusCode,
            body: '',
            location: res.headers.location as string,
          });
        }
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf-8'),
          })
        );
        res.on('error', reject);
      }
    );
    req.on('error', reject);
  });
}

function httpsPost(
  url: string,
  body: object,
  headers: Record<string, string> = {}
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'User-Agent': 'Stoat/1.0',
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') })
        );
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── IPC helpers ──────────────────────────────────────────────────────────────

function sendProgress(task: DownloadTask, payload: Record<string, unknown>) {
  mainWindowRef?.webContents.send('downloader/progress', {
    downloadId: task.id,
    url: task.url,
    destination: task.destination,
    outputPath: task.outputPath,
    lrcPath: task.lrcPath,
    status: task.status,
    progress: task.progress,
    error: task.error,
    ...payload,
  });
}

function sendYtdlpStatus() {
  mainWindowRef?.webContents.send('downloader/ytdlp-status', ytdlpStatus);
}

// ─── yt-dlp binary management ─────────────────────────────────────────────────

function getYtdlpDir(): string {
  return join(app.getPath('userData'), 'bin');
}

function getYtdlpPath(): string {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return join(getYtdlpDir(), `yt-dlp${ext}`);
}

async function downloadBinaryFromGithub(destPath: string): Promise<void> {
  const rel = await httpsGet(
    'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
    { 'User-Agent': 'Stoat/1.0' }
  );
  const json = JSON.parse(rel.body);
  const tag = json.tag_name as string;

  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const isArm = process.arch === 'arm64';

  let fileName: string;
  if (isWin) {
    fileName = isArm ? 'yt-dlp_win_arm64.exe' : 'yt-dlp.exe';
  } else if (isMac) {
    fileName = isArm ? 'yt-dlp_macos' : 'yt-dlp_macos_legacy';
  } else {
    fileName = isArm ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  }

  const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/download/${tag}/${fileName}`;
  await streamToFile(downloadUrl, destPath);
  if (!isWin) chmodSync(destPath, 0o755);
}

function streamToFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (currentUrl: string, depth = 0) => {
      if (depth > 10) return reject(new Error('Too many redirects'));
      https
        .get(currentUrl, { headers: { 'User-Agent': 'Stoat/1.0' } }, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            return follow(res.headers.location as string, depth + 1);
          }
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`HTTP ${res.statusCode} downloading yt-dlp`));
          }
          const { createWriteStream } =
            require('node:fs') as typeof import('node:fs');
          const file = createWriteStream(destPath);
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
          file.on('error', (e) => {
            file.close();
            reject(e);
          });
          res.on('error', reject);
        })
        .on('error', reject);
    };
    follow(url);
  });
}

export async function ensureYtdlp(): Promise<string> {
  const binPath = getYtdlpPath();

  if (existsSync(binPath)) {
    ytdlpBinaryPath = binPath;
    ytdlpStatus = { ready: true, downloading: false, error: null };
    sendYtdlpStatus();
    return binPath;
  }

  ytdlpStatus = { ready: false, downloading: true, error: null };
  sendYtdlpStatus();

  try {
    mkdirSync(getYtdlpDir(), { recursive: true });
    await downloadBinaryFromGithub(binPath);
    ytdlpBinaryPath = binPath;
    ytdlpStatus = { ready: true, downloading: false, error: null };
    sendYtdlpStatus();
    return binPath;
  } catch (err: any) {
    ytdlpStatus = { ready: false, downloading: false, error: err?.message ?? String(err) };
    sendYtdlpStatus();
    throw err;
  }
}

export function getYtdlpStatus(): YtDlpStatus {
  return ytdlpStatus;
}

export function setMainWindowRef(win: BrowserWindow) {
  mainWindowRef = win;
}

// ─── InnerTube search ─────────────────────────────────────────────────────────

/**
 * Parse column 2 runs from a YTM musicResponsiveListItemRenderer.
 * Runs look like: ["Artist", " • ", "Album", " • ", "2023"]
 * or just:        ["Artist", " • ", "2023"]
 * Separators are " • " (with spaces) or "•".
 */
function parseYTMColumn2(runs: any[]): { artist: string; album: string } {
  // Collect the non-separator text segments in order
  const SEP = /^\s*•\s*$/;
  const segments: string[] = runs
    .map((r: any) => (r.text as string) ?? '')
    .filter((t) => !SEP.test(t) && t.trim().length > 0);

  // Heuristic: last segment that's a 4-digit year is the year
  const yearRe = /^\d{4}$/;
  const withoutYear = segments.filter((s) => !yearRe.test(s.trim()));

  const artist = withoutYear[0] ?? '';
  const album  = withoutYear[1] ?? '';   // empty string when not present
  return { artist, album };
}

function parseYTMResults(data: any): SearchResult[] {
  const results: SearchResult[] = [];
  const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs ?? [];
  for (const tab of tabs) {
    const sections =
      tab?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
    for (const section of sections) {
      const items = section?.musicShelfRenderer?.contents ?? [];
      for (const item of items) {
        const r = item?.musicResponsiveListItemRenderer;
        if (!r) continue;

        const cols = r.flexColumns ?? [];
        const title =
          cols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
            ?.text ?? '';
        const col2Runs: any[] =
          cols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
        const { artist, album } = parseYTMColumn2(col2Runs);

        const thumbs =
          r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? [];
        const thumbnail = (thumbs[thumbs.length - 1]?.url ?? '') as string;
        const videoId =
          r.overlay?.musicItemThumbnailOverlayRenderer?.content
            ?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint
            ?.videoId as string | undefined;

        // Duration from fixedColumns if present
        const fixedCols = r.fixedColumns ?? [];
        const durText =
          fixedCols[0]?.musicResponsiveListItemFixedColumnRenderer?.text
            ?.runs?.[0]?.text ?? '';
        const durParts = durText.split(':').map(Number);
        const duration =
          durParts.length === 2
            ? durParts[0] * 60 + durParts[1]
            : durParts.length === 3
            ? durParts[0] * 3600 + durParts[1] * 60 + durParts[2]
            : 0;

        if (videoId && title) {
          results.push({
            id: videoId,
            videoId,
            title,
            artist,
            album,
            thumbnail,
            duration,
            source: 'ytm',
            url: `https://www.youtube.com/watch?v=${videoId}`,
          });
        }
      }
    }
  }
  return results;
}

function parseYTResults(data: any): SearchResult[] {
  const items =
    data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents ?? [];
  return items.flatMap((item: any) => {
    const r = item?.videoRenderer;
    if (!r) return [];
    const title = r.title?.runs?.[0]?.text ?? '';
    const artist = r.ownerText?.runs?.[0]?.text ?? '';
    const thumbnail =
      (r.thumbnail?.thumbnails?.slice(-1)[0]?.url ?? '') as string;
    const videoId = r.videoId as string | undefined;
    const durText = r.lengthText?.simpleText ?? '0:00';
    const parts = durText.split(':').map(Number);
    const duration =
      parts.length === 2
        ? parts[0] * 60 + parts[1]
        : parts.length === 3
        ? parts[0] * 3600 + parts[1] * 60 + parts[2]
        : 0;
    if (!videoId || !title) return [];
    return [
      {
        id: videoId,
        videoId,
        title,
        artist,
        album: '',
        thumbnail,
        duration,
        source: 'yt' as const,
        url: `https://www.youtube.com/watch?v=${videoId}`,
      },
    ];
  });
}

async function innertubePost(
  base: string,
  endpoint: string,
  body: object,
  context: object
): Promise<any> {
  const url = `${base}/${endpoint}?key=${INNERTUBE_KEY}&prettyPrint=false`;
  const isMusic = base.includes('music');
  const res = await httpsPost(url, { context, ...body }, {
    'Content-Type': 'application/json',
    'X-YouTube-Client-Name': isMusic ? '67' : '1',
    'X-YouTube-Client-Version': isMusic
      ? YTM_CONTEXT.client.clientVersion
      : YT_CONTEXT.client.clientVersion,
    Origin: isMusic
      ? 'https://music.youtube.com'
      : 'https://www.youtube.com',
    Referer: isMusic
      ? 'https://music.youtube.com/'
      : 'https://www.youtube.com/',
  });
  if (res.statusCode < 200 || res.statusCode >= 300)
    throw new Error(`InnerTube ${res.statusCode}`);
  return JSON.parse(res.body);
}

export async function searchYouTubeMusic(query: string): Promise<SearchResult[]> {
  try {
    const data = await innertubePost(
      YTM_BASE,
      'search',
      { query, params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA==' },
      YTM_CONTEXT
    );
    return parseYTMResults(data);
  } catch {
    return [];
  }
}

export async function searchYouTube(query: string): Promise<SearchResult[]> {
  try {
    const data = await innertubePost(YT_BASE, 'search', { query }, YT_CONTEXT);
    return parseYTResults(data);
  } catch {
    return [];
  }
}

export async function search(query: string): Promise<SearchResult[]> {
  const ytmResults = await searchYouTubeMusic(query);
  if (ytmResults.length > 0) return ytmResults;
  return searchYouTube(query);
}

// ─── LRC conversion ───────────────────────────────────────────────────────────
//
// yt-dlp's --convert-subs lrc support is inconsistent across versions and
// subtitle sources. Instead we grab the raw subtitle file (srv3 > ttml > vtt)
// and convert it ourselves — this is reliable on all yt-dlp versions.
//
// srv3 (YouTube's native XML format) carries millisecond timestamps and is the
// richest source. We fall back to VTT if srv3/ttml aren't available.

/**
 * Convert a WebVTT subtitle string to LRC format.
 * VTT cues look like:
 *   00:01.000 --> 00:04.000
 *   Lyric line here
 */
function vttToLrc(vtt: string): string {
  const lines = vtt.split('\n');
  const lrcLines: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    // Match timestamp lines: 00:01.000 --> 00:04.000 or 00:00:01.000 --> ...
    const tsMatch = line.match(
      /^(\d{1,2}:\d{2}[.:]\d{2,3})\s*-->/
    );
    if (tsMatch) {
      const ts = tsMatch[1];
      // Convert timestamp to [mm:ss.xx] format
      const lrcTs = normaliseTimestamp(ts);
      // Collect text lines until blank line or next cue
      const textParts: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        const t = lines[i].trim();
        // Strip VTT tags like <00:01.000><c> and HTML entities
        const clean = t
          .replace(/<\d{2}:\d{2}[.:]\d{3}>/g, '')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&nbsp;/g, ' ')
          .trim();
        if (clean) textParts.push(clean);
        i++;
      }
      const text = textParts.join(' ');
      if (text && lrcTs) lrcLines.push(`[${lrcTs}]${text}`);
    } else {
      i++;
    }
  }
  return lrcLines.join('\n');
}

/**
 * Convert a YouTube srv3 XML subtitle string to LRC format.
 * srv3 looks like: <text start="1.234" dur="2.5">Lyric line</text>
 */
function srv3ToLrc(xml: string): string {
  const lrcLines: string[] = [];
  const re = /<text[^>]+start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const startSec = parseFloat(m[1]);
    const rawText = m[2]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#39;/g, "'")
      .trim();
    if (rawText) {
      lrcLines.push(`[${secondsToLrcTs(startSec)}]${rawText}`);
    }
  }
  return lrcLines.join('\n');
}

function normaliseTimestamp(ts: string): string {
  // Input: 00:01.000 or 00:00:01.000
  const parts = ts.replace(',', '.').split(':');
  if (parts.length === 2) {
    // mm:ss.xxx
    const mm = parts[0].padStart(2, '0');
    const ss = parts[1].padStart(6, '0'); // ss.xxx
    return `${mm}:${ss.slice(0, 5)}`; // mm:ss.xx
  } else if (parts.length === 3) {
    // hh:mm:ss.xxx — fold hours into minutes for LRC
    const totalMin = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    const mm = String(totalMin).padStart(2, '0');
    const ss = parts[2].padStart(6, '0');
    return `${mm}:${ss.slice(0, 5)}`;
  }
  return '';
}

function secondsToLrcTs(s: number): string {
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  const mmStr = String(mm).padStart(2, '0');
  const ssStr = ss.toFixed(2).padStart(5, '0');
  return `${mmStr}:${ssStr}`;
}

/**
 * Post-process raw subtitle files written by yt-dlp into an LRC file.
 * Cleans up the raw files afterwards.
 * Returns the path of the written LRC file, or null if nothing found.
 */
function convertSubsToLrc(
  baseName: string, // full path without extension, e.g. /music/Artist - Title
  destination: string
): string | null {
  const { readdirSync: rd, readFileSync: rf, writeFileSync: wf } =
    require('node:fs') as typeof import('node:fs');

  let lrcContent: string | null = null;
  const rawSubFiles: string[] = [];

  try {
    const files = rd(destination);
    // Find subtitle files that share this base name
    const safeName = basename(baseName);
    const subFiles = files.filter(
      (f) =>
        f.startsWith(safeName) &&
        /\.(srv3|ttml|vtt|srv1|srv2)$/.test(f)
    );

    // Prefer srv3 > ttml > vtt
    const preferred = ['srv3', 'ttml', 'vtt', 'srv1', 'srv2'];
    let chosen: string | null = null;
    for (const ext of preferred) {
      const match = subFiles.find((f) => f.endsWith(`.${ext}`));
      if (match) {
        chosen = match;
        break;
      }
    }

    if (!chosen) return null;
    rawSubFiles.push(...subFiles);

    const content = rf(join(destination, chosen), 'utf-8');
    lrcContent =
      chosen.endsWith('.srv3') || chosen.endsWith('.ttml')
        ? srv3ToLrc(content)
        : vttToLrc(content);
  } catch {
    return null;
  }

  if (!lrcContent || lrcContent.trim().length === 0) return null;

  const lrcPath = `${baseName}.lrc`;
  try {
    const { writeFileSync: wfs } =
      require('node:fs') as typeof import('node:fs');
    wfs(lrcPath, lrcContent, 'utf-8');
    // Remove raw sub files
    for (const f of rawSubFiles) {
      try {
        unlinkSync(join(destination, f));
      } catch { /* best-effort */ }
    }
    return lrcPath;
  } catch {
    return null;
  }
}

// ─── Downloading ──────────────────────────────────────────────────────────────

function getDownloadFolder(options: DownloadOptions): string {
  return options.destination || app.getPath('music');
}

export async function startDownload(
  mainWindow: BrowserWindow,
  options: DownloadOptions
): Promise<string> {
  mainWindowRef = mainWindow;

  const id = randomUUID();
  const destination = getDownloadFolder(options);
  mkdirSync(destination, { recursive: true });

  const task: DownloadTask = {
    id,
    url: options.url,
    destination,
    status: 'pending',
    progress: 0,
  };
  downloadTasks.set(id, task);
  sendProgress(task, { event: 'started', text: 'Preparing download…' });

  (async () => {
    try {
      const binPath = await ensureYtdlp();

      const fmt =
        options.format && options.format in DOWNLOAD_FORMATS
          ? DOWNLOAD_FORMATS[options.format]
          : DOWNLOAD_FORMATS.mp3_320;

      // Use a temp name during download, then we know the exact base name
      // so we can match subtitle files to it reliably.
      const outTemplate = join(destination, '%(uploader)s - %(title)s.%(ext)s');

      const args: string[] = [
        '--no-playlist',
        '--progress',
        '--newline',
        // Audio extraction
        '-x',
        ...fmt.ytdlpArgs,
        // Metadata embedding
        '--add-metadata',
        '--embed-thumbnail',
      ];

      // Override metadata tags when we have rich data from the search result
      if (options.title || options.artist || options.album) {
        // --parse-metadata lets us set arbitrary metadata fields
        if (options.title)  args.push('--parse-metadata', `::(?P<meta_title>${escapeRegex(options.title)})`);
        if (options.artist) {
          // Use postprocessor args to inject into ffmpeg directly — most reliable
          args.push(
            '--ppa',
            `FFmpegMetadata:-metadata artist=${shellescape(options.artist)}`
          );
        }
        if (options.album) {
          args.push(
            '--ppa',
            `FFmpegMetadata:-metadata album=${shellescape(options.album)}`
          );
        }
      }

      // Lyrics / subtitles
      if (options.downloadLyrics !== false) {
        args.push(
          '--write-subs',
          '--write-auto-subs',
          '--sub-langs', 'en.*',
          '--sub-format', 'srv3/ttml/vtt/best',
          // Write subtitle file alongside audio; we'll convert it to LRC ourselves
          '--output', `subtitle:${join(destination, '%(uploader)s - %(title)s.%(ext)s')}`
        );
      }

      args.push('-o', outTemplate, '--', options.url);

      const { spawn } = await import('node:child_process');
      const proc = spawn(binPath, args, { cwd: destination });
      task.process = proc as any;
      task.status = 'started';

      let lastFile: string | null = null;
      let stderrAccum = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();

        const pMatch = text.match(/\[download\]\s+([\d.]+)%/);
        if (pMatch) {
          task.progress = parseFloat(pMatch[1]);
          task.status = 'progress';
          sendProgress(task, {
            event: 'progress',
            text: `${Math.round(task.progress)}%`,
          });
        }

        const destMatch = text.match(/\[download\] Destination: (.+)/);
        if (destMatch) {
          const p = destMatch[1].trim();
          if (!/\.(webp|jpg|jpeg|png|srv\d|ttml|vtt)$/i.test(p)) lastFile = p;
        }

        const postMatch = text.match(
          /\[(?:ExtractAudio|Merger|VideoConvertor)\] Destination: (.+)/
        );
        if (postMatch) lastFile = postMatch[1].trim();
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        const t = chunk.toString();
        if (!t.includes('WARNING') && !t.includes('warning')) stderrAccum += t;
      });

      await new Promise<void>((resolve, reject) => {
        proc.on('close', (code: number | null) => {
          if (code === 0 || proc.killed) resolve();
          else
            reject(
              new Error(stderrAccum.slice(-500) || `yt-dlp exited ${code}`)
            );
        });
        proc.on('error', reject);
      });

      // Convert subtitle files → LRC
      let lrcPath: string | null = null;
      if (options.downloadLyrics !== false && lastFile) {
        const baseName = lastFile.replace(/\.[^.]+$/, ''); // strip audio ext
        lrcPath = convertSubsToLrc(baseName, destination);
        if (lrcPath) task.lrcPath = lrcPath;
      }

      task.status = 'done';
      task.progress = 100;
      task.outputPath = lastFile ?? undefined;
      sendProgress(task, {
        event: 'done',
        text: 'Download complete',
        outputPath: lastFile,
        lrcPath,
      });
    } catch (err: any) {
      if (task.status !== 'cancelled') {
        task.status = 'error';
        task.error = err?.message ?? String(err);
        sendProgress(task, { event: 'error', text: task.error });
      }
    } finally {
      downloadTasks.delete(id);
    }
  })();

  return id;
}

export async function cancelDownload(downloadId: string): Promise<void> {
  const task = downloadTasks.get(downloadId);
  if (!task) return;
  (task.process as any)?.kill?.('SIGTERM');
  task.status = 'cancelled';
  sendProgress(task, { event: 'cancelled', text: 'Cancelled' });
  downloadTasks.delete(downloadId);
}

export async function listDownloads(folder?: string): Promise<string[]> {
  const target = folder || app.getPath('music');
  if (!existsSync(target)) return [];
  try {
    return readdirSync(target, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// ─── Misc helpers ─────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Shell-safe quoting for ffmpeg -metadata values passed via --ppa */
function shellescape(s: string): string {
  // ffmpeg receives this via yt-dlp's argument splitting, not a shell,
  // so we just need to avoid breaking the arg boundary.
  // Wrap in single quotes, escape any single quotes inside.
  return `'${s.replace(/'/g, "'\\''")}'`;
}
