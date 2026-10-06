// Comparing two captures of one case (site-engine-spec §6.4): the text of the
// root and the pixels of the full-page screenshot.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { OUT_DIR } from './paths.mjs';

/** A unified diff of two texts, or '' when equal. */
export function textDiff(a, b) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dir = fs.mkdtempSync(path.join(OUT_DIR, 'diff-'));
  const fa = path.join(dir, 'a.txt'), fb = path.join(dir, 'b.txt');
  fs.writeFileSync(fa, a);
  fs.writeFileSync(fb, b);
  try {
    execFileSync('git', ['diff', '--no-index', '--no-color', '--', fa, fb], { encoding: 'utf8' });
    return '';
  } catch (err) {
    return err.stdout || String(err);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * `{ differing: 0 }` when the screenshots are identical, `{ differing: n, diff }`
 * (a diff image) when n pixels differ, `{ differing: -1, size }` when they differ in size.
 */
export function comparePng(a, b) {
  if (Buffer.compare(a, b) === 0) return { differing: 0 };
  const pa = PNG.sync.read(a), pb = PNG.sync.read(b);
  if (pa.width !== pb.width || pa.height !== pb.height) {
    return { differing: -1, size: [[pa.width, pa.height], [pb.width, pb.height]] };
  }
  const diff = new PNG({ width: pa.width, height: pa.height });
  const differing = pixelmatch(pa.data, pb.data, diff.data, pa.width, pa.height, { threshold: 0 });
  return { differing, diff: differing ? PNG.sync.write(diff) : undefined };
}

/** Compare two `runCase` results: `{ textSame, pixelsSame, png }`. */
export function compareResults(base, branch) {
  const png = comparePng(base.png, branch.png);
  return { textSame: base.text === branch.text, pixelsSame: png.differing === 0, png };
}
