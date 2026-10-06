// The theme contract (site-engine-spec §4.7): the engine's CSS reads colour,
// radius and shadow only through the custom properties every shell defines in
// its :root. A property the CSS reads must be in a contract list, or be one
// the engine itself sets (on an element's style, or in a rule of its own).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT } from '../helpers/paths.mjs';

export const CONTRACT = [
  '--navy', '--navy-deep', '--navy-mid', '--green', '--green-dark', '--paper', '--paper-dim', '--line', '--ink', '--ink-soft',
  '--white', '--muted', '--amber', '--cork', '--court', '--court-dark', '--court-line', '--radius', '--card-shadow',
];

const LIB = path.join(SITE_ROOT, 'lib', 'v1');
const read = dir => (fs.existsSync(path.join(LIB, dir))
  ? fs.readdirSync(path.join(LIB, dir)).filter(f => f.endsWith(dir === 'css' ? '.css' : '.js')).map(f => ({ rel: `${dir}/${f}`, text: fs.readFileSync(path.join(LIB, dir, f), 'utf8') }))
  : []);

const css = read('css');

/** The schedule board's own palette: listed in a block at the top of css/schedule-board.css. */
function boardContract() {
  const board = css.find(f => f.rel === 'css/schedule-board.css');
  if (!board) return [];
  const block = board.text.match(/THEME CONTRACT[\s\S]*?\*\//);
  return block ? [...block[0].matchAll(/--[a-z0-9-]+/g)].map(m => m[0]) : [];
}

test('every custom property the engine CSS reads is in the contract, or set by the engine itself', () => {
  const listed = new Set([...CONTRACT, ...boardContract()]);
  const setByEngine = new Set();
  for (const f of [...css, ...read('views'), ...read('apps'), ...read('data')]) {
    for (const m of f.text.matchAll(/(--[a-z0-9-]+)\s*:/g)) setByEngine.add(m[1]);
  }
  const stray = [];
  for (const f of css) {
    for (const m of f.text.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
      if (!listed.has(m[1]) && !setByEngine.has(m[1])) stray.push(`${f.rel}: ${m[1]}`);
    }
  }
  assert.deepEqual([...new Set(stray)], [], 'a theme property the shells do not know about');
});

test('the contract is the one the templates and Control Center define', () => {
  for (const rel of ['tools/control-center.html', '_templates/standard-tournament-template/index.html', '_templates/dual-meet-template/index.html']) {
    const text = fs.readFileSync(path.join(SITE_ROOT, rel), 'utf8');
    const root = text.match(/:root\s*\{[\s\S]*?\n\s*\}/);
    assert.ok(root, `${rel} has a :root block`);
    for (const name of CONTRACT) assert.ok(root[0].includes(name + ':') || root[0].includes(name + ' :'), `${rel} defines ${name}`);
  }
});
