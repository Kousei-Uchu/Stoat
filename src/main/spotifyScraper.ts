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
import { BrowserWindow } from 'electron';
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

function sendSpotifyProgress(level: 'info' | 'warn' | 'error' | 'debug', step: string, message: string, details?: any) {
  logger.debug(`[spotify/progress] ${step} - ${message}`, details ?? {});
  if (mainWindow) {
    try {
      mainWindow.webContents.send('spotify/progress', { level, step, message, details, timestamp: Date.now() });
    } catch {
      // ignore IPC failures
    }
  }
}

async function mapWithConcurrency<T, R>(items: T[], _limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let idx = 0; idx < items.length; idx++) {
    try {
      const r = await fn(items[idx], idx);
      results[idx] = r;
    } catch (e) {
      // preserve slot as undefined if fn fails
      results[idx] = undefined as unknown as R;
    }
  }
  return results;
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
        httpsGet(res.headers.location as string, headers).then(resolve).catch(reject);
        return;
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
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

function httpsGetBinary(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        ...headers,
      },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGetBinary(res.headers.location as string, headers).then(resolve).catch(reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSpotifyImageUrl(url?: string): string | undefined {
  if (!url) return undefined;
  return url.replace(/ab67616d[a-f0-9]{8}/i, 'ab67616db273');
}

interface SpotifyWebPlaylistRow {
  trackId: string;
  title: string;
  albumId?: string;
  albumName?: string;
  coverUrl?: string;
  artists: Array<{ id?: string; name: string }>;
}

// Exponential backoff for 429 rate-limit responses
async function rateLimitedRequest(
  fn: () => Promise<{ status: number; body: string }>,
  maxRetries = 3
): Promise<{ status: number; body: string }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fn();
    if (res.status === 429) {
      // Parse Retry-After header; otherwise exponential backoff
      const baseDelay = Math.min(1000 * Math.pow(2, attempt), 60_000);
      const jitterMs = Math.random() * 500; // smaller jitter
      const delay = baseDelay + jitterMs;

      // Log only on first and final attempts to reduce spam
      if (attempt === 0 || attempt === maxRetries) {
        logger.warn(
          `Spotify rate limited (429) — backing off ${Math.round(delay)}ms (attempt ${attempt + 1}/${maxRetries + 1})`,
          { status: 429, attempt, maxRetries, delayMs: Math.round(delay) }
        );
        if (mainWindow) {
          mainWindow.webContents.send('spotify/debug', {
            timestamp: Date.now(),
            level: 'warn',
            message: `Rate limit hit — waiting ${Math.round(delay / 1000)}s before retry`,
            details: { attempt: attempt + 1, maxRetries: maxRetries + 1, delayMs: Math.round(delay) }
          });
        }
      }

      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return res;
  }

  const errorMsg = `Spotify rate limit exceeded after max retries (${maxRetries} attempts)`;
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

  const _stealthModule: any = await import('puppeteer-extra-plugin-stealth').catch(() => null);
  if (_stealthModule) {
    const stealth = typeof _stealthModule === 'function'
      ? _stealthModule()
      : typeof _stealthModule.default === 'function'
      ? _stealthModule.default()
      : undefined;
    if (stealth) puppeteerExtra.default.use(stealth);
  }

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

async function createSpotifyBrowserPage() {
  const puppeteerExtraModule = await import('puppeteer-extra').catch(() => null);
  if (!puppeteerExtraModule) {
    throw new Error('puppeteer-extra not available');
  }
  const puppeteerExtra = puppeteerExtraModule.default ?? puppeteerExtraModule;
  const stealthPluginModule = await import('puppeteer-extra-plugin-stealth').catch(() => null);
  const stealthPlugin = stealthPluginModule?.default ?? stealthPluginModule;
  if (stealthPlugin) {
    const stealth = typeof stealthPlugin === 'function'
      ? stealthPlugin()
      : typeof (stealthPlugin as any).default === 'function'
      ? (stealthPlugin as any).default()
      : undefined;
    if (stealth) puppeteerExtra.use(stealth);
  }

  const browser = await puppeteerExtra.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  return { browser, page };
}

async function acceptSpotifyCookies(page: any) {
  try {
    const cookieBtn = await page.$('#onetrust-accept-btn-handler');
    if (cookieBtn) await cookieBtn.click();
  } catch {
    // ignore cookie modal if not present
  }
}

async function extractSpotifyPlaylistRowsFromPage(page: any) {
  const trackMap = new Map<string, SpotifyWebPlaylistRow>();
  const albumIds = new Set<string>();
  const artistIds = new Set<string>();

  await page.waitForSelector('[data-testid="tracklist-row"]', { timeout: 15000 });

  let staleStrikes = 0;
  let previousCount = 0;

  for (let scrollLoop = 0; scrollLoop < 65; scrollLoop++) {
    const extracted = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="tracklist-row"]'));
      const batch: SpotifyWebPlaylistRow[] = [];

      for (const row of rows) {
        const section = row.closest('section');
        const heading = section?.querySelector('h2');
        if (heading?.innerText.toLowerCase().includes('recommend')) continue;

        const titleEl = row.querySelector<HTMLAnchorElement>('div[role="gridcell"] a[href*="/track/"]');
        const albumEl = row.querySelector<HTMLAnchorElement>('a[href*="/album/"]');
        const artistEls = Array.from(row.querySelectorAll<HTMLAnchorElement>('a[href*="/artist/"]'));
        const imgEl = row.querySelector<HTMLImageElement>('img');

        if (!titleEl) continue;

        const trackId = titleEl.getAttribute('href')?.split('/track/')?.[1]?.split('?')?.[0];
        if (!trackId) continue;

        const coverUrlRaw = imgEl?.getAttribute('src') ?? null;
        const coverUrl = coverUrlRaw ? coverUrlRaw.replace(/ab67616d[a-f0-9]{8}/i, 'ab67616db273') : undefined;

        batch.push({
          trackId,
          title: titleEl.innerText.trim(),
          albumId: albumEl?.getAttribute('href')?.split('/album/')?.[1]?.split('?')?.[0],
          albumName: albumEl?.innerText.trim(),
          coverUrl,
          artists: artistEls.map((el) => ({
            id: el.getAttribute('href')?.split('/artist/')?.[1]?.split('?')?.[0],
            name: el.innerText.trim(),
          })),
        });
      }

      return batch;
    });

    for (const row of extracted) {
      if (!trackMap.has(row.trackId)) {
        trackMap.set(row.trackId, row);
      }
      if (row.albumId) albumIds.add(row.albumId);
      for (const artist of row.artists) {
        if (artist.id) artistIds.add(artist.id);
      }
    }

    const currentCount = trackMap.size;
    if (currentCount === previousCount) {
      staleStrikes += 1;
      if (staleStrikes >= 5 && currentCount > 0) break;
    } else {
      staleStrikes = 0;
    }

    previousCount = currentCount;

    await page.evaluate(() => {
      const scrollable = document.querySelector('#main-view, .main-view-container__scroll-node-child');
      if (scrollable) {
        (scrollable as HTMLElement).scrollBy(0, 900);
      } else {
        window.scrollBy(0, 600);
      }
    });
    await wait(1200);
  }

  return {
    rows: Array.from(trackMap.values()),
    albumIds: Array.from(albumIds),
    artistIds: Array.from(artistIds),
    coverUrl: trackMap.values().next().value?.coverUrl,
  };
}

async function scrapePlaylistFromWebPage(playlistId: string): Promise<SpotifyPlaylistMeta> {
  const { browser, page } = await createSpotifyBrowserPage();
  try {
    const url = `https://open.spotify.com/playlist/${playlistId}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await acceptSpotifyCookies(page);
    await wait(3000);

    const playlistPageData = await extractSpotifyPlaylistRowsFromPage(page);
    const playlistMeta = await spotifyGet(
      `/playlists/${playlistId}?fields=id,name,description,images,tracks(total)`
    ).catch(() => null);

    // Deep-harvest albums and artists sequentially.
    sendSpotifyProgress('info', 'playlist:harvest_start', 'Starting album + artist deep harvest', { albumCount: playlistPageData.albumIds.length, artistCount: playlistPageData.artistIds.length });

    let concurrencyLimit = 6;
    try {
      const settings = await getUserSettings();
      const v = (settings as any)?.spotifyScraperConcurrency;
      if (typeof v === 'number' && v > 0 && v <= 50) concurrencyLimit = v;
    } catch {
      // ignore and use default
    }

    const albumPairs = await mapWithConcurrency(playlistPageData.albumIds, concurrencyLimit, async (albumId) => {
      try {
        const det = await scrapeSpotifyAlbumDetailsFromPage(browser, albumId);
        sendSpotifyProgress('debug', 'album:harvest', `Scraped album ${albumId}`, { albumId });
        return { albumId, details: det };
      } catch (err) {
        sendSpotifyProgress('warn', 'album:harvest', `Album deep harvest failed`, { albumId, err: String(err) });
        return { albumId, details: null };
      }
    });

    const albumDetails = new Map<string, Partial<SpotifyAlbumMeta>>();
    for (const p of albumPairs) if (p && p.details) albumDetails.set(p.albumId, p.details);

    const artistPairs = await mapWithConcurrency(playlistPageData.artistIds, concurrencyLimit, async (artistId) => {
      try {
        const det = await scrapeSpotifyArtistDetailsFromPage(browser, artistId);
        sendSpotifyProgress('debug', 'artist:harvest', `Scraped artist ${artistId}`, { artistId });
        return { artistId, details: det };
      } catch (err) {
        sendSpotifyProgress('warn', 'artist:harvest', `Artist deep harvest failed`, { artistId, err: String(err) });
        return { artistId, details: null };
      }
    });

    const artistDetails = new Map<string, Partial<SpotifyArtistMeta>>();
    for (const p of artistPairs) if (p && p.details) artistDetails.set(p.artistId, p.details);

    // Process tracks sequentially while metadata enrichment completes.
    sendSpotifyProgress('info', 'playlist:tracks_start', 'Starting metadata enrichment for playlist tracks', { trackCount: playlistPageData.rows.length });

    const trackResults = await mapWithConcurrency(playlistPageData.rows, 1, async (row) => {
      const trackId = row.trackId;
      try {
        const track = await getCompleteTrackPayload(trackId);

        // Preserve page-provided name/album/cover if available
        if (row.title) track.name = row.title;
        if (row.albumName) track.album.name = row.albumName;
        if (row.coverUrl) track.album.coverUrlLarge = normalizeSpotifyImageUrl(row.coverUrl) ?? row.coverUrl;

        // Merge page-level artist info with deep-harvested artist details or track-provided artists
        const pageArtistMetas = row.artists.map((artistRow) => {
          const pageArtist = artistDetails.get(artistRow.id ?? '');
          if (pageArtist?.id) {
            return {
              id: pageArtist.id,
              name: artistRow.name || pageArtist.name || '',
              genres: pageArtist.genres ?? [],
              imageUrl: pageArtist.imageUrl,
              popularity: pageArtist.popularity,
              followers: pageArtist.followers,
              externalUrl: pageArtist.externalUrl,
            } as SpotifyArtistMeta;
          }

          return (
            track.artists.find((a) => a.id === artistRow.id) ?? {
              id: artistRow.id ?? '',
              name: artistRow.name,
              genres: [],
            }
          ) as SpotifyArtistMeta;
        });

        if (pageArtistMetas.length > 0) {
          track.artists = pageArtistMetas;
          if (!track.album.artists?.length) track.album.artists = pageArtistMetas;
        }

        const mergedGenres = [
          ...new Set([
            ...(track.album.genres ?? []),
            ...track.artists.flatMap((artist) => artist.genres ?? []),
          ]),
        ];
        track.genres = mergedGenres;

        sendSpotifyProgress('info', 'track:enriched', `Enriched metadata for ${trackId}`, { trackId });
        return track;
      } catch (error) {
        sendSpotifyProgress('warn', 'track:enrich_failed', `Failed to enrich ${trackId}`, { trackId, err: String(error) });
        logger.debug('Spotify web fallback failed to fetch track payload', { trackId, err: String(error) });
        return null;
      }
    });

    const tracks: SpotifyTrackMeta[] = (trackResults.filter(Boolean) as SpotifyTrackMeta[]);

    sendSpotifyProgress('info', 'playlist:complete', 'Playlist harvest complete', { playlistId, trackCount: tracks.length });

    return {
      id: playlistMeta?.id ?? playlistId,
      name: playlistMeta?.name ?? `Spotify Playlist ${playlistId}`,
      description: playlistMeta?.description ?? undefined,
      coverUrl: playlistMeta?.images?.[0]?.url ?? playlistPageData.coverUrl ?? undefined,
      tracks,
      totalTracks: playlistMeta?.tracks?.total ?? tracks.length,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function scrapeSpotifyAlbumDetailsFromPage(browser: any, albumId: string): Promise<Partial<SpotifyAlbumMeta>> {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    await page.goto(`https://open.spotify.com/album/${albumId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await acceptSpotifyCookies(page);
    await wait(3000);
    await page.waitForSelector('h1.encore-text-headline-large, [data-testid="tracklist-row"]', { timeout: 15000 });

    const details = await page.evaluate(() => {
      const title = (document.querySelector('h1.encore-text-headline-large') as HTMLElement | null)?.innerText?.trim() || '';
      const releaseDate = (document.querySelector('span[data-testid="release-date"]') as HTMLElement | null)?.innerText?.trim() || '';
      const totalTracks = document.querySelectorAll('[data-testid="tracklist-row"]').length;
      const rawImg =
        (document.querySelector('img[data-testid="cover-art-image"], main img[class*="G3NmZakc"], main img') as HTMLImageElement | null)?.getAttribute('src') || '';
      const artists = Array.from(document.querySelectorAll('a[href*="/artist/"]')).map((el) => ({
        id: el.getAttribute('href')?.split('/artist/')?.[1]?.split('?')?.[0],
        name: (el as HTMLElement).innerText.trim(),
      }));
      return { title, releaseDate, totalTracks, imageUrl: rawImg, artists };
    });

    return {
      id: albumId,
      name: details.title,
      releaseDate: details.releaseDate,
      releaseYear: (details.releaseDate || '').slice(0, 4),
      totalTracks: details.totalTracks,
      coverUrlLarge: normalizeSpotifyImageUrl(details.imageUrl) ?? details.imageUrl,
      coverUrlMedium: normalizeSpotifyImageUrl(details.imageUrl) ?? details.imageUrl,
      coverUrlSmall: normalizeSpotifyImageUrl(details.imageUrl) ?? details.imageUrl,
      artists: details.artists
        .filter((artist: any) => artist.id)
        .map((artist: any) => ({ id: artist.id!, name: artist.name, genres: [] } as SpotifyArtistMeta)),
      genres: [],
      externalUrl: `https://open.spotify.com/album/${albumId}`,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeSpotifyTrackFromPage(browser: any, trackId: string): Promise<Partial<SpotifyTrackMeta>> {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1200, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.goto(`https://open.spotify.com/track/${trackId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await acceptSpotifyCookies(page);
    await wait(2000);

    const details = await page.evaluate(() => {
      const title = (document.querySelector('h1') as HTMLElement | null)?.innerText?.trim() || '';
      const albumAnchor = document.querySelector('a[href*="/album/"]') as HTMLAnchorElement | null;
      const albumId = albumAnchor?.getAttribute('href')?.split('/album/')?.[1]?.split('?')?.[0] || undefined;
      const albumName = albumAnchor?.innerText?.trim() || undefined;
      const rawImg = (document.querySelector('img') as HTMLImageElement | null)?.getAttribute('src') || '';
      const artistEls = Array.from(document.querySelectorAll('a[href*="/artist/"]')) as HTMLAnchorElement[];
      const artists = artistEls.map((el) => ({ id: el.getAttribute('href')?.split('/artist/')?.[1]?.split('?')?.[0], name: el.innerText.trim() }));
      return { title, albumId, albumName, imageUrl: rawImg, artists };
    });

    return {
      id: trackId,
      name: details.title,
      durationMs: 0,
      trackNumber: 0,
      discNumber: 0,
      explicit: false,
      artists: (details.artists ?? []).map((a: any) => ({ id: a.id ?? '', name: a.name, genres: [] } as SpotifyArtistMeta)),
      album: {
        id: details.albumId ?? '',
        name: details.albumName ?? '',
        releaseDate: '',
        releaseYear: '',
        totalTracks: 0,
        coverUrlLarge: normalizeSpotifyImageUrl(details.imageUrl) ?? details.imageUrl,
        genres: [],
        artists: [],
      } as SpotifyAlbumMeta,
      genres: [],
    } as Partial<SpotifyTrackMeta>;
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeSpotifyArtistDetailsFromPage(browser: any, artistId: string): Promise<Partial<SpotifyArtistMeta>> {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    await page.goto(`https://open.spotify.com/artist/${artistId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await acceptSpotifyCookies(page);
    await wait(3000);
    await page.waitForSelector('h1.encore-text-headline-large, .encore-text-headline-large', { timeout: 15000 });

    const details = await page.evaluate(() => {
      const name =
        (document.querySelector('h1.encore-text-headline-large') as HTMLElement | null)?.innerText?.trim() ||
        (document.querySelector('.encore-text-headline-large') as HTMLElement | null)?.innerText?.trim() ||
        '';
      const rawImg =
        (document.querySelector('main img[class*="iAxxIuF4sEfJ8MBA"], main figure img, [class*="artist-header"] img, main img') as HTMLImageElement | null)?.getAttribute('src') ||
        '';
      return { name, imageUrl: rawImg };
    });

    return {
      id: artistId,
      name: details.name,
      genres: [],
      imageUrl: normalizeSpotifyImageUrl(details.imageUrl) ?? details.imageUrl,
      externalUrl: `https://open.spotify.com/artist/${artistId}`,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

// ─── Artist helpers ───────────────────────────────────────────────────────────

async function fetchArtistMeta(artistId: string): Promise<SpotifyArtistMeta> {
  try {
    const a = await spotifyGet(`/artists/${artistId}`);
    return {
      id: a.id,
      name: a.name,
      genres: a.genres ?? [],
      imageUrl: normalizeSpotifyImageUrl(a.images?.[0]?.url) ?? a.images?.[0]?.url,
      popularity: a.popularity,
      followers: a.followers?.total,
      externalUrl: a.external_urls?.spotify,
    };
  } catch (e) {
    // If API lookup fails (rate limit, token), try page scraping as a fallback
    try {
      const { browser } = await createSpotifyBrowserPage();
      try {
        const details = await scrapeSpotifyArtistDetailsFromPage(browser, artistId);
        return {
          id: details.id ?? artistId,
          name: details.name ?? details.id ?? artistId,
          genres: details.genres ?? [],
          imageUrl: details.imageUrl,
          popularity: details.popularity,
          followers: details.followers,
          externalUrl: details.externalUrl,
        } as SpotifyArtistMeta;
      } finally {
        await browser.close().catch(() => {});
      }
    } catch (err2) {
      throw e;
    }
  }
}

// ─── Album helpers ────────────────────────────────────────────────────────────

async function fetchAlbumMeta(albumId: string): Promise<SpotifyAlbumMeta> {
  try {
    const a = await spotifyGet(`/albums/${albumId}`);
    const artists = await Promise.all(
      (a.artists ?? []).map((ar: any) => fetchArtistMeta(ar.id).catch(() => ({ id: ar.id, name: ar.name, genres: [], })))
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
      coverUrlLarge: normalizeSpotifyImageUrl(a.images?.[0]?.url) ?? a.images?.[0]?.url ?? '',
      coverUrlMedium: normalizeSpotifyImageUrl(a.images?.[1]?.url) ?? a.images?.[1]?.url,
      coverUrlSmall: normalizeSpotifyImageUrl(a.images?.[2]?.url) ?? a.images?.[2]?.url,
      label: a.label,
      genres,
      artists,
      upc: a.external_ids?.upc,
      externalUrl: a.external_urls?.spotify,
    };
  } catch (e) {
    // Fallback to page scraping for album details
    try {
      const { browser } = await createSpotifyBrowserPage();
      try {
        const details = await scrapeSpotifyAlbumDetailsFromPage(browser, albumId);
        const artists = (details.artists ?? []).map((ar: any) => ({ id: ar.id ?? '', name: ar.name ?? '', genres: ar.genres ?? [] } as SpotifyArtistMeta));
        const genres = [...new Set([...(details.genres ?? []), ...artists.flatMap(a => a.genres)])];
        return {
          id: details.id ?? albumId,
          name: details.name ?? '',
          releaseDate: details.releaseDate ?? '',
          releaseYear: details.releaseYear ?? '',
          totalTracks: details.totalTracks ?? 0,
          coverUrlLarge: details.coverUrlLarge ?? '',
          coverUrlMedium: details.coverUrlMedium,
          coverUrlSmall: details.coverUrlSmall,
          label: details.label,
          genres,
          artists,
          upc: details.upc,
          externalUrl: details.externalUrl,
        } as SpotifyAlbumMeta;
      } finally {
        await browser.close().catch(() => {});
      }
    } catch (e2) {
      throw e;
    }
  }
}

// ─── Public scrapers ──────────────────────────────────────────────────────────

/** Get complete track + album + artist payload */
export async function getCompleteTrackPayload(trackId: string): Promise<SpotifyTrackMeta> {
  let track: any = null;
  let scrapedFallback: Partial<SpotifyTrackMeta> | null = null;

  try {
    track = await spotifyGet(`/tracks/${trackId}`);
  } catch (e) {
    // API failed (rate limit or token issue) — try page scraping as fallback
    try {
      const { browser } = await createSpotifyBrowserPage();
      try {
        const scraped = await scrapeSpotifyTrackFromPage(browser, trackId);
        scrapedFallback = scraped;
        track = {
          id: scraped.id,
          name: scraped.name,
          duration_ms: scraped.durationMs ?? 0,
          track_number: scraped.trackNumber ?? 0,
          disc_number: scraped.discNumber ?? 0,
          external_ids: { isrc: scraped.isrc },
          explicit: scraped.explicit ?? false,
          popularity: scraped.popularity,
          external_urls: { spotify: `https://open.spotify.com/track/${trackId}` },
          preview_url: scraped.previewUrl,
          artists: (scraped.artists ?? []).map((a: any) => ({ id: a.id, name: a.name })),
          album: {
            id: scraped.album?.id ?? '',
            name: scraped.album?.name ?? '',
            release_date: scraped.album?.releaseDate ?? '',
          },
        };
      } finally {
        await browser.close().catch(() => {});
      }
    } catch (e2) {
      throw e;
    }
  }

  const albumId = track.album?.id;
  const artistIds = (track.artists ?? []).map((a: any) => a.id).filter(Boolean);
  const fallbackArtists = (scrapedFallback?.artists ?? []).map((a: any) => ({ id: a.id ?? '', name: a.name, genres: [] as string[] } as SpotifyArtistMeta));

  let album: SpotifyAlbumMeta;
  if (albumId) {
    try {
      album = await fetchAlbumMeta(albumId);
    } catch (albumError) {
      if (mainWindow) {
        sendSpotifyProgress('warn', 'album:fetch_failed', `Album fetch failed for ${albumId}, falling back to page scraper`, {
          albumId,
          err: String(albumError),
        });
      }
      if (albumId) {
        try {
          const { browser } = await createSpotifyBrowserPage();
          try {
            const scrapedAlbum = await scrapeSpotifyAlbumDetailsFromPage(browser, albumId);
            album = {
              ...scrapedAlbum,
              id: albumId,
              genres: scrapedAlbum.genres ?? [],
            } as SpotifyAlbumMeta;
          } finally {
            await browser.close().catch(() => {});
          }
        } catch {
          album = {
            id: albumId,
            name: scrapedFallback?.album?.name ?? track.album?.name ?? '',
            releaseDate: scrapedFallback?.album?.releaseDate ?? '',
            releaseYear: scrapedFallback?.album?.releaseYear ?? '',
            totalTracks: scrapedFallback?.album?.totalTracks ?? 0,
            coverUrlLarge: scrapedFallback?.album?.coverUrlLarge ?? '',
            coverUrlMedium: scrapedFallback?.album?.coverUrlMedium,
            coverUrlSmall: scrapedFallback?.album?.coverUrlSmall,
            label: scrapedFallback?.album?.label,
            genres: scrapedFallback?.album?.genres ?? [],
            artists: scrapedFallback?.album?.artists ?? [],
            upc: scrapedFallback?.album?.upc,
            externalUrl: scrapedFallback?.album?.externalUrl,
          } as SpotifyAlbumMeta;
        }
      } else {
        album = {
          id: scrapedFallback?.album?.id ?? '',
          name: scrapedFallback?.album?.name ?? track.album?.name ?? '',
          releaseDate: scrapedFallback?.album?.releaseDate ?? '',
          releaseYear: scrapedFallback?.album?.releaseYear ?? '',
          totalTracks: scrapedFallback?.album?.totalTracks ?? 0,
          coverUrlLarge: scrapedFallback?.album?.coverUrlLarge ?? '',
          coverUrlMedium: scrapedFallback?.album?.coverUrlMedium,
          coverUrlSmall: scrapedFallback?.album?.coverUrlSmall,
          label: scrapedFallback?.album?.label,
          genres: scrapedFallback?.album?.genres ?? [],
          artists: scrapedFallback?.album?.artists ?? [],
          upc: scrapedFallback?.album?.upc,
          externalUrl: scrapedFallback?.album?.externalUrl,
        } as SpotifyAlbumMeta;
      }
    }
  } else {
    album = {
      id: scrapedFallback?.album?.id ?? '',
      name: scrapedFallback?.album?.name ?? track.album?.name ?? '',
      releaseDate: scrapedFallback?.album?.releaseDate ?? '',
      releaseYear: scrapedFallback?.album?.releaseYear ?? '',
      totalTracks: scrapedFallback?.album?.totalTracks ?? 0,
      coverUrlLarge: scrapedFallback?.album?.coverUrlLarge ?? '',
      coverUrlMedium: scrapedFallback?.album?.coverUrlMedium,
      coverUrlSmall: scrapedFallback?.album?.coverUrlSmall,
      label: scrapedFallback?.album?.label,
      genres: scrapedFallback?.album?.genres ?? [],
      artists: scrapedFallback?.album?.artists ?? [],
      upc: scrapedFallback?.album?.upc,
      externalUrl: scrapedFallback?.album?.externalUrl,
    } as SpotifyAlbumMeta;
  }

  const artistMetas = artistIds.length
    ? await Promise.all(
        artistIds.map((aid: string) =>
          fetchArtistMeta(aid).catch(() => ({ id: aid, name: '', genres: [] as string[] }))
        )
      )
    : fallbackArtists;

  const genres = [
    ...album.genres,
    ...artistMetas.flatMap((a) => a.genres),
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

  try {
    const playlist = await spotifyGet(`/playlists/${playlistId}?fields=id,name,description,images,tracks(total)`);
    const tracks: SpotifyTrackMeta[] = [];
    let url: string | null = `${API_BASE}/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(id,name,duration_ms,track_number,disc_number,external_ids,explicit,artists,album))`;
    let pageNum = 0;

    while (url) {
      pageNum++;
      let page: any;
      try {
        page = await spotifyGet(url);
      } catch (pageError) {
        logger.warn('Spotify playlist pagination failed, falling back to page scraping', { playlistId, url, err: String(pageError) });
        if (mainWindow) {
          mainWindow.webContents.send('spotify/debug', {
            timestamp: Date.now(),
            level: 'warn',
            message: `Playlist pagination failed, falling back to browser page scraper (page ${pageNum})`,
            details: { playlistId, url, pageNum, error: String(pageError) }
          });
        }
        return scrapePlaylistFromWebPage(playlistId);
      }

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
  } catch (error) {
    logger.warn('Spotify playlist API failed, falling back to page scraping', { playlistId, err: String(error) });
    if (mainWindow) {
      mainWindow.webContents.send('spotify/debug', {
        timestamp: Date.now(),
        level: 'warn',
        message: 'Spotify playlist API failed, using browser page scraper fallback',
        details: { playlistId, error: String(error) }
      });
    }
    return scrapePlaylistFromWebPage(playlistId);
  }
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

    // Embed album artwork from Spotify (use ByteVector + Picture API)
    if (meta.album.coverUrlLarge) {
      try {
        const imgRes = await httpsGetBinary(meta.album.coverUrlLarge);
        if (imgRes.status === 200) {
          const { ByteVector, Picture, PictureType } = TagLib as any;
          const buf = imgRes.body;
          const byteVec = ByteVector.fromByteArray(new Uint8Array(buf));
          const picture = Picture.fromData(byteVec);
          picture.type = PictureType.FrontCover;
          // Set mimeType if available property exists
          if ('mimeType' in picture) (picture as any).mimeType = 'image/jpeg';
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
