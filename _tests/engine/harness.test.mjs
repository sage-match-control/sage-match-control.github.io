// The harness checks itself (site-engine-spec §6.7, Phase 0 acceptance): it is
// what makes "no visible change" checkable, so it has to be shown to catch a
// change, to be steady when nothing changed, and to refuse anything that
// leaves the machine.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SITE_ROOT } from '../helpers/paths.mjs';
import { launchBrowser, openPage, settle } from '../helpers/browser.mjs';
import { startSite } from '../helpers/server.mjs';
import { runCase } from '../helpers/runCase.mjs';
import { compareResults } from '../helpers/compare.mjs';
import { buildCases } from './cases.mjs';

const TIME = '2026-10-03T13:00:00+08:00';

function scratchSite(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

/** A page whose script runs `body`, served and opened under the harness. Returns what openPage returned. */
async function openScratch(browser, body, options = {}) {
  const root = scratchSite({ 'index.html': `<!doctype html><title>t</title><body><script>${body}</script></body>` });
  const site = await startSite({ root });
  const h = await openPage(browser, `${site.baseUrl}/index.html`, { time: TIME, ...options });
  await settle(h.page);
  const close = h.close;
  h.close = async () => { await close(); await site.close(); fs.rmSync(root, { recursive: true, force: true }); };
  return h;
}

/** A copy of the standard template with `modify` applied to its text, plus the shared assets. */
function mutatedTree(modify) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutated-'));
  fs.cpSync(path.join(SITE_ROOT, 'assets'), path.join(root, 'assets'), { recursive: true });
  fs.cpSync(path.join(SITE_ROOT, 'lib'), path.join(root, 'lib'), { recursive: true }); // the page imports the engine
  const dir = path.join(root, '_templates', 'standard-tournament-template');
  fs.mkdirSync(dir, { recursive: true });
  const source = fs.readFileSync(path.join(SITE_ROOT, '_templates', 'standard-tournament-template', 'index.html'), 'utf8');
  const changed = modify(source);
  assert.notEqual(changed, source, 'the mutation changed the page');
  fs.writeFileSync(path.join(dir, 'index.html'), changed);
  return root;
}

describe('harness self-test', () => {
  let browser;
  before(async () => { browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); });

  it('a request to a host that is not routed fails the case, naming the URL', async () => {
    const h = await openScratch(browser, "fetch('https://example.org/leak').catch(function(){});");
    try {
      assert.ok(h.errors.some(e => e.includes('https://example.org/leak')), JSON.stringify(h.errors));
    } finally { await h.close(); }
  });

  it('a Cloud Run request the case does not handle fails the case', async () => {
    const h = await openScratch(browser, "fetch('https://sage-tools-api-1.us-central1.run.app/v3/anything').catch(function(){});");
    try {
      assert.ok(h.errors.some(e => e.includes('unhandled Cloud Run request') && e.includes('/v3/anything')), JSON.stringify(h.errors));
    } finally { await h.close(); }
  });

  it('a Cloud Run request the case handles is answered, and recorded', async () => {
    const cloudRun = [{ method: 'GET', path: /\/v3\/ping$/, reply: () => ({ status: 200, body: { hello: 'world' } }) }];
    const h = await openScratch(browser,
      "fetch('https://sage-tools-api-1.us-central1.run.app/v3/ping').then(function(r){return r.json()}).then(function(j){document.title=j.hello})",
      { cloudRun });
    try {
      assert.deepEqual(h.errors, []);
      assert.equal(await h.page.title(), 'world');
      assert.equal(h.requests.length, 1);
    } finally { await h.close(); }
  });

  it('a pageerror or console.error fails the case unless the case lists the message', async () => {
    const body = "console.error('boom'); setTimeout(function(){ throw new Error('late') }, 0);";
    const failing = await openScratch(browser, body);
    try {
      assert.ok(failing.errors.some(e => e.includes('boom')));
      assert.ok(failing.errors.some(e => e.includes('late')));
    } finally { await failing.close(); }
    const listed = await openScratch(browser, body, { allowErrors: ['boom', /late/] });
    try { assert.deepEqual(listed.errors, []); } finally { await listed.close(); }
  });

  it('fonts answer empty, and a socket to the live Worker closes quietly', async () => {
    const h = await openScratch(browser,
      "fetch('https://fonts.googleapis.com/css2?family=Inter').then(function(r){document.title='font '+r.status});" +
      "var ws = new WebSocket('wss://sage-live.example.workers.dev/live/e/d'); ws.onclose = function(){ window.__closed = true };");
    try {
      assert.deepEqual(h.errors, []);
      await h.page.waitForFunction(() => window.__closed === true);
      assert.equal(await h.page.title(), 'font 200');
    } finally { await h.close(); }
  });

  it('the clock holds at the case time until a step moves it', async () => {
    const h = await openScratch(browser, '');
    try {
      const before = await h.page.evaluate(() => Date.now());
      await h.page.waitForTimeout(700);
      assert.equal(await h.page.evaluate(() => Date.now()), before);
      assert.equal(before, Date.parse(TIME));
      assert.equal(await h.page.evaluate(() => new Date().getHours()), 13); // Asia/Manila
      await h.setTime('2026-10-03T15:30:00+08:00');
      assert.equal(await h.page.evaluate(() => Date.now()), Date.parse('2026-10-03T15:30:00+08:00'));
    } finally { await h.close(); }
  });

  describe('against a real case', () => {
    const c = buildCases().find(x => x.id === 'std-index/piggleball-2026/finder/final/desktop');

    it('the same case twice gives identical text and pixels', async () => {
      const [a, b] = [await runCase(browser, SITE_ROOT, c), await runCase(browser, SITE_ROOT, c)];
      const r = compareResults(a, b);
      assert.ok(r.textSame && r.pixelsSame, `text same ${r.textSame}, ${r.png.differing} pixels differ`);
      assert.deepEqual(a.errors, []);
    });

    it('a one-character change to a template colour is caught as a pixel difference', async () => {
      const root = mutatedTree(html => html.replace(/(--navy:\s*#[0-9A-Fa-f]{5})([0-9A-Fa-f])/, (_m, head, last) => head + (last === '0' ? '1' : '0')));
      try {
        const [base, changed] = [await runCase(browser, SITE_ROOT, c), await runCase(browser, root, c)];
        const r = compareResults(base, changed);
        assert.ok(r.textSame, 'colours do not change the text');
        assert.ok(!r.pixelsSame, 'the pixels differ');
        assert.ok(r.png.differing > 0 && r.png.diff, 'a diff image is made');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });

    it('a one-character change to a view’s text is caught as a text difference', async () => {
      const root = mutatedTree(html => html.replace('>Find matches<', '>Find matchez<'));
      try {
        const [base, changed] = [await runCase(browser, SITE_ROOT, c), await runCase(browser, root, c)];
        const r = compareResults(base, changed);
        assert.ok(!r.textSame, 'the text differs');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
  });
});
