// The prize draw page (sage-docs/docs/specs/.../prize-draw-spec.md §5): one module script that takes its rules from
// the engine, keeps no copy of them, and has the elements the spec names.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT } from '../../helpers/paths.mjs';
import { stripComments } from '../../helpers/extract.mjs';
import * as draw from '../../../lib/v1/domain/prize-draw.js';

const page = fs.readFileSync(path.join(SITE_ROOT, 'tools/prize-draw.html'), 'utf8');
const script = page.slice(page.indexOf('<script type="module">'), page.indexOf('</script>', page.indexOf('<script type="module">')));
// Every name the script declares, indented or not: function declarations and const/let/var bindings.
const declared = code => new Set([...code.matchAll(/\b(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/g)]
  .map(m => m[1] || m[2]));

test('one inline script, a module, importing only root-absolute engine paths', () => {
  const inline = [...page.matchAll(/<script\b([^>]*)>/g)].map(m => m[1].trim()).filter(a => !/\bsrc=/.test(a));
  assert.deepEqual(inline, ['type="module"']);
  const froms = [...script.matchAll(/from\s+'([^']+)'/g)].map(m => m[1]);
  assert.ok(froms.includes('/lib/v1/domain/prize-draw.js'));
  for (const f of froms) assert.ok(f.startsWith('/lib/v1/'), f);
});

test('declares nothing the draw module exports', () => {
  const mine = declared(stripComments(script));
  for (const name of Object.keys(draw)) assert.ok(!mine.has(name), `the page declares ${name}`);
});

test('draws winners with drawWinners over SHA-256, and uses Math.random only for show', () => {
  const code = stripComments(script);
  assert.match(code, /drawWinners\(\{[^}]*sha256Hex/);
  const uses = (code.match(/Math\.random\(\)/g) || []).length;
  assert.ok(uses <= 6, `Math.random() appears ${uses} times: only the reel's filler rows and the jar's physics may use it`);
});

test('has every element the spec names, and no seed box', () => {
  const ids = ['eventLine', 'howBtn', 'displayBtn', 'bigBtn', 'styleReel', 'styleJar', 'reel', 'reelStrip', 'jar',
    'displayStatus', 'reveal', 'spinBtn', 'seedLine', 'titleInput', 'eventSelect', 'daySelect', 'facilitySelect',
    'srcPaste', 'srcPlayers', 'srcCheckedIn', 'srcNumbers', 'loadPlayersBtn', 'loadCheckedInBtn', 'numberCount',
    'fillNumbersBtn', 'namesInput', 'namesCount', 'namesProblems', 'prizeRows', 'addPrizeBtn', 'prizesCount',
    'prizeProblems', 'removeWinners', 'showTickets', 'lockBtn', 'unlockBtn', 'editListBtn', 'newDrawBtn',
    'winnersList', 'copyBtn', 'txtBtn', 'pngBtn', 'listBtn', 'checkBtn', 'checkResult', 'howDialog', 'toast'];
  for (const id of ids) assert.match(page, new RegExp(`id="${id}"`), id);
  assert.doesNotMatch(page, /id="seedInput"/);
  assert.match(page, /<title>Prize draw · S\.A\.G\.E\.<\/title>/);
  assert.match(page, /LUCKY DINK/);
  assert.match(page, /No Rigging Zone/);
  assert.match(page, /Draw again/);
  assert.doesNotMatch(page, /Big Dill/i);
  assert.doesNotMatch(page, /\babsent\b/i);
});
