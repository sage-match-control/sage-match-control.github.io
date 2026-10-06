// views/live-matches.js: the court grouping and the board's markup, on hand-made models.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import {
  courtSortKey, courtNumberFrom, buildFacilityCourtGroups, liveEmptyRowHTML, liveTableRowsHTML,
  facilityTableHTML, liveMetaHTML, renderLiveMatches,
} from '../../../lib/v1/views/live-matches.js';

const HEADER = 'matchNumber,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const row = (n, live, court, t1, p1, p2, s1, t2, q1, q2, s2) => `${n},${live},9:00 AM,Court ${court},${t1},${p1},${p2},${s1},${t2},${q1},${q2},${s2}`;
const csv = rows => [HEADER, ...rows].join('\n');
const STANDINGS = 'teamCode,player1,player2,wins,loss,quotient,bracket\n';
const model = (facilities, type = 'standard') => buildDayModel(
  { key: 'e', type, title: 'E', display: {}, days: [] },
  { key: 'd', facilities: facilities.map(f => f.name) },
  { isLive: true, facilities: facilities.map(f => ({ name: f.name, matchesCsv: csv(f.rows), standingsCsv: STANDINGS })) },
  { now: 0 },
);

const MAIN = [
  row(1, '2', 2, 'ND_1', 'Ann', 'Bo', '', 'ND_2', 'Cy', 'Di', ''),
  row(2, '', 1, 'ND_3', 'Ed', 'Flo', 11, 'ND_4', 'Gus', 'Hal', 4),
  row(3, '', 10, 'ND_5', 'Ivy', 'Jo', '', 'bye', 'bye', 'bye', ''),
];
const ANNEX = [row(4, '', 5, 'ND_6', 'Kai', 'Lu', '', 'ND_7', 'Mo', 'Ned', '')];

test('courts sort by their number, and one with none sorts last', () => {
  assert.deepEqual(['Court 10', '2', 'Court 1', 'Roof'].sort((a, b) => courtSortKey(a) - courtSortKey(b)), ['Court 1', '2', 'Court 10', 'Roof']);
  assert.equal(courtNumberFrom('Court 3'), '3');
  assert.equal(courtNumberFrom(''), null);
});

test('each facility lists its own scheduled courts in order, the match on court now, and idle courts as null', () => {
  const groups = buildFacilityCourtGroups(model([{ name: 'Main', rows: MAIN }, { name: 'Annex', rows: ANNEX }]));
  assert.deepEqual(Array.from(groups.keys()), ['Main', 'Annex']);
  const main = groups.get('Main');
  assert.deepEqual(main.map(([c]) => c), ['1', '2']);          // court 10 holds only a BYE: not a court
  assert.equal(main[0][1], null);
  assert.equal(main[1][1].num, 1);
  assert.deepEqual(groups.get('Annex').map(([c, m]) => [c, m]), [['5', null]]);
});

test('a live court outside the schedule still shows', () => {
  const rows = [row(1, '7', 1, 'ND_1', 'Ann', 'Bo', '', 'ND_2', 'Cy', 'Di', '')];
  const groups = buildFacilityCourtGroups(model([{ name: 'Main', rows }]));
  assert.deepEqual(groups.get('Main').map(([c, m]) => [c, m && m.num]), [['1', null], ['7', 1]]);
});

test('an idle row has the same cells as a live one, so the row keeps its height', () => {
  const m = model([{ name: 'Main', rows: MAIN }]);
  const live = liveTableRowsHTML('2', m.matches.find(x => x.num === 1), m);
  const idle = liveTableRowsHTML('1', null, m);
  const cells = html => (html.match(/<td/g) || []).length;
  assert.equal(cells(idle), cells(live));
  assert.match(idle, /No match playing/);
  assert.match(live, /live-match-pill">#1</);
  assert.match(live, /live-vs-score">VS</);
  assert.match(live, /Round Robin/);
  assert.equal((idle.match(/<tr/g) || []).length, (live.match(/<tr/g) || []).length);
});

test('a played match shows its score; a TBD side says so', () => {
  const rows = [row(1, '1', 1, 'ND_1', 'TBD', 'TBD', 11, 'ND_2', 'Cy', 'Di', 4)];
  const m = model([{ name: 'Main', rows }]);
  const html = liveTableRowsHTML('1', m.matches[0], m);
  assert.match(html, /live-vs-score">11&ndash;4</);
  assert.match(html, /live-team-code tbd">ND_1</);
  assert.match(html, /To be determined/);
});

test('a facility is titled with its courts in play, unless the day has only one', () => {
  const two = model([{ name: 'Main', rows: MAIN }, { name: 'Annex', rows: ANNEX }]);
  const rows = buildFacilityCourtGroups(two).get('Main');
  assert.match(facilityTableHTML('Main', rows, two), /Main <span class="facility-count">1 court in play/);
  const one = model([{ name: 'Main', rows: MAIN }]);
  assert.doesNotMatch(facilityTableHTML('Main', buildFacilityCourtGroups(one).get('Main'), one), /facility-title/);
  assert.match(facilityTableHTML('Main', rows, two), /data-facility-key="Main"/);
});

test('the count line', () => {
  const m = model([{ name: 'Main', rows: MAIN }]);
  assert.match(liveMetaHTML(buildFacilityCourtGroups(m)), /<b>1<\/b><span>court in play/);
  assert.match(liveMetaHTML(new Map([['Main', [['1', null]]]])), /<b>0<\/b><span>courts in play/);
});

test('extension points: a logo (and its blank slot in an idle row), a row of its own, a blank matchup line', () => {
  const m = model([{ name: 'Main', rows: MAIN }]);
  const opts = { teamLogoHTML: code => `<img class="live-team-logo" alt="${code}">` };
  const live = liveTableRowsHTML('2', m.matches.find(x => x.num === 1), m, opts);
  assert.ok(live.indexOf('alt="ND_1"') < live.indexOf('ND_1</div>'), 'left logo comes first');
  assert.ok(live.indexOf('alt="ND_2"') > live.indexOf('ND_2</div>'), 'right logo comes after');
  assert.match(liveEmptyRowHTML('1', opts), /live-team-logo-placeholder/);
  assert.doesNotMatch(liveEmptyRowHTML('1'), /live-team-logo/);
  assert.match(liveEmptyRowHTML('1', { emptyMatchupHTML: '<div class="live-matchup">&nbsp;</div>' }), /live-matchup/);
  assert.equal(liveTableRowsHTML('2', m.matches[0], m, { liveRow: () => '<tr>own</tr>' }), '<tr>own</tr>');
  assert.match(liveTableRowsHTML('2', m.matches.find(x => x.num === 1), m, { liveRow: () => null }), /live-match-pill/);
});

test('renderLiveMatches fills the board, the count and the facility cards', () => {
  const m = model([{ name: 'Main', rows: MAIN }, { name: 'Annex', rows: ANNEX }]);
  const el = () => ({ innerHTML: '', querySelectorAll: () => [] });
  const boardEl = el(), metaEl = el(), extrasEl = el();
  renderLiveMatches(m, { boardEl, metaEl, extrasEl, facilityExtras: name => `<card>${name}</card>` });
  assert.equal((boardEl.innerHTML.match(/<table class="live-table"/g) || []).length, 2);
  assert.match(metaEl.innerHTML, /1<\/b><span>court in play/);
  assert.equal(extrasEl.innerHTML, '<card>Main</card><card>Annex</card>');
  assert.doesNotThrow(() => renderLiveMatches(m, { boardEl: null }));
});
