// Captures Tournament Hub screenshots for the pubmat from a finished event,
// rewound to LIVE_SLOT so the Live board and Match Finder have matches on court.
// Only needed to refresh the screenshots in shots/; a new event doesn't need it.
// Run from anywhere: node _templates/hub-pubmat/capture.mjs
//
// Expects the usual D:PersonalSAGE layout: this repo beside event-data/
// (the snapshot) and sage-tools-api/ (whose puppeteer it borrows).
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const HERE = import.meta.dirname;
const require = createRequire(import.meta.url);
const puppeteer = require(path.resolve(HERE, '../../../sage-tools-api/node_modules/puppeteer'));

const EVENT = 'pickle-for-sight-2026';
const DAY = 'pickle-for-sight-day1';
const LIVE_SLOT = '12:45 PM';
const SYNCED_AT = '2026-09-27T04:47:12Z'; // 12:47 PM in Manila
const STANDINGS_CATEGORY = "Novice Women's Doubles"; // finished before LIVE_SLOT
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SITE = path.resolve(HERE, '../..');
const DATA = path.resolve(HERE, '../../../event-data');
const OUT = path.join(HERE, 'shots');

// ---- Doctored snapshot: LIVE_SLOT's matches on court, later ones unplayed ----
const toMin = t => { const m = /(\d+):(\d+)\s*(AM|PM)/i.exec(t); let h = +m[1] % 12; if (/pm/i.test(m[3])) h += 12; return h * 60 + +m[2]; };
const snap = JSON.parse(fs.readFileSync(path.join(DATA, EVENT, 'data', `${DAY}.json`), 'utf8'));
snap.isLive = true;
snap.generatedAt = SYNCED_AT;
const slot = toMin(LIVE_SLOT);
const later = new Map(); // player name -> matches after LIVE_SLOT
const atSlot = [];
for (const f of snap.facilities) {
  f.syncedAt = SYNCED_AT;
  const rows = f.matchesCsv.split('\r\n').map(l => l.split(','));
  for (const r of rows.slice(1)) {
    if (r.length < 12) continue;
    const t = toMin(r[2]);
    if (t === slot) { r[1] = r[3].replace(/\D/g, ''); atSlot.push(r[5], r[9]); }
    if (t > slot) for (const p of [r[5], r[9]]) later.set(p, (later.get(p) || 0) + 1);
    if (t >= slot) { r[7] = ''; r[11] = ''; }
  }
  f.matchesCsv = rows.map(r => r.join(',')).join('\r\n');
}
// Match Finder searches the on-court pair with the most matches still to play
const pick = atSlot.sort((a, b) => (later.get(b) || 0) - (later.get(a) || 0))[0];
const snapJson = JSON.stringify(snap);

// ---- Static server for the site ----
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.ico':'image/x-icon', '.csv':'text/csv' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(5173);

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: true, executablePath: CHROME });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function openPage(url, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.emulateTimezone('Asia/Manila');
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.url().includes(`/event-data/${EVENT}/data/`)) {
      req.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: snapJson });
    } else req.continue();
  });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await sleep(1500);
  return page;
}

const phone = { width: 390, height: 844, deviceScaleFactor: 4, isMobile: true, hasTouch: true };
const SCREEN_H = 820; // visible screen height in the pubmat's phone frame, CSS px
const topOf = (page, sel) => page.$eval(sel, el => el.getBoundingClientRect().top + window.scrollY);
const screen = (page, name, y) => page.screenshot({ path: `${OUT}/${name}.png`,
  clip: { x: 0, y: Math.max(0, Math.round(y)), width: 390, height: SCREEN_H }, captureBeyondViewport: true });

const hub = await openPage(`http://localhost:5173/events/${EVENT}/`, phone);
await screen(hub, 'hub-live', await topOf(hub, '.view-tab') - 28);

await hub.click('.view-tab[data-view="finder"]');
await sleep(500);
await hub.type('#teamInput', pick, { delay: 20 });
await sleep(300);
await hub.keyboard.press('ArrowDown');
await hub.keyboard.press('Enter');
await sleep(800);
await screen(hub, 'hub-finder', await topOf(hub, '.ticket') - 150);

await hub.click('.view-tab[data-view="standings"]');
await sleep(500);
await hub.type('#catFilterInput', STANDINGS_CATEGORY, { delay: 20 });
await sleep(300);
await hub.keyboard.press('Enter');
await sleep(800);
await screen(hub, 'hub-standings', await topOf(hub, '#catFilterInput') - 60);


console.log('finder search:', pick);
await browser.close();
server.close();
