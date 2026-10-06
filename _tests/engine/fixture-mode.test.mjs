// Fixture mode on every engine page (site-engine-spec §4.8, Phase 2 acceptance):
// ?fixture=<name> on localhost reads /_fixtures/ instead of the published data.
// The templates' Hub and schedule board did not have it before; they have it
// now. Nothing else in the harness would catch its loss: the baseline pages
// cannot do it, so this is not a comparison.
//
// An instantiated template, no routes for event-data: a request for the real
// snapshot would fail the case, so passing means the fixture file was read.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SITE_ROOT } from '../helpers/paths.mjs';
import { launchBrowser, openPage, settle } from '../helpers/browser.mjs';
import { startSite } from '../helpers/server.mjs';

const EVENT = 'attendance-demo-2026';
const DAY = 'attendance-demo-2026-day1';

const settings = {
  EVENT_KEY: EVENT,
  DAYS: [{ key: DAY, label: 'Oct 3', date: '2026-10-03' }],
  FACILITIES: [{ name: 'Main', courts: [1, 4] }, { name: 'Annex', courts: [5, 9] }],
  DIVISIONS: { N: { name: 'N', full: 'Novice' }, LI: { name: 'LI', full: 'Low Intermediate' } },
  EVENTS: { MD: "Men's Doubles", WD: "Women's Doubles" },
  DAY_KEY: DAY,
  CAT_META: { NMD: { short: 'N MD', color: '#6D9EEB' }, NWD: { short: 'N WD', color: '#C27BA0' }, LIMD: { short: 'LI MD', color: '#1155CC' } },
};
const tokens = {
  EVENT_KEY: EVENT, EVENT_TITLE: 'Attendance Demo', EVENT_TAGLINE: 'x', EVENT_HEADLINE: '', EVENT_DATE_RANGE: 'Oct 3', VENUE: 'Main',
  QR_IMAGE: '/assets/logo.png', QR_URL: 'x', EVENT_LOGO: '/assets/logo.png', SCHEDULE_DAY_KEY: DAY,
};

describe('fixture mode on the templates', () => {
  let browser, site;
  before(async () => {
    browser = await launchBrowser();
    site = await startSite({ root: SITE_ROOT, instantiate: { tokens, settings } });
  });
  after(async () => { await browser.close(); await site.close(); });

  for (const [label, page] of [['Hub', 'standard-tournament-template/index.html'], ['schedule board', 'standard-tournament-template/schedule.html']]) {
    it(`the ${label} reads the fixture snapshot`, async () => {
      const h = await openPage(browser, `${site.baseUrl}/_templates/${page}?fixture=pre`, { time: '2026-10-03T13:00:00+08:00' });
      try {
        await settle(h.page);
        assert.deepEqual(h.errors, []);
        const text = await h.page.locator('body').innerText();
        assert.match(text, /Ben Lim/, `${label} shows a player from the fixture`);
        assert.doesNotMatch(text, /Couldn.t load|isn.t published yet|isn.t loaded yet/);
      } finally { await h.close(); }
    });

    it(`the ${label} without ?fixture= asks GitHub Pages, which this case does not route`, async () => {
      const h = await openPage(browser, `${site.baseUrl}/_templates/${page}`, { time: '2026-10-03T13:00:00+08:00' });
      try {
        await settle(h.page);
        assert.ok(h.errors.some(e => e.includes('github.io/event-data/attendance-demo-2026/data/')), JSON.stringify(h.errors));
      } finally { await h.close(); }
    });
  }
});
