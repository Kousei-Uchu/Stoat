<div align="center">

<img src="resources/other/nora_logo_banner.webp" alt="Nora Logo">

# Nora Player

### An elegant music player for desktop, iOS, and Android

Built with Electron (desktop) and Capacitor (mobile) · React · TypeScript

[![License](https://img.shields.io/github/license/Sandakan/Nora?style=for-the-badge)](LICENSE)

> **Original project**: [Sandakan/Nora](https://github.com/Sandakan/Nora)  
> **This fork** is maintained by **Sorren** ([@Kousei-Uchu](https://github.com/Kousei-Uchu))

[Desktop Build](#-desktop-electron) · [iOS Build](#-ios-capacitor) · [Android Build](#-android-capacitor) · [Plugins](#-plugin-system) · [Changelog](changelog.md)

</div>

---

## ✨ Features

### Core (original Nora)
- Full music library management — songs, artists, albums, genres, playlists
- Synced & unsynced lyrics (LRClib, local .lrc files)
- Last.fm scrobbling, Discord Rich Presence
- Mini-player, fullscreen player, equalizer, dynamic themes

### Extended (this fork)

#### Downloader Plugin
- Paste any YouTube, Spotify, SoundCloud, or YouTube Music URL
- **Spotify support with no login** — uses the public Spotify web-player token (spotifly-style). If you configure Spotify credentials in Settings → Accounts, the official Client Credentials flow is used instead for higher rate limits.
- Smart YouTube matching avoids wrong versions (instrumentals, covers, remixes, nightcore, etc.) using confidence scoring across title + artist + album + duration
- Batch download: full albums, playlists, artist discographies
- Full ID3 tag embedding (title, artist, album artist, album, year, track #, genre, artwork)
- Synced `.lrc` lyrics downloaded alongside audio, auto-registered in library
- **Duplicate detection** — prompts before re-downloading an existing file
- yt-dlp auto-downloaded on first use (~10 MB), no user setup needed

#### DJ Mode Plugin
- AI voice announcements between tracks (Web Speech API TTS)
- AI-generated commentary via Anthropic API (4 styles: Minimal, Friendly, Hype, Trivia)
- Mood selector (Auto, Chill, Energetic, Focus, Party, Moody)
- Crossfade (1–12s), loudness normalisation
- Session stats, live TTS preview

#### Plugin System
- All extended features are **plugins**, not hardcoded features
- Built-in plugins (Downloader, DJ Mode) ship with Nora, can be disabled
- Plugin Store with Official and Community sections
- Install, enable/disable, uninstall from one UI

#### iOS & Android (Capacitor)
- Full Capacitor integration — build for iOS 16+ and Android
- **iOS is completely clean**: no downloader, no plugin system, no DJ mode, not even a log line mentioning them. The Vite build system removes them entirely via compile-time constants + tree-shaking + module alias stubs.
- Android supports all desktop features except Electron-specific IPC

---

## 🖥 Desktop (Electron)

```bash
npm install
npm run dev        # development
npm run build      # production build
```

---

## 📱 iOS (Capacitor)

> **Requirements**: macOS, Xcode 15+, CocoaPods

```bash
npm install

# First time: add the iOS platform
npm run cap:add:ios

# Build the web assets for iOS (strips ALL download/plugin code)
npm run build:ios

# Open in Xcode
npm run cap:ios
```

The `build:ios` script sets `VITE_PLATFORM=ios`, which:
- Replaces `DownloadPage`, `DjModePage`, `PluginsPage` with null stubs
- Replaces the plugin registry with empty exports  
- Sets `window.api` to `undefined` (no Electron IPC surface)
- Tree-shakes out all dead code

The result is a clean music player with zero download or plugin infrastructure.

---

## 🤖 Android (Capacitor)

> **Requirements**: Android Studio, JDK 17+

```bash
npm install

# First time: add the Android platform
npm run cap:add:android

# Build web assets for Android
npm run build:android

# Open in Android Studio
npm run cap:android
```

---

## 🔌 Plugin System

Plugins live in `src/renderer/src/plugins/`. A plugin is defined by a `NPluginManifest` object in `registry.ts`.

**Adding an official plugin:**
1. Add its manifest to `OFFICIAL_STORE_PLUGINS` in `registry.ts`
2. Create the component(s) and route(s)
3. Guard any Electron IPC calls behind `IS_ELECTRON` from `platform.ts`

**Built-in plugins** (cannot be uninstalled, only disabled):
- `dev.nora.downloader` — Nora Downloader
- `dev.nora.dj` — DJ Mode

---

## 🤝 Credits

- **Original Nora** by [Sandakan](https://github.com/Sandakan) — [github.com/Sandakan/Nora](https://github.com/Sandakan/Nora)
- **Fork** by [Sorren (@Kousei-Uchu)](https://github.com/Kousei-Uchu)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — audio extraction
- [Anthropic](https://anthropic.com) — Claude AI (DJ commentary)
- [Capacitor](https://capacitorjs.com) — iOS/Android runtime

## 📄 License

[MIT](LICENSE.txt)
