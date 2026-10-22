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

// ---- the playoff bracket chart (standings-bracket-chart-spec §7.6) ---------------------------------------------

const LINKED_HEADER = 'teamCode,player1,player2,wins,loss,quotient,bracket,match,from';
const linkedModel = ({ type = 'standard', rows, matches = [] }) => buildDayModel(
  { key: 'e', type, title: 'E', display: DISPLAY, days: [] },
  { key: 'd', facilities: ['Main'] },
  { isLive: true, facilities: [{ name: 'Main', matchesCsv: [MATCH_HEADER, ...matches].join('\n'), standingsCsv: [LINKED_HEADER, ...rows].join('\n') }] },
  { now: 0 },
);
const slotRow = (code, match, from) => `${code},${code},,0,0,,,${match},${from}`;
const RR_ROWS = [stand('NOD_1', 'Ann', 'Bo', 2, 0, 2, '1') + ',,', stand('NOD_2', 'Cy', 'Di', 0, 2, 0.5, '1') + ',,', stand('NOD_3', 'Ed', 'Flo', 2, 0, 1.5, '2') + ',,', stand('NOD_4', 'Gus', 'Hal', 0, 2, 0.4, '2') + ',,'];
// A two-bracket category: two semifinals, a bronze and the Final (two rounds).
const TWO_BRACKETS = [
  ['NOD_SF_1', 'SF-1', ''], ['NOD_SF_2', 'SF-1', ''], ['NOD_SF_3', 'SF-2', ''], ['NOD_SF_4', 'SF-2', ''],
  ['NOD_B_1', 'B', 'L:SF-1'], ['NOD_B_2', 'B', 'L:SF-2'], ['NOD_F_1', 'F', 'W:SF-1'], ['NOD_F_2', 'F', 'W:SF-2'],
].map(r => slotRow(...r));
// A twice-to-beat category: one playoff round.
const SERIES = ['NOD_F_1_(1),Ann,Bo,0,0,,,F (1),', 'NOD_F_2_(1),Cy,Di,0,0,,,F (1),', 'NOD_F_1_(2),Ann,Bo,0,0,,,F (2),', 'NOD_F_2_(2),Cy,Di,0,0,,,F (2),'];
const CARD = 'Novice Open Doubles';

test('a standard category\'s Round Robin and Playoffs are section titles; the stages under them keep their captions', () => {
  const title = text => `<div class="standings-section-title"><span class="standings-section-text">${text}</span></div>`;
  const series = linkedModel({ rows: [...RR_ROWS, ...SERIES] });
  const html = categoryCardHTML(CARD, series.standings, series);
  assert.ok(html.includes(title('Round Robin')));
  assert.ok(html.includes(title('Playoffs')), 'with no switch, the title stands alone');
  assert.doesNotMatch(html, /stage-caption">(Round Robin|Playoffs)/);
  assert.match(html, /class="rr-bracket-label[^"]*">Bracket 1</, 'a bracket keeps its label under the title');
  const rrOnly = linkedModel({ rows: RR_ROWS });
  assert.doesNotMatch(categoryCardHTML(CARD, rrOnly.standings, rrOnly), /Playoffs/, 'no playoffs, no Playoffs title');
  assert.match(stageTablesHTML(series.standings, series).html, /stage-caption">Round Robin/, 'the stages alone (a dual meet\'s) are unchanged');
  assert.doesNotMatch(stageTablesHTML(series.standings, series).html, /standings-section-title/);
});

test('the List / Bracket switch is on a standard category with two or more playoff rounds, and nowhere else', () => {
  const eligible = linkedModel({ rows: [...RR_ROWS, ...TWO_BRACKETS] });
  const html = categoryCardHTML(CARD, eligible.standings, eligible);
  assert.match(html, /<div class="standings-view-switch" role="group" aria-label="Playoff view">/);
  assert.match(html, /data-standings-view="list" aria-pressed="true">List</);
  assert.match(html, /data-standings-view="bracket" aria-pressed="false">Bracket</);
  // It heads the playoffs, under the Round Robin, not the category's title.
  const [head, body] = html.split('<div class="standings-col-body">');
  assert.doesNotMatch(head, /standings-view-switch/);
  assert.match(body, /<div class="standings-section-title playoffs-head"><span class="standings-section-text">Playoffs<\/span><div class="standings-view-switch"/);
  assert.ok(body.indexOf('Round Robin') < body.indexOf('playoffs-head'));
  const bracketView = categoryCardHTML(CARD, eligible.standings, eligible, { view: 'bracket' }).split('<div class="standings-col-body">')[1];
  assert.ok(bracketView.indexOf('playoffs-head') < bracketView.indexOf('class="bk"'), 'above the chart too');
  const series = linkedModel({ rows: [...RR_ROWS, ...SERIES] });
  assert.doesNotMatch(categoryCardHTML(CARD, series.standings, series), /standings-view-switch/, 'one playoff round');
  const rrOnly = linkedModel({ rows: RR_ROWS });
  assert.doesNotMatch(categoryCardHTML(CARD, rrOnly.standings, rrOnly), /standings-view-switch/);
  const dual = linkedModel({ type: 'dual-meet', rows: TWO_BRACKETS.map(r => 'PNF_' + r) });
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  try {
    assert.doesNotMatch(dualMeetStandingsHTML(dual, {}), /standings-view-switch|class="bk/);
    assert.doesNotMatch(dualMeetStandingsHTML(dual, { view: 'bracket' }), /class="bk/, 'a dual meet ignores the option');
  } finally { delete globalThis.window; }
});

test('the switch shows the chosen view as pressed', () => {
  const m = linkedModel({ rows: [...RR_ROWS, ...TWO_BRACKETS] });
  const html = categoryCardHTML(CARD, m.standings, m, { view: 'bracket' });
  assert.match(html, /data-standings-view="list" aria-pressed="false">List</);
  assert.match(html, /data-standings-view="bracket" aria-pressed="true">Bracket</);
});

test('the List view is what it was: the same output with the option or without, and no chart', () => {
  const m = linkedModel({ rows: [...RR_ROWS, ...TWO_BRACKETS] });
  assert.equal(categoryCardHTML(CARD, m.standings, m, { view: 'list' }), categoryCardHTML(CARD, m.standings, m));
  assert.equal(stageTablesHTML(m.standings, m, { view: 'list' }).html, stageTablesHTML(m.standings, m).html);
  const list = stageTablesHTML(m.standings, m);
  assert.doesNotMatch(list.html, /class="bk/);
  assert.equal(list.bracketWidth, 0);
  assert.match(list.html, /stage-caption">Semifinals/);
  // The same category without the sheet's links is drawn the same way in List.
  const plain = model({ display: DISPLAY, standings: [stand('NOD_1', 'Ann', 'Bo', 2, 0, 2, '1'), stand('NOD_2', 'Cy', 'Di', 0, 2, 0.5, '1'),
    ...['NOD_SF_1', 'NOD_SF_2', 'NOD_SF_3', 'NOD_SF_4', 'NOD_F_1', 'NOD_F_2'].map(c => stand(c, c, '', 0, 0, 0))] });
  assert.equal(categoryCardHTML(CARD, plain.standings, plain, { view: 'list' }), categoryCardHTML(CARD, plain.standings, plain));
  assert.match(categoryCardHTML(CARD, plain.standings, plain), /standings-view-switch/, 'a finished event\'s sheet gets the switch too');
});

test('the Bracket view keeps the Round Robin and draws the chart in place of the stage blocks', () => {
  const m = linkedModel({ rows: [...RR_ROWS, ...TWO_BRACKETS] });
  const out = stageTablesHTML(m.standings, m, { view: 'bracket' });
  assert.match(out.html, /stage-caption">Round Robin/);
  assert.match(out.html, /<div class="bk" style="width:380px;/);
  assert.doesNotMatch(out.html, /stage-caption">Semifinals|stage-banner|class="matchup/);
  assert.equal(out.bracketWidth, 380);
  const series = linkedModel({ rows: [...RR_ROWS, ...SERIES] });
  assert.match(stageTablesHTML(series.standings, series, { view: 'bracket' }).html, /class="matchup/, 'one playoff round stays as cards');
});

test('a chart that does not fit its card is shown in a window that scrolls sideways, lines included', () => {
  const m = linkedModel({ rows: [...RR_ROWS, ...TWO_BRACKETS] });
  const fits = stageTablesHTML(m.standings, m, { view: 'bracket', availableWidth: 380 });
  assert.match(fits.html, /class="bk"/);
  assert.match(fits.html, /<button type="button" class="bk-full-open" data-bk-full="NOD">Full tree<\/button>/, 'a tablet gets Full tree with the whole chart too');
  assert.equal((fits.html.match(/bk-full-open/g) || []).length, 1);
  const narrow = stageTablesHTML(m.standings, m, { view: 'bracket', availableWidth: 300 });
  assert.match(narrow.html, /class="bk-rounds bk-rounds--fit"[^>]*data-bk-card-w="300" data-bk-per-view="1"/, 'one round fills the window');
  assert.match(narrow.html, /<div class="bk-track"[^>]*><div class="bk" style="width:636px;/);
  assert.match(narrow.html, /<path /);
  assert.equal((narrow.html.match(/bk-full-open/g) || []).length, 1, 'one Full tree button, not two');
  assert.equal(narrow.bracketWidth, 0, 'the column keeps its width');
});

test('a chart wider than the column widens it', () => {
  const m = linkedModel({ rows: [...RR_ROWS, ...TWO_BRACKETS] });
  const stacked = new Set([CARD]);
  const wide = categoryCardHTML(CARD, m.standings, m, { view: 'bracket', stacked });
  assert.match(wide, /<div class="standings-col[^"]*standings-col--bracket[^"]*" data-cat-key="Novice Open Doubles" style="--bk-col-w:408px">/);
  assert.doesNotMatch(categoryCardHTML(CARD, m.standings, m, { view: 'bracket', stacked, availableWidth: 300 }), /standings-col--bracket|--bk-col-w/);
  assert.doesNotMatch(categoryCardHTML(CARD, m.standings, m, { stacked }), /standings-col--bracket|--bk-col-w/);
  // Side by side, the column is two columns wide already, and a chart narrower than that leaves it so.
  assert.doesNotMatch(categoryCardHTML(CARD, m.standings, m, { view: 'bracket' }), /standings-col--bracket|--bk-col-w/);
});

test('on the desktop board a card keeps its 1 col / 2 col width in either view', () => {
  const m = linkedModel({ rows: [...RR_ROWS, ...TWO_BRACKETS] });
  const sideBySide = categoryCardHTML(CARD, m.standings, m, { view: 'bracket', fixedColumn: true, availableWidth: 300 });
  assert.match(sideBySide, /<div class="standings-col standings-col--wide" data-cat-key="Novice Open Doubles">/);
  assert.match(sideBySide, /<div class="bk" style="width:704px;/, 'two columns hold both rounds, stretched across the card (inside its border and scrollbar)');
  assert.match(sideBySide, /width:334px">/);
  assert.doesNotMatch(sideBySide, /bk-rounds|bk-chip/, 'nothing to swipe, so no chips');
  assert.equal((sideBySide.match(/bk-full-open/g) || []).length, 1);
  const stacked = categoryCardHTML(CARD, m.standings, m, { view: 'bracket', fixedColumn: true, stacked: new Set([CARD]) });
  assert.match(stacked, /<div class="standings-col standings-col--stacked" data-cat-key="Novice Open Doubles">/);
  assert.match(stacked, /class="bk-rounds bk-rounds--fit"[^>]*data-bk-card-w="325" data-bk-per-view="1"/, 'one column shows one round at a time');
  const oneBracket = linkedModel({ rows: [stand('NOD_1', 'Ann', 'Bo', 2, 0, 2) + ',,', stand('NOD_2', 'Cy', 'Di', 0, 2, 0.5) + ',,', ...TWO_BRACKETS] });
  const single = categoryCardHTML(CARD, oneBracket.standings, oneBracket, { view: 'bracket', fixedColumn: true });
  assert.match(single, /<div class="standings-col" data-cat-key="Novice Open Doubles">/);
  assert.match(single, /class="bk-rounds bk-rounds--fit"[^>]*data-bk-card-w="325" data-bk-per-view="1"/);
  assert.equal((single.match(/bk-full-open/g) || []).length, 1, 'Full tree is under the strip');
});

test('on the desktop board two columns show three rounds two at a time', () => {
  const qf = [1, 2, 3, 4].flatMap(n => [slotRow(`NOD_QF_${2 * n - 1}`, `QF-${n}`, ''), slotRow(`NOD_QF_${2 * n}`, `QF-${n}`, '')]);
  const later = [
    ['NOD_SF_1', 'SF-1', 'W:QF-1'], ['NOD_SF_2', 'SF-1', 'W:QF-2'], ['NOD_SF_3', 'SF-2', 'W:QF-3'], ['NOD_SF_4', 'SF-2', 'W:QF-4'],
    ['NOD_B_1', 'B', 'L:SF-1'], ['NOD_B_2', 'B', 'L:SF-2'], ['NOD_F_1', 'F', 'W:SF-1'], ['NOD_F_2', 'F', 'W:SF-2'],
  ].map(r => slotRow(...r));
  const m = linkedModel({ rows: [...RR_ROWS, ...qf, ...later] });
  const html = categoryCardHTML(CARD, m.standings, m, { view: 'bracket', fixedColumn: true });
  assert.match(html, /<div class="standings-col standings-col--wide" data-cat-key="Novice Open Doubles">/);
  assert.match(html, /class="bk-rounds bk-rounds--fit"[^>]*data-bk-card-w="334" data-bk-per-view="2"/, 'it would fit whole, but shows two rounds');
  assert.equal((html.match(/data-bk-round=/g) || []).length, 3);
});

test('a card hands the decorate hook to its chart', () => {
  const m = linkedModel({ rows: [...RR_ROWS, ...TWO_BRACKETS], matches: ['3,,9:00 AM,Court 1,NOD_SF_1,a,b,,NOD_SF_2,c,d,'] });
  const html = categoryCardHTML(CARD, m.standings, m, { view: 'bracket', decorateBracketMatch: match => ({ attrs: ` data-n="${match.num}"` }) });
  assert.match(html, /data-bk-match="SF-1" data-n="3"/);
});
