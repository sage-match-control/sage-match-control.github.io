// views/live-matches.js: the court grouping and the board's markup, on hand-made models.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import {
  courtSortKey, courtNumberFrom, buildFacilityCourtGroups, liveEmptyRowHTML, liveTableRowsHTML,
  facilityTableHTML, liveMetaHTML, renderLiveMatches, withCourtCell,
} from '../../../lib/v1/views/live-matches.js';
import { liveRowHTML } from '../../../lib/v1/views/teams.js';
import { eventConfig, loadSnapshot, caseTime } from '../../helpers/fixtures.mjs';

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
  assert.match(live, /<td class="live-cat-cell" colspan="3"><span class="live-num" title="Match 1">#1<\/span>/);
  assert.doesNotMatch(live, /live-match-pill/);
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
  assert.match(liveTableRowsHTML('2', m.matches.find(x => x.num === 1), m, { liveRow: () => null }), /live-num/);
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

// ---- courtCell: Control Center's Set match (control-center-court-control-spec.md §5.1) ----

const DECO = { className: 'court-settable', attrs: ' data-court-number="1" role="button"', html: '<span class="court-hint">✎ Set match</span>' };
const cellsOf = html => html.match(/<td class="live-court-cell[^"]*"/g) || [];

test('withCourtCell decorates the first court cell only, keeping its classes, and leaves the row alone for null', () => {
  const m = model([{ name: 'Main', rows: MAIN }]);
  const idle = liveTableRowsHTML('1', null, m);
  const decorated = withCourtCell(idle, DECO);
  assert.match(decorated, /<td class="live-court-cell idle court-settable" rowspan="2" data-court-number="1" role="button">1<span class="court-hint">✎ Set match<\/span><\/td>/);
  assert.equal(cellsOf(decorated).length, 1);
  assert.equal(withCourtCell(idle, null), idle);
  assert.equal(withCourtCell(idle, undefined), idle);
  const live = liveTableRowsHTML('2', m.matches.find(x => x.num === 1), m);
  assert.match(withCourtCell(live, { className: 'x' }), /<td class="live-court-cell x" rowspan="2"><span class="live-dot"/);
  assert.equal(withCourtCell('<tr>no cell</tr>', DECO), '<tr>no cell</tr>');
});

test('without the courtCell option nothing changes, byte for byte', () => {
  const m = model([{ name: 'Main', rows: MAIN }, { name: 'Annex', rows: ANNEX }]);
  const groups = buildFacilityCourtGroups(m);
  for (const [name, rows] of groups) {
    assert.equal(facilityTableHTML(name, rows, m, { courtCell: undefined }), facilityTableHTML(name, rows, m, {}));
    assert.equal(
      facilityTableHTML(name, rows, m, {}),
      `\n  ${m.day.facilities.length === 1 ? '' : `<div class="facility-title">${name} <span class="facility-count">${rows.filter(([, x]) => x).length} court${rows.filter(([, x]) => x).length === 1 ? '' : 's'} in play</span></div>`}\n  <div class="live-table-wrap" data-facility-key="${name}">\n    <table class="live-table">\n      <thead><tr>\n        <th>Court</th><th colspan="3">Match Details</th>\n      </tr></thead>\n      <tbody>${rows.map(([c, x]) => liveTableRowsHTML(c, x, m, {})).join('')}</tbody>\n    </table>\n  </div>`,
    );
  }
  const el = () => ({ innerHTML: '', querySelectorAll: () => [] });
  const a = el(), b = el();
  renderLiveMatches(m, { boardEl: a, courtCell: undefined });
  renderLiveMatches(m, { boardEl: b });
  assert.equal(a.innerHTML, b.innerHTML);
  assert.doesNotMatch(a.innerHTML, /court-settable/);
});

test('with courtCell every court gets exactly one decorated cell, and the option is called with (facility, court, match|null)', () => {
  const m = model([{ name: 'Main', rows: MAIN }, { name: 'Annex', rows: ANNEX }]);
  const calls = [];
  const el = () => ({ innerHTML: '', querySelectorAll: () => [] });
  const boardEl = el();
  renderLiveMatches(m, {
    boardEl,
    courtCell: (facility, court, match) => {
      calls.push([facility, court, match && match.num]);
      return { className: 'court-settable', attrs: ` data-court-facility="${facility}" data-court-number="${court}"`, html: '<span class="court-hint">hint</span>' };
    },
  });
  assert.deepEqual(calls, [['Main', '1', null], ['Main', '2', 1], ['Annex', '5', null]]);
  assert.equal((boardEl.innerHTML.match(/class="live-court-cell[^"]*court-settable"/g) || []).length, 3);
  assert.equal((boardEl.innerHTML.match(/<td class="live-court-cell/g) || []).length, 3);
  assert.match(boardEl.innerHTML, /<td class="live-court-cell idle court-settable" rowspan="2" data-court-facility="Main" data-court-number="1">1<span class="court-hint">hint<\/span><\/td>/);
  assert.match(boardEl.innerHTML, /<td class="live-court-cell court-settable" rowspan="2" data-court-facility="Main" data-court-number="2"><span class="live-dot" aria-hidden="true"><\/span>2<span class="court-hint">hint<\/span><\/td>/);
});

test('a courtCell that returns null leaves that court alone', () => {
  const m = model([{ name: 'Main', rows: MAIN }]);
  const el = { innerHTML: '', querySelectorAll: () => [] };
  renderLiveMatches(m, { boardEl: el, courtCell: (f, court) => (court === '1' ? null : DECO) });
  assert.equal((el.innerHTML.match(/court-settable/g) || []).length, 1);
});

test('a team event’s own live rows (options.liveRow) are decorated too, and an idle court gets null', () => {
  const EV = 'pickledrive-anniversary-2026';
  const team = buildDayModel(eventConfig(EV), eventConfig(EV).days[0], loadSnapshot(EV), { now: caseTime(EV), alwaysLive: true });
  // The fixture is a finished day; an unscored copy of a match is one still being played (a scored one is done).
  const match = { ...team.matches.find(x => x.t1p1 !== 'TBD'), played: false, t1Score: '', t2Score: '' };
  const rows = [['1', match], ['2', null]];
  const seen = [];
  const html = facilityTableHTML('Main', rows, team, {
    liveRow: (court, x) => liveRowHTML(team, court, x),
    courtCell: (facility, court, x) => { seen.push([facility, court, x && x.num]); return { className: 'court-settable', html: '<span class="court-hint">h</span>' }; },
  });
  assert.deepEqual(seen, [['Main', '1', match.num], ['Main', '2', null]]);
  assert.equal(cellsOf(html).length, 2);
  assert.equal((html.match(/court-settable/g) || []).length, 2);
  assert.match(html, /live-dot" aria-hidden="true"><\/span>1<span class="court-hint">h<\/span><\/td>/);
});

// ---- markPlayer and matchNote (mission-control-layout-spec §9.2): a page's own mark and count ----

test('markPlayer marks a name and matchNote ends the category line; without them the rows are as before', () => {
  const m = model([{ name: 'Main', rows: MAIN }]);
  const live = m.matches.find(x => x.num === 1);
  const plain = liveTableRowsHTML('2', live, m);
  assert.equal(liveTableRowsHTML('2', live, m, { markPlayer: () => '', matchNote: () => '' }), plain);
  const seen = [];
  const html = liveTableRowsHTML('2', live, m, {
    markPlayer: (name, match) => { seen.push([name, match.num]); return name === 'Cy' ? 'flag' : ''; },
    matchNote: match => `<span class="note">${match.num} note</span>`,
  });
  assert.match(html, /<span class="p">Ann<\/span><span class="p">Bo<\/span>/);
  assert.match(html, /<span class="p flag">Cy<\/span><span class="p">Di<\/span>/);
  assert.match(html, /<span class="live-round">Round Robin<\/span><span class="note">1 note<\/span><\/td>/);
  assert.deepEqual(seen.map(s => s[0]).sort(), ['Ann', 'Bo', 'Cy', 'Di']);
  assert.equal(html.replace(' flag', '').replace('<span class="note">1 note</span>', ''), plain);
});

test('matchNote returning nothing adds nothing, and an idle court is untouched', () => {
  const m = model([{ name: 'Main', rows: MAIN }]);
  const live = m.matches.find(x => x.num === 1);
  assert.equal(liveTableRowsHTML('2', live, m, { matchNote: () => undefined }), liveTableRowsHTML('2', live, m));
  assert.equal(liveTableRowsHTML('5', null, m, { markPlayer: () => 'flag', matchNote: () => 'x' }), liveTableRowsHTML('5', null, m));
});

// ---- the match number's corner tab and a finished match still on court (the owner's request of 2026-11-22) ----

const DONE_ROWS = [
  row(1, '2', 2, 'ND_1', 'Ann', 'Bo', '', 'ND_2', 'Cy', 'Di', ''),      // on court 2, no score: in play
  row(2, '1', 1, 'ND_3', 'Ed', 'Flo', 11, 'ND_4', 'Gus', 'Hal', 4),     // on court 1, both scores in: done
];

test('an idle row has no number tab, but its strip keeps the same cell, so its height matches', () => {
  const m = model([{ name: 'Main', rows: MAIN }]);
  assert.doesNotMatch(liveTableRowsHTML('1', null, m), /live-num/);
  assert.match(liveTableRowsHTML('1', null, m), /<td class="live-cat-cell" colspan="3">/);
});

test('a match with both scores in still on its court is done: a check mark for the dot, a Done note, its rows marked', () => {
  const m = model([{ name: 'Main', rows: DONE_ROWS }]);
  const done = liveTableRowsHTML('1', m.matches.find(x => x.num === 2), m);
  assert.match(done, /<tr class="live-done">\s*<td class="live-court-cell done" rowspan="2"><span class="live-done-mark" aria-hidden="true">✓<\/span>1<\/td>/);
  assert.doesNotMatch(done, /live-dot/);
  assert.match(done, /<span class="live-done-note">Done<\/span><\/td>/);
  assert.match(done, /<tr class="live-match-row live-done">/);
  assert.match(done, /live-vs-score">11&ndash;4</);
  const live = liveTableRowsHTML('2', m.matches.find(x => x.num === 1), m);
  assert.doesNotMatch(live, /live-done|done"/);
  assert.match(live, /<td class="live-court-cell" rowspan="2"><span class="live-dot"/);
});

test('a series game that will never be played counts as done on its court too, scores or not', () => {
  const m = model([{ name: 'Main', rows: DONE_ROWS }]);
  const unplayed = m.matches.find(x => x.num === 1);
  assert.doesNotMatch(liveTableRowsHTML('2', unplayed, m), /live-done/);
  m.unneededGames.add(unplayed);
  assert.match(liveTableRowsHTML('2', unplayed, m), /<td class="live-court-cell done"/);
});

test('a decorated done court keeps its done class', () => {
  const m = model([{ name: 'Main', rows: DONE_ROWS }]);
  const html = withCourtCell(liveTableRowsHTML('1', m.matches.find(x => x.num === 2), m), { className: 'court-settable' });
  assert.match(html, /<td class="live-court-cell done court-settable" rowspan="2">/);
});

test('without countDone the counts are as before; with it, a done court counts apart from the courts in play', () => {
  const two = model([{ name: 'Main', rows: DONE_ROWS }, { name: 'Annex', rows: ANNEX }]);
  const groups = buildFacilityCourtGroups(two);
  assert.match(liveMetaHTML(groups), /<b>2<\/b><span>courts in play<\/span>/);
  const isDone = x => x.played;
  assert.match(liveMetaHTML(groups, isDone), /<b>1<\/b><span>court in play &middot; 1 done<\/span>/);
  const rows = groups.get('Main');
  assert.match(facilityTableHTML('Main', rows, two), /facility-count">2 courts in play</);
  assert.match(facilityTableHTML('Main', rows, two, { countDone: true }), /facility-count">1 court in play &middot; 1 done</);
  const el = () => ({ innerHTML: '', querySelectorAll: () => [] });
  const metaEl = el();
  renderLiveMatches(two, { boardEl: el(), metaEl, countDone: true });
  assert.match(metaEl.innerHTML, /<b>1<\/b><span>court in play &middot; 1 done/);
  assert.doesNotMatch(liveMetaHTML(buildFacilityCourtGroups(model([{ name: 'Main', rows: MAIN }])), isDone), /done/, 'no done court: no done count');
});

test('a team event’s own live row has the tab in its strip and the same done state', () => {
  const EV = 'pickledrive-anniversary-2026';
  const team = buildDayModel(eventConfig(EV), eventConfig(EV).days[0], loadSnapshot(EV), { now: caseTime(EV), alwaysLive: true });
  const unplayed = { ...team.matches.find(x => x.t1p1 !== 'TBD'), played: false, t1Score: '', t2Score: '' };
  const played = team.matches.find(x => x.played);
  const live = liveRowHTML(team, '1', unplayed);
  assert.match(live, new RegExp(`<td class="live-cat-cell" colspan="3"><span class="live-num" title="Match ${unplayed.num}">#${unplayed.num}</span>`));
  assert.doesNotMatch(live, /live-match-pill|live-done/);
  const done = liveRowHTML(team, '2', played);
  assert.match(done, /<td class="live-court-cell done" rowspan="2"><span class="live-done-mark" aria-hidden="true">✓<\/span>2<\/td>/);
  assert.match(done, /<span class="live-done-note">Done<\/span>/);
  assert.match(done, /<tr class="live-match-row live-done">/);
});
