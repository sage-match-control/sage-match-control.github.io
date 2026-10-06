// views/standings.js: the markup builders on hand-made models (the browser fixtures have no sub-brackets or BYEs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import {
  sortStageKeys, pairUpMatchups, matchupHTML, stageTablesHTML, categoryCardHTML, groupByCategory,
  clubSummaryHTML, dualMeetStandingsHTML, categoryToggleBarHTML, categoryAutocompleteHTML,
} from '../../../lib/v1/views/standings.js';

const MATCH_HEADER = 'matchNumber,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const STAND_HEADER = 'teamCode,player1,player2,wins,loss,quotient,bracket';
const stand = (code, p1, p2, w, l, q, br = '') => `${code},${p1},${p2},${w},${l},${q},${br}`;
const model = ({ type = 'standard', display = {}, matches = [], standings = [] }) => buildDayModel(
  { key: 'e', type, title: 'E', display, days: [] },
  { key: 'd', facilities: ['Main'] },
  { isLive: true, facilities: [{ name: 'Main', matchesCsv: [MATCH_HEADER, ...matches].join('\n'), standingsCsv: [STAND_HEADER, ...standings].join('\n') }] },
  { now: 0 },
);
const DISPLAY = { divisions: { N: 'Novice' }, events: { OD: 'Open Doubles' } };

test('stage keys sort in the playoff order, unknown ones last', () => {
  assert.deepEqual(sortStageKeys(['FINAL', 'ZZ', 'QF', 'SF']), ['QF', 'SF', 'FINAL', 'ZZ']);
});

test('playoff rows pair up by match instance, then by bracket column, then in order', () => {
  const rows = [{ teamCode: 'NOD_QF_1_(1)' }, { teamCode: 'NOD_QF_2_(1)' }, { teamCode: 'NOD_QF_1_(2)' }, { teamCode: 'NOD_QF_2_(2)' }];
  assert.equal(pairUpMatchups(rows).length, 2);
  const braced = [{ teamCode: 'A', bracket: 'x' }, { teamCode: 'B', bracket: 'y' }, { teamCode: 'C', bracket: 'x' }];
  assert.deepEqual(pairUpMatchups(braced).map(p => p.map(s => s.teamCode)), [['A', 'C'], ['B']]);
  assert.deepEqual(pairUpMatchups([{ teamCode: 'A' }, { teamCode: 'B' }, { teamCode: 'C' }]).map(p => p.length), [2, 1]);
});

test('a matchup card shows the played score and greys out a series game that is never played', () => {
  const m = model({
    display: DISPLAY,
    matches: ['1,,9:00 AM,Court 1,NOD_F_1_(1),Ann,Bo,11,NOD_F_2_(1),Cy,Di,4', '2,,9:30 AM,Court 1,NOD_F_1_(2),Ann,Bo,,NOD_F_2_(2),Cy,Di,'],
    standings: [
      stand('NOD_F_1_(1)', 'Ann', 'Bo', 0, 0, 0), stand('NOD_F_2_(1)', 'Cy', 'Di', 0, 0, 0),
      stand('NOD_F_1_(2)', 'Ann', 'Bo', 0, 0, 0), stand('NOD_F_2_(2)', 'Cy', 'Di', 0, 0, 0),
    ],
  });
  const first = matchupHTML([m.standings[0], m.standings[1]], m);
  assert.match(first, /mu-score ">11</);
  assert.match(first, /Match 1/);
  assert.doesNotMatch(first, /not-needed/);
  const second = matchupHTML([m.standings[2], m.standings[3]], m);
  assert.match(second, /class="matchup not-needed" title="Not needed"/);
});

test('Round Robin: one table, or a grid of bracket tables; BYE rows never show', () => {
  const rows = [
    stand('NOD_1', 'Ann', 'Bo', 2, 0, 2, '1'), stand('NOD_2', 'Cy', 'Di', 1, 1, 1, '1'),
    stand('NOD_3', 'Ed', 'Flo', 1, 0, 1, '2'), stand('NOD_4', 'bye', 'bye', 0, 0, 0, '2'),
  ];
  const m = model({ display: DISPLAY, standings: rows });
  const grid = stageTablesHTML(m.standings, m);
  assert.equal(grid.hasMultiBracket, true);
  assert.equal((grid.html.match(/<table class="br-table"/g) || []).length, 2);
  assert.match(grid.html, /Bracket 1/);
  assert.doesNotMatch(grid.html, /bye/i);
  assert.match(grid.html, /<div class="br-table-wrap">/);
  const column = stageTablesHTML(m.standings, m, { rrBracketLayout: 'column' });
  assert.equal(column.hasMultiBracket, false);
  assert.equal((column.html.match(/<table class="br-table"/g) || []).length, 1);
  assert.match(column.html, /<th class="br-badge">Br<\/th>/);
  const single = stageTablesHTML(model({ display: DISPLAY, standings: [stand('NOD_1', 'Ann', 'Bo', 1, 0, 1)] }).standings, m);
  assert.doesNotMatch(single.html, /rr-bracket-grid/);
});

test('a category card carries a column toggle only when it has several brackets', () => {
  const rows = [stand('NOD_1', 'Ann', 'Bo', 2, 0, 2, '1'), stand('NOD_2', 'Cy', 'Di', 1, 1, 1, '2')];
  const m = model({ display: DISPLAY, standings: rows });
  const html = categoryCardHTML('Novice Open Doubles', m.standings, m);
  assert.match(html, /bracket-cols-toggle[^>]*aria-pressed="false"[^>]*>1 col</);
  assert.match(html, /standings-col--wide/);
  assert.match(categoryCardHTML('Novice Open Doubles', m.standings, m, { stacked: new Set(['Novice Open Doubles']) }), /2 cols/);
});

test('categories group by label in display order', () => {
  const display = { divisions: { N: 'Novice', I: 'Intermediate' }, events: { OD: 'Open Doubles' } };
  const m = model({ display, standings: [stand('IOD_1', 'a', 'b', 0, 0, 0), stand('NOD_1', 'c', 'd', 0, 0, 0)] });
  const { sortedCats } = groupByCategory(m);
  assert.deepEqual(sortedCats, ['Novice Open Doubles', 'Intermediate Open Doubles']);
  const unresolved = new Set();
  groupByCategory(model({ display: DISPLAY, standings: [stand('QZZ_1', 'a', 'b', 0, 0, 0)] }), { unresolved });
  assert.ok(unresolved.size > 0);
});

test('the dual meet club bar sums Round Robin wins and takes a logo through its extension point', () => {
  const display = { divisions: { N: 'Novice' }, events: { OD: 'Open Doubles' }, clubs: { PNF: 'Pickle & Friends', BUP: 'Bataan' } };
  const m = model({ type: 'dual-meet', display, standings: [stand('PNF_NOD_1', 'a', 'b', 3, 0, 1), stand('BUP_NOD_1', 'c', 'd', 1, 2, 1)] });
  const byClub = new Map([['PNF', [m.standings[0]]], ['BUP', [m.standings[1]]]]);
  const html = clubSummaryHTML(byClub, ['PNF', 'BUP'], m, { clubLogoHTML: (code, name) => `<img class="cs-logo" alt="${name}">` });
  assert.match(html, /club-summary-item leader/);
  assert.match(html, /cs-logo" alt="Pickle &amp; Friends|cs-logo" alt="Pickle & Friends/);
  assert.equal(clubSummaryHTML(new Map([['PNF', [m.standings[0]]]]), ['PNF'], m), '');
});

test('dual meet desktop layouts: a grid with a side column, or one row of columns', () => {
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  try {
    const display = { divisions: { N: 'Novice', A: 'Advanced' }, events: { OD: 'Open Doubles', MD: 'Mens Doubles' }, clubs: { PNF: 'P', BUP: 'B' } };
    const standings = [
      stand('PNF_NOD_1', 'a', 'b', 1, 0, 1), stand('PNF_NMD_1', 'c', 'd', 1, 0, 1), stand('PNF_AMD_1', 'e', 'f', 1, 0, 1),
    ];
    const m = model({ type: 'dual-meet', display, standings });
    const grid = dualMeetStandingsHTML(m, {});
    assert.match(grid, /grid-column:1;grid-row:1;/);
    assert.match(grid, /standings-col-overflow/);
    const row = dualMeetStandingsHTML(m, { dualMeetDesktopLayout: 'row' });
    assert.doesNotMatch(row, /standings-col-overflow|grid-column/);
    assert.equal((row.match(/class="standings-col"/g) || []).length, 3);
  } finally {
    delete globalThis.window;
  }
});

test('the category toggle bar and the phone category search', () => {
  const bar = categoryToggleBarHTML(['A', 'B'], new Set(['B']));
  assert.match(bar, /cat-toggle-chip active" data-cat="A"/);
  assert.match(bar, /cat-toggle-chip hidden-cat" data-cat="B"/);
  assert.equal(categoryToggleBarHTML([], new Set()), '');
  assert.match(categoryAutocompleteHTML('no', ['Novice Open', 'Advanced']), /data-cat="Novice Open"/);
  assert.equal(categoryAutocompleteHTML('zzz', ['Novice Open']), '');
  assert.equal(categoryAutocompleteHTML('', Array.from({ length: 30 }, (_, i) => `C${i}`)).match(/ac-item/g).length, 20);
});
