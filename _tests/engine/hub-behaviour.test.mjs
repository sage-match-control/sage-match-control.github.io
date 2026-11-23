// What the Tournament Hub does when it is scrolled and tapped (hub-player-experience-spec §2.4).
// The comparison harness's screenshots are full-page: the viewport grows to the page's height, so nothing is ever
// scrolled. This file opens a harness case at its real viewport (375 × 812 on a phone, 1280 × 800 on a computer)
// and asserts on the live page. `npm run compare` runs it with the rest of engine/.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SITE_ROOT } from '../helpers/paths.mjs';
import { launchBrowser, openPage, settle } from '../helpers/browser.mjs';
import { startSite } from '../helpers/server.mjs';
import { buildCases } from './cases.mjs';

const cases = buildCases();

/** Open a harness case; with runSteps, also run its steps (open a tab, pick a category…). `storage` adds to the case's. */
async function openCase(browser, site, id, { runSteps = false, storage = {} } = {}) {
  const c = cases.find(x => x.id === id);
  assert.ok(c, `no harness case ${id}`);
  site.register(c.id, c.instantiate);
  const h = await openPage(browser, site.baseUrl + c.path, {
    viewport: c.viewport, time: c.time, registry: c.registry, snapshots: c.snapshots,
    fixtureFiles: c.fixtureFiles, external: c.external, cloudRun: c.cloudRun,
    allowErrors: c.allowErrors, storage: { ...c.storage, ...storage }, caseId: c.id,
  });
  await settle(h.page);
  if (runSteps) for (const s of c.steps) { await s.run(h.page, h); await settle(h.page); }
  return h;
}

/** Type into the search box one key at a time, so the page's input handlers fire. */
async function typeInto(page, text) {
  const input = page.locator('#teamInput');
  await input.click();
  await input.fill('');
  await input.pressSequentially(text, { delay: 10 });
}

const resultsTop = page => page.evaluate(() => document.getElementById('results').getBoundingClientRect().top);
const scrollY = page => page.evaluate(() => window.scrollY);
const searchIsFocused = page => page.evaluate(() => document.activeElement === document.getElementById('teamInput'));
const suggestionsOpen = page => page.evaluate(() => document.getElementById('acList').classList.contains('show'));

describe('the Hub on a phone', () => {
  let browser, site;
  before(async () => { browser = await launchBrowser(); site = await startSite({ root: SITE_ROOT }); });
  after(async () => { await browser.close(); await site.close(); });

  /** Open a case, run `fn(h)`, and close the page whatever happens; the page's own errors fail the test. */
  async function withPage(id, options, fn) {
    const h = await openCase(browser, site, id, options);
    try {
      await fn(h);
      assert.deepEqual(h.errors, [], 'the page logged errors');
    } finally {
      await h.close();
    }
  }

  const STD_PHONE = 'std-index/pickle-for-sight-2026/finder/mid/phone';
  const TEAM_PHONE = 'team-index/pickledrive-anniversary-2026/finder/mid/phone';

  // ---- step 1: a search shows its results ----

  it('picking a suggestion scrolls to the results and closes the keyboard and the suggestions', async () => {
    await withPage(STD_PHONE, {}, async ({ page }) => {
      assert.ok(await resultsTop(page) > 300, 'before a search the results are far down the first screen');
      await typeInto(page, 'Josh');
      assert.equal(await suggestionsOpen(page), true, 'typing opens the suggestions');
      await page.locator('#acList .ac-item').first().click();
      await settle(page);
      const top = await resultsTop(page);
      assert.ok(top >= 0 && top <= 300, `the results start at ${top}px`);
      assert.equal(await searchIsFocused(page), false, 'the box is blurred');
      assert.equal(await suggestionsOpen(page), false, 'the suggestions are closed');
    });
  });

  it('Find matches does the same', async () => {
    await withPage(STD_PHONE, {}, async ({ page }) => {
      await typeInto(page, 'Josh Manarang');
      await page.locator('#searchBtn').click();
      await settle(page);
      const top = await resultsTop(page);
      assert.ok(top >= 0 && top <= 300, `the results start at ${top}px`);
      assert.equal(await searchIsFocused(page), false);
      assert.equal(await suggestionsOpen(page), false);
    });
  });

  it('Enter in the box does the same', async () => {
    await withPage(STD_PHONE, {}, async ({ page }) => {
      await typeInto(page, 'Josh Manarang');
      await page.keyboard.press('Enter');
      await settle(page);
      const top = await resultsTop(page);
      assert.ok(top >= 0 && top <= 300, `the results start at ${top}px`);
      assert.equal(await searchIsFocused(page), false);
    });
  });

  it('the results stop just under the pinned search box', async () => {
    await withPage(STD_PHONE, {}, async ({ page }) => {
      await typeInto(page, 'Josh Manarang');
      await page.locator('#searchBtn').click();
      await settle(page);
      const gap = await page.evaluate(() => document.getElementById('results').getBoundingClientRect().top - document.getElementById('searchPanel').getBoundingClientRect().bottom);
      assert.ok(gap >= 0 && gap <= 16, `the gap under the search box is ${gap}px`);
    });
  });

  it('clearing the box does not scroll', async () => {
    await withPage(STD_PHONE, {}, async ({ page }) => {
      await typeInto(page, 'Josh Manarang');
      await page.locator('#searchBtn').click();
      await settle(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => document.getElementById('clearInputBtn').click());
      await settle(page);
      assert.equal(await scrollY(page), 0);
    });
  });

  it('a team event’s team chip shows the results too', async () => {
    await withPage(TEAM_PHONE, {}, async ({ page }) => {
      await page.locator('.team-chip-btn').first().click();
      await settle(page);
      const top = await resultsTop(page);
      assert.ok(top >= 0 && top <= 300, `the results start at ${top}px`);
    });
  });

  it('a saved search on a returning visit scrolls to the results when Match Finder is the open tab', async () => {
    await withPage(STD_PHONE, { storage: { local: { 'pickle-for-sight-2026.search': 'Josh Manarang' } } }, async ({ page }) => {
      assert.equal(await page.locator('.view-tab[data-view="finder"].active').count(), 1);
      assert.ok(await page.locator('#results .ticket').count() > 0, 'the saved search is restored');
      const top = await resultsTop(page);
      assert.ok(top >= 0 && top <= 300, `the results start at ${top}px`);
    });
  });

  it('a saved search does not scroll when another tab is the open one', async () => {
    await withPage(STD_PHONE, { storage: { local: { 'pickle-for-sight-2026.search': 'Josh Manarang', 'pickle-for-sight-2026.view': 'standings' } } }, async ({ page }) => {
      assert.equal(await page.locator('.view-tab[data-view="standings"].active').count(), 1);
      assert.equal(await scrollY(page), 0);
    });
  });
});

describe('the Hub on a computer', () => {
  let browser, site;
  before(async () => { browser = await launchBrowser(); site = await startSite({ root: SITE_ROOT }); });
  after(async () => { await browser.close(); await site.close(); });

  const STD_DESKTOP = 'std-index/pickle-for-sight-2026/finder/mid/desktop';
  const TEAM_DESKTOP = 'team-index/pickledrive-anniversary-2026/finder/mid/desktop';

  it('a search closes the suggestions but does not scroll', async () => {
    const h = await openCase(browser, site, STD_DESKTOP);
    try {
      const { page } = h;
      await typeInto(page, 'Josh');
      const before = await scrollY(page);
      await page.locator('#acList .ac-item').first().click();
      await settle(page);
      assert.equal(await scrollY(page), before);
      assert.equal(await suggestionsOpen(page), false);
      await typeInto(page, 'Josh Manarang');
      await page.locator('#searchBtn').click();
      await settle(page);
      assert.equal(await scrollY(page), before);
      assert.equal(await suggestionsOpen(page), false, 'Find matches closes the suggestions here too');
      assert.deepEqual(h.errors, []);
    } finally {
      await h.close();
    }
  });

  it('a team chip still scrolls to the top of the page', async () => {
    const h = await openCase(browser, site, TEAM_DESKTOP);
    try {
      const { page } = h;
      await page.evaluate(() => window.scrollTo(0, 400));
      assert.equal(await scrollY(page), 400);
      await page.locator('.team-chip-btn').first().evaluate(el => el.click());
      await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 5000 });
      assert.equal(await scrollY(page), 0);
      assert.deepEqual(h.errors, []);
    } finally {
      await h.close();
    }
  });
});
