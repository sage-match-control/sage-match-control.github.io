// The site's 404.html: what a visitor reads when an address isn't on the site, and the step that
// sends a finished event's old address on to events/archives/. The redirect itself is
// archivedPagePath in lib/v1/domain/event-pages.js, tested in unit/domain/event-pages.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT } from '../helpers/paths.mjs';

const html = fs.readFileSync(path.join(SITE_ROOT, '404.html'), 'utf8');

test('the message is in the markup and not hidden, so it reads without JavaScript', () => {
  const main = /<main\b[^>]*>/.exec(html);
  assert.ok(main, 'has a <main>');
  assert.doesNotMatch(main[0], /\bhidden\b/);
  assert.match(html, /<h1\b[^>]*>That one landed out<\/h1>/);
  assert.match(html, /This page isn.t on the site\./);
});

test('it links nowhere: no tournament, no field guide, no staff tools', () => {
  assert.doesNotMatch(html, /<a\b/i);
});

test('a failed import of the engine still ends in the message, never a blank page', () => {
  assert.doesNotMatch(html, /^\s*import\s/m, 'a static import that fails would stop the whole script');
  assert.match(html, /import\('\/lib\/v1\/domain\/event-pages\.js'\)/);
});

test('only an address under events/ waits for the archive check', () => {
  assert.match(html, /location\.pathname\.startsWith\('\/events\/'\)/);
});

test('the check has a time limit, so a slow network still ends in the message', () => {
  assert.match(html, /setTimeout\(reveal, \d+\)/);
});

test('it is not offered to search engines, and its paths are root-absolute', () => {
  assert.match(html, /<meta name="robots" content="noindex"/);
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    assert.match(m[1], /^(\/|https:\/\/fonts\.)/, `${m[1]}: GitHub Pages serves this page at any depth`);
  }
});
