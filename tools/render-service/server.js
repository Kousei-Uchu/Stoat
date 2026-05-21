const express = require('express');
const path = require('path');
const { Spotifly } = require('spotifly');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();
const cors = require('cors');
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const spot = new Spotifly();

app.post('/api/resolve', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const data = await spot.resolve(url);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Simple endpoint that attempts to download via yt-dlp (must be installed on host)
app.post('/api/download', async (req, res) => {
  const { url, format = 'mp3_320' } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  // map simple format key to yt-dlp args
  const formatArgs = ['-x', '--audio-format', format.split('_')[0]];
  const outDir = path.join(__dirname, 'downloads');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const args = ['-o', path.join(outDir, '%(title)s.%(ext)s'), ...formatArgs, url];
  const ytdlp = spawn('yt-dlp', args);

  ytdlp.stdout.on('data', (d) => console.log(String(d)));
  ytdlp.stderr.on('data', (d) => console.error(String(d)));

  ytdlp.on('close', (code) => {
    if (code === 0) return res.json({ ok: true, path: outDir });
    return res.status(500).json({ ok: false, code });
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Render service listening on ${PORT}`));
