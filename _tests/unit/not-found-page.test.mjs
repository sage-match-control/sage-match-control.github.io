// The site's 404.html: what a visitor reads when an address isn't on the site.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT } from '../helpers/paths.mjs';

const html = fs.readFileSync(path.join(SITE_ROOT, '404.html'), 'utf8');

test('it says what happened', () => {
  assert.match(html, /<h1\b[^>]*>That one landed out<\/h1>/);
  assert.match(html, /This page isn.t on the site\./);
});

test('it redirects nowhere: no script and no refresh, so an old address stays a 404', () => {
  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /http-equiv/i);
});

test('it links nowhere: no tournament, no field guide, no staff tools', () => {
  assert.doesNotMatch(html, /<a\b/i);
});

test('it is not offered to search engines, and its paths are root-absolute', () => {
  assert.match(html, /<meta name="robots" content="noindex"/);
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    assert.match(m[1], /^(\/|https:\/\/fonts\.)/, `${m[1]}: GitHub Pages serves this page at any depth`);
  }
});
