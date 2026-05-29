# Nora — Setup, Build & Run Guide

> Original project: [Sandakan/Nora](https://github.com/Sandakan/Nora)  
> This fork by Sorren ([@Kousei-Uchu](https://github.com/Kousei-Uchu))

---

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone & Install](#2-clone--install)
3. [Environment Variables](#3-environment-variables)
4. [Desktop (Electron)](#4-desktop-electron)
5. [iOS (Capacitor)](#5-ios-capacitor)
6. [Android (Capacitor)](#6-android-capacitor)
7. [Plugin System](#7-plugin-system)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Prerequisites

### All platforms
| Tool | Version | Notes |
|------|---------|-------|
| Node.js | **22 LTS** or newer | Required. Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) |
| npm | **10+** | Ships with Node 22 |
| Git | any | |

> **Windows note:** Use PowerShell or Git Bash. WSL2 works but paths differ.

### Desktop only
| Tool | Version | Notes |
|------|---------|-------|
| No extra tools needed | — | Electron and yt-dlp are managed automatically |

> yt-dlp (~10 MB) is auto-downloaded to your app data folder on first launch of the Download plugin. No manual install needed.

### iOS only (macOS required)
| Tool | Version | Notes |
|------|---------|-------|
| macOS | 13 Ventura+ | Xcode requires it |
| Xcode | **15+** | Install from Mac App Store |
| Xcode Command Line Tools | latest | `xcode-select --install` |
| CocoaPods | **1.14+** | `sudo gem install cocoapods` |

### Android only
| Tool | Version | Notes |
|------|---------|-------|
| Android Studio | **Hedgehog (2023.1.1)+** | [Download](https://developer.android.com/studio) |
| JDK | **17** | Bundled with Android Studio, or install separately |
| Android SDK | API 33+ | Install via Android Studio SDK Manager |

---

## 2. Clone & Install

```bash
git clone https://github.com/Kousei-Uchu/Nora.git
cd Nora
npm install
```

> If you see peer dependency warnings about `@capacitor/*`, they are expected — Capacitor packages are optional and only used for mobile builds.

### If `npm install` fails with `ERESOLVE`

The project uses Vite 8. If you see a peer dependency conflict with `@vitejs/plugin-react`, ensure you have the correct version:

```bash
# Should print ^6.0.1 or higher
npm show @vitejs/plugin-react version
```

If it still fails:
```bash
npm install --legacy-peer-deps
```

---

## 3. Environment Variables

Copy the example file and fill in what you need:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `MAIN_VITE_DISCORD_CLIENT_ID` | Optional | Discord application client ID for Rich Presence. Get one at [discord.com/developers](https://discord.com/developers/applications). Without this, Discord RPC is silently disabled — the app still works fine. |
| `MAIN_VITE_SPOTIFY_CLIENT_ID` | Optional | Spotify client ID for authenticated API access (higher rate limits). Without credentials, the app uses anonymous token access (SpotAPI approach) — works for most use cases. |
| `MAIN_VITE_SPOTIFY_CLIENT_SECRET` | Optional | Spotify client secret. Required alongside `SPOTIFY_CLIENT_ID` for credential-based auth. |

> **Spotify without credentials:** The downloader uses Spotify's anonymous `clienttoken.spotify.com` endpoint (the same approach as [SpotAPI by Aran404](https://github.com/Aran404/SpotAPI)) — no login, no OAuth, no credentials needed for basic use.

---

## 4. Desktop (Electron)

### Development (hot reload)

```bash
npm run dev
```

Opens Electron with hot reload for both main and renderer processes.

### Production build

```bash
npm run build
```

Output is in `dist/`. The installer for your platform will be in `dist/`:
- **Windows:** `Nora Setup x.x.x.exe`
- **macOS:** `Nora-x.x.x.dmg`
- **Linux:** `Nora-x.x.x.AppImage` or `.deb`

### Build for a specific platform

```bash
# Windows (from Windows or via Wine on macOS/Linux)
npm run build -- --win

# macOS (macOS only)
npm run build -- --mac

# Linux
npm run build -- --linux
```

---

## 5. iOS (Capacitor)

> **macOS only.** The iOS simulator and device builds require Xcode on macOS.

### First-time setup

```bash
# 1. Add the iOS platform (run once)
npm run cap:add:ios

# 2. Install CocoaPods dependencies (run from ios/ directory)
cd ios/App && pod install && cd ../..
```

### Build and open in Xcode

```bash
# Builds the web assets with VITE_PLATFORM=ios (strips all download/plugin code)
# then syncs to the iOS project
npm run build:ios

# Open Xcode
npm run cap:ios
```

In Xcode:
1. Select your target device or simulator in the toolbar
2. Press **▶ Run** (or `Cmd+R`)

### What the iOS build contains

The `build:ios` command sets `VITE_PLATFORM=ios`, which causes the Vite build to:

- **Completely remove** the Downloader plugin, DJ Mode, and Plugin Store via module alias stubs
- **Remove** all `window.api` Electron IPC calls (replaced by the mobile API shim)
- Set `window.__capacitorApi` as the API surface instead

No download code, no plugin infrastructure, and no DJ code exists anywhere in the iOS bundle — not even as dead code. This is enforced at compile time via Vite aliases + tree-shaking, not runtime checks.

### Live reload during development

```bash
# Start the Vite dev server
npm run dev:mobile

# In a separate terminal, open Xcode
npm run cap:ios
```

Then in `capacitor.config.ts`, uncomment the `server.url` line and set it to your machine's LAN IP:

```ts
server: {
  url: 'http://192.168.x.x:5173',
}
```

Re-run `npx cap sync ios` after changing the config.

### Signing & provisioning

In Xcode → select the `App` target → **Signing & Capabilities**:
1. Select your Apple Developer Team
2. Set a unique Bundle Identifier (must match `capacitor.config.ts` → `appId`)
3. Xcode will manage provisioning profiles automatically for simulator builds

For App Store distribution, follow Apple's standard archiving and submission process.

---

## 6. Android (Capacitor)

### First-time setup

```bash
# Add the Android platform (run once)
npm run cap:add:android
```

### Build and open in Android Studio

```bash
# Builds web assets with VITE_PLATFORM=android and syncs to Android project
npm run build:android

# Open Android Studio
npm run cap:android
```

In Android Studio:
1. Wait for Gradle sync to complete
2. Select a device or emulator from the toolbar
3. Press **▶ Run** (or `Shift+F10`)

### Live reload

```bash
npm run dev:mobile
# Uncomment server.url in capacitor.config.ts with your LAN IP
npx cap sync android
npm run cap:android
```

### Signing for release

In Android Studio → **Build → Generate Signed Bundle / APK**, follow the wizard to create or select a keystore.

---

## 7. Plugin System

Plugins are located in `src/renderer/src/plugins/`. The built-in plugins (Downloader, DJ Mode) cannot be uninstalled but can be disabled from the Plugins page in the sidebar.

### Adding an official plugin

1. Add a `NPluginManifest` entry to `OFFICIAL_STORE_PLUGINS` in `src/renderer/src/plugins/registry.ts`
2. Create the component(s) and route(s) under `src/renderer/src/routes/main-player/`
3. Add the route to `routeTree.gen.ts` following the existing pattern
4. Guard any Electron IPC calls behind `IS_ELECTRON` from `src/renderer/src/platform.ts`

### Platform guards

```ts
import { IS_ELECTRON, IS_IOS, SUPPORTS_PLUGINS } from '../platform';

// Only runs on desktop
if (IS_ELECTRON) {
  window.api.someElectronThing();
}

// True on both Electron and Android; false on iOS
if (SUPPORTS_PLUGINS) {
  // show plugin UI
}
```

---

## 8. Troubleshooting

### `npm install` fails with `ERESOLVE`
Run with `--legacy-peer-deps`:
```bash
npm install --legacy-peer-deps
```

### yt-dlp download fails on first launch
Check your internet connection. yt-dlp is fetched from GitHub Releases. If you're behind a proxy, set `HTTPS_PROXY` in your environment before launching the app.

### Discord RPC not working
- Ensure `MAIN_VITE_DISCORD_CLIENT_ID` is set in your `.env`
- Ensure Discord is running on the same machine
- The app retries the connection every 30 seconds — if Discord starts after Nora, it will connect automatically

### Spotify searches return errors
The anonymous token path (SpotAPI approach) uses Spotify's internal endpoints. If it fails:
- Add `MAIN_VITE_SPOTIFY_CLIENT_ID` + `MAIN_VITE_SPOTIFY_CLIENT_SECRET` to `.env` for authenticated access
- Get credentials at [developer.spotify.com](https://developer.spotify.com/dashboard)

### iOS build: `pod install` fails
```bash
sudo gem update cocoapods
cd ios/App && pod repo update && pod install
```

### iOS build: app crashes immediately
- Check the Xcode console for the error
- Ensure `capacitor.config.ts` → `server.url` is commented out for production builds
- Verify the Bundle ID in Xcode matches `appId` in `capacitor.config.ts`

### Android: Gradle sync fails
- In Android Studio: **File → Invalidate Caches / Restart**
- Ensure JDK 17 is set: **File → Project Structure → SDK Location → JDK Location**


### `Can't find meta/_journal.json` on launch

This means the app can't locate the database migration files. It happens when running `npm run dev` for the first time after a fresh clone (the `out/` folder doesn't exist yet).

**Fix:** This is resolved automatically in this version — `db.ts` now uses `app.getAppPath()` to find migrations relative to the project root in dev mode and relative to `app.asar.unpacked/` in production. No manual action needed.

If you still see it after pulling this version:
```bash
# Make sure you have the latest code then reinstall
npm install
npm run dev
```

If it persists, the `resources/drizzle/meta/_journal.json` file may be missing from the repo:
```bash
ls resources/drizzle/meta/
# Should show: 0000_snapshot.json  0001_snapshot.json  0002_snapshot.json  _journal.json
```

### Songs downloaded by the plugin not appearing in library
The downloader automatically calls `app/downloader/register-song` after each download, which parses the file into the library. If a song doesn't appear:
1. Open **Settings → Storage** and click **Rescan library**
2. Alternatively, add your download folder to **Settings → Music Folders**

