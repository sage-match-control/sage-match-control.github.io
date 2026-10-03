// Renders the Tournament Hub pubmat to print-ready files. Run from anywhere:
//
//   node _templates/hub-pubmat/render.mjs                  the blank base board only
//   node _templates/hub-pubmat/render.mjs <event-key> ...  the base, plus each event's files
//
// An event's panel is read from its own page, events/<event-key>/index.html:
// the name from <title> (minus " — Tournament Hub"), the date/venue line from
// the hero's .eyebrow, the QR image from the QR panel's <img> and the short
// link under it from .qr-link-text. Fix any of those on the page, not here.
//
// Writes, under out/ (git-ignored):
//   base/board-blank.pdf             the board with an empty white QR slot — print once
//   <event>/qr-panel.pdf             that event's QR panel at its exact size (sticker)
//   <event>/board.pdf                the whole board with that event's panel in place
//   <event>/board-preview.png        a small preview to check before sending to print
//   <event>/board-150dpi.png         3600 x 5400 raster, for printers that won't take PDF
//
// Expects the usual D:\Personal\SAGE layout: this repo beside sage-tools-api/,
// whose puppeteer it borrows, driving the installed Chrome.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const HERE = import.meta.dirname;
const require = createRequire(import.meta.url);
const puppeteer = require(path.resolve(HERE, '../../../sage-tools-api/node_modules/puppeteer'));

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BOARD = { w: 24, h: 36 };       // inches; must match .board in board.html
const PANEL = { w: 8, h: 8.75 };      // inches; must match --panel-w / --panel-h
const SITE = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'out');
const PAGE_URL = pathToFileURL(path.join(HERE, 'board.html')).href;

const text = html => html
  .replace(/<wbr\s*\/?>/gi, '').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&times;/g, '×').replace(/&middot;/g, '·')
  .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim();

function readEvent(key) {
  const dir = path.join(SITE, 'events', key);
  const file = path.join(dir, 'index.html');
  if (!fs.existsSync(file)) throw new Error(`No ${path.relative(SITE, file)} — is "${key}" the event's folder name?`);
  const html = fs.readFileSync(file, 'utf8');
  const pick = (re, what) => {
    const m = re.exec(html);
    if (!m) throw new Error(`${key}: couldn't find the ${what} in index.html`);
    return m[1];
  };
  const name = text(pick(/<title>([^<]*)<\/title>/, '<title>')).replace(/\s*—\s*Tournament Hub$/, '');
  const when = text(pick(/<div class="eyebrow">([\s\S]*?)<\/div>/, 'hero .eyebrow'));
  const qrSrc = pick(/<img src="([^"]+)"[^>]*alt="QR code[^"]*"/, 'QR image');
  const url = text(pick(/<div class="qr-link-text">([\s\S]*?)<\/div>/, 'QR link text'));
  const qrFile = path.join(dir, qrSrc);
  if (!fs.existsSync(qrFile)) throw new Error(`${key}: QR image ${qrSrc} not found`);
  if (/\{\{/.test(name + when + url)) throw new Error(`${key}: index.html still has {{TOKENS}} in it`);
  return { name, when, url, qr: pathToFileURL(qrFile).href };
}

const keys = process.argv.slice(2);
const events = keys.map(key => [key, readEvent(key)]); // fail before launching Chrome

const browser = await puppeteer.launch({ headless: true, executablePath: CHROME,
  args: ['--allow-file-access-from-files'] });

async function load(cfg, size, scale = 1) {
  const page = await browser.newPage();
  await page.setViewport({ width: Math.round(size.w * 96), height: Math.round(size.h * 96), deviceScaleFactor: scale });
  await page.evaluateOnNewDocument(c => { window.PUBMAT = c; }, cfg);
  await page.goto(PAGE_URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('body[data-ready="1"]');
  return page;
}
const pdf = (page, size, file) => page.pdf({ path: file, width: `${size.w}in`, height: `${size.h}in`,
  printBackground: true, pageRanges: '1' });

fs.mkdirSync(path.join(OUT, 'base'), { recursive: true });
let page = await load({ mode: 'blank', name: '', when: '', url: '', qr: '' }, BOARD);
await pdf(page, BOARD, path.join(OUT, 'base/board-blank.pdf'));
await page.close();
console.log(path.relative(process.cwd(), path.join(OUT, 'base/board-blank.pdf')));

for (const [key, e] of events) {
  const dir = path.join(OUT, key);
  fs.mkdirSync(dir, { recursive: true });

  page = await load({ mode: 'panel', ...e }, PANEL);
  await pdf(page, PANEL, path.join(dir, 'qr-panel.pdf'));
  await page.close();

  page = await load({ mode: 'board', ...e }, BOARD);
  await pdf(page, BOARD, path.join(dir, 'board.pdf'));
  await page.close();

  page = await load({ mode: 'board', ...e }, BOARD, 0.5);
  await page.screenshot({ path: path.join(dir, 'board-preview.png') });
  await page.close();

  page = await load({ mode: 'board', ...e }, BOARD, 150 / 96);
  await page.screenshot({ path: path.join(dir, 'board-150dpi.png') });
  await page.close();
  console.log(`${path.relative(process.cwd(), dir)}/  ${e.name} · ${e.when} · ${e.url}`);
}

await browser.close();
