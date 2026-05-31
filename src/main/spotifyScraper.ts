/**
 * spotifyScraper.ts — Production-grade Spotify metadata pipeline
 *
 * Fallback chain (in order):
 *   1. User has Spotify credentials in DB → official Client Credentials API
 *   2. No credentials → puppeteer-extra stealth token interception
 *   3. Puppeteer unavailable/fails → SpotAPI clienttoken.spotify.com approach
 *   4. All else fails → return null (caller falls back to yt-dlp embedded tags)
 *
 * The scraped payload is used to:
 *   a) Embed rich ID3/MP4 tags into the downloaded audio file via node-taglib-sharp
 *   b) Register genres, album art, artist data in Nora's database via parseSong
 */

import https from 'node:https';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { app, BrowserWindow } from 'electron';
import logger from './logger';
import { getUserSettings } from './db/queries/settings';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpotifyArtistMeta {
  id: string;
  name: string;
  genres: string[];
  imageUrl?: string;
  popularity?: number;
  followers?: number;
  externalUrl?: string;
}

export interface SpotifyAlbumMeta {
  id: string;
  name: string;
  releaseDate: string;
  releaseYear: string;
  totalTracks: number;
  coverUrlLarge: string;  // highest-res artwork from Spotify
  coverUrlMedium?: string;
  coverUrlSmall?: string;
  label?: string;
  genres: string[];
  artists: SpotifyArtistMeta[];
  upc?: string;           // barcode
  externalUrl?: string;
}

export interface SpotifyTrackMeta {
  id: string;
  name: string;
  durationMs: number;
  trackNumber: number;
  discNumber: number;
  isrc?: string;
  explicit: boolean;
  popularity?: number;
  externalUrl?: string;
  previewUrl?: string;
  artists: SpotifyArtistMeta[];
  album: SpotifyAlbumMeta;
  genres: string[];       // union of album + artist genres
}

export interface SpotifyPlaylistMeta {
  id: string;
  name: string;
  description?: string;
  coverUrl?: string;
  tracks: SpotifyTrackMeta[];
  totalTracks: number;
}

// ─── Token cache ──────────────────────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiry = 0;
let anonymousClientId: string | null = null;
let mainWindow: BrowserWindow | null = null;

export function setMainWindowRef(win: BrowserWindow | null) {
  mainWindow = win;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function httpsGet(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        ...headers,
      },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location as string, headers).then(resolve).catch(reject);
      }
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

function httpsPost(url: string, body: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        ...headers,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

// Exponential backoff for 429 rate-limit responses
async function rateLimitedRequest(
  fn: () => Promise<{ status: number; body: string }>,
  maxRetries = 12  // Increased from 4 to 12 for more resilience
): Promise<{ status: number; body: string }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fn();
    if (res.status === 429) {
      // Parse Retry-After header; otherwise exponential backoff
      // Exponential: 2s, 4s, 8s, 16s, 32s, 60s, 60s... capped at 60s
      const baseDelay = Math.min(1000 * Math.pow(2, attempt), 60_000);
      const jitterMs = Math.random() * 1000;  // Add ±1s jitter to prevent thundering herd
      const delay = baseDelay + jitterMs;
      
      logger.warn(
        `Spotify rate limited (429) — backing off ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries + 1})`,
        { status: 429, attempt, maxRetries, delayMs: Math.round(delay) }
      );
      
      // Emit debug event to renderer
      if (mainWindow) {
        mainWindow.webContents.send('spotify/debug', {
          timestamp: Date.now(),
          level: 'warn',
          message: `Rate limit hit — waiting ${Math.round(delay / 1000)}s before retry`,
          details: { attempt: attempt + 1, maxRetries: maxRetries + 1, delayMs: Math.round(delay) }
        });
      }
      
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return res;
  }
  const errorMsg = 'Spotify rate limit exceeded after max retries (12 attempts)';
  logger.error(errorMsg, { maxRetries });
  
  if (mainWindow) {
    mainWindow.webContents.send('spotify/debug', {
      timestamp: Date.now(),
      level: 'error',
      message: errorMsg,
      details: { maxRetries }
    });
  }
  
  throw new Error(errorMsg);
}

// ─── Token acquisition ────────────────────────────────────────────────────────

/** Method 1: Official Client Credentials OAuth */
async function getTokenWithCredentials(clientId: string, clientSecret: string): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry - 30_000) return cachedToken;

  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await httpsPost(
    'https://accounts.spotify.com/api/token',
    'grant_type=client_credentials',
    { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' }
  );
  const data = JSON.parse(res.body);
  if (!data.access_token) throw new Error('Credentials auth failed: ' + res.body.slice(0, 200));
  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in ?? 3600) * 1000;
  return cachedToken!;
}

/** Method 2: Puppeteer stealth token interception */
async function getTokenViaPuppeteer(): Promise<string> {
  // Dynamic import so puppeteer-extra is truly optional (not in main bundle)
  const puppeteerExtra = await import('puppeteer-extra').catch(() => null);
  if (!puppeteerExtra) throw new Error('puppeteer-extra not available');

  const StealthPlugin = await import('puppeteer-extra-plugin-stealth').catch(() => null);
  if (StealthPlugin) puppeteerExtra.default.use(StealthPlugin.default());

  const browser = await puppeteerExtra.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    let capturedToken: string | null = null;

    // Intercept outgoing requests and grab the Bearer token
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const auth = req.headers()['authorization'] ?? '';
      if (!capturedToken && auth.startsWith('Bearer BQ')) {
        capturedToken = auth.replace('Bearer ', '');
      }
      req.continue();
    });

    // Navigate to a public Spotify page to trigger the web player to authenticate
    await page.goto('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', {
      waitUntil: 'networkidle2',
      timeout: 30_000,
    });

    if (!capturedToken) {
      // Give the page 5s more to fire authenticated requests
      await new Promise(r => setTimeout(r, 5_000));
    }

    if (!capturedToken) throw new Error('No Bearer token captured via Puppeteer');

    cachedToken = capturedToken;
    tokenExpiry = Date.now() + 3_600_000; // Assume ~1h
    return capturedToken;
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Method 3: SpotAPI-style anonymous clienttoken endpoint */
async function getTokenViaClientTokenEndpoint(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry - 30_000) return cachedToken;

  // Step 1: extract anonymous client_id from open.spotify.com
  if (!anonymousClientId) {
    const pageRes = await httpsGet('https://open.spotify.com/');
    const patterns = [
      /"clientId"\s*:\s*"([a-f0-9]{32})"/,
      /clientId['"]\s*:\s*['"]([a-f0-9]{32})['"]/,
      /client_id=([a-f0-9]{32})/,
    ];
    for (const pat of patterns) {
      const m = pageRes.body.match(pat);
      if (m) { anonymousClientId = m[1]; break; }
    }
  }

  if (!anonymousClientId) {
    // Fallback: use the legacy get_access_token endpoint
    const res = await httpsGet('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
      Referer: 'https://open.spotify.com/',
      Origin: 'https://open.spotify.com',
    });
    if (res.status >= 200 && res.status < 300) {
      const data = JSON.parse(res.body);
      if (data.accessToken) {
        cachedToken = data.accessToken;
        tokenExpiry = data.accessTokenExpirationTimestampMs ?? (now + 3_600_000);
        return cachedToken!;
      }
    }
    throw new Error('Could not extract anonymous Spotify clientId');
  }

  // Step 2: POST to clienttoken endpoint (SpotAPI approach)
  const body = JSON.stringify({
    client_data: {
      client_version: '1.2.52.442',
      client_id: anonymousClientId,
      js_sdk_data: {
        device_brand: 'unknown', device_model: 'unknown',
        os: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
        os_version: 'unknown', device_id: '', device_type: 'computer',
      },
    },
  });

  const res = await httpsPost('https://clienttoken.spotify.com/v1/clienttoken', body, {
    Accept: 'application/json',
    Origin: 'https://open.spotify.com',
    Referer: 'https://open.spotify.com/',
  });

  const data = JSON.parse(res.body);
  const token = data?.granted_token?.token as string | undefined;
  if (!token) throw new Error('clienttoken endpoint returned no token');

  cachedToken = token;
  tokenExpiry = now + (data.granted_token.expires_after_seconds ?? 1800) * 1000;
  return cachedToken!;
}

/** Primary token getter — tries credential → puppeteer → clienttoken */
export async function getSpotifyToken(forceRefresh = false): Promise<string> {
  if (forceRefresh) { cachedToken = null; tokenExpiry = 0; }

  // Try user credentials first
  try {
    const settings = await getUserSettings();
    const { spotifyClientId, spotifyClientSecret } = settings as any;
    if (spotifyClientId && spotifyClientSecret) {
      return await getTokenWithCredentials(spotifyClientId, spotifyClientSecret);
    }
  } catch { /* DB not ready or no settings */ }

  // Try puppeteer stealth
  try {
    return await getTokenViaPuppeteer();
  } catch (e) {
    logger.debug('Puppeteer Spotify token failed, falling back to clienttoken', { err: String(e) });
  }

  // Fall back to SpotAPI clienttoken approach
  return getTokenViaClientTokenEndpoint();
}

// ─── Spotify API helpers ──────────────────────────────────────────────────────

const API_BASE = 'https://api.spotify.com/v1';

async function spotifyGet(endpoint: string, retryOn401 = true): Promise<any> {
  const token = await getSpotifyToken();
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;

  const res = await rateLimitedRequest(() =>
    httpsGet(url, { Authorization: `Bearer ${token}`, Accept: 'application/json' })
  );

  if (res.status === 401 && retryOn401) {
    // Token expired — refresh and retry once
    cachedToken = null;
    return spotifyGet(endpoint, false);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Spotify API ${res.status}: ${endpoint}`);
  }
  return JSON.parse(res.body);
}

// ─── Artist helpers ───────────────────────────────────────────────────────────

async function fetchArtistMeta(artistId: string): Promise<SpotifyArtistMeta> {
  const a = await spotifyGet(`/artists/${artistId}`);
  return {
    id: a.id,
    name: a.name,
    genres: a.genres ?? [],
    imageUrl: a.images?.[0]?.url,
    popularity: a.popularity,
    followers: a.followers?.total,
    externalUrl: a.external_urls?.spotify,
  };
}

// ─── Album helpers ────────────────────────────────────────────────────────────

async function fetchAlbumMeta(albumId: string): Promise<SpotifyAlbumMeta> {
  const a = await spotifyGet(`/albums/${albumId}`);
  const artists = await Promise.all(
    (a.artists ?? []).map((ar: any) => fetchArtistMeta(ar.id).catch(() => ({
      id: ar.id, name: ar.name, genres: [],
    })))
  );
  const genres: string[] = [
    ...(a.genres ?? []),
    ...artists.flatMap((ar) => ar.genres),
  ].filter((g, i, arr) => arr.indexOf(g) === i);

  return {
    id: a.id,
    name: a.name,
    releaseDate: a.release_date ?? '',
    releaseYear: (a.release_date ?? '').slice(0, 4),
    totalTracks: a.total_tracks ?? 0,
    coverUrlLarge: a.images?.[0]?.url ?? '',
    coverUrlMedium: a.images?.[1]?.url,
    coverUrlSmall: a.images?.[2]?.url,
    label: a.label,
    genres,
    artists,
    upc: a.external_ids?.upc,
    externalUrl: a.external_urls?.spotify,
  };
}

// ─── Public scrapers ──────────────────────────────────────────────────────────

/** Get complete track + album + artist payload */
export async function getCompleteTrackPayload(trackId: string): Promise<SpotifyTrackMeta> {
  const track = await spotifyGet(`/tracks/${trackId}`);
  const [album, ...artistMetas] = await Promise.all([
    fetchAlbumMeta(track.album?.id),
    ...((track.artists ?? []) as any[]).map((a: any) =>
      fetchArtistMeta(a.id).catch(() => ({ id: a.id, name: a.name, genres: [] as string[] }))
    ),
  ]);

  const genres = [
    ...album.genres,
    ...artistMetas.flatMap(a => a.genres),
  ].filter((g, i, arr) => arr.indexOf(g) === i);

  return {
    id: track.id,
    name: track.name,
    durationMs: track.duration_ms,
    trackNumber: track.track_number,
    discNumber: track.disc_number,
    isrc: track.external_ids?.isrc,
    explicit: track.explicit ?? false,
    popularity: track.popularity,
    externalUrl: track.external_urls?.spotify,
    previewUrl: track.preview_url,
    artists: artistMetas as SpotifyArtistMeta[],
    album,
    genres,
  };
}

export async function fetchSpotifyTrack(trackId: string): Promise<SpotifyTrackMeta> {
  return getCompleteTrackPayload(trackId);
}

export async function fetchSpotifyAlbumTracks(albumId: string): Promise<SpotifyTrackMeta[]> {
  return scrapeAlbum(albumId);
}

export async function fetchSpotifyPlaylistTracks(playlistId: string): Promise<SpotifyTrackMeta[]> {
  return (await scrapePlaylist(playlistId)).tracks;
}

export async function fetchSpotifyArtistTracks(artistId: string): Promise<SpotifyTrackMeta[]> {
  return (await scrapeArtistDiscography(artistId)).tracks;
}

/** Scrape all tracks from a playlist (handles >100 via pagination) */
export async function scrapePlaylist(playlistId: string): Promise<SpotifyPlaylistMeta> {
  console.debug('[SpotifyScraper] scrapePlaylist start', playlistId);
  if (mainWindow) {
    mainWindow.webContents.send('spotify/debug', {
      timestamp: Date.now(),
      level: 'info',
      message: `Fetching playlist metadata`,
      details: { playlistId }
    });
  }
  
  const playlist = await spotifyGet(`/playlists/${playlistId}?fields=id,name,description,images,tracks(total)`);
  const tracks: SpotifyTrackMeta[] = [];
  let url: string | null = `${API_BASE}/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(id,name,duration_ms,track_number,disc_number,external_ids,explicit,artists,album))`;
  let pageNum = 0;

  while (url) {
    pageNum++;
    const page: any = await spotifyGet(url);
    const pageItemCount = page.items?.length ?? 0;
    const totalFetched = tracks.length + pageItemCount;
    
    console.debug('[SpotifyScraper] playlist page', {
      playlistId,
      page: pageNum,
      items: pageItemCount,
      totalFetched,
      next: page.next,
    });
    
    if (mainWindow) {
      mainWindow.webContents.send('spotify/debug', {
        timestamp: Date.now(),
        level: 'info',
        message: `Playlist page ${pageNum} — fetched ${pageItemCount} items (${totalFetched}/${playlist.tracks?.total ?? '?'} total)`,
        details: { pageNum, pageItemCount, totalFetched, playlistTotal: playlist.tracks?.total }
      });
    }
    
    for (const item of page.items ?? []) {
      const t = item?.track;
      if (!t || !t.id) continue;
      try {
        // Full payload for each track (album art + artist genres)
        const full = await getCompleteTrackPayload(t.id);
        tracks.push(full);
      } catch (e) {
        logger.debug(`Skipping playlist track ${t.id}: ${e}`);
      }
    }
    url = page.next ?? null;
  }

  if (mainWindow) {
    mainWindow.webContents.send('spotify/debug', {
      timestamp: Date.now(),
      level: 'info',
      message: `Playlist complete — ${tracks.length} tracks`,
      details: { playlistId, trackCount: tracks.length }
    });
  }

  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    coverUrl: playlist.images?.[0]?.url,
    tracks,
    totalTracks: playlist.tracks?.total ?? tracks.length,
  };
}

/** Scrape all albums/singles for an artist (full discography, paginated) */
export async function scrapeArtistDiscography(artistId: string): Promise<{ albumIds: string[]; tracks: SpotifyTrackMeta[] }> {
  if (mainWindow) {
    mainWindow.webContents.send('spotify/debug', {
      timestamp: Date.now(),
      level: 'info',
      message: `Fetching artist discography`,
      details: { artistId }
    });
  }

  const albumIds: string[] = [];
  let url: string | null = `${API_BASE}/artists/${artistId}/albums?include_groups=album,single&limit=50`;
  let albumPageNum = 0;

  while (url) {
    albumPageNum++;
    const page: any = await spotifyGet(url);
    const pageCount = page.items?.length ?? 0;
    for (const a of page.items ?? []) albumIds.push(a.id as string);
    
    if (mainWindow) {
      mainWindow.webContents.send('spotify/debug', {
        timestamp: Date.now(),
        level: 'info',
        message: `Artist discography page ${albumPageNum} — fetched ${pageCount} albums (${albumIds.length} total)`,
        details: { artistId, pageNum: albumPageNum, pageCount, totalAlbums: albumIds.length }
      });
    }
    
    url = page.next ?? null;
  }

  const tracks: SpotifyTrackMeta[] = [];
  for (let i = 0; i < albumIds.length; i++) {
    const albumId = albumIds[i];
    try {
      const albumTracks = await scrapeAlbum(albumId);
      tracks.push(...albumTracks);
      
      if ((i + 1) % 10 === 0 && mainWindow) {
        mainWindow.webContents.send('spotify/debug', {
          timestamp: Date.now(),
          level: 'info',
          message: `Processed ${i + 1}/${albumIds.length} albums — ${tracks.length} tracks total`,
          details: { processed: i + 1, total: albumIds.length, trackCount: tracks.length }
        });
      }
    } catch (e) {
      logger.debug(`Skipping album ${albumId}: ${e}`);
    }
  }

  // Deduplicate by ISRC → title+artist
  const seen = new Set<string>();
  const uniqueTracks = tracks.filter(t => {
    const key = t.isrc ?? `${t.name.toLowerCase()}|${t.artists[0]?.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (mainWindow) {
    mainWindow.webContents.send('spotify/debug', {
      timestamp: Date.now(),
      level: 'info',
      message: `Artist discography complete — ${uniqueTracks.length} unique tracks (${albumIds.length} albums)`,
      details: { artistId, trackCount: uniqueTracks.length, albumCount: albumIds.length }
    });
  }

  return {
    albumIds,
    tracks: uniqueTracks,
  };
}

/** Scrape all tracks from an album */
export async function scrapeAlbum(albumId: string): Promise<SpotifyTrackMeta[]> {
  const album = await fetchAlbumMeta(albumId);
  const tracks: SpotifyTrackMeta[] = [];
  let url: string | null = `${API_BASE}/albums/${albumId}/tracks?limit=50`;

  while (url) {
    const page: any = await spotifyGet(url);
    for (const t of page.items ?? []) {
      const artistMetas = await Promise.all(
        (t.artists ?? []).map((a: any) =>
          fetchArtistMeta(a.id).catch(() => ({ id: a.id, name: a.name, genres: [] as string[] }))
        )
      );
      const genres = [
        ...album.genres,
        ...artistMetas.flatMap(a => a.genres),
      ].filter((g, i, arr) => arr.indexOf(g) === i);

      tracks.push({
        id: t.id,
        name: t.name,
        durationMs: t.duration_ms,
        trackNumber: t.track_number,
        discNumber: t.disc_number,
        isrc: t.external_ids?.isrc,
        explicit: t.explicit ?? false,
        artists: artistMetas as SpotifyArtistMeta[],
        album,
        genres,
      });
    }
    url = page.next ?? null;
  }

  return tracks;
}

/** Parse a Spotify URL into type + id */
export function parseSpotifyUrl(url: string): { type: 'track' | 'album' | 'playlist' | 'artist'; id: string } | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('spotify.com')) return null;
    const [type, id] = u.pathname.split('/').filter(Boolean);
    if (['track','album','playlist','artist'].includes(type)) return { type: type as any, id };
    return null;
  } catch { return null; }
}

export function isSpotifyUrl(url: string): boolean {
  return parseSpotifyUrl(url) !== null;
}

/** Resolve any Spotify URL to a list of SpotifyTrackMeta */
export async function resolveSpotifyUrl(url: string): Promise<SpotifyTrackMeta[]> {
  const parsed = parseSpotifyUrl(url);
  if (!parsed) throw new Error('Not a valid Spotify URL');
  switch (parsed.type) {
    case 'track':    return [await getCompleteTrackPayload(parsed.id)];
    case 'album':    return scrapeAlbum(parsed.id);
    case 'playlist': return (await scrapePlaylist(parsed.id)).tracks;
    case 'artist':   return (await scrapeArtistDiscography(parsed.id)).tracks;
    default: throw new Error(`Unknown Spotify URL type`);
  }
}

// ─── Media pipeline integration ───────────────────────────────────────────────
// Called immediately after a yt-dlp download finishes with the output file path.

/**
 * Embed rich Spotify metadata into a downloaded audio file using node-taglib-sharp,
 * then re-register the file in Nora's library so all the new tags are picked up.
 *
 * The caller (downloader.ts / register-song IPC) should call this AFTER the file
 * is confirmed written to disk.
 */
export async function embedSpotifyMetadataIntoFile(
  audioFilePath: string,
  meta: SpotifyTrackMeta,
  onProgress?: (msg: string) => void
): Promise<void> {
  // Lazy-import node-taglib-sharp (only installed on Electron, not mobile builds)
  const TagLib = await import('node-taglib-sharp').catch(() => null);
  if (!TagLib) {
    logger.debug('node-taglib-sharp not available — skipping tag embedding');
    return;
  }

  try {
    onProgress?.('Embedding metadata…');
    const { File } = TagLib;
    const file = File.createFromPath(audioFilePath);
    const tag = file.tag;

    tag.title       = meta.name;
    tag.performers  = meta.artists.map(a => a.name);
    tag.albumArtists = [meta.album.artists[0]?.name ?? meta.artists[0]?.name ?? ''];
    tag.album        = meta.album.name;
    tag.year         = parseInt(meta.album.releaseYear) || 0;
    tag.track        = meta.trackNumber;
    tag.disc         = meta.discNumber;
    tag.genres       = meta.genres.length ? meta.genres : (meta.album.genres.length ? meta.album.genres : []);
    tag.comment      = meta.isrc ? `ISRC:${meta.isrc}` : '';

    // Embed album artwork from Spotify
    if (meta.album.coverUrlLarge) {
      try {
        const imgRes = await httpsGet(meta.album.coverUrlLarge);
        if (imgRes.status === 200) {
          const { IPicture, PictureType, MimeType } = TagLib;
          const picture = IPicture.fromData(Buffer.from(imgRes.body, 'binary'));
          picture.type = PictureType.FrontCover;
          picture.mimeType = MimeType.Jpeg;
          tag.pictures = [picture];
        }
      } catch (e) {
        logger.debug('Could not embed album artwork', { err: String(e) });
      }
    }

    file.save();
    file.dispose();
    onProgress?.('Metadata embedded successfully');
    logger.debug(`Metadata embedded into ${audioFilePath}`);
  } catch (e) {
    logger.debug('Tag embedding failed', { err: String(e), path: audioFilePath });
  }
}
