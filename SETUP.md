# Nora — Setup, Build & Run Guide

This guide covers everything from a clean clone to a running dev build and a packaged installer.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20 LTS or 22 LTS | [nodejs.org](https://nodejs.org) |
| npm | 11+ | Comes with Node |
| Git | Any recent | |
| Python 3 | 3.10+ | Only needed if you want to test spotdl CLI manually |
| **Windows only**: PowerShell 5+ | Built-in on Win10/11 | Used by the binary downloader for zip extraction |
| **macOS only**: Xcode CLI tools | `xcode-select --install` | Provides `tar`, `unzip`, `chmod` |

---

## 1. Clone & install dependencies

```bash
git clone https://github.com/Kousei-Uchu/Stoat.git
cd Stoat
npm install
```

This installs all JS/TS dependencies. It does **not** fetch the spotdl or ffmpeg binaries yet.

---

## 2. Download the spotdl + ffmpeg binaries

This step downloads pre-built binaries into `resources/bin/` so they can be bundled into the app. You only need to do this once, or again after updating `SPOTDL_VERSION` in the script.

```bash
node scripts/download-binaries.mjs
```

### What it downloads

| Platform | spotdl source | ffmpeg source |
|---|---|---|
| Windows x64 | GitHub releases | BtbN/FFmpeg-Builds (win64-gpl) |
| macOS x64 | GitHub releases | evermeet.cx static build |
| macOS arm64 | GitHub releases (same universal binary) | evermeet.cx arm64 static build |
| Linux x64 | GitHub releases | BtbN/FFmpeg-Builds (linux64-gpl) |
| Linux arm64 | GitHub releases | BtbN/FFmpeg-Builds (linuxarm64-gpl) |

### Flags

```bash
# Only download for the platform you're building for right now
node scripts/download-binaries.mjs --platform win32

# Re-download even if files already exist
node scripts/download-binaries.mjs --force

# Combine
node scripts/download-binaries.mjs --platform darwin-arm64 --force
```

### Troubleshooting binary downloads

**ffmpeg zip extraction fails on Windows** — The script uses PowerShell's `ZipFile` class. If it fails, manually download `ffmpeg-master-latest-win64-gpl.zip` from https://github.com/BtbN/FFmpeg-Builds/releases/tag/latest, open it, and copy `ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe` to `resources/bin/win32/ffmpeg.exe`.

**macOS Gatekeeper quarantine** — After downloading, macOS may quarantine the binaries. Clear the quarantine attribute:
```bash
xattr -d com.apple.quarantine resources/bin/darwin-arm64/spotdl
xattr -d com.apple.quarantine resources/bin/darwin-arm64/ffmpeg
xattr -d com.apple.quarantine resources/bin/darwin-x64/spotdl
xattr -d com.apple.quarantine resources/bin/darwin-x64/ffmpeg
```

**Already have ffmpeg-static in node_modules** — The script detects this automatically and copies from there instead of downloading anything.

---

## 3. Run in development mode

```bash
npm run dev
```

This starts electron-vite in watch mode. The Electron window opens automatically. Hot module reload applies to the renderer; main process changes require a manual restart (Ctrl+C then `npm run dev` again, or use the reload button in the DevTools).

### Dev-mode binary resolution

In dev mode, `binaryManager.ts` resolves binaries from `<projectRoot>/resources/bin/<platform>/`. This is the same directory populated by `download-binaries.mjs`, so no extra setup is needed.

---

## 4. Build a distributable package

The build scripts automatically run `npm run download-binaries` first, so you don't need to run step 2 manually if you're doing a fresh build.

### Windows (NSIS installer, x64 + arm64)
```bash
npm run build:win
```
Output: `dist/Nora v{version}-win-x64.exe` and `dist/Nora v{version}-win-arm64.exe`

### Windows x64 only (faster)
```bash
npm run build:win-x64
```

### macOS (DMG, x64 + arm64)
```bash
npm run build:mac
```
Output: `dist/Nora v{version}-mac-x64.dmg` and `dist/Nora v{version}-mac-arm64.dmg`

> **Note:** Building macOS packages on Windows produces the DMG but the app won't be notarised. For distribution, build on a Mac and set up Apple notarisation credentials in your environment.

### macOS arm64 only
```bash
npm run build:mac-arm64
```

### Linux (AppImage + deb + rpm + snap)
```bash
npm run build:linux
```

### Unpackaged (for quick testing without an installer)
```bash
npm run build:unpack
```
Output: `dist/win-unpacked/` (or `dist/mac/`, `dist/linux-unpacked/`)

---

## 5. Type-check without building

```bash
npm run typecheck
```

---

## 6. How spotdl + ffmpeg are embedded

At build time, `electron-builder.yml` copies the `resources/bin/<platform>/` directory alongside `app.asar` as `extraResources`. At runtime:

- `src/main/binaryManager.ts` computes the correct platform key and returns the path inside `process.resourcesPath` (packaged) or `<projectRoot>/resources/bin/<platform>/` (dev).
- `ensureSpotdl()` in `downloader.ts` calls `binaryManager.resolveSpotdl()` and throws immediately if the binary isn't present (no runtime download — it must be pre-bundled).
- yt-dlp continues to be downloaded on first launch from GitHub into `app.getPath('userData')/bin/`, with `resources/bin/<platform>/yt-dlp[.exe]` checked first as an optional override.

### Binary directory layout

```
resources/
  bin/
    win32/
      spotdl.exe
      ffmpeg.exe
      yt-dlp.exe       ← optional, overrides runtime download
    darwin-x64/
      spotdl
      ffmpeg
    darwin-arm64/
      spotdl
      ffmpeg
    linux-x64/
      spotdl
      ffmpeg
    linux-arm64/
      spotdl
      ffmpeg
```

This directory is listed in `.gitignore` — binaries are not committed to the repo.

---

## 7. Updating spotdl

1. Check the latest release at https://github.com/spotDL/spotify-downloader/releases
2. Update `SPOTDL_VERSION` in `scripts/download-binaries.mjs`
3. Re-run `node scripts/download-binaries.mjs --force`
4. Rebuild the app

---

## 8. Common issues

**`spotdl binary not found` error at runtime** — You skipped step 2. Run `node scripts/download-binaries.mjs --platform win32` (or your platform), then restart the app.

**`Error: [vite]: Rolldown failed to resolve import "puppeteer-extra"`** — You still have `puppeteer-extra` listed as a dependency in `package.json`. Remove it and run `npm install` again. The `spotifyScraper.ts` file uses `new Function('m', 'return import(m)')` to hide these imports from the bundler.

**spotdl fails with `yt-dlp not found`** — spotdl v4.5.0 requires yt-dlp. The bundled spotdl binary includes its own yt-dlp, but if it doesn't: run `resources/bin/<platform>/spotdl --download-yt-dlp` once from the command line to let spotdl download it into its own directory.

**spotdl fails with `Deno not found` (v4.5.0+)** — Some YouTube videos now require a JavaScript runtime. Run `resources/bin/<platform>/spotdl --download-deno` once to let spotdl self-install Deno alongside itself. This is a one-time operation.

**Spotify URL preview (search panel) shows no results** — This uses `spotifyScraper.ts` (not spotdl), which falls back through credential → clienttoken approaches. Check your Spotify API credentials in Settings if you need richer metadata in the preview panel.