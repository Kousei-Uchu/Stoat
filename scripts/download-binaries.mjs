#!/usr/bin/env node
/**
 * download-binaries.mjs
 *
 * Downloads pre-built spotdl and ffmpeg binaries for all target platforms
 * into resources/bin/<platform>/ so electron-builder can include them as
 * extraResources in the final app package.
 *
 * Run once before building:
 *   node scripts/download-binaries.mjs
 *
 * Flags:
 *   --platform <key>   Only download for one platform (see ALL_PLATFORMS below)
 *   --force            Re-download even if the file already exists
 *
 * spotdl releases: https://github.com/spotDL/spotify-downloader/releases
 * ffmpeg builds:   https://github.com/BtbN/FFmpeg-Builds (Windows + Linux)
 *                  https://evermeet.cx/ffmpeg/ (macOS static builds)
 *
 * macOS note: BtbN does not provide macOS builds. The script pulls from
 * evermeet.cx which hosts static ffmpeg binaries for macOS x64/arm64.
 * These are unsigned; macOS Gatekeeper may quarantine them. The app
 * spawns ffmpeg via Node child_process which bypasses Gatekeeper on
 * most system configurations, but for fully notarised builds you should
 * supply your own ffmpeg binary signed with your Developer ID.
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BIN_DIR = path.join(ROOT, 'resources', 'bin');

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const forceDl = args.includes('--force');
const platformArg = (() => {
  const i = args.indexOf('--platform');
  return i !== -1 ? args[i + 1] : null;
})();

// ─── Version / URL config ─────────────────────────────────────────────────────

// Bump SPOTDL_VERSION when a new release drops.
// Asset names follow the pattern spotdl-{ver}-{platform} confirmed from:
// https://github.com/spotDL/spotify-downloader/releases
const SPOTDL_VERSION = '4.5.0';

// spotdl dropped separate arm64 binaries in v4.3+.
// macOS universal binary works for both x64 and arm64.
// Linux arm64 is not officially distributed as a binary; use the x64 one via
// Rosetta / emulation, or install via pip on native arm64 Linux hosts.
const SPOTDL_ASSETS = {
  'win32':        `spotdl-${SPOTDL_VERSION}-win32.exe`, // Back to the specific one you verified manually
  'darwin-x64':   `spotdl-${SPOTDL_VERSION}.spec`,       // Modern target spec file if compiled locally, or point to an archived release
  'darwin-arm64': `spotdl-${SPOTDL_VERSION}.spec`,
  'linux-x64':    `spotdl-${SPOTDL_VERSION}-linux`,
  'linux-arm64':  `spotdl-${SPOTDL_VERSION}-linux`,   
};

const SPOTDL_OUT = {
  'win32': 'spotdl.exe',
  'darwin-x64': 'spotdl', 'darwin-arm64': 'spotdl',
  'linux-x64': 'spotdl', 'linux-arm64': 'spotdl',
};

const SPOTDL_BASE =
  `https://github.com/spotDL/spotify-downloader/releases/download/v${SPOTDL_VERSION}`;

// BtbN rolling "latest" builds — filename is stable, content updates daily.
// These are large archives; we stream-extract only the ffmpeg binary.
// BtbN does NOT build macOS — those use evermeet.cx instead.
const FFMPEG_SOURCES = {
  'win32': {
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
    type: 'zip',
    // Path inside the zip: ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe
    inner: 'ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe',
    out: 'ffmpeg.exe',
  },
  'darwin-x64': {
    // evermeet.cx provides static macOS x64 builds
    url: 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip',
    type: 'zip',
    inner: 'ffmpeg',   // single file at root of zip
    out: 'ffmpeg',
  },
  'darwin-arm64': {
    // evermeet.cx arm64 build
    url: 'https://evermeet.cx/ffmpeg/getrelease/arm64/ffmpeg/zip',
    type: 'zip',
    inner: 'ffmpeg',
    out: 'ffmpeg',
  },
  'linux-x64': {
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz',
    type: 'tar.xz',
    inner: 'ffmpeg-master-latest-linux64-gpl/bin/ffmpeg',
    out: 'ffmpeg',
  },
  'linux-arm64': {
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linuxarm64-gpl.tar.xz',
    type: 'tar.xz',
    inner: 'ffmpeg-master-latest-linuxarm64-gpl/bin/ffmpeg',
    out: 'ffmpeg',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg)  { process.stdout.write(msg + '\n'); }
function warn(msg) { process.stderr.write('[warn] ' + msg + '\n'); }

/** Follow redirects and stream URL to destPath accurately without corruption. */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const follow = (currentUrl, depth = 0) => {
      if (depth > 15) return reject(new Error('Too many redirects'));
      
      https.get(currentUrl, { headers: { 'User-Agent': 'MarmaladeBuilder/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, depth + 1);
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume(); // Drain to avoid socket hang
          return reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
        }

        const tmp = destPath + '.tmp';
        // CRITICAL FIX 1: Explicitly pass 'binary' flags to avoid default encoding conversion shifts
        const file = fs.createWriteStream(tmp, { flags: 'w', encoding: 'binary' });
        
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          process.stdout.write(`\r  ${(received / 1024 / 1024).toFixed(1)} MB received`);
        });

        res.pipe(file);

        // CRITICAL FIX 2: Ensure data is fully flushed to physical storage before renaming the file
        file.on('finish', () => {
          file.end(); // Safely end the write configuration channel
          
          // Small safety timeout ensuring Windows file-system allocation locks drop
          setTimeout(() => {
            try {
              if (fs.existsSync(tmp)) {
                process.stdout.write('\n');
                fs.renameSync(tmp, destPath);
                resolve();
              } else {
                reject(new Error('Temporary file vanished before finalization'));
              }
            } catch (err) {
              reject(err);
            }
          }, 100);
        });

        file.on('error', (e) => { 
          try { fs.unlinkSync(tmp); } catch {} 
          reject(e); 
        });
        
        res.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

/**
 * Download an archive and extract a single file from it.
 * Requires unzip (zip) or tar (tar.xz) on PATH.
 * On Windows, tar is available since Win10 1803 and handles zip too.
 */
async function downloadAndExtract(url, archiveType, innerPath, destPath, label) {
  const tmpArchive = destPath + '.archive.tmp';
  log(`⬇  ${label}`);
  log(`   ${url}`);
  try {
    await downloadFile(url, tmpArchive);
  } catch (err) {
    try { fs.unlinkSync(tmpArchive); } catch {}
    throw err;
  }

  try {
    if (archiveType === 'zip') {
      // tar on Windows 10+ handles zip; unzip on Unix
      if (process.platform === 'win32') {
        // Use PowerShell to extract a specific file from a zip
        const psCmd = `powershell -NoProfile -Command "Add-Type -Assembly System.IO.Compression.FileSystem; $z = [System.IO.Compression.ZipFile]::OpenRead('${tmpArchive}'); $e = $z.Entries | Where-Object { $_.FullName -eq '${innerPath}' -or $_.Name -eq '${path.basename(innerPath)}' } | Select-Object -First 1; if (-not $e) { throw 'Entry not found: ${innerPath}' }; $s = $e.Open(); $f = [System.IO.File]::Create('${destPath}'); $s.CopyTo($f); $f.Close(); $s.Close(); $z.Dispose()"`;
        execSync(psCmd, { stdio: 'pipe' });
      } else {
        // Try unzip first, fall back to python3
        try {
          execSync(`unzip -p "${tmpArchive}" "${innerPath}" > "${destPath}"`, { stdio: 'pipe', shell: true });
          // unzip -p returns 0 even for missing entries, check output size
          const size = fs.statSync(destPath).size;
          if (size === 0) throw new Error('empty output — entry not found');
        } catch {
          // Fall back to single-file zip (evermeet.cx puts ffmpeg at root)
          execSync(`unzip -p "${tmpArchive}" "${path.basename(innerPath)}" > "${destPath}"`, { stdio: 'pipe', shell: true });
        }
      }
    } else {
      // tar.xz — GNU tar (Linux) or bsdtar (macOS)
      // Strip path components so we get just the binary
      const components = innerPath.split('/').length - 1;
      execSync(
        `tar -xJf "${tmpArchive}" --strip-components=${components} -O "${innerPath}" > "${destPath}"`,
        { stdio: 'pipe', shell: true }
      );
      // Verify
      if (fs.statSync(destPath).size === 0) throw new Error('empty output after tar extract');
    }
  } finally {
    try { fs.unlinkSync(tmpArchive); } catch {}
  }
}

/** Try to copy ffmpeg from ffmpeg-static npm package if already installed. */
function tryFfmpegStatic(platform, destPath) {
  try {
    const staticDir = path.join(ROOT, 'node_modules', 'ffmpeg-static');
    if (!fs.existsSync(staticDir)) return false;
    const map = {
      'win32':        path.join(staticDir, 'win32', 'x64', 'ffmpeg.exe'),
      'darwin-x64':   path.join(staticDir, 'darwin', 'x64', 'ffmpeg'),
      'darwin-arm64': path.join(staticDir, 'darwin', 'arm64', 'ffmpeg'),
      'linux-x64':    path.join(staticDir, 'linux', 'x64', 'ffmpeg'),
      'linux-arm64':  path.join(staticDir, 'linux', 'arm64', 'ffmpeg'),
    };
    const src = map[platform];
    if (!src || !fs.existsSync(src)) return false;
    fs.copyFileSync(src, destPath);
    log(`  ✅ ffmpeg copied from ffmpeg-static npm package`);
    return true;
  } catch {
    return false;
  }
}

/** Fetch the latest spotdl GitHub release tag (best-effort). */
async function fetchLatestSpotdlTag() {
  return new Promise((resolve) => {
    const req = https.get(
      'https://api.github.com/repos/spotDL/spotify-downloader/releases/latest',
      { headers: { 'User-Agent': 'MarmaladeBuilder/1.0', 'Accept': 'application/vnd.github+json' } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString());
            resolve(json.tag_name?.replace(/^v/, '') ?? null);
          } catch { resolve(null); }
        });
        res.on('error', () => resolve(null));
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const ALL_PLATFORMS = Object.keys(SPOTDL_ASSETS);
const platforms = platformArg ? [platformArg] : ALL_PLATFORMS;

const invalid = platforms.filter(p => !ALL_PLATFORMS.includes(p));
if (invalid.length) {
  console.error(`Unknown platform(s): ${invalid.join(', ')}`);
  console.error(`Valid: ${ALL_PLATFORMS.join(', ')}`);
  process.exit(1);
}

log(`\n📦 Marmalade binary downloader`);
log(`   spotdl v${SPOTDL_VERSION} + ffmpeg (latest)`);
log(`   Platforms : ${platforms.join(', ')}`);
log(`   Output dir: ${BIN_DIR}\n`);

// Check for a newer spotdl version
log('🔍 Checking latest spotdl release on GitHub…');
const latestTag = await fetchLatestSpotdlTag();
if (latestTag && latestTag !== SPOTDL_VERSION) {
  warn(`Newer spotdl available: v${latestTag}. Update SPOTDL_VERSION in this script and re-run.`);
} else if (latestTag === SPOTDL_VERSION) {
  log(`✔  spotdl v${SPOTDL_VERSION} is the latest release.\n`);
} else {
  log(`⚠  Could not check latest release (rate limit or network). Continuing with v${SPOTDL_VERSION}.\n`);
}

let errors = 0;

for (const platform of platforms) {
  const platDir = path.join(BIN_DIR, platform);
  fs.mkdirSync(platDir, { recursive: true });

  log(`\n── ${platform} ${'─'.repeat(50 - platform.length)}`);

  // ── spotdl ────────────────────────────────────────────────────────────────
  const assetName = SPOTDL_ASSETS[platform];
  const outName   = SPOTDL_OUT[platform];
  const spotdlDest = path.join(platDir, outName);

  if (!forceDl && fs.existsSync(spotdlDest)) {
    log(`✅ spotdl: already present (${path.relative(ROOT, spotdlDest)}) — skip`);
  } else {
    const url = `${SPOTDL_BASE}/${assetName}`;
    log(`⬇  spotdl: ${assetName}`);
    log(`   ${url}`);
    try {
      await downloadFile(url, spotdlDest);
      if (process.platform !== 'win32' || platform !== 'win32') {
        try { fs.chmodSync(spotdlDest, 0o755); } catch {}
      }
      const sizeMB = (fs.statSync(spotdlDest).size / 1024 / 1024).toFixed(1);
      log(`✅ spotdl: saved (${sizeMB} MB) → ${path.relative(ROOT, spotdlDest)}`);
    } catch (err) {
      warn(`spotdl [${platform}]: ${err.message}`);
      errors++;
    }
  }

  // ── ffmpeg ────────────────────────────────────────────────────────────────
  const ffInfo  = FFMPEG_SOURCES[platform];
  const ffDest  = path.join(platDir, ffInfo.out);

  if (!forceDl && fs.existsSync(ffDest)) {
    log(`✅ ffmpeg: already present (${path.relative(ROOT, ffDest)}) — skip`);
    continue;
  }

  // Check ffmpeg-static npm package first (zero download cost)
  if (!forceDl && tryFfmpegStatic(platform, ffDest)) {
    if (process.platform !== 'win32') try { fs.chmodSync(ffDest, 0o755); } catch {}
    continue;
  }

  try {
    await downloadAndExtract(ffInfo.url, ffInfo.type, ffInfo.inner, ffDest, 'ffmpeg');
    if (process.platform !== 'win32') try { fs.chmodSync(ffDest, 0o755); } catch {}
    const sizeMB = (fs.statSync(ffDest).size / 1024 / 1024).toFixed(1);
    log(`✅ ffmpeg: saved (${sizeMB} MB) → ${path.relative(ROOT, ffDest)}`);
  } catch (err) {
    warn(`ffmpeg [${platform}]: ${err.message}`);
    warn(`   Manual fix: place the ffmpeg binary at ${path.relative(ROOT, ffDest)}`);
    errors++;
  }
}

log('');
if (errors > 0) {
  log(`⚠️  Completed with ${errors} error(s). See warnings above.`);
  process.exit(1);
} else {
  log(`🎉 All binaries ready. Run your build command now.\n`);
}
