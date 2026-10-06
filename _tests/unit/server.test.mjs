// Instantiating a template as the harness serves it (site-engine-spec §6.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { instantiateTemplate, startSite } from '../helpers/server.mjs';

const template = [
  "const EVENT_KEY = '{{EVENT_KEY}}';",
  'const DAYS = [',
  "  // EXAMPLE — replace",
  "  { key: '{{EVENT_KEY}}-day1', label: 'Day 1' }",
  '];',
  'const LIVE_BASE_URL = \'wss://x\';',
  '<h1>{{EVENT_TITLE}}</h1>',
].join('\n');

test('settings replace a declared const first, then tokens fill the rest', () => {
  const out = instantiateTemplate(template, {
    tokens: { EVENT_KEY: 'k', EVENT_TITLE: 'T' },
    settings: { EVENT_KEY: 'k', DAYS: [{ key: 'k-day1', label: 'Oct 3' }] },
  });
  assert.match(out, /const EVENT_KEY = "k";/);
  assert.match(out, /"label": "Oct 3"/);
  assert.doesNotMatch(out, /EXAMPLE/);
  assert.match(out, /<h1>T<\/h1>/);
  assert.match(out, /const LIVE_BASE_URL = 'wss:\/\/x';/);
});

test('a setting the file does not declare is left alone', () => {
  const out = instantiateTemplate("const EVENT_KEY = 'x';", { settings: { DAYS: [], EVENT_KEY: 'y' } });
  assert.equal(out, 'const EVENT_KEY = "y";');
});

test('an unknown token throws, naming it', () => {
  assert.throws(() => instantiateTemplate('{{NOPE}}', { tokens: {} }), err => err.token === 'NOPE');
});

test('startSite serves a folder like Pages, instantiates _templates/, and answers 500 for an unknown token', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  fs.mkdirSync(path.join(root, '_templates'));
  fs.mkdirSync(path.join(root, 'tools'));
  fs.writeFileSync(path.join(root, 'tools', 'page.html'), '<p>{{KEPT}}</p>');
  fs.writeFileSync(path.join(root, '_templates', 'a.html'), '<p>{{A}}</p>');
  fs.writeFileSync(path.join(root, '_templates', 'b.html'), '<p>{{B}}</p>');
  const site = await startSite({ root, instantiate: { tokens: { A: 'one' } } });
  try {
    assert.equal(await (await fetch(`${site.baseUrl}/tools/page`)).text(), '<p>{{KEPT}}</p>');
    assert.equal(await (await fetch(`${site.baseUrl}/_templates/a.html`)).text(), '<p>one</p>');
    const bad = await fetch(`${site.baseUrl}/_templates/b.html`);
    assert.equal(bad.status, 500);
    assert.match(await bad.text(), /unknown token B/);
    assert.equal((await fetch(`${site.baseUrl}/missing`)).status, 404);
  } finally {
    await site.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
