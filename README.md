<div align="center">

<img src="resources/other/nora_logo_banner.webp" alt="Nora Logo">

# Nora Player

### An elegant music player for the modern desktop

Built with Electron and React • Inspired by [Oto Music](https://play.google.com/store/apps/details?id=com.piyush.music&gl=us)

[![GitHub license](https://img.shields.io/github/license/Sandakan/Nora?style=for-the-badge)](https://github.com/Sandakan/Nora/blob/master/LICENSE)

> **Original project**: [Sandakan/Nora](https://github.com/Sandakan/Nora)  
> **This fork** is maintained by **Sorren** ([@Kousei-Uchu](https://github.com/Kousei-Uchu)) and adds a suite of extended features described below.

[Download](#-download) • [Features](#-features) • [Build Guide](#-build-from-source) • [Changelog](/changelog.md)

</div>

---

## 🎯 Why Nora?

Nora reimagines desktop music playback with thoughtful design and powerful features. Built to overcome the limitations of default music apps, it provides an intuitive and beautiful experience that puts your music front and center.

![Nora Banner Artwork](/resources/other/artwork%200.webp)

---

## ✨ Features

### Core (original Nora)

**Library Management**
- Organize songs, artists, albums, and playlists with ease
- Advanced search with smart song filters
- Edit song metadata easily and conveniently
- Full genre, album, and artist info pages

**Listening Experience**
- Sing along with song lyrics (synced & unsynced)
- Last.FM scrobbling integration
- Mini-player and fullscreen player modes

**Personalization**
- Favorites, listening history, playlists
- Artist biography and similar artist info
- Light / Dark theme

---

### 🆕 Extended features (this fork)

#### Downloader (Stoat Downloader)
- **No external dependencies** — yt-dlp is auto-downloaded on first launch (~10 MB) and managed automatically
- **Search** songs by name with results from YouTube Music (preferred for accuracy) and YouTube
- **Paste any URL** — YouTube, YouTube Music, SoundCloud, and more
- **Spotify URL support** (track, album, playlist, artist discography) — no Spotify login required
  - Uses Spotify's public metadata API to fetch full track info including album, artist, genres, year, and track number
  - Smart YouTube matching using confidence scoring (title + artist + album + duration similarity) to avoid wrong versions (instrumentals, remixes, covers, sped-up, etc.)
  - Batch downloading for albums, playlists, and full artist discographies with per-track progress
- **Rich metadata tagging** — downloaded files are tagged with title, artist, album artist, album, year, track number, and genres via ffmpeg
- **Lyrics download** — synced `.lrc` files downloaded and converted alongside audio automatically
- **Recent downloads** panel shows status of all downloads this session (replaces the old "in download folder" file list)
- **Spaces in search** fixed — the text input now correctly allows spaces

#### DJ Mode
- Full Spotify-style AI DJ feature (accessible via sidebar or Settings → Downloads → DJ Mode)
- **Voice announcements** between tracks using the Web Speech API (TTS)
  - Choose from all system voices
  - Control speed, pitch, and volume
  - Skip announcements with one click
- **AI-generated commentary** using a built-in Anthropic model
  - Four announcement styles: Minimal, Friendly, Hype, Trivia
  - Configurable announce frequency (every N tracks)
- **Mood selector** — Auto, Chill, Energetic, Focus, Party, Moody
- **Crossfade** between tracks (1–12 s, configurable)
- **Loudness normalisation** toggle
- **Session stats** — tracks played, announcements made, session duration
- **TTS preview** — type any text and hear your voice settings live

#### Album & Artist metadata
- Album downloads now include full album-level metadata (album artist, year, genre, track number) embedded in the file
- Spotify-sourced downloads carry genre tags fetched from Spotify's artist and album API

---

## 📥 Download

Go to the **[Releases page](https://github.com/Kousei-Uchu/Nora/releases) > Assets > Choose your platform** or download the latest release directly.

---

## 🔨 Build from source

```bash
git clone https://github.com/Kousei-Uchu/Nora.git
cd Nora
npm install
npm run dev        # Development
npm run build      # Production build
```

---

## 📸 Gallery

![Support for Online and Offline Lyrics](/resources/other/artwork%201.webp)

![Switch between Dark and Light Modes](/resources/other/artwork%202.webp)

![Support for Last.FM Scrobbling](/resources/other/artwork%209.webp)

![Organize your music library with ease](/resources/other/artwork%203.webp)

---

## 🤝 Credits

- **Original Nora** by [Sandakan](https://github.com/Sandakan) — [github.com/Sandakan/Nora](https://github.com/Sandakan/Nora)
- **This fork** maintained by [Sorren (@Kousei-Uchu)](https://github.com/Kousei-Uchu)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) for audio extraction
- [Anthropic](https://anthropic.com) for Claude AI (DJ commentary)

## 📄 License

[MIT](LICENSE.txt)
