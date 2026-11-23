// The `podium` option of createStandings (categoryCardHTML, categoryColumnHTML) and createTeams (teamStandingsHTML):
// off by default, so Control Center and an old page's markup are unchanged (hub-player-experience-spec §8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import { categoryCardHTML, dualMeetStandingsHTML, groupByCategory, createStandings } from '../../../lib/v1/views/standings.js';
import { teamStandingsHTML, createTeams } from '../../../lib/v1/views/teams.js';
import { eventConfig, loadSnapshot, deriveState, caseTime } from '../../helpers/fixtures.mjs';

// the builders ask for the screen size; a phone
globalThis.window = { matchMedia: () => ({ matches: false }) };

const fixtureModel = (ev, state = 'final') => {
  const cfg = eventConfig(ev);
  const snap = state === 'final' ? loadSnapshot(ev) : deriveState(loadSnapshot(ev), state);
  return buildDayModel(cfg, cfg.days[0], snap, { now: caseTime(ev) });
};
const PODIUM = /<div class="podium">/g;
const count = html => (html.match(PODIUM) || []).length;

// ---- a standard event's card -----------------------------------------------------------------------------------

test('a standard card with podium puts it first in .standings-col-body; without the option there is none', () => {
  const m = fixtureModel('piggleball-2026');
  const { categories } = groupByCategory(m);
  const cat = Array.from(categories.keys()).find(c => /Novice/.test(c));
  assert.ok(cat, 'the Novice Open Doubles card');
  const rows = categories.get(cat);
  const plain = categoryCardHTML(cat, rows, m, {});
  assert.equal(count(plain), 0);
  assert.equal(count(categoryCardHTML(cat, rows, m, { podium: false })), 0);
  const withPodium = categoryCardHTML(cat, rows, m, { podium: true });
  assert.equal(count(withPodium), 1);
  assert.match(withPodium, /<div class="standings-col-body">\s*<div class="podium">/);
  assert.match(withPodium, /Joshua Dizon \/ Jericho Dizon/);
  // the card's own content follows it unchanged
  const squash = s => s.replace(/\s+/g, '');
  assert.equal(squash(withPodium.replace(/<div class="podium">[\s\S]*?<\/ol>\s*<\/div>/, '')), squash(plain));
});

test('a standard card on mid has no podium even with the option', () => {
  const m = fixtureModel('piggleball-2026', 'mid');
  const { categories } = groupByCategory(m);
  for (const [cat, rows] of categories) assert.equal(count(categoryCardHTML(cat, rows, m, { podium: true })), 0, cat);
});

test('the card keeps its round-robin rows, status pills and open rows beside the podium', () => {
  const m = fixtureModel('piggleball-2026');
  const { categories } = groupByCategory(m);
  const [cat, rows] = Array.from(categories).find(([c]) => /Novice/.test(c));
  const html = categoryCardHTML(cat, rows, m, { podium: true, openRows: true });
  assert.match(html, /rr-status/);
  assert.match(html, /rr-open-mark/);
  assert.match(html, /class="[^"]*\brr-open\b/);
});

// ---- a dual meet's column --------------------------------------------------------------------------------------

test('a dual meet’s columns carry the podium first in the column body, one per finished category', () => {
  const fin = fixtureModel('pnf-x-bup-dual-meet');
  assert.equal(count(dualMeetStandingsHTML(fin, {})), 0);
  const html = dualMeetStandingsHTML(fin, { podium: true });
  assert.equal(count(html), 7);
  assert.match(html, /<div class="standings-col-body">\s*<div class="podium">/);
  assert.match(html, /Keren Kenizzite \/ Shaira Tarlit\* · Pickle &amp; Friends Community/);
  assert.equal(count(dualMeetStandingsHTML(fixtureModel('pnf-x-bup-dual-meet', 'mid'), { podium: true })), 0);
});

// ---- a team event ----------------------------------------------------------------------------------------------

test('team standings with hooks.podium start with the event’s podium; without it there is none', () => {
  const m = fixtureModel('pickledrive-anniversary-2026');
  assert.equal(count(teamStandingsHTML(m, {}, {})), 0);
  assert.equal(count(teamStandingsHTML(m, {}, { podium: false })), 0);
  const html = teamStandingsHTML(m, {}, { podium: true });
  assert.equal(count(html), 1);
  assert.match(html, /^<div class="team-standings[^"]*"><div class="podium">/);
  assert.match(html, /San Mig Lobbers<small>Beat Can i buy you a DINK\? 32–26 in the final<\/small>/);
  assert.equal(count(teamStandingsHTML(fixtureModel('pickledrive-anniversary-2026', 'mid'), {}, { podium: true })), 0);
  assert.equal(count(teamStandingsHTML(fixtureModel('team-demo-2026'), {}, { podium: true })), 0);
});

// ---- the components ---------------------------------------------------------------------------------------------

const fakeEl = () => ({ innerHTML: '', addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, querySelectorAll: () => [] });

test('createTeams passes the podium option to the standings it draws', () => {
  const m = fixtureModel('pickledrive-anniversary-2026');
  for (const [options, want] of [[{}, 0], [{ podium: true }, 1]]) {
    const standingsEl = fakeEl();
    const teams = createTeams({ getModel: () => m, getFinder: () => ({}), input: fakeEl(), acList: fakeEl(), resultsEl: fakeEl(), standingsEl, saveSearch() {}, ...options });
    teams.renderStandings();
    assert.equal(count(standingsEl.innerHTML), want, JSON.stringify(options));
  }
});

test('createStandings passes the podium option to the cards it draws', () => {
  globalThis.window = { matchMedia: () => ({ matches: true }), addEventListener() {} };   // a computer: every category's card
  try {
    const m = fixtureModel('piggleball-2026');
    for (const [options, want] of [[{}, 0], [{ podium: true }, 3]]) {
      const bodyEl = { ...fakeEl(), clientWidth: 1280 };
      const standings = createStandings({ bodyEl, panelEl: fakeEl(), getModel: () => m, ...options });
      standings.render();
      assert.equal(count(bodyEl.innerHTML), want, JSON.stringify(options));
    }
  } finally {
    globalThis.window = { matchMedia: () => ({ matches: false }) };
  }
});
