/**
 * binaryManager.ts — Resolves bundled binary paths at runtime.
 *
 * spotdl and ffmpeg are shipped as extraResources inside the asar package.
 * Layout inside the installed app:
 *
 *   <resources>/
 *     bin/
 *       win32/
 *         spotdl.exe
 *         ffmpeg.exe
 *       darwin-x64/
 *         spotdl
 *         ffmpeg
 *       darwin-arm64/
 *         spotdl
 *         ffmpeg
 *       linux-x64/
 *         spotdl
 *         ffmpeg
 *       linux-arm64/
 *         spotdl
 *         ffmpeg
 *
 * In dev mode the binaries live at <projectRoot>/resources/bin/<platform>/.
 * electron-builder unpacks extraResources alongside app.asar, so at runtime
 * process.resourcesPath points to the right directory on all platforms.
 */

import { app } from 'electron';
import { existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

// ─── Platform key ─────────────────────────────────────────────────────────────

function platformKey(): string {
  const p = process.platform;
  const a = process.arch;
  if (p === 'win32') return 'win32';
  if (p === 'darwin') return a === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  // linux
  return a === 'arm64' ? 'linux-arm64' : 'linux-x64';
}

function binaryExt(): string {
  return process.platform === 'win32' ? '.exe' : '';
}

// ─── Path resolution ──────────────────────────────────────────────────────────

/**
 * Returns the path to the resources/bin/<platform>/ directory.
 * Works in both dev (relative to project root) and production (process.resourcesPath).
 */
function binDir(): string {
  const resourcesPath = app.isPackaged
    ? process.resourcesPath
    : join(app.getAppPath(), 'resources');
  return join(resourcesPath, 'bin', platformKey());
}

function binaryPath(name: string): string {
  return join(binDir(), `${name}${binaryExt()}`);
}

// ─── Ensure executable bit (macOS / Linux) ────────────────────────────────────

function ensureExecutable(p: string): void {
  if (process.platform !== 'win32') {
    try {
      chmodSync(p, 0o755);
    } catch {
      // already executable or read-only mount — ignore
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface BinaryInfo {
  path: string;
  available: boolean;
}

export function resolveSpotdl(): BinaryInfo {
  const p = binaryPath('spotdl');
  const available = existsSync(p);
  if (available) ensureExecutable(p);
  return { path: p, available };
}

export function resolveFfmpeg(): BinaryInfo {
  const p = binaryPath('ffmpeg');
  const available = existsSync(p);
  if (available) ensureExecutable(p);
  return { path: p, available };
}

/**
 * yt-dlp continues to be downloaded at runtime (existing behaviour) but now
 * also checks extraResources first so power-users can pre-bundle it too.
 */
export function resolveYtdlpFromResources(): BinaryInfo {
  const p = binaryPath('yt-dlp');
  const available = existsSync(p);
  if (available) ensureExecutable(p);
  return { path: p, available };
}