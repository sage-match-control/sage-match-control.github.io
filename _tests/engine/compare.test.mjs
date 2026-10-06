// The comparison harness (site-engine-spec §6): run every case on the baseline
// tree and on the branch tree and compare the text and the pixels.
//
//   npm run compare                  every case
//   CASE='std-index/.*/live' npm run compare     only the cases whose id matches
//   BASE=<commit> npm run compare    another baseline than the merge-base with main
//   CONCURRENCY=2 npm run compare    pages open at once (default 4)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT, OUT_DIR } from '../helpers/paths.mjs';
import { checkoutBaseline } from '../helpers/baseline.mjs';
import { launchBrowser } from '../helpers/browser.mjs';
import { startSite } from '../helpers/server.mjs';
import { runCase } from '../helpers/runCase.mjs';
import { compareResults, textDiff } from '../helpers/compare.mjs';
import { buildCases } from './cases.mjs';
import { ACCEPTED } from './accepted.mjs';

const filter = process.env.CASE ? new RegExp(process.env.CASE) : null;
const cases = buildCases().filter(c => !filter || filter.test(c.id));
const concurrency = Number(process.env.CONCURRENCY || 4);
const RERUNS = 2;
// Windows briefly running out of socket buffers is the machine's, not the page's.
const TRANSIENT = /ERR_NO_BUFFER_SPACE|ERR_CONNECTION_(RESET|CLOSED|REFUSED)/;

const safeName = id => id.replace(/[^\w.-]+/g, '__');

describe('engine compare: baseline vs branch', { concurrency }, () => {
  let baseline, browser, baseSite, branchSite;
  before(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    baseline = checkoutBaseline();
    browser = await launchBrowser();
    baseSite = await startSite({ root: baseline.dir });
    branchSite = await startSite({ root: SITE_ROOT });
    console.log(`baseline ${baseline.commit} · ${cases.length} cases · concurrency ${concurrency}`);
  });
  after(async () => {
    if (browser) await browser.close();
    if (baseSite) await baseSite.close();
    if (branchSite) await branchSite.close();
    if (baseline) baseline.remove();
  });

  for (const c of cases) {
    it(c.id, async () => {
      let [base, branch] = await Promise.all([runCase(browser, baseSite, c), runCase(browser, branchSite, c)]);

      // Anti-aliasing can differ by 1/255 on a few pixels from one run to the next (the same tree twice
      // does it too). A difference in the pixels alone is run again; a real one is still there.
      for (let again = 0; again < RERUNS; again++) {
        const r = compareResults(base, branch);
        const errors = [...base.errors, ...branch.errors];
        if (errors.some(e => !TRANSIENT.test(e))) break;               // a real page error
        if (!errors.length && (r.pixelsSame || !r.textSame || ACCEPTED.some(a => a.case.test(c.id)))) break;    // nothing to retry, or a real text difference
        [base, branch] = await Promise.all([runCase(browser, baseSite, c), runCase(browser, branchSite, c)]);
      }

      const problems = [];
      for (const [tree, r] of [['baseline', base], ['branch', branch]]) {
        for (const e of r.errors) problems.push(`${tree} page error: ${e}`);
      }

      const { textSame, pixelsSame, png } = compareResults(base, branch);

      const accepted = ACCEPTED.filter(a => a.case.test(c.id));
      const kindOk = k => accepted.some(a => a.kind === 'both' || a.kind === k);
      if (!textSame && !kindOk('text')) problems.push('the text differs');
      if (!pixelsSame && !kindOk('pixels')) problems.push(png.differing === -1 ? `the screenshots differ in size: ${JSON.stringify(png.size)}` : `${png.differing} pixels differ`);

      if (problems.length) {
        const dir = path.join(OUT_DIR, safeName(c.id));
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'baseline.png'), base.png);
        fs.writeFileSync(path.join(dir, 'branch.png'), branch.png);
        if (png.diff) fs.writeFileSync(path.join(dir, 'diff.png'), png.diff);
        fs.writeFileSync(path.join(dir, 'baseline.txt'), base.text);
        fs.writeFileSync(path.join(dir, 'branch.txt'), branch.text);
        fs.writeFileSync(path.join(dir, 'text.diff'), textDiff(base.text, branch.text));
        assert.fail(`${problems.join('; ')}\n  written to ${dir}`);
      }
      if (accepted.length && (!textSame || !pixelsSame)) console.log(`accepted: ${c.id} (§12 rows ${accepted.map(a => a.row).join(', ')})`);
    });
  }
});
