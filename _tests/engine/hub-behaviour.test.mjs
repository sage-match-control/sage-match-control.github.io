// What the Tournament Hub does when it is scrolled and tapped (hub-player-experience-spec §2.4): steps 1 (a search shows
// its results), 3 (the bar the banner folds into).
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

// ---- step 3: the bar the banner folds into ----------------------------------------------------------------------

const BAR_HEIGHT = 54;
const barVisible = page => page.locator('.hub-bar').isVisible();
const scrollTo = async (page, y) => { await page.evaluate(top => window.scrollTo(0, top), y); await settle(page); };
const topOf = (page, selector) => page.evaluate(sel => document.querySelector(sel).getBoundingClientRect().top, selector);
// textContent, not innerText: the bar sets its text in capitals with CSS, and the spec’s labels are the tabs’ own.
const texts = (page, selector) => page.locator(selector).evaluateAll(list => list.map(el => el.textContent.trim()));
const textOf = (page, selector) => page.locator(selector).first().evaluate(el => el.textContent.trim());
const activeIn = (page, selector) => page.locator(`${selector}.active`).count();
const barOn = page => page.evaluate(() => document.body.classList.contains('hub-bar-on'));

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

  it('is hidden at the top, shows once the banner has scrolled away, and hides again at the top', async () => {
    await withPage(STD_PHONE, {}, async ({ page }) => {
      assert.equal(await page.locator('.hub-bar').count(), 1, 'the bar is made once');
      assert.equal(await barVisible(page), false, 'hidden while the banner shows');
      assert.equal(await barOn(page), false);
      await scrollTo(page, 1500);
      assert.equal(await barVisible(page), true);
      assert.equal(await barOn(page), true);
      assert.equal(await page.locator('.hub-bar-btn').isVisible(), true, 'a phone has the menu button');
      assert.equal(await page.locator('.hub-bar-row').isVisible(), false, 'and no row');
      assert.equal(await textOf(page, '.hub-bar-btn-label'), 'Match Finder');
      assert.equal(await topOf(page, '.hub-bar'), 0, 'pinned to the top of the screen');
      await scrollTo(page, 0);
      assert.equal(await barVisible(page), false);
      assert.equal(await barOn(page), false);
    });
  });

  it('carries the logo, the date and venue line and the title', async () => {
    await withPage(STD_PHONE, {}, async ({ page }) => {
      await scrollTo(page, 1500);
      assert.match((await page.locator('.hub-bar-meta').innerText()).trim(), /^Sep 27\s+·\s+PCPH Main$/i);
      assert.equal((await page.locator('.hub-bar-title').innerText()).trim().toLowerCase(), 'pickle for sight');
      assert.equal(await page.locator('.hub-bar-logo').getAttribute('src'), await page.locator('header.hero .hero-logos img').first().getAttribute('src'));
    });
  });

  it('the button opens a menu of the tabs; a tab closes it, switches the view and scrolls to its panel', async () => {
    await withPage(STD_PHONE, {}, async ({ page }) => {
      await scrollTo(page, 1500);
      await page.locator('.hub-bar-btn').click();
      assert.equal(await page.locator('#hubMenu').isVisible(), true);
      assert.equal(await page.locator('.hub-menu-scrim').isVisible(), true);
      assert.equal(await page.locator('.hub-bar-btn').getAttribute('aria-expanded'), 'true');
      assert.deepEqual(await texts(page, '.hub-menu-tab'), ['Match Finder', 'Live Matches', 'Standings']);
      assert.equal(await activeIn(page, '.hub-menu-tab'), 1);
      assert.equal(await textOf(page, '.hub-menu-tab.active'), 'Match Finder');
      assert.equal(await page.locator('#hubMenu .hub-menu-day').count(), 0, 'a one-day event has no day picker');
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
      const wanted = Math.min(panelAbs - BAR_HEIGHT - 8, reachable);
      assert.ok(Math.abs(y - wanted) <= 1, `scrolled to ${y}, wanted ${wanted} (the panel is ${panelAbs}px down the page)`);
      // remembered, as a click on the banner's tab remembers it
      assert.equal(await page.evaluate(() => localStorage.getItem('pickle-for-sight-2026.view')), 'standings');
    });
  });

  it('Escape, the scrim and the button each close an open menu, and Escape returns focus to the button', async () => {
    await withPage(STD_PHONE, {}, async ({ page }) => {
      await scrollTo(page, 1500);
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

  it('an open menu closes when the screen widens to a computer, and when the bar goes away', async () => {
    await withPage(STD_PHONE, {}, async ({ page }) => {
      await scrollTo(page, 1500);
      await page.locator('.hub-bar-btn').click();
      assert.equal(await page.locator('#hubMenu').isVisible(), true);
      await page.setViewportSize({ width: 1280, height: 800 });
      await settle(page);
      assert.equal(await page.locator('#hubMenu').isVisible(), false);
      await page.setViewportSize({ width: 375, height: 812 });
      await settle(page);
      await scrollTo(page, 1500);
      await page.locator('.hub-bar-btn').click();
      assert.equal(await page.locator('#hubMenu').isVisible(), true);
      await scrollTo(page, 0);
      assert.equal(await barVisible(page), false);
      assert.equal(await page.locator('#hubMenu').isVisible(), false, 'hiding the bar closes the menu');
    });
  });

  it('the search box pins under the bar while it shows', async () => {
    await withPage(STD_PHONE, {}, async ({ page }) => {
      await scrollTo(page, 1500);
      const panelTop = await topOf(page, '#searchPanel');
      assert.ok(Math.abs(panelTop - 62) <= 1, `the search box is ${panelTop}px from the top`);
    });
  });

  it('a team event’s menu has four tabs', async () => {
    await withPage(TEAM_PHONE, {}, async ({ page }) => {
      await scrollTo(page, 1500);
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
      const clubTop = await topOf(page, '.club-summary');
      assert.ok(Math.abs(clubTop - BAR_HEIGHT) <= 1, `the club bar is ${clubTop}px from the top`);
    });
  });
});

describe('the bar on a computer', () => {
  let browser, site;
  before(async () => { browser = await launchBrowser(); site = await startSite({ root: SITE_ROOT }); });
  after(async () => { await browser.close(); await site.close(); });
  const withPage = (id, options, fn) => withCase(browser, site, id, options, fn);

  const STD_DESKTOP = 'std-index/pickle-for-sight-2026/finder/mid/desktop';

  it('shows a row of the sync line and the tabs, with no menu, and the QR panel moves under it', async () => {
    await withPage(STD_DESKTOP, {}, async ({ page }) => {
      assert.equal(await barVisible(page), false, 'hidden at the top');
      const qrTopAtRest = await topOf(page, '.qr-panel');
      await scrollTo(page, 900);
      assert.equal(await barVisible(page), true);
      assert.equal(await page.locator('.hub-bar-btn').isVisible(), false, 'no menu button');
      assert.equal(await page.locator('.hub-bar-row').isVisible(), true);
      assert.equal(await page.locator('.hub-bar-row .hub-bar-tab').count(), 3);
      assert.equal(await activeIn(page, '.hub-bar-tab'), 1);
      assert.match(await page.locator('.hub-bar-sync').innerText(), /Sep 27 · Live · last synced/);
      assert.equal(await page.locator('.hub-bar-day').count(), 0, 'a one-day event has no day picker');
      const qrTop = await topOf(page, '.qr-panel');
      assert.ok(qrTop >= BAR_HEIGHT, `the QR panel is ${qrTop}px from the top`);
      assert.ok(qrTopAtRest < BAR_HEIGHT, 'and was higher at the top of the page');
      await page.locator('.hub-bar-tab', { hasText: 'Standings' }).click();
      await settle(page);
      assert.equal(await activeIn(page, '.hub-bar-tab[data-view="standings"]'), 1, 'active on the bar');
      assert.equal(await activeIn(page, '.view-tab[data-view="standings"]'), 1, 'and in the banner');
      assert.equal(await activeIn(page, '.hub-bar-tab[data-view="finder"]'), 0);
    });
  });

  it('leaves the search box to scroll away with the page', async () => {
    await withPage(STD_DESKTOP, {}, async ({ page }) => {
      await scrollTo(page, 900);
      const panelBottom = await page.evaluate(() => document.getElementById('searchPanel').getBoundingClientRect().bottom);
      assert.ok(panelBottom < 0, `the search box is above the screen (${panelBottom}px), not pinned`);
    });
  });

  it('leaves the sync line out below 1100 px and still shows the tabs at 950 px', async () => {
    await withPage(STD_DESKTOP, {}, async ({ page }) => {
      await page.setViewportSize({ width: 950, height: 800 });
      await settle(page);
      await scrollTo(page, 900);
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

  /** Open it on its first day (saved, so the page loads it rather than waiting for a pick). */
  async function openTwoDays(viewport) {
    const { c, registry, snapshots } = twoDays();
    site.register(c.id, c.instantiate);
    const h = await openPage(browser, site.baseUrl + c.path, {
      viewport: viewport || c.viewport, time: c.time, registry, snapshots,
      fixtureFiles: c.fixtureFiles, external: c.external, cloudRun: c.cloudRun, allowErrors: c.allowErrors,
      storage: { ...c.storage, local: { 'pickle-for-sight-2026.dayIndex': '0' } }, caseId: c.id,
    });
    await settle(h.page);
    return h;
  }

  it('lists both days in the bar’s picker on a computer, and choosing the second loads it', async () => {
    const h = await openTwoDays();
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
      assert.deepEqual(h.errors, []);
    } finally {
      await h.close();
    }
  });

  it('puts the day picker in the phone’s menu', async () => {
    const h = await openTwoDays({ width: 375, height: 812 });
    try {
      const { page } = h;
      await scrollTo(page, 1500);
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
});
