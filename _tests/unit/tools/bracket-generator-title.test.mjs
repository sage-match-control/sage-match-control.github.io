// The bracket generator's exported image fits a long category title instead of
// cutting it off with an ellipsis: the largest size from TITLE_MAX_PX down to
// TITLE_MIN_PX that fits on one line, else two lines split where they come out
// most even (sage-docs/docs/specs/.../bracket-generator-spec.md, the image export).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT } from '../../helpers/paths.mjs';
import { extractFunction, extractConst } from '../../helpers/extract.mjs';

const page = fs.readFileSync(path.join(SITE_ROOT, 'tools/bracket-generator.html'), 'utf8');

const source = [
  extractConst(page, 'TITLE_MAX_PX').text,
  extractConst(page, 'TITLE_MIN_PX').text,
  extractConst(page, 'titleFont').text,
  extractFunction(page, 'truncateToWidth'),
  extractFunction(page, 'fitTitle'),
].join('\n');
const fitTitle = new Function(`${source}\nreturn fitTitle;`)();

// A stand-in canvas context: every character is 0.8em wide at the font's size.
function fakeCtx() {
  return {
    font: '',
    measureText(s) {
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)[1]);
      return { width: s.length * px * 0.8 };
    },
  };
}
const widthAt = (s, px) => s.length * px * 0.8;
const MAX_WIDTH = 880; // the export's width - 120

test('a title that fits stays one line at the full size', () => {
  const r = fitTitle(fakeCtx(), 'GEN X NOVICE MEN\'S DOUBLES', MAX_WIDTH);
  assert.deepEqual(r, { px: 38, lines: ['GEN X NOVICE MEN\'S DOUBLES'] });
});

test('a longer title shrinks to the largest size that fits on one line', () => {
  const t = 'NEXT GEN INTERMEDIATE WOMEN\'S DOUBLES'; // 36 chars: 38px is too wide, 30px fits
  const r = fitTitle(fakeCtx(), t, MAX_WIDTH);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0], t);
  assert.ok(r.px < 38 && r.px >= 28, `px ${r.px}`);
  assert.ok(widthAt(t, r.px) <= MAX_WIDTH);
  assert.ok(widthAt(t, r.px + 1) > MAX_WIDTH, 'not the largest size that fits');
});

test('a title too long for one line at the smallest size goes onto two even lines, never cut', () => {
  const t = 'NEXT GEN HIGH INTERMEDIATE MIXED DOUBLES PLUS'; // too wide at 28px on one line
  assert.ok(widthAt(t, 28) > MAX_WIDTH);
  const r = fitTitle(fakeCtx(), t, MAX_WIDTH);
  assert.equal(r.lines.length, 2);
  assert.equal(r.lines.join(' '), t);
  for (const l of r.lines) assert.ok(widthAt(l, r.px) <= MAX_WIDTH, l);
  assert.ok(!r.lines.some(l => l.includes('…')));
  // The most even split of these words.
  assert.deepEqual(r.lines, ['NEXT GEN HIGH INTERMEDIATE', 'MIXED DOUBLES PLUS']);
});

test('a single word wider than the image is the only thing still cut', () => {
  const r = fitTitle(fakeCtx(), 'X'.repeat(60), MAX_WIDTH);
  assert.equal(r.lines.length, 1);
  assert.ok(r.lines[0].endsWith('…'));
});

test('the image export lays the title out with fitTitle, not truncateToWidth', () => {
  const exportSrc = extractFunction(page, 'exportAsImage');
  assert.match(exportSrc, /fitTitle\(/);
  assert.doesNotMatch(exportSrc, /truncateToWidth\([^)]*currentCategory/);
});
