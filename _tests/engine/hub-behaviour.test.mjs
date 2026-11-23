// What the Tournament Hub does when it is scrolled and tapped (hub-player-experience-spec §2.4): steps 1 (a search shows
// its results), 3 (the bar the banner folds into), 5 (a Standings row opens that pair in Match Finder), 8 (a dual meet's
// category chips).
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
      // The banner no longer fills a phone's first screen (it never shows there), so the results already start
      // near the top; the search still has to land them just under the search box, with the keyboard closed.
      const panelBottom = await page.evaluate(() => document.getElementById('searchPanel').getBoundingClientRect().bottom);
      assert.ok(await resultsTop(page) >= panelBottom, 'before a search the results start below the search box');
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

// ---- step 3: the bar the banner folds into ----------------------------------------------------------------------
// On a phone the banner never shows and the bar is always there; on a computer the banner shows until the reader
// folds it with its chevron, and the bar then stands in its place (kept in this browser).

// The bar is two rows and its height follows its title (a phone's can wrap): measured, never assumed.
const barHeight = page => page.evaluate(() => Math.round(document.querySelector('.hub-bar').getBoundingClientRect().height));

/** The bar's two rows: the title row, then the second row (a phone's menu button, a computer's row of tabs) under it;
 *  the title whole, never cut off; and --hub-bar-h on <html> the bar's own height, for everything under it. */
async function assertTwoRows(page, second) {
  const r = await page.evaluate(sel => {
    const box = el => el.getBoundingClientRect();
    const title = document.querySelector('.hub-bar-title');
    return {
      titleBottom: box(title).bottom, secondTop: box(document.querySelector(sel)).top,
      clipped: title.scrollWidth > title.clientWidth + 1,
      bar: Math.round(box(document.querySelector('.hub-bar')).height),
      cssHeight: getComputedStyle(document.documentElement).getPropertyValue('--hub-bar-h').trim(),
    };
  }, second);
  assert.ok(r.secondTop >= r.titleBottom, `the second row (${second}) is under the title (${r.secondTop} vs ${r.titleBottom})`);
  assert.equal(r.clipped, false, 'the title is whole');
  assert.equal(r.cssHeight, `${r.bar}px`, '--hub-bar-h is the bar’s height');
}

const titleLines = page => page.evaluate(() => {
  const t = document.querySelector('.hub-bar-title');
  return Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight));
});
const HUB_FOLDED = { local: { 'sage.hub.bannerFolded': '1' } };
const CC_FOLDED = { local: { 'sage.controlCenter.bannerFolded': '1' } };
const barVisible = page => page.locator('.hub-bar').isVisible();
const heroVisible = page => page.locator('header.hero').isVisible();
const scrollTo = async (page, y) => { await page.evaluate(top => window.scrollTo(0, top), y); await settle(page); };
const topOf = (page, selector) => page.evaluate(sel => document.querySelector(sel).getBoundingClientRect().top, selector);
// textContent, not innerText: the bar sets its text in capitals with CSS, and the spec’s labels are the tabs’ own.
const texts = (page, selector) => page.locator(selector).evaluateAll(list => list.map(el => el.textContent.trim()));
const textOf = (page, selector) => page.locator(selector).first().evaluate(el => el.textContent.trim());
const activeIn = (page, selector) => page.locator(`${selector}.active`).count();
const barOn = page => page.evaluate(() => document.body.classList.contains('hub-bar-on'));
const stored = (page, key) => page.evaluate(k => localStorage.getItem(k), key);

/** Open a harness case and run `fn(h)`, closing the page whatever happens; the page's own errors fail the test. */
async function withCase(browser, site, id, options, fn) {
  const h = await openCase(browser, site, id, options);
  try {
    await fn(h);
    assert.deepEqual(h.errors, [], 'the page logged errors');
  } finally {
    await h.close();
  }
}

describe('the bar on a phone', () => {
  let browser, site;
  before(async () => { browser = await launchBrowser(); site = await startSite({ root: SITE_ROOT }); });
  after(async () => { await browser.close(); await site.close(); });
  const withPage = (id, options, fn) => withCase(browser, site, id, options, fn);

  const STD_PHONE = 'std-index/pickle-for-sight-2026/finder/mid/phone';
  const TEAM_PHONE = 'team-index/pickledrive-anniversary-2026/finder/mid/phone';
  const DM_STANDINGS_PHONE = 'dm-index/pnf-x-bup-dual-meet/standings/mid/phone';

  it('is always there, pinned to the top, and the banner never shows', async () => {
    await withPage(STD_PHONE, {}, async ({ page }) => {
      assert.equal(await page.locator('.hub-bar').count(), 1, 'the bar is made once');
      assert.equal(await heroVisible(page), false, 'no banner at the top of the page');
      assert.equal(await barVisible(page), true, 'the bar shows without scrolling');
      assert.equal(await barOn(page), true);
      assert.equal(await page.locator('.hub-bar-btn').isVisible(), true, 'a phone has the menu button');
      assert.equal(await page.locator('.hub-bar-row').isVisible(), false, 'and no row');
      assert.equal(await page.locator('.hub-fold-btn').isVisible(), false, 'and no chevron');
      assert.equal(await page.locator('.hub-bar-fold').isVisible(), false);
      assert.equal(await textOf(page, '.hub-bar-btn-label'), 'Match Finder');
      assert.equal(await topOf(page, '.hub-bar'), 0, 'pinned to the top of the screen');
      await assertTwoRows(page, '.hub-bar-btn');
      assert.equal(await titleLines(page), 1, 'a title that fits keeps one line');
      const widths = await page.evaluate(() => [document.querySelector('.hub-bar-btn').getBoundingClientRect().width, document.querySelector('.hub-bar').clientWidth]);
      assert.ok(widths[0] >= widths[1] - 24 - 1, `the menu button spans the bar (${widths[0]} of ${widths[1]})`);
      assert.equal(await page.locator('.hub-bar-pday').isVisible(), false, 'a one-day event has no day pill');
      const panelTop = await topOf(page, '#searchPanel');
      assert.ok(panelTop >= (await barHeight(page)), `the page starts under the bar (search box at ${panelTop}px)`);
      await scrollTo(page, 1500);
      assert.equal(await barVisible(page), true);
      assert.equal(await topOf(page, '.hub-bar'), 0);
      await scrollTo(page, 0);
      assert.equal(await barVisible(page), true, 'and still there back at the top');
      assert.equal(await heroVisible(page), false);
    });
  });

  it('a reader who folded the banner on a computer gets the same bar on a phone, and no chevron', async () => {
    await withPage(STD_PHONE, { storage: HUB_FOLDED }, async ({ page }) => {
      assert.equal(await barVisible(page), true);
      assert.equal(await heroVisible(page), false);
      assert.equal(await page.locator('.hub-bar-fold').isVisible(), false);
    });
  });

  it('carries the logo, the date and venue line and the title', async () => {
    await withPage(STD_PHONE, {}, async ({ page }) => {
      assert.match((await page.locator('.hub-bar-meta').innerText()).trim(), /^Sep 27\s+·\s+PCPH Main$/i);
      assert.equal((await page.locator('.hub-bar-title').innerText()).trim().toLowerCase(), 'pickle for sight');
      assert.equal(await page.locator('.hub-bar-logo').getAttribute('src'), await page.locator('header.hero .hero-logos img').first().getAttribute('src'));
    });
  });

  it('the button opens a menu of the tabs; a tab closes it, switches the view and scrolls to its panel', async () => {
    await withPage(STD_PHONE, {}, async ({ page }) => {
      await page.locator('.hub-bar-btn').click();
      assert.equal(await page.locator('#hubMenu').isVisible(), true);
      assert.equal(await page.locator('.hub-menu-scrim').isVisible(), true);
      assert.equal(await page.locator('.hub-bar-btn').getAttribute('aria-expanded'), 'true');
      assert.deepEqual(await texts(page, '.hub-menu-tab'), ['Match Finder', 'Live Matches', 'Standings']);
      assert.equal(await activeIn(page, '.hub-menu-tab'), 1);
      assert.equal(await textOf(page, '.hub-menu-tab.active'), 'Match Finder');
      assert.equal(await page.locator('#hubMenu .hub-menu-day').count(), 0, 'a one-day event has no day picker');
      assert.equal(await page.locator('#hubMenu .hub-menu-picker').count(), 0, 'the Hub has no other picker');
      assert.match(await page.locator('#hubMenu .hub-menu-sync').innerText(), /last synced/);

      await page.locator('.hub-menu-tab', { hasText: 'Standings' }).click();
      await settle(page);
      assert.equal(await page.locator('#hubMenu').isVisible(), false, 'the menu closes');
      assert.equal(await page.locator('.hub-menu-scrim').isVisible(), false);
      assert.equal(await activeIn(page, '.view-tab[data-view="standings"]'), 1, 'the banner’s tab is the open one');
      assert.equal(await textOf(page, '.hub-bar-btn-label'), 'Standings');
      // It scrolled the panel to just under the bar, or as near as the page allows: this fixture’s Standings are short.
      const { y, reachable, panelAbs } = await page.evaluate(() => ({
        y: window.scrollY,
        reachable: document.documentElement.scrollHeight - window.innerHeight,
        panelAbs: document.getElementById('standingsResults').getBoundingClientRect().top + window.scrollY,
      }));
      const wanted = Math.max(0, Math.min(panelAbs - (await barHeight(page)) - 8, reachable));
      assert.ok(Math.abs(y - wanted) <= 1, `scrolled to ${y}, wanted ${wanted} (the panel is ${panelAbs}px down the page)`);
      // remembered, as a click on the banner's tab remembers it
      assert.equal(await page.evaluate(() => localStorage.getItem('pickle-for-sight-2026.view')), 'standings');
    });
  });

  it('Escape, the scrim and the button each close an open menu, and Escape returns focus to the button', async () => {
    await withPage(STD_PHONE, {}, async ({ page }) => {
      const menu = page.locator('#hubMenu');
      await page.locator('.hub-bar-btn').click();
      assert.equal(await menu.isVisible(), true);
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains('hub-menu-tab')), true, 'focus moves to the first tab');
      await page.keyboard.press('Escape');
      assert.equal(await menu.isVisible(), false);
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains('hub-bar-btn')), true);
      assert.equal(await page.locator('.hub-bar-btn').getAttribute('aria-expanded'), 'false');
      await page.locator('.hub-bar-btn').click();
      await page.locator('.hub-menu-scrim').click({ position: { x: 20, y: 600 } });
      assert.equal(await menu.isVisible(), false, 'the scrim closes it');
      await page.locator('.hub-bar-btn').click();
      await page.locator('.hub-bar-btn').click();
      assert.equal(await menu.isVisible(), false, 'the button toggles it');
    });
  });

  it('widening to a computer closes an open menu and brings the banner back (not folded there)', async () => {
    await withPage(STD_PHONE, {}, async ({ page }) => {
      await page.locator('.hub-bar-btn').click();
      assert.equal(await page.locator('#hubMenu').isVisible(), true);
      await page.setViewportSize({ width: 1280, height: 800 });
      await settle(page);
      assert.equal(await page.locator('#hubMenu').isVisible(), false);
      assert.equal(await barVisible(page), false, 'a computer shows the banner until it is folded');
      assert.equal(await heroVisible(page), true);
      assert.equal(await barOn(page), false);
      await page.setViewportSize({ width: 375, height: 812 });
      await settle(page);
      assert.equal(await barVisible(page), true, 'and narrowing again brings the bar back');
      assert.equal(await heroVisible(page), false);
    });
  });

  it('the search box pins under the bar', async () => {
    await withPage(STD_PHONE, {}, async ({ page }) => {
      await scrollTo(page, 1500);
      const panelTop = await topOf(page, '#searchPanel');
      const want = (await barHeight(page)) + 8;
      assert.ok(Math.abs(panelTop - want) <= 1, `the search box is ${panelTop}px from the top, not ${want}px`);
    });
  });

  it('a team event’s menu has four tabs', async () => {
    await withPage(TEAM_PHONE, {}, async ({ page }) => {
      assert.equal(await barVisible(page), true);
      await page.locator('.hub-bar-btn').click();
      assert.equal((await texts(page, '.hub-menu-tab')).length, 4);
      assert.equal(await activeIn(page, '.hub-menu-tab'), 1);
    });
  });

  it('a dual meet’s club score bar pins under the bar, not at the top of the screen', async () => {
    await withPage(DM_STANDINGS_PHONE, { runSteps: true }, async ({ page }) => {
      await scrollTo(page, 1200);
      assert.equal(await barVisible(page), true);
      const clubTop = await topOf(page, '#standingsBody .club-summary');
      assert.ok(Math.abs(clubTop - (await barHeight(page))) <= 1, `the club bar is ${clubTop}px from the top`);
    });
  });
});

describe('the bar on a computer', () => {
  let browser, site;
  before(async () => { browser = await launchBrowser(); site = await startSite({ root: SITE_ROOT }); });
  after(async () => { await browser.close(); await site.close(); });
  const withPage = (id, options, fn) => withCase(browser, site, id, options, fn);

  const STD_DESKTOP = 'std-index/pickle-for-sight-2026/finder/mid/desktop';

  it('shows the banner with a chevron, and no bar, however far the page scrolls', async () => {
    await withPage(STD_DESKTOP, {}, async ({ page }) => {
      assert.equal(await heroVisible(page), true);
      assert.equal(await barVisible(page), false);
      assert.equal(await page.locator('header.hero .hub-fold-btn').isVisible(), true, 'the banner has its chevron');
      assert.equal(await page.locator('.hub-fold-btn').getAttribute('aria-label'), 'Fold the banner');
      await scrollTo(page, 900);
      assert.equal(await barVisible(page), false, 'scrolling the banner away brings no bar');
      assert.equal(await barOn(page), false);
    });
  });

  it('the chevron folds the banner into the bar, pinned at the top, and the choice is kept', async () => {
    await withPage(STD_DESKTOP, {}, async ({ page }) => {
      const qrTopAtRest = await topOf(page, '.qr-panel');
      await page.locator('.hub-fold-btn').click();
      await settle(page);
      assert.equal(await heroVisible(page), false, 'the banner is folded away');
      assert.equal(await barVisible(page), true);
      assert.equal(await topOf(page, '.hub-bar'), 0);
      assert.equal(await stored(page, 'sage.hub.bannerFolded'), '1');
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains('hub-bar-fold')), true, 'focus moves to the bar’s chevron');
      assert.equal(await page.locator('.hub-bar-btn').isVisible(), false, 'no menu button');
      assert.equal(await barHeight(page), 54, 'the Hub keeps the slim one-row bar on a computer');
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--hub-bar-h').trim()), '54px');
      const rowTop = await topOf(page, '.hub-bar-row');
      assert.ok(rowTop < 54 / 2, `the tabs sit beside the title, not under it (row top ${rowTop}px)`);
      assert.equal(await page.locator('.hub-bar-row').isVisible(), true);
      assert.equal(await page.locator('.hub-bar-row .hub-bar-tab').count(), 3);
      assert.equal(await activeIn(page, '.hub-bar-tab'), 1);
      assert.match(await page.locator('.hub-bar-sync').innerText(), /Sep 27 · Live · last synced/);
      assert.equal(await page.locator('.hub-bar-day').count(), 0, 'a one-day event has no day picker');
      const qrTop = await topOf(page, '.qr-panel');
      assert.ok(qrTop >= (await barHeight(page)), `the QR panel is ${qrTop}px from the top`);
      assert.ok(qrTopAtRest < (await barHeight(page)), 'and was higher with the banner showing');
      const panelTop = await topOf(page, '#searchPanel');
      assert.ok(panelTop >= (await barHeight(page)), `the page starts under the bar (search box at ${panelTop}px)`);
      await scrollTo(page, 900);
      assert.equal(await topOf(page, '.hub-bar'), 0, 'still pinned once the page scrolls');

      await page.reload();
      await settle(page);
      assert.equal(await barVisible(page), true, 'still folded after a reload');
      assert.equal(await heroVisible(page), false);
    });
  });

  it('the bar’s chevron brings the banner back, and that is kept too', async () => {
    await withPage(STD_DESKTOP, { storage: HUB_FOLDED }, async ({ page }) => {
      assert.equal(await barVisible(page), true);
      assert.equal(await page.locator('.hub-bar-fold').getAttribute('aria-label'), 'Show the banner');
      await page.locator('.hub-bar-fold').click();
      await settle(page);
      assert.equal(await heroVisible(page), true);
      assert.equal(await barVisible(page), false);
      assert.equal(await stored(page, 'sage.hub.bannerFolded'), '0');
      assert.equal(await page.evaluate(() => document.activeElement.classList.contains('hub-fold-btn')), true, 'focus returns to the banner’s chevron');
    });
  });

  it('a tab on the bar switches the view, on the bar and in the banner', async () => {
    await withPage(STD_DESKTOP, { storage: HUB_FOLDED }, async ({ page }) => {
      await page.locator('.hub-bar-tab', { hasText: 'Standings' }).click();
      await settle(page);
      assert.equal(await activeIn(page, '.hub-bar-tab[data-view="standings"]'), 1, 'active on the bar');
      assert.equal(await activeIn(page, '.view-tab[data-view="standings"]'), 1, 'and in the banner');
      assert.equal(await activeIn(page, '.hub-bar-tab[data-view="finder"]'), 0);
    });
  });

  it('leaves the search box to scroll away with the page', async () => {
    await withPage(STD_DESKTOP, { storage: HUB_FOLDED }, async ({ page }) => {
      await scrollTo(page, 900);
      const panelBottom = await page.evaluate(() => document.getElementById('searchPanel').getBoundingClientRect().bottom);
      assert.ok(panelBottom < 0, `the search box is above the screen (${panelBottom}px), not pinned`);
    });
  });

  it('leaves the sync line out below 1100 px and still shows the tabs at 950 px', async () => {
    await withPage(STD_DESKTOP, { storage: HUB_FOLDED }, async ({ page }) => {
      await page.setViewportSize({ width: 950, height: 800 });
      await settle(page);
      assert.equal(await page.locator('.hub-bar-sync').isVisible(), false);
      assert.equal(await page.locator('.hub-bar-row .hub-bar-tab').first().isVisible(), true);
      assert.equal(await page.locator('.hub-bar-btn').isVisible(), false);
    });
  });
});

describe('the bar at a multi-day event', () => {
  let browser, site;
  before(async () => { browser = await launchBrowser(); site = await startSite({ root: SITE_ROOT }); });
  after(async () => { await browser.close(); await site.close(); });

  /** The desktop case's registry with a second day (same facilities, the next date), and its snapshot under that day too. */
  function twoDays() {
    const c = cases.find(x => x.id === 'std-index/pickle-for-sight-2026/finder/mid/desktop');
    const registry = JSON.parse(JSON.stringify(c.registry));
    const days = registry.events['pickle-for-sight-2026'].days;
    const firstKey = Object.keys(days)[0];
    const date = new Date(Date.parse(`${days[firstKey].date}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10);
    days['pickle-for-sight-day2'] = { ...JSON.parse(JSON.stringify(days[firstKey])), label: 'Sep 28', date };
    const snapshots = JSON.parse(JSON.stringify(c.snapshots));
    snapshots['pickle-for-sight-2026']['pickle-for-sight-day2'] = snapshots['pickle-for-sight-2026'][firstKey];
    return { c, registry, snapshots };
  }

  /** Open it on its first day (saved, so the page loads it rather than waiting for a pick), or with no day yet. */
  async function openTwoDays(viewport, { local = { 'pickle-for-sight-2026.dayIndex': '0' } } = {}) {
    const { c, registry, snapshots } = twoDays();
    site.register(c.id, c.instantiate);
    const h = await openPage(browser, site.baseUrl + c.path, {
      viewport: viewport || c.viewport, time: c.time, registry, snapshots,
      fixtureFiles: c.fixtureFiles, external: c.external, cloudRun: c.cloudRun, allowErrors: c.allowErrors,
      storage: { ...c.storage, local }, caseId: c.id,
    });
    await settle(h.page);
    return h;
  }

  it('lists both days in the folded bar’s picker on a computer, and choosing the second loads it', async () => {
    const h = await openTwoDays(null, { local: { 'pickle-for-sight-2026.dayIndex': '0', 'sage.hub.bannerFolded': '1' } });
    try {
      const { page } = h;
      await scrollTo(page, 900);
      assert.equal(await barVisible(page), true);
      assert.equal(await page.locator('.hub-bar-day select').count(), 1);
      assert.deepEqual(await texts(page, '.hub-bar-day select option'), ['Sep 27', 'Sep 28'], 'the placeholder is left out');
      assert.equal(await page.locator('.hub-bar-day select').inputValue(), '0');
      await page.locator('.hub-bar-day select').selectOption('1');
      await page.waitForFunction(() => document.getElementById('dayPicker').value === '1');
      await settle(page);
      assert.equal(await page.locator('#dayPicker').inputValue(), '1');
      assert.equal(await scrollY(page), 0, 'choosing a day scrolls to the top');
      assert.match(await page.locator('#syncStatus').innerText(), /^Sep 28/);
      assert.equal(await barVisible(page), true, 'still folded once the day has loaded');
      assert.deepEqual(h.errors, []);
    } finally {
      await h.close();
    }
  });

  it('on a phone, puts the day beside the menu button, a quarter of the row, and choosing the second day loads it', async () => {
    const h = await openTwoDays({ width: 375, height: 812 });
    try {
      const { page } = h;
      assert.equal(await page.locator('.hub-bar-pday').isVisible(), true);
      const r = await page.evaluate(() => {
        const box = sel => document.querySelector(sel).getBoundingClientRect();
        return { day: box('.hub-bar-pday'), btn: box('.hub-bar-btn') };
      });
      assert.ok(Math.abs(r.day.top - r.btn.top) <= 1, 'on the same row');
      assert.ok(r.day.right <= r.btn.left, 'the day first, then the button');
      const share = r.day.width / (r.day.width + r.btn.width);
      assert.ok(share > 0.2 && share < 0.3, `the day takes about a quarter (${share.toFixed(2)})`);
      assert.equal(await textOf(page, '.hub-bar-pday-text'), 'Sep 27');
      assert.deepEqual(await texts(page, '.hub-bar-pday select option'), ['Sep 27', 'Sep 28']);
      await page.locator('.hub-bar-pday select').selectOption('1');
      await page.waitForFunction(() => document.getElementById('dayPicker').value === '1');
      await settle(page);
      assert.match(await page.locator('#syncStatus').innerText(), /^Sep 28/);
      assert.equal(await textOf(page, '.hub-bar-pday-text'), 'Sep 28', 'the pill follows');
      await assertTwoRows(page, '.hub-bar-btn');
      assert.deepEqual(h.errors, []);
    } finally {
      await h.close();
    }
  });

  it('puts the day picker in the phone’s menu', async () => {
    const h = await openTwoDays({ width: 375, height: 812 });
    try {
      const { page } = h;
      await page.locator('.hub-bar-btn').click();
      assert.equal(await page.locator('#hubMenu .hub-menu-day select').count(), 1);
      assert.deepEqual(await texts(page, '#hubMenu .hub-menu-day select option'), ['Sep 27', 'Sep 28']);
      await page.locator('#hubMenu .hub-menu-day select').selectOption('1');
      await page.waitForFunction(() => document.getElementById('dayPicker').value === '1');
      await settle(page);
      assert.equal(await page.locator('#hubMenu').isVisible(), false, 'the menu closes');
      assert.equal(await page.locator('#dayPicker').inputValue(), '1');
      assert.deepEqual(h.errors, []);
    } finally {
      await h.close();
    }
  });

  it('with no day picked before, loads the day nearest today at once (domain/initial-day.js), and keeps a picked one', async () => {
    const h = await openTwoDays({ width: 375, height: 812 }, { local: {} });
    try {
      const { page } = h;
      assert.equal(await barVisible(page), true);
      // The case's clock is on the first day's date (or nearer it than the added second day).
      assert.equal(await page.locator('#dayPicker').inputValue(), '0', 'a day is loaded without a pick');
      assert.equal(await textOf(page, '.hub-bar-pday-text'), 'Sep 27');
      assert.equal(await textOf(page, '.hub-bar-btn-label'), 'Match Finder', 'and lands on Match Finder');
      await page.locator('.hub-bar-pday select').selectOption('1');
      await page.waitForFunction(() => document.getElementById('dayPicker').value === '1');
      await settle(page);
      await page.reload();
      await settle(page);
      assert.equal(await page.locator('#dayPicker').inputValue(), '1', 'reopened, the day picked last time loads');
      assert.deepEqual(h.errors, []);
    } finally {
      await h.close();
    }
  });
});

describe('Control Center’s bar', () => {
  let browser, site;
  before(async () => { browser = await launchBrowser(); site = await startSite({ root: SITE_ROOT }); });
  after(async () => { await browser.close(); await site.close(); });
  const withPage = (id, options, fn) => withCase(browser, site, id, options, fn);

  const CC_PHONE = 'cc/pickle-for-sight-2026/mission-control/mid/phone';
  const CC_DESKTOP = 'cc/pickle-for-sight-2026/mission-control/mid/desktop';
  const CC_TEAM_DESKTOP = 'cc/pickledrive-anniversary-2026/mission-control/mid/desktop';

  it('on a phone: always there, with the event’s title, and a menu of the tabs, the event and the sync line', async () => {
    await withPage(CC_PHONE, { runSteps: true }, async ({ page }) => {
      assert.equal(await heroVisible(page), false);
      assert.equal(await barVisible(page), true);
      assert.equal(await textOf(page, '.hub-bar-meta'), 'Control Center');
      assert.equal(await textOf(page, '.hub-bar-title'), 'Pickle for Sight');
      assert.equal(await page.locator('.hub-bar-logo').getAttribute('src'), '/assets/logo.png');
      assert.equal(await textOf(page, '.hub-bar-btn-label'), 'Mission Control');
      await page.locator('.hub-bar-btn').click();
      assert.equal(await page.locator('#hubMenu').getAttribute('aria-label'), 'Control Center');
      assert.deepEqual(await texts(page, '.hub-menu-tab'), ['Mission Control', 'Awards', 'Match Finder', 'Live Matches', 'Standings']);
      assert.equal(await page.locator('#hubMenu .hub-menu-picker select').count(), 1, 'the event picker');
      assert.equal(await page.locator('#hubMenu .hub-menu-picker select').inputValue(), 'pickle-for-sight-2026');
      assert.match(await page.locator('#hubMenu .hub-menu-sync').innerText(), /last synced/);
      await page.locator('.hub-menu-tab', { hasText: 'Standings' }).click();
      await settle(page);
      assert.equal(await activeIn(page, '.view-tab[data-view="standings"]'), 1);
      assert.equal(await textOf(page, '.hub-bar-btn-label'), 'Standings');
    });
  });

  it('on a phone: choosing another event in the menu switches to it, and the bar follows', async () => {
    await withPage(CC_PHONE, { runSteps: true }, async ({ page }) => {
      await page.locator('.hub-bar-btn').click();
      await page.locator('#hubMenu .hub-menu-picker select').selectOption('pickledrive-anniversary-2026');
      await page.waitForFunction(() => document.getElementById('eventPicker').value === 'pickledrive-anniversary-2026');
      await settle(page);
      assert.equal(await page.locator('#hubMenu').isVisible(), false, 'the menu closes');
      assert.equal(await textOf(page, '.hub-bar-title'), 'PickleDrive Club One Year Celebration');
      // A long title: one line no smaller than 13 px, or, where that is too wide, two lines at its own size.
      const t = await page.evaluate(() => {
        const el = document.querySelector('.hub-bar-title');
        return { wrapped: el.classList.contains('hub-bar-title-wrap'), size: parseFloat(getComputedStyle(el).fontSize) };
      });
      if (t.wrapped) assert.equal(await titleLines(page), 2, 'wrapped onto two lines');
      else {
        assert.equal(await titleLines(page), 1);
        assert.ok(t.size >= 13 && t.size < 15, `one line, made smaller to fit (${t.size}px)`);
      }
      await assertTwoRows(page, '.hub-bar-btn');
    });
  });

  it('on a computer: the banner until it is folded; folded, the bar with every tab, kept in its own key', async () => {
    await withPage(CC_DESKTOP, { runSteps: true }, async ({ page }) => {
      assert.equal(await heroVisible(page), true);
      assert.equal(await barVisible(page), false);
      await page.locator('.hub-fold-btn').click();
      await settle(page);
      assert.equal(await heroVisible(page), false);
      assert.equal(await barVisible(page), true);
      assert.equal(await stored(page, 'sage.controlCenter.bannerFolded'), '1');
      assert.equal(await stored(page, 'sage.hub.bannerFolded'), null, 'the Hub’s choice is its own');
      assert.deepEqual(await texts(page, '.hub-bar-row .hub-bar-tab'), ['Mission Control', 'Awards', 'Match Finder', 'Live Matches', 'Standings']);
      assert.equal(await page.locator('.hub-bar.hub-bar-two').count(), 1, 'Control Center has two rows on a computer');
      await assertTwoRows(page, '.hub-bar-row');
      assert.equal(await titleLines(page), 1);
      await page.locator('.hub-bar-tab', { hasText: 'Live Matches' }).click();
      await settle(page);
      assert.equal(await activeIn(page, '.view-tab[data-view="live"]'), 1);
      assert.equal(await activeIn(page, '.hub-bar-tab[data-view="live"]'), 1);
    });
  });

  it('seven tabs at 950 px: the whole title above, the open tab in view in the row, and the chevron on screen', async () => {
    await withPage(CC_TEAM_DESKTOP, { runSteps: true, storage: CC_FOLDED }, async ({ page }) => {
      await page.setViewportSize({ width: 950, height: 800 });
      await settle(page);
      assert.equal(await page.locator('.hub-bar-row .hub-bar-tab').count(), 7);
      await page.locator('.hub-bar-tab', { hasText: 'Teams' }).click();
      await settle(page);
      const r = await page.evaluate(() => {
        const box = el => document.querySelector(el).getBoundingClientRect();
        return { title: box('.hub-bar-text').width, fold: box('.hub-bar-fold').right, row: box('.hub-bar-row'), tab: box('.hub-bar-tab.active') };
      });
      await assertTwoRows(page, '.hub-bar-row');
      assert.ok(r.fold <= 950, `the chevron ends at ${r.fold}px`);
      assert.ok(r.tab.left >= r.row.left - 1 && r.tab.right <= r.row.right + 1, 'the open tab is in view');
      const row = await page.evaluate(() => {
        const el = document.querySelector('.hub-bar-row');
        return { overflows: el.scrollWidth > el.clientWidth + 1, tight: document.querySelector('.hub-bar').classList.contains('hub-bar-tight') };
      });
      assert.equal(row.overflows && !row.tight, false, 'a row too wide for everything gives up the sync line first');
    });
  });
});

// ---- step 5: a Standings row opens that pair's matches ---------------------------------------------------------

const finderIsActive = page => page.evaluate(() => !!document.querySelector('.view-tab[data-view="finder"].active'));
const standingsHidden = page => page.evaluate(() => document.getElementById('standingsResults').style.display === 'none');
const rowPairLabel = (page, selector) => page.locator(selector).first().evaluate(tr => [...tr.querySelectorAll('td.pair > span')].map(s => s.textContent.trim()).join(' / '));

describe('a Standings row on a phone', () => {
  let browser, site;
  before(async () => { browser = await launchBrowser(); site = await startSite({ root: SITE_ROOT }); });
  after(async () => { await browser.close(); await site.close(); });

  const PHONE = 'std-index/pickle-for-sight-2026/standings-category-2/mid/phone';

  it('opens that pair in Match Finder, its summary card in view just under the pinned search box', async () => {
    await withCase(browser, site, PHONE, { runSteps: true }, async ({ page }) => {
      assert.ok(await page.locator('tr.rr-open').count() > 0, 'the named rows are marked');
      const team = await page.locator('tr.rr-open').first().getAttribute('data-team');
      assert.ok(team, 'the row names its pair');
      await page.locator('tr.rr-open').first().click();
      await settle(page);
      assert.equal(await finderIsActive(page), true, 'Match Finder is the active tab');
      assert.equal(await standingsHidden(page), true, 'Standings is hidden');
      assert.ok(await page.locator('#results .pair-summary').count() > 0, 'the summary card is drawn');
      const gap = await page.evaluate(() => document.getElementById('results').getBoundingClientRect().top - document.getElementById('searchPanel').getBoundingClientRect().bottom);
      assert.ok(gap >= 0 && gap <= 16, `the results start ${gap}px under the search box`);
      const top = await resultsTop(page);
      // As high as they can be: under the bar, the 8px above the pinned search box, the box and a 16px gap.
      const panelH = await page.evaluate(() => document.getElementById('searchPanel').getBoundingClientRect().height);
      const highest = (await barHeight(page)) + 8 + panelH + 16;
      assert.ok(top <= highest + 1, `the results start at ${top}px, no lower than ${highest}px`);
      assert.ok(await page.evaluate(() => document.querySelector('#results .pair-summary').getBoundingClientRect().bottom < innerHeight), 'the summary card is on screen');
    });
  });

  it('opens the pair the row names, in Match Finder\'s search box', async () => {
    await withCase(browser, site, PHONE, { runSteps: true }, async ({ page }) => {
      const label = await rowPairLabel(page, 'tr.rr-open');
      await page.locator('tr.rr-open').first().click();
      await settle(page);
      const value = await page.locator('#teamInput').inputValue();
      // the box holds the pair's label; its names are the row's
      label.split(' / ').forEach(name => assert.ok(value.includes(name), `"${value}" holds "${name}"`));
    });
  });

  it('Enter on a focused row does the same', async () => {
    await withCase(browser, site, PHONE, { runSteps: true }, async ({ page }) => {
      await page.locator('tr.rr-open').first().focus();
      await page.keyboard.press('Enter');
      await settle(page);
      assert.equal(await finderIsActive(page), true);
      assert.ok(await page.locator('#results .pair-summary').count() > 0);
    });
  });

  it('leaves room for the bar when the page was scrolled down (the bar showing) before the tap', async () => {
    await withCase(browser, site, PHONE, { runSteps: true }, async ({ page }) => {
      await scrollTo(page, 600);
      assert.equal(await barOn(page), true, 'the bar is showing');
      await page.locator('tr.rr-open').first().click();
      await settle(page);
      assert.ok(await page.locator('#results .pair-summary').count() > 0);
      const bottom = await page.evaluate(() => document.getElementById('searchPanel').getBoundingClientRect().bottom);
      const resultsT = await resultsTop(page);
      const barBottom = await page.evaluate(() => document.querySelector('.hub-bar').getBoundingClientRect().bottom);
      assert.ok(resultsT >= bottom - 1, 'the results start under the search box');
      assert.ok(bottom >= barBottom - 1, 'the search box is under the bar');
    });
  });
});

describe('a Standings row on a computer', () => {
  let browser, site;
  before(async () => { browser = await launchBrowser(); site = await startSite({ root: SITE_ROOT }); });
  after(async () => { await browser.close(); await site.close(); });

  const DESKTOP = 'std-index/pickle-for-sight-2026/standings/mid/desktop';

  it('opens that pair in Match Finder with the search box in view', async () => {
    await withCase(browser, site, DESKTOP, { runSteps: true }, async ({ page }) => {
      const row = page.locator('tr.rr-open').nth(3);
      await row.scrollIntoViewIfNeeded();
      const before = await scrollY(page);
      assert.ok(before > 0, 'the page was scrolled to reach the row');
      await row.click();
      await settle(page);
      assert.equal(await finderIsActive(page), true, 'Match Finder is the active tab');
      assert.ok(await page.locator('#results .pair-summary').count() > 0, 'the summary card is drawn');
      const top = await topOf(page, '#searchPanel');
      assert.ok(top >= 0 && top < 800, `the search box is in the viewport (top ${top}px)`);
    });
  });

  it('with the banner folded, the search box lands under the bar', async () => {
    await withCase(browser, site, DESKTOP, { runSteps: true, storage: HUB_FOLDED }, async ({ page }) => {
      const row = page.locator('tr.rr-open').nth(3);
      await row.scrollIntoViewIfNeeded();
      await row.click();
      await settle(page);
      assert.equal(await finderIsActive(page), true);
      const top = await topOf(page, '#searchPanel');
      assert.ok(top >= (await barHeight(page)) && top < 800, `the search box is under the bar (top ${top}px)`);
    });
  });
});

// On a computer each Standings column scrolls by itself (the shells cap it at 92vh), so a category head pins to its
// own column's top. The bar's 54px offset is for heads that pin to the screen; given to these, it pushed every head
// 54px down its column, over the rows below it.
describe('Standings heads with the banner folded on a computer', () => {
  let browser, site;
  before(async () => { browser = await launchBrowser(); site = await startSite({ root: SITE_ROOT }); });
  after(async () => { await browser.close(); await site.close(); });

  /** How far each drawn category head sits below the inside of its column's top border, in px. */
  const headOffsets = page => page.evaluate(() => [...document.querySelectorAll('.standings-board-desktop .standings-col-head')]
    .filter(h => h.offsetParent)
    .map(h => { const col = h.closest('.standings-col'); return Math.round(h.getBoundingClientRect().top - col.getBoundingClientRect().top - col.clientTop); }));

  for (const [where, id, storage] of [
    ['the Hub', 'std-index/pickle-for-sight-2026/standings/mid/desktop', HUB_FOLDED],
    ['Control Center', 'cc/pickle-for-sight-2026/standings/mid/desktop', CC_FOLDED],
  ]) {
    it(`${where}: every head sits at its column's top`, async () => {
      await withCase(browser, site, id, { runSteps: true, storage }, async ({ page }) => {
        assert.equal(await page.evaluate(() => document.body.classList.contains('hub-bar-on')), true, 'the bar is on');
        const offsets = await headOffsets(page);
        assert.ok(offsets.length > 0, 'heads are drawn');
        assert.deepEqual(offsets, offsets.map(() => 0));
      });
    });
  }
});

describe('a Standings row in Control Center', () => {
  let browser, site;
  before(async () => { browser = await launchBrowser(); site = await startSite({ root: SITE_ROOT }); });
  after(async () => { await browser.close(); await site.close(); });

  const CC_DESKTOP = 'cc/pickle-for-sight-2026/standings/mid/desktop';
  const CC_PHONE = 'cc/pickle-for-sight-2026/standings/mid/phone';
  const CC_DM_DESKTOP = 'cc/pnf-x-bup-dual-meet/standings/mid/desktop';
  const CC_TEAM_DESKTOP = 'cc/pickledrive-anniversary-2026/standings/mid/desktop';

  it('opens that pair in Match Finder, on the pair, with the search box in view (a computer)', async () => {
    await withCase(browser, site, CC_DESKTOP, { runSteps: true }, async ({ page }) => {
      assert.ok(await page.locator('tr.rr-open').count() > 0, 'the named rows are marked');
      const label = await rowPairLabel(page, 'tr.rr-open');
      const row = page.locator('tr.rr-open').first();
      await row.scrollIntoViewIfNeeded();
      await row.click();
      await settle(page);
      assert.equal(await finderIsActive(page), true, 'Match Finder is the active tab');
      assert.equal(await standingsHidden(page), true);
      assert.ok(await page.locator('#results .pair-summary').count() > 0, 'the summary card is drawn');
      const value = await page.locator('#teamInput').inputValue();
      label.split(' / ').forEach(name => assert.ok(value.includes(name), `"${value}" holds "${name}"`));
      const top = await topOf(page, '#searchPanel');
      assert.ok(top >= 0 && top < 800, `the search box is in the viewport (top ${top}px)`);
    });
  });

  it('Enter on a focused row does the same', async () => {
    await withCase(browser, site, CC_DESKTOP, { runSteps: true }, async ({ page }) => {
      await page.locator('tr.rr-open').first().focus();
      await page.keyboard.press('Enter');
      await settle(page);
      assert.equal(await finderIsActive(page), true);
      assert.ok(await page.locator('#results .pair-summary').count() > 0);
    });
  });

  it('on a phone, the results land just under the pinned search box', async () => {
    await withCase(browser, site, CC_PHONE, { runSteps: true }, async ({ page }) => {
      // A phone's Standings show one category at a time: pick the first.
      await page.locator('#catFilterInput').click();
      await page.locator('#catAcList .ac-item').first().click();
      await settle(page);
      await page.locator('tr.rr-open').first().click();
      await settle(page);
      assert.equal(await finderIsActive(page), true);
      assert.ok(await page.locator('#results .pair-summary').count() > 0);
      const gap = await page.evaluate(() => document.getElementById('results').getBoundingClientRect().top - document.getElementById('searchPanel').getBoundingClientRect().bottom);
      assert.ok(gap >= 0 && gap <= 16, `the results start ${gap}px under the search box`);
    });
  });

  it('a dual meet’s rows open too; a team event’s Standings have none', async () => {
    await withCase(browser, site, CC_DM_DESKTOP, { runSteps: true }, async ({ page }) => {
      assert.ok(await page.locator('tr.rr-open').count() > 0);
      await page.locator('tr.rr-open').first().click();
      await settle(page);
      assert.equal(await finderIsActive(page), true);
      assert.ok(await page.locator('#results .pair-summary').count() > 0);
    });
    await withCase(browser, site, CC_TEAM_DESKTOP, { runSteps: true }, async ({ page }) => {
      assert.equal(await page.locator('tr.rr-open').count(), 0);
    });
  });
});

// ---- step 8: a dual meet's Standings jump to a category (phones only) ---------------------------------------------

const DM_FINAL_PHONE = 'dm-index/pnf-x-bup-dual-meet/standings/final/phone';
const DM_FINAL_DESKTOP = 'dm-index/pnf-x-bup-dual-meet/standings/final/desktop';
const CC_DM_FINAL_PHONE = 'cc/pnf-x-bup-dual-meet/standings/final/phone';
const CC_DM_FINAL_DESKTOP = 'cc/pnf-x-bup-dual-meet/standings/final/desktop';

/** Where a chip's category sits against the pinned row: the gap between the pin's bottom and the column's top. */
const jumpGap = (page, n) => page.evaluate(i => {
  const chip = document.querySelectorAll('.dm-jump-chip')[i];
  const col = [...document.querySelectorAll('#standingsBody .standings-col')].find(c => c.dataset.catKey === chip.dataset.jumpCat);
  return col.getBoundingClientRect().top - document.querySelector('.dm-pin').getBoundingClientRect().bottom;
}, n);
const activeChips = page => page.evaluate(() => [...document.querySelectorAll('.dm-jump-chip')].map((c, i) => c.classList.contains('active') ? i : -1).filter(i => i >= 0));

describe('a dual meet’s category chips on a phone', () => {
  let browser, site;
  before(async () => { browser = await launchBrowser(); site = await startSite({ root: SITE_ROOT }); });
  after(async () => { await browser.close(); await site.close(); });
  const withPage = (id, options, fn) => withCase(browser, site, id, options, fn);

  it('are pinned under the club bar, one for each of the seven categories, in the columns’ order', async () => {
    await withPage(DM_FINAL_PHONE, { runSteps: true }, async ({ page }) => {
      assert.equal(await page.locator('.dm-pin').count(), 1);
      assert.equal(await page.locator('.dm-pin > .club-summary').count(), 1);
      assert.equal(await page.locator('.dm-pin > .dm-jump').count(), 1);
      const chips = await page.locator('.dm-jump-chip').evaluateAll(list => list.map(c => ({ cat: c.dataset.jumpCat, text: c.textContent.trim() })));
      assert.equal(chips.length, 7);
      const cols = await page.locator('#standingsBody .standings-col').evaluateAll(list => list.map(c => c.dataset.catKey));
      assert.deepEqual(chips.map(c => c.cat), cols);
      assert.match(chips[0].text, /^[A-Z]+ [A-Z]+$/, 'a division and an event code');
      // the club bar and the chips come before the board
      assert.equal(await page.evaluate(() => document.querySelector('.dm-pin').nextElementSibling.classList.contains('standings-board')), true);
    });
  });

  it('a tap on the third chip lands that category just under the pinned row and marks its chip', async () => {
    await withPage(DM_FINAL_PHONE, { runSteps: true }, async ({ page }) => {
      await page.locator('.dm-jump-chip').nth(2).click();
      await settle(page);
      const gap = await jumpGap(page, 2);
      assert.ok(gap >= 0 && gap <= 16, `the category starts ${gap}px under the pinned row`);
      assert.deepEqual(await activeChips(page), [2]);
      // the pinned row really is pinned, at the top of the screen (the bar shows here, so under it)
      const pinTop = await topOf(page, '.dm-pin');
      assert.ok(Math.abs(pinTop - (await barHeight(page))) <= 1, `the pinned row is ${pinTop}px from the top`);
    });
  });

  it('the jump still lands right when the bar is already showing before the tap', async () => {
    await withPage(DM_FINAL_PHONE, { runSteps: true }, async ({ page }) => {
      await scrollTo(page, 1200);
      assert.equal(await barOn(page), true, 'the bar is showing');
      await page.locator('.dm-jump-chip').nth(2).click();
      await settle(page);
      const gap = await jumpGap(page, 2);
      assert.ok(gap >= 0 && gap <= 16, `the category starts ${gap}px under the pinned row`);
      assert.deepEqual(await activeChips(page), [2]);
      const pinTop = await topOf(page, '.dm-pin');
      assert.ok(Math.abs(pinTop - (await barHeight(page))) <= 1, `the pinned row sits at ${pinTop}px, under the bar`);
    });
  });

  it('a tap on the last chip lands as near as the page lets it and marks that chip', async () => {
    await withPage(DM_FINAL_PHONE, { runSteps: true }, async ({ page }) => {
      await page.locator('.dm-jump-chip').nth(6).click();
      await settle(page);
      assert.ok(await jumpGap(page, 6) >= 0, 'the last category is not hidden under the pinned row');
      assert.deepEqual(await activeChips(page), [6]);
    });
  });

  it('scrolling by hand moves the highlight to the category at the top, and back', async () => {
    await withPage(DM_FINAL_PHONE, { runSteps: true }, async ({ page }) => {
      const tops = await page.evaluate(() => [...document.querySelectorAll('#standingsBody .standings-col')].map(c => c.getBoundingClientRect().top + window.scrollY));
      const pinH = await page.evaluate(() => document.querySelector('.dm-pin').getBoundingClientRect().height);
      await scrollTo(page, tops[4] - pinH - (await barHeight(page)) + 40);
      await page.waitForTimeout(120);
      assert.deepEqual(await activeChips(page), [4]);
      await scrollTo(page, tops[1] - pinH - (await barHeight(page)) + 40);
      await page.waitForTimeout(120);
      assert.deepEqual(await activeChips(page), [1]);
    });
  });

  it('a chip row wider than the screen scrolls sideways on its own and the page does not', async () => {
    await withPage(DM_FINAL_PHONE, { runSteps: true }, async ({ page }) => {
      const m = await page.evaluate(() => {
        const nav = document.querySelector('.dm-jump');
        return { scroll: nav.scrollWidth, client: nav.clientWidth, doc: document.documentElement.scrollWidth, view: window.innerWidth };
      });
      assert.ok(m.scroll > m.client, `the chips (${m.scroll}px) overflow their row (${m.client}px)`);
      assert.ok(m.doc <= m.view, `the page is ${m.doc}px wide on a ${m.view}px screen`);
    });
  });

  it('the category heads no longer pin under the chips', async () => {
    await withPage(DM_FINAL_PHONE, { runSteps: true }, async ({ page }) => {
      assert.equal(await page.locator('#standingsBody .standings-col-head').first().evaluate(el => getComputedStyle(el).position), 'static');
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.dm-pin .club-summary')).position), 'static');
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.dm-pin')).position), 'sticky');
    });
  });

  it('the page stays whole: every category is still drawn after a jump', async () => {
    await withPage(DM_FINAL_PHONE, { runSteps: true }, async ({ page }) => {
      await page.locator('.dm-jump-chip').nth(3).click();
      await settle(page);
      assert.equal(await page.locator('#standingsBody .standings-col').count(), 7);
      assert.equal(await page.locator('#standingsBody .standings-col:visible').count(), 7);
    });
  });

  it('the chips are a phone’s: a computer’s Standings draw neither the pinned row nor chips', async () => {
    await withPage(DM_FINAL_DESKTOP, { runSteps: true }, async ({ page }) => {
      assert.equal(await page.locator('.dm-pin').count(), 0);
      assert.equal(await page.locator('.dm-jump-chip').count(), 0);
      assert.equal(await page.locator('#standingsBody .standings-col').count() > 0, true);
    });
  });

  it('Control Center’s dual-meet Standings draw neither, on a phone or a computer', async () => {
    for (const id of [CC_DM_FINAL_PHONE, CC_DM_FINAL_DESKTOP]) {
      await withPage(id, { runSteps: true }, async ({ page }) => {
        assert.ok(await page.locator('.standings-col').count() > 0, `${id} draws its Standings`);
        assert.equal(await page.locator('.dm-pin').count(), 0, id);
        assert.equal(await page.locator('.dm-jump-chip').count(), 0, id);
      });
    }
  });
});
