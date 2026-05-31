/**
 * Stoat Downloader — fully self-contained, no user-installed dependencies.
 *
 * On first launch, yt-dlp is automatically downloaded from GitHub into the
 * app's userData directory (~10 MB) and reused on subsequent launches.
 *
 * Search uses YouTube's internal InnerTube API directly from the main process
 * (no CORS issues, no API key required).
 *
 * Spotify URL support: resolves Spotify tracks/albums/playlists/artists
 * via the public Spotify metadata API (no login required) then smart-matches
 * on YouTube Music using spotdl-style confidence scoring to avoid wrong versions.
 */

import { app, BrowserWindow } from 'electron';
import { existsSync, mkdirSync, readdirSync, chmodSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import https from 'node:https';
import {
  isSpotifyUrl,
  parseSpotifyUrl,
  fetchSpotifyTrack,
  fetchSpotifyAlbumTracks,
  fetchSpotifyPlaylistTracks,
  fetchSpotifyArtistTracks,
  embedSpotifyMetadataIntoFile,
} from './spotifyScraper';
import type { SpotifyTrackMeta as SpotifyScraperTrackMeta } from './spotifyScraper';

const spotifyUrlInfo = require('spotify-url-info').default || require('spotify-url-info');

const fetchFn = globalThis.fetch;

const {
  getData,
  getPreview,
  getTracks,
  getDetails
} = spotifyUrlInfo(fetchFn);

const spotify = getData

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
  albumArtist?: string;
  year?: string;
  trackNumber?: string;
  genres?: string[];
  // Batch download
  isBatch?: boolean;
  batchId?: string;
  // Extra options
  downloadLyrics?: boolean;
  /** How to handle duplicate files: 'ask' (default) | 'skip' | 'overwrite' */
  duplicateAction?: 'ask' | 'skip' | 'overwrite';
}

export interface SpotifyTrackMeta {
  id: string;
  title: string;
  artist: string;
  artistIds: string[];
  album: string;
  albumArtist: string;
  year: string;
  trackNumber: string;
  discNumber: string;
  duration: number; // seconds
  isrc?: string;
  explicit: boolean;
  genres: string[];
  albumCover?: string;
}

function normalizeSpotifyTrackMeta(meta: SpotifyScraperTrackMeta): SpotifyTrackMeta {
  return {
    id: meta.id,
    title: meta.name,
    artist: meta.artists?.[0]?.name ?? '',
    artistIds: (meta.artists ?? []).map((artist) => artist.id),
    album: meta.album.name,
    albumArtist:
      meta.album.artists?.[0]?.name ?? meta.artists?.[0]?.name ?? '',
    year: meta.album.releaseYear,
    trackNumber: String(meta.trackNumber ?? 0),
    discNumber: String(meta.discNumber ?? 0),
    duration: Math.round((meta.durationMs ?? 0) / 1000),
    isrc: meta.isrc,
    explicit: meta.explicit,
    genres: meta.genres ?? [],
    albumCover: meta.album.coverUrlLarge,
  };
}

export interface SearchResult {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // seconds
  thumbnail: string;
  source: 'ytm' | 'yt' | 'spotify';
  url: string;
  // Spotify enrichment
  spotifyMeta?: SpotifyTrackMeta;
  matchScore?: number;
}

export interface BatchDownloadItem {
  url: string;
  meta: SpotifyTrackMeta;
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
  // Batch context
  batchId?: string;
  batchTotal?: number;
  batchCurrent?: number;
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

// ─── Spotify constants ────────────────────────────────────────────────────────

// Spotify's public token endpoint used by the web player (no login required)


// ─── State ────────────────────────────────────────────────────────────────────

const downloadTasks = new Map<string, DownloadTask>();
const batchQueues = new Map<string, BatchDownloadItem[]>();

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
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Stoat/1.0)', ...headers } },
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
          'User-Agent': 'Mozilla/5.0 (compatible; Stoat/1.0)',
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
    batchId: task.batchId,
    batchTotal: task.batchTotal,
    batchCurrent: task.batchCurrent,
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

// ─── Smart YouTube Music matching (spotdl-style) ──────────────────────────────

/**
 * Normalise a string for comparison: lowercase, remove punctuation, collapse whitespace.
 */
function normaliseStr(s: string): string {
  return s
    .toLowerCase()
    .replace(/['"''""]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compute word-overlap Jaccard similarity between two strings */
function jaccardSim(a: string, b: string): number {
  const setA = new Set(normaliseStr(a).split(' ').filter(Boolean));
  const setB = new Set(normaliseStr(b).split(' ').filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  let inter = 0;
  setA.forEach((w) => { if (setB.has(w)) inter++; });
  return inter / (setA.size + setB.size - inter);
}

/** Duration similarity: 1.0 if within 2 s, 0 if off by > 10 s */
function durationScore(ytSec: number, spotMs: number): number {
  if (!ytSec || !spotMs) return 0.5;
  const diff = Math.abs(ytSec - spotMs / 1000);
  if (diff <= 2) return 1.0;
  if (diff <= 5) return 0.8;
  if (diff <= 10) return 0.5;
  return 0;
}

/**
 * Penalty for "bad" version keywords in a YTM result title that aren't in the Spotify title.
 * This catches instrumentals, remixes, covers, sped up, nightcore, etc.
 */
const BAD_VERSION_KEYWORDS = [
  'instrumental', 'karaoke', 'cover', 'tribute', 'nightcore',
  'sped up', 'slowed', 'reverb', 'lofi', 'lo-fi', 'remix',
  'mashup', 'piano version', 'acoustic', 'live', 'version', 'edit',
  'extended', 'radio edit', 'remaster', 'demo', 'reprise',
];

function badVersionPenalty(ytTitle: string, spotTitle: string): number {
  const ytNorm = normaliseStr(ytTitle);
  const spNorm = normaliseStr(spotTitle);
  let penalty = 0;
  for (const kw of BAD_VERSION_KEYWORDS) {
    if (ytNorm.includes(kw) && !spNorm.includes(kw)) {
      penalty += 0.25;
    }
  }
  return Math.min(penalty, 1.0);
}

/**
 * Score a YTM search result against known Spotify metadata.
 * Returns a score 0–1 (higher = better match).
 */
function scoreYtmResult(ytm: SearchResult, meta: SpotifyTrackMeta): number {
  const titleSim = jaccardSim(ytm.title, meta.title);
  const artistSim = jaccardSim(ytm.artist, meta.artist);
  const albumSim = ytm.album ? jaccardSim(ytm.album, meta.album) : 0.3;
  const durScore = durationScore(ytm.duration, meta.duration);
  const penalty = badVersionPenalty(ytm.title, meta.title);

  // Weights: title 35%, artist 30%, album 10%, duration 25%
  const raw = titleSim * 0.35 + artistSim * 0.30 + albumSim * 0.10 + durScore * 0.25;

  // Source bonus: YTM results are more likely to be official
  const srcBonus = ytm.source === 'ytm' ? 0.05 : 0;

  return Math.max(0, Math.min(1, raw + srcBonus - penalty));
}

/**
 * Find the best YouTube URL for a Spotify track using smart matching.
 * Returns the best VideoId or null if no confident match.
 */
export async function findBestYouTubeMatch(meta: SpotifyTrackMeta): Promise<SearchResult | null> {
  const query = `${meta.title} ${meta.artist}`;

  // Search YTM first (most likely to have official versions)
  const ytmResults = await searchYouTubeMusic(query);
  const ytResults = ytmResults.length < 3 ? await searchYouTube(query) : [];
  const candidates = [...ytmResults, ...ytResults];

  if (candidates.length === 0) return null;

  // Score each candidate
  const scored = candidates.map((r) => ({ ...r, matchScore: scoreYtmResult(r, meta) }));
  scored.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));

  const best = scored[0];
  // Require a minimum confidence of 0.35
  if ((best.matchScore ?? 0) < 0.35) return null;

  return best;
}

// ─── InnerTube search ─────────────────────────────────────────────────────────

function parseYTMColumn2(runs: any[]): { artist: string; album: string } {
  const SEP = /^\s*•\s*$/;
  const segments: string[] = runs
    .map((r: any) => (r.text as string) ?? '')
    .filter((t) => !SEP.test(t) && t.trim().length > 0);

  const yearRe = /^\d{4}$/;
  const withoutYear = segments.filter((s) => !yearRe.test(s.trim()));

  const artist = withoutYear[0] ?? '';
  const album  = withoutYear[1] ?? '';
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

/**
 * Resolve a Spotify URL to a list of track metadata objects.
 * For a track URL: returns a single-item array.
 * For album/playlist/artist: returns all tracks.
 */
export async function resolveSpotifyUrl(url: string): Promise<SpotifyTrackMeta[]> {
  const parsed = parseSpotifyUrl(url);
  if (!parsed) throw new Error('Not a valid Spotify URL');

  console.debug('[Downloader] Resolving Spotify URL', { url, type: parsed.type, id: parsed.id });
  
  try {
    switch (parsed.type) {
      case 'track':
        return [normalizeSpotifyTrackMeta(await fetchSpotifyTrack(parsed.id))];
      case 'album':
        return (await fetchSpotifyAlbumTracks(parsed.id)).map(normalizeSpotifyTrackMeta);
      case 'playlist':
        return (await fetchSpotifyPlaylistTracks(parsed.id)).map(normalizeSpotifyTrackMeta);
      case 'artist':
        return (await fetchSpotifyArtistTracks(parsed.id)).map(normalizeSpotifyTrackMeta);
      default:
        throw new Error(`Unknown Spotify URL type: ${parsed.type}`);
    }
  } catch (err) {
    console.error('[Downloader] Spotify URL resolution failed', { url, type: parsed.type, error: err });
    throw err;
  }
}

// ─── LRC conversion ───────────────────────────────────────────────────────────

function vttToLrc(vtt: string): string {
  const lines = vtt.split('\n');
  const lrcLines: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    const tsMatch = line.match(
      /^(\d{1,2}:\d{2}[.:]\d{2,3})\s*-->/
    );
    if (tsMatch) {
      const ts = tsMatch[1];
      const lrcTs = normaliseTimestamp(ts);
      const textParts: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        const t = lines[i].trim();
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
  const parts = ts.replace(',', '.').split(':');
  if (parts.length === 2) {
    const mm = parts[0].padStart(2, '0');
    const ss = parts[1].padStart(6, '0');
    return `${mm}:${ss.slice(0, 5)}`;
  } else if (parts.length === 3) {
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

function convertSubsToLrc(
  baseName: string,
  destination: string
): string | null {
  const { readdirSync: rd, readFileSync: rf, writeFileSync: wf } =
    require('node:fs') as typeof import('node:fs');

  let lrcContent: string | null = null;
  const rawSubFiles: string[] = [];

  try {
    const files = rd(destination);
    const safeName = basename(baseName);
    const subFiles = files.filter(
      (f) =>
        f.startsWith(safeName) &&
        /\.(srv3|ttml|vtt|srv1|srv2)$/.test(f)
    );

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

/** Run a single yt-dlp download for a given URL with metadata */
async function runYtdlpDownload(
  task: DownloadTask,
  options: DownloadOptions,
  binPath: string
): Promise<void> {
  const destination = task.destination;
  const fmt =
    options.format && options.format in DOWNLOAD_FORMATS
      ? DOWNLOAD_FORMATS[options.format]
      : DOWNLOAD_FORMATS.mp3_320;

  const outTemplate = join(destination, '%(uploader)s - %(title)s.%(ext)s');

  const args: string[] = [
    '--no-playlist',
    '--progress',
    '--newline',
    '-x',
    ...fmt.ytdlpArgs,
    '--add-metadata',
    '--embed-thumbnail',
  ];

  // Embed rich metadata via ffmpeg postprocessor args
  if (options.artist) {
    args.push('--ppa', `FFmpegMetadata:-metadata artist=${shellescape(options.artist)}`);
  }
  if (options.albumArtist) {
    args.push('--ppa', `FFmpegMetadata:-metadata album_artist=${shellescape(options.albumArtist)}`);
  }
  if (options.album) {
    args.push('--ppa', `FFmpegMetadata:-metadata album=${shellescape(options.album)}`);
  }
  if (options.year) {
    args.push('--ppa', `FFmpegMetadata:-metadata date=${shellescape(options.year)}`);
  }
  if (options.trackNumber) {
    args.push('--ppa', `FFmpegMetadata:-metadata track=${shellescape(options.trackNumber)}`);
  }
  if (options.genres && options.genres.length > 0) {
    args.push('--ppa', `FFmpegMetadata:-metadata genre=${shellescape(options.genres.join('; '))}`);
  }
  if (options.title) {
    args.push('--ppa', `FFmpegMetadata:-metadata title=${shellescape(options.title)}`);
  }

  if (options.downloadLyrics !== false) {
    args.push(
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs', 'en.*',
      '--sub-format', 'srv3/ttml/vtt/best',
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
      sendProgress(task, { event: 'progress', text: `${Math.round(task.progress)}%` });
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

  // Convert subtitles → LRC
  let lrcPath: string | null = null;
  if (options.downloadLyrics !== false && lastFile) {
    const baseName = lastFile.replace(/\.[^.]+$/, '');
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
    batchId: options.batchId,
  };
  downloadTasks.set(id, task);
  sendProgress(task, { event: 'started', text: 'Preparing download…' });

  (async () => {
    try {
      const binPath = await ensureYtdlp();

      // ── Duplicate check for direct (non-batch) downloads ───────────────
      // For batch downloads each track is checked individually inside the loop.
      if (!options.isBatch && !isSpotifyUrl(options.url)) {
        const dupResult = await checkForDuplicate(task, options);
        if (dupResult === 'skip') {
          task.status = 'cancelled';
          sendProgress(task, { event: 'cancelled', text: 'Skipped — file already exists' });
          downloadTasks.delete(id);
          return;
        }
        // 'overwrite' or 'none' — proceed
      }

      // ── Spotify URL handling ────────────────────────────────────────────
      if (isSpotifyUrl(options.url)) {
        const parsed = parseSpotifyUrl(options.url)!;
        console.debug('[Downloader] Spotify URL detected', options.url, parsed.type);

        if (parsed.type === 'track') {
          // Single track: resolve metadata, find best YT match, download
          sendProgress(task, { event: 'resolving', text: 'Fetching Spotify metadata…' });
          const scrapedMeta = await fetchSpotifyTrack(parsed.id);
          const meta = normalizeSpotifyTrackMeta(scrapedMeta);
          const match = await findBestYouTubeMatch(meta);
          if (!match) throw new Error('Could not find a matching YouTube video for this track.');

          await runYtdlpDownload(
            task,
            {
              ...options,
              url: match.url,
              title: meta.title,
              artist: meta.artist,
              albumArtist: meta.albumArtist,
              album: meta.album,
              year: meta.year,
              trackNumber: meta.trackNumber,
              genres: meta.genres,
            },
            binPath
          );
          return;
        }

        // Batch: album / playlist / artist
        sendProgress(task, { event: 'resolving', text: 'Fetching Spotify track list…' });
        let tracks: SpotifyTrackMeta[] = [];
        if (parsed.type === 'album') tracks = (await fetchSpotifyAlbumTracks(parsed.id)).map(normalizeSpotifyTrackMeta);
        else if (parsed.type === 'playlist') tracks = (await fetchSpotifyPlaylistTracks(parsed.id)).map(normalizeSpotifyTrackMeta);
        else if (parsed.type === 'artist') tracks = (await fetchSpotifyArtistTracks(parsed.id)).map(normalizeSpotifyTrackMeta);

        if (tracks.length === 0) throw new Error('No tracks found for this Spotify URL.');

        task.batchTotal = tracks.length;
        task.batchCurrent = 0;
        sendProgress(task, {
          event: 'batch_start',
          text: `Downloading ${tracks.length} tracks…`,
          batchTotal: tracks.length,
        });

        let successCount = 0;
        let failCount = 0;
        for (let i = 0; i < tracks.length; i++) {
          if (task.status === 'cancelled') break;
          const meta = tracks[i];
          task.batchCurrent = i + 1;
          sendProgress(task, {
            event: 'batch_progress',
            text: `Track ${i + 1}/${tracks.length}: ${meta.title}`,
            batchCurrent: i + 1,
            batchTotal: tracks.length,
          });
          try {
            const match = await findBestYouTubeMatch(meta);
            if (!match) { failCount++; continue; }
            // Create a sub-task context for the individual download progress
            const subTask: DownloadTask = {
              ...task,
              url: match.url,
              progress: 0,
              status: 'pending',
            };
            await runYtdlpDownload(
              subTask,
              {
                ...options,
                url: match.url,
                title: meta.title,
                artist: meta.artist,
                albumArtist: meta.albumArtist,
                album: meta.album,
                year: meta.year,
                trackNumber: meta.trackNumber,
                genres: meta.genres,
                isBatch: true,
                batchId: id,
              },
              binPath
            );
            successCount++;
          } catch (err: any) {
            failCount++;
            sendProgress(task, {
              event: 'batch_track_error',
              text: `Failed: ${meta.title} — ${err?.message ?? 'unknown error'}`,
              batchCurrent: i + 1,
            });
          }
        }

        task.status = 'done';
        task.progress = 100;
        sendProgress(task, {
          event: 'done',
          text: `Batch complete — ${successCount} downloaded, ${failCount} failed`,
          batchSuccessCount: successCount,
          batchFailCount: failCount,
        });
        return;
      }

      // ── Non-Spotify URL ─────────────────────────────────────────────────
      await runYtdlpDownload(task, options, binPath);
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

/**
 * Check if a download output file likely already exists.
 * For non-Spotify downloads the yt-dlp output template is:
 *   <destination>/%(uploader)s - %(title)s.<ext>
 * We can't know the exact filename before download, so we check by
 * searching for files containing the search query terms in the folder.
 *
 * For confirmed duplicates, we emit a 'duplicate' IPC event and wait
 * for the renderer to respond via 'app/downloader/duplicate-response'.
 */
async function checkForDuplicate(
  task: DownloadTask,
  options: DownloadOptions
): Promise<'skip' | 'overwrite' | 'none'> {
  if (options.duplicateAction === 'overwrite') return 'none';
  if (options.duplicateAction === 'skip') return 'skip';

  const dest = task.destination;
  if (!existsSync(dest)) return 'none';

  // Build a candidate name from metadata if available
  const title = options.title || options.searchQuery || '';
  const artist = options.artist || '';
  if (!title) return 'none';

  try {
    const files = readdirSync(dest);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const needle = norm(title);
    const match = files.find((f) => {
      const fn = norm(f);
      return fn.includes(needle) || (artist && fn.includes(norm(artist)) && fn.includes(needle.slice(0, 8)));
    });

    if (!match) return 'none';

    // File likely already exists — ask the renderer
    const existingPath = join(dest, match);
    return new Promise<'skip' | 'overwrite' | 'none'>((resolve) => {
      sendProgress(task, {
        event: 'duplicate',
        text: 'File already exists',
        existingFile: match,
        existingPath,
      });

      // Listen for response from renderer (one-time)
      const { ipcMain } = require('electron') as typeof import('electron');
      const handler = (_: any, { downloadId, action }: { downloadId: string; action: 'skip' | 'overwrite' }) => {
        if (downloadId !== task.id) return;
        ipcMain.removeListener('app/downloader/duplicate-response', handler);
        clearTimeout(timeout);
        resolve(action === 'skip' ? 'skip' : 'none');
      };

      // Auto-skip after 30s if no response
      const timeout = setTimeout(() => {
        ipcMain.removeListener('app/downloader/duplicate-response', handler);
        resolve('skip');
      }, 30_000);

      ipcMain.on('app/downloader/duplicate-response', handler);
    });
  } catch {
    return 'none';
  }
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

function shellescape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
