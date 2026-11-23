// views/club-bar.js: a dual meet's club score on Match Finder's first screen (step 7 of the Hub player experience,
// hub-player-experience-spec §9). It is the bar Standings shows, so these tests also pin that the two agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import { clubBarHTML } from '../../../lib/v1/views/club-bar.js';
import { dualMeetStandingsHTML } from '../../../lib/v1/views/standings.js';
import { introHTML } from '../../../lib/v1/views/finder.js';
import { eventConfig, loadSnapshot, deriveState, caseTime } from '../../helpers/fixtures.mjs';

const fixtureModel = (ev, state = 'final', { isLive } = {}) => {
  const cfg = eventConfig(ev);
  const snap = state === 'final' ? loadSnapshot(ev) : deriveState(loadSnapshot(ev), state);
  if (isLive !== undefined) snap.isLive = isLive;
  return buildDayModel(cfg, cfg.days[0], snap, { now: caseTime(ev) });
};

const DUAL = 'pnf-x-bup-dual-meet';
const wins = html => [...html.matchAll(/<span class="cs-wins">(\d+)<\/span>/g)].map(m => Number(m[1]));
const names = html => [...html.matchAll(/<span class="cs-name">([^<]*)<\/span>/g)].map(m => m[1]);

test('PNF × BUP live: both clubs with their wins, in the order Standings has them', () => {
  const m = fixtureModel(DUAL);
  assert.equal(m.isLive, true);
  const html = clubBarHTML(m);
  assert.match(html, /^<div class="finder-club-bar">/);
  assert.equal((html.match(/class="club-summary"/g) || []).length, 1);
  assert.deepEqual(names(html), ['Pickle &amp; Friends Community', '1Bataan United Picklers']);
  assert.deepEqual(wins(html), [64, 48]);
  assert.match(html, /club-summary-item leader/);
  assert.match(html, /club-summary-vs/);
});

test('the bar is the Standings bar: the same clubs, wins, leader and order', () => {
  // dualMeetStandingsHTML asks for the screen size
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  for (const state of ['final', 'mid', 'pre']) {
    const m = fixtureModel(DUAL, state);
    const bar = clubBarHTML(m);
    const standings = dualMeetStandingsHTML(m, {});
    const summary = standings.match(/<div class="club-summary">[\s\S]*?<div class="club-summary-vs">VS<\/div>[\s\S]*?<\/div><\/div><\/div>/)[0];
    assert.equal(bar, `<div class="finder-club-bar">${summary}</div>`, state);
  }
});

test('the logos come through clubLogoHTML, once a club, with its code and name', () => {
  const m = fixtureModel(DUAL);
  const calls = [];
  const html = clubBarHTML(m, { clubLogoHTML: (code, name) => { calls.push([code, name]); return `<img class="cs-logo" src="/${code}.png" alt="${name} logo">`; } });
  assert.deepEqual(calls, [['PNF', 'Pickle & Friends Community'], ['BUP', '1Bataan United Picklers']]);
  assert.equal((html.match(/class="cs-logo"/g) || []).length, 2);
  assert.match(html, /src="\/PNF\.png"/);
  assert.match(html, /src="\/BUP\.png"/);
  // with none, the bar has no logo
  assert.doesNotMatch(clubBarHTML(m), /cs-logo/);
});

test('a standard event gives no bar', () => {
  assert.equal(clubBarHTML(fixtureModel('piggleball-2026')), '');
  assert.equal(clubBarHTML(fixtureModel('pickle-for-sight-2026')), '');
});

test('a team event gives no bar', () => {
  assert.equal(clubBarHTML(fixtureModel('pickledrive-anniversary-2026')), '');
  assert.equal(clubBarHTML(fixtureModel('team-demo-2026')), '');
});

test('a dual meet whose day is not live gives no bar', () => {
  const m = fixtureModel(DUAL, 'final', { isLive: false });
  assert.equal(m.isLive, false);
  assert.equal(clubBarHTML(m), '');
});

test('a dual meet with no standings gives no bar (a bar needs two clubs)', () => {
  const m = fixtureModel(DUAL);
  assert.equal(clubBarHTML({ ...m, standings: [] }), '');
});

test('on the first screen the bar comes before the counts', () => {
  const m = fixtureModel(DUAL);
  const html = introHTML(m, { introTop: mm => clubBarHTML(mm) });
  assert.ok(html.indexOf('finder-club-bar') !== -1);
  assert.ok(html.indexOf('finder-club-bar') < html.indexOf('class="stats-row"'));
  assert.match(html, /<span>Pairs<\/span>/);
});
