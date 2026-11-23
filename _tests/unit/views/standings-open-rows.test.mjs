// A round-robin row that opens that pair in Match Finder (views/standings.js, `openRows`; `createStandings`'s
// `onPairSelect`). Step 5 of the Hub player experience. Without `openRows` nothing about a row changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import { stageTablesHTML, categoryCardHTML, dualMeetStandingsHTML } from '../../../lib/v1/views/standings.js';
import { teamStandingsHTML } from '../../../lib/v1/views/teams.js';
import { eventConfig, loadSnapshot, caseTime } from '../../helpers/fixtures.mjs';

// categoryCardHTML and dualMeetStandingsHTML ask for the screen size; a phone.
globalThis.window = { matchMedia: () => ({ matches: false }) };

const MATCH_HEADER = 'matchNumber,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const STAND_HEADER = 'teamCode,player1,player2,wins,loss,quotient,bracket';
const stand = (code, p1, p2, w, l, q, br = '') => `${code},${p1},${p2},${w},${l},${q},${br}`;
const model = ({ type = 'standard', display = {}, matches = [], standings = [], isLive = true }) => buildDayModel(
  { key: 'e', type, title: 'E', display, days: [] },
  { key: 'd', facilities: ['Main'] },
  { isLive, facilities: [{ name: 'Main', matchesCsv: [MATCH_HEADER, ...matches].join('\n'), standingsCsv: [STAND_HEADER, ...standings].join('\n') }] },
  { now: 0 },
);
const DISPLAY = { divisions: { N: 'Novice' }, events: { OD: 'Open Doubles' } };
const mrow = (n, a, sa, b, sb) => `${n},,9:00 AM,Court 1,${a},${a}a,${a}b,${sa},${b},${b}a,${b}b,${sb}`;

// Bracket 1: three named pairs. Bracket 2: two named pairs and one slot with no names that the schedule uses (shown as its code).
// A playoff row with a pair (the Final) and one with none (a Semifinal slot, TBD).
const MATCHES = [
  mrow(1, 'NOD_1', 11, 'NOD_2', 4), mrow(2, 'NOD_1', 11, 'NOD_3', 6), mrow(3, 'NOD_2', 11, 'NOD_3', 9),
  mrow(4, 'NOD_4', 11, 'NOD_5', 5), mrow(5, 'NOD_5', '', 'NOD_6', ''), mrow(6, 'NOD_6', '', 'NOD_4', ''),
];
const STANDINGS = [
  stand('NOD_1', 'Ann', 'Bo', 2, 0, 1.9412, '1'), stand('NOD_2', 'Cy', 'Di', 1, 1, 0.7, '1'), stand('NOD_3', 'Ed', 'Flo', 0, 2, 0.5455, '1'),
  stand('NOD_4', 'Gus', 'Hal', 1, 0, 2.2, '2'), stand('NOD_5', 'Ian', 'Jo', 0, 1, 0.4545, '2'), stand('NOD_6', 'NOD_6', '', 0, 0, '', '2'),
  stand('NOD_SF_1', 'Ann', 'Bo', 0, 0, '', ''), stand('NOD_SF_2', 'NOD_SF_2', '', 0, 0, '', ''),
];
const live = () => model({ display: DISPLAY, matches: MATCHES, standings: STANDINGS });

const rows = html => html.match(/<tr[^>]*>/g) || [];
const openRows = html => rows(html).filter(r => /\brr-open\b/.test(r));
const marks = html => (html.match(/<span class="rr-open-mark" aria-hidden="true">›<\/span>/g) || []).length;

test('with openRows each named round-robin row carries its code, tabindex and a › at the end of the Q cell', () => {
  const m = live();
  const { html } = stageTablesHTML(m.standings, m, { openRows: true });
  const open = openRows(html);
  assert.deepEqual(open.map(r => r.match(/data-team="([^"]+)"/)[1]).sort(), ['NOD_1', 'NOD_2', 'NOD_3', 'NOD_4', 'NOD_5']);
  open.forEach(r => assert.match(r, /tabindex="0"/));
  assert.equal(marks(html), 5);
  // the mark is the last thing in the Q cell, after the figure
  assert.match(html, /<td class="quo">1\.9412<span class="rr-open-mark" aria-hidden="true">›<\/span><\/td>/);
});

test('a row keeps its win / loss class beside rr-open', () => {
  const m = live();
  const { html } = stageTablesHTML(m.standings, m, { openRows: true });
  assert.ok(rows(html).some(r => /class="win rr-open"/.test(r)), 'a winning pair');
  assert.ok(rows(html).some(r => /class="loss rr-open"/.test(r)), 'a losing pair');
});

test('a slot with no names (its code shown) or TBD gets no mark and does nothing', () => {
  const m = live();
  const { html } = stageTablesHTML(m.standings, m, { openRows: true });
  const tbdRow = html.match(/<tr[^>]*>\s*<td class="pair tbd"><span>NOD_6<\/span><\/td>/);
  assert.ok(tbdRow, 'the unnamed scheduled pair is drawn as its code');
  assert.doesNotMatch(tbdRow[0], /rr-open|data-team|tabindex/);
  assert.equal(html.match(/<tr[^>]*>\s*<td class="pair tbd">/g).filter(r => /rr-open/.test(r)).length, 0);
});

test('without openRows nothing changes: no class, no attribute, no mark', () => {
  const m = live();
  const plain = stageTablesHTML(m.standings, m).html;
  assert.equal(openRows(plain).length, 0);
  assert.doesNotMatch(plain, /rr-open|data-team|tabindex/);
  assert.equal(stageTablesHTML(m.standings, m, { openRows: false }).html, plain);
  assert.equal(stageTablesHTML(m.standings, m, { openRows: undefined }).html, plain);
});

test('the playoff stages draw no marks', () => {
  const m = live();
  const { html } = stageTablesHTML(m.standings, m, { openRows: true });
  const at = html.indexOf('Semifinal');
  assert.ok(at > -1, 'the fixture draws a playoff stage');
  assert.doesNotMatch(html.slice(at), /rr-open/);
});

test('a dual meet\'s one table per club marks its rows too', () => {
  const m = live();
  const { html } = stageTablesHTML(m.standings, m, { rrBracketLayout: 'column', openRows: true });
  assert.equal(openRows(html).length, 5);
  assert.equal(marks(html), 5);
  assert.match(html, /<tr class="win rr-open" data-team="NOD_1" tabindex="0">/);
});

test('the mark sits after the figure and does not collide with the tie pill, which is in the pair cell', () => {
  // two pairs level on wins with equal quotients: each carries a Tied pill under its names
  const tied = model({
    display: DISPLAY,
    matches: [mrow(1, 'NOD_7', 11, 'NOD_8', 11)],
    standings: [stand('NOD_7', 'Mo', 'Ned', 0, 1, 1, '3'), stand('NOD_8', 'Olu', 'Pat', 0, 1, 1, '3')],
  });
  const { html } = stageTablesHTML(tied.standings, tied, { openRows: true });
  const row = html.match(/<tr class="loss rr-open" data-team="NOD_7"[^>]*>[\s\S]*?<\/tr>/)[0];
  const pill = row.indexOf('class="rr-tie rr-tie--tied"');
  const mark = row.indexOf('class="rr-open-mark"');
  assert.ok(pill > -1, 'the tie pill is drawn');
  assert.ok(mark > pill, 'the mark comes after the pill');
  assert.ok(row.indexOf('</td>', pill) < row.indexOf('<td class="quo">'), 'the pill is in the pair cell, before the Q cell');
  assert.match(row, /<td class="quo">1\.0000<span class="rr-open-mark" aria-hidden="true">›<\/span><\/td>\s*<\/tr>$/);
});

test('a standard category card threads openRows into its tables', () => {
  const m = live();
  const on = categoryCardHTML('Novice Open Doubles', m.standings, m, { openRows: true });
  assert.equal(marks(on), 5);
  const off = categoryCardHTML('Novice Open Doubles', m.standings, m);
  assert.equal(marks(off), 0);
  assert.doesNotMatch(off, /rr-open/);
});

test('a dual meet\'s standings thread openRows through the club tables', () => {
  const ev = 'pnf-x-bup-dual-meet';
  const cfg = eventConfig(ev);
  const m = buildDayModel(cfg, cfg.days[0], loadSnapshot(ev), { now: caseTime(ev) });
  const on = dualMeetStandingsHTML(m, { rrBracketLayout: 'column', openRows: true });
  const off = dualMeetStandingsHTML(m, { rrBracketLayout: 'column' });
  assert.ok(marks(on) > 0, 'marks drawn');
  assert.equal(marks(off), 0);
  assert.doesNotMatch(off, /rr-open|data-team/);
  // every marked row is a named pair's, carrying its team code
  openRows(on).forEach(r => assert.match(r, /data-team="[^"]+"/));
  // the bronze / final block, shared by both clubs, draws no mark
  // (each shared block runs to the next column's start)
  const sharedBlocks = on.split('class="shared-stages"').slice(1).map(chunk => chunk.split('<div class="standings-col"')[0]);
  assert.ok(sharedBlocks.length > 0, 'the fixture has cross-club stages');
  sharedBlocks.forEach(block => assert.doesNotMatch(block, /rr-open/));
});

test('a team event\'s Standings (views/teams.js) draw no marks', () => {
  const ev = 'team-demo-2026';
  const cfg = eventConfig(ev);
  const m = buildDayModel(cfg, cfg.days[0], loadSnapshot(ev), { now: caseTime(ev) });
  const html = teamStandingsHTML(m, {});
  assert.ok(html.length > 0, 'the team standings are drawn');
  assert.doesNotMatch(html, /rr-open|rr-open-mark|data-team=/);
});
