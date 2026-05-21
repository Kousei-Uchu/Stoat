Render service
===============

Lightweight standalone service that resolves Spotify URLs using `spotifly` and can optionally invoke `yt-dlp` to download audio. This is intended as a fallback when the main app cannot reach Spotify directly (for example when Spotify domains are blocked by a network).

Quick start
-----------

Install dependencies and start:

```bash
cd tools/render-service
npm install
npm start
```

Notes
-----
- The `/api/resolve` endpoint uses `spotifly` and does not require Spotify auth.
- The `/api/download` endpoint spawns `yt-dlp` — ensure `yt-dlp` is installed on the host system and available on PATH.
- This service is intentionally minimal; adapt authentication, rate-limiting and security as needed before exposing it publicly.
