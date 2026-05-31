const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const playlistUrl = 'https://open.spotify.com/playlist/72tpl5jsd6PUFMePOc3XRZ?si=fe3e8214bcb84e2e';
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

  try {
    await page.goto(playlistUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // accept cookie banner if present
    try {
      const btn = await page.$('#onetrust-accept-btn-handler');
      if (btn) await btn.click();
    } catch (e) {}

    // wait for track rows
    await page.waitForSelector('[data-testid="tracklist-row"]', { timeout: 30000 });

    // scroll and collect
    const rowsMap = new Map();

    for (let i = 0; i < 60; i++) {
      const batch = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[data-testid="tracklist-row"]'));
        return rows.map(row => {
          const titleEl = row.querySelector('div[role="gridcell"] a[href*="/track/"]');
          const albumEl = row.querySelector('a[href*="/album/"]');
          const artistEls = Array.from(row.querySelectorAll('a[href*="/artist/"]'));
          const img = row.querySelector('img');
          const trackId = titleEl?.getAttribute('href')?.split('/track/')?.[1]?.split('?')?.[0];
          return {
            trackId,
            title: titleEl?.innerText?.trim(),
            albumId: albumEl?.getAttribute('href')?.split('/album/')?.[1]?.split('?')?.[0],
            albumName: albumEl?.innerText?.trim(),
            coverUrl: img?.getAttribute('src') || null,
            artists: artistEls.map(a => ({ id: a.getAttribute('href')?.split('/artist/')?.[1]?.split('?')?.[0], name: a.innerText.trim() })),
          };
        }).filter(r => r.trackId);
      });

      for (const r of batch) rowsMap.set(r.trackId, r);

      // scroll
      await page.evaluate(() => {
        const scrollable = document.querySelector('#main-view, .main-view-container__scroll-node-child');
        if (scrollable) scrollable.scrollBy(0, 900);
        else window.scrollBy(0, 600);
      });
      await new Promise(r => setTimeout(r, 1200));
    }

    const tracks = Array.from(rowsMap.values());
    console.log(JSON.stringify({ trackCount: tracks.length, tracks: tracks.slice(0, 50) }, null, 2));
    fs.writeFileSync('scripts/playlist_scrape_result.json', JSON.stringify({ url: playlistUrl, trackCount: tracks.length, tracks }, null, 2));

  } catch (err) {
    console.error('Error scraping playlist:', err);
    process.exitCode = 2;
  } finally {
    await browser.close().catch(() => {});
  }
})();
