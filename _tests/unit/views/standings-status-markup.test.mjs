// The status pill in a round-robin table's header and the tie pills under a row's names
// (views/standings.js, views/ticket.js's pairCell `after`, views/teams.js). Step 4 of the Hub player experience.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import { pairCell } from '../../../lib/v1/views/ticket.js';
import { stageTablesHTML, categoryCardHTML } from '../../../lib/v1/views/standings.js';
import { groupTableHTML, teamStandingsHTML } from '../../../lib/v1/views/teams.js';
import { eventConfig, loadSnapshot, caseTime } from '../../helpers/fixtures.mjs';

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

// Bracket 1: three pairs, two of the three meetings played. Bracket 2: a circle, all played. Bracket 3: a draw, played.
const MATCHES = [
  mrow(1, 'NOD_1', 11, 'NOD_2', 4), mrow(2, 'NOD_1', 11, 'NOD_3', 6), mrow(3, 'NOD_2', '', 'NOD_3', ''),
  mrow(4, 'NOD_4', 11, 'NOD_5', 5), mrow(5, 'NOD_5', 11, 'NOD_6', 9), mrow(6, 'NOD_6', 11, 'NOD_4', 3),
  mrow(7, 'NOD_7', 11, 'NOD_8', 11),
];
const STANDINGS = [
  stand('NOD_1', 'Ann', 'Bo', 2, 0, 1.9412, '1'), stand('NOD_2', 'Cy', 'Di', 0, 1, 0.3636, '1'), stand('NOD_3', 'Ed', 'Flo', 0, 1, 0.5455, '1'),
  stand('NOD_4', 'Gus', 'Hal', 1, 1, 0.875, '2'), stand('NOD_5', 'Ian', 'Jo', 1, 1, 0.8, '2'), stand('NOD_6', 'Kai', 'Lee', 1, 1, 1.4286, '2'),
  stand('NOD_7', 'Mo', 'Ned', 0, 1, 1, '3'), stand('NOD_8', 'Olu', 'Pat', 0, 1, 1, '3'),
];
const live = () => model({ display: DISPLAY, matches: MATCHES, standings: STANDINGS });

/** The HTML of one bracket's block: from its label to the end of its table. */
const bracketBlock = (html, n) => {
  const start = html.indexOf(`>Bracket ${n}`);
  assert.ok(start > -1, `Bracket ${n} is drawn`);
  const end = html.indexOf('</table>', start);
  return html.slice(start, end);
};

test('each bracket\'s label carries its own status pill', () => {
  const m = live();
  const { html } = stageTablesHTML(m.standings, m);
  assert.match(bracketBlock(html, 1), /^>Bracket 1<span class="rr-status rr-status--progress">In progress · 2\/3<\/span><\/div>/);
  assert.match(bracketBlock(html, 2), /^>Bracket 2<span class="rr-status rr-status--final">Final<\/span><\/div>/);
  assert.match(bracketBlock(html, 3), /rr-status rr-status--final">Final</);
  assert.equal((html.match(/class="rr-status /g) || []).length, 3);
});

test('a single table has the pill in its Round Robin heading: a caption, or a card\'s section title', () => {
  const m = model({ display: DISPLAY, matches: MATCHES.slice(0, 3), standings: STANDINGS.slice(0, 3).map(s => s.replace(/,1$/, ',')) });
  const caption = stageTablesHTML(m.standings, m).html;
  assert.match(caption, /<div class="stage-caption">Round Robin<span class="rr-status rr-status--progress">In progress · 2\/3<\/span><\/div>/);
  assert.equal((caption.match(/class="rr-status /g) || []).length, 1);
  const card = categoryCardHTML('Novice Open Doubles', m.standings, m);
  assert.match(card, /<span class="standings-section-text">Round Robin<span class="rr-status rr-status--progress">In progress · 2\/3<\/span><\/span>/);
});

test('the dual meet\'s one table per club has one pill in its heading for the whole table', () => {
  const m = live();
  const { html } = stageTablesHTML(m.standings, m, { rrBracketLayout: 'column' });
  assert.equal((html.match(/class="rr-status /g) || []).length, 1);
  // 8 pairs, 7 meetings drawn, the third meeting unplayed
  assert.match(html, /<div class="stage-caption">Round Robin<span class="rr-status rr-status--progress">In progress · 6\/7<\/span><\/div>/);
});

test('before the day is live there are no pills', () => {
  const m = model({ display: DISPLAY, matches: MATCHES, standings: STANDINGS, isLive: false });
  const grid = stageTablesHTML(m.standings, m).html;
  const column = stageTablesHTML(m.standings, m, { rrBracketLayout: 'column' }).html;
  [grid, column, categoryCardHTML('Novice Open Doubles', m.standings, m)].forEach(html => {
    assert.doesNotMatch(html, /rr-status|rr-tie/);
  });
});

test('a tie pill sits under a pair\'s two names, and Tied is its own colour', () => {
  const m = live();
  const { html } = stageTablesHTML(m.standings, m);
  const b2 = bracketBlock(html, 2);
  assert.equal((b2.match(/<span class="rr-tie">3-way tie · on quotient<\/span>/g) || []).length, 3);
  assert.match(b2, /<span>Kai<\/span><span>Lee<\/span><span class="rr-tie">3-way tie · on quotient<\/span><\/td>/);
  const b3 = bracketBlock(html, 3);
  assert.equal((b3.match(/<span class="rr-tie rr-tie--tied">Tied<\/span>/g) || []).length, 2);
  // Bracket 1: the winner of both its meetings is level with no one and has none; the two pairs on 0 wins, who have
  // not met, go on quotient
  const b1 = bracketBlock(html, 1);
  assert.equal((b1.match(/<span class="rr-tie">Tie · on quotient<\/span>/g) || []).length, 2);
  assert.doesNotMatch(b1.split('</tr>')[0], /rr-tie/);
});

test('a head-to-head pill names the score', () => {
  const standings = [stand('NOD_1', 'Ann', 'Bo', 1, 1, 0.9, '1'), stand('NOD_2', 'Cy', 'Di', 1, 1, 1.4, '1'), stand('NOD_3', 'Ed', 'Flo', 0, 2, 0.4, '1')];
  const matches = [mrow(1, 'NOD_1', 11, 'NOD_2', 5), mrow(2, 'NOD_2', 11, 'NOD_3', 3), mrow(3, 'NOD_3', 7, 'NOD_1', 11)];
  const m = model({ display: DISPLAY, matches, standings });
  const { html } = stageTablesHTML(m.standings, m);
  assert.match(html, /<span class="rr-tie">Tie · won head-to-head 11–5<\/span>/);
  assert.match(html, /<span class="rr-tie">Tie · lost head-to-head 5–11<\/span>/);
});

test('pairCell: the `after` option goes inside the cell, after the names; without it nothing changes', () => {
  const m = live();
  const s = m.standings.find(x => x.teamCode === 'NOD_4');
  assert.equal(pairCell(s, m), pairCell(s, m, {}));
  assert.doesNotMatch(pairCell(s, m), /rr-tie/);
  assert.match(pairCell(s, m, { after: '<i>x</i>' }), /<span>Gus<\/span><span>Hal<\/span><i>x<\/i><\/td>$/);
  const tbd = { ...s, player1: '', player2: '' };
  assert.doesNotMatch(pairCell(tbd, m, { after: '<i>x</i>' }), /<i>x<\/i>/);
});

test("the real fixture: Novice Men's Doubles, every bracket Final and Bracket 3's two pairs Tied", () => {
  const ev = 'pickle-for-sight-2026';
  const snapshot = loadSnapshot(ev);
  const m = buildDayModel(eventConfig(ev), eventConfig(ev).days[0], snapshot, { now: caseTime(ev) });
  const rows = m.standings.filter(s => s.teamCode.startsWith('NMD_'));
  const html = stageTablesHTML(rows, m).html;
  assert.equal((html.match(/rr-status--final">Final</g) || []).length, 4);       // the finished fixture: all four brackets
  assert.equal((html.match(/rr-tie rr-tie--tied">Tied</g) || []).length, 2);     // Bracket 3's two pairs on 0 wins
});

// ---- a team event's bracket tables ----------------------------------------------------------------------

const TEAM = 'pickledrive-anniversary-2026';
const teamModel = (edit = {}, snapshot = loadSnapshot(TEAM)) => buildDayModel({ ...eventConfig(TEAM), ...edit }, eventConfig(TEAM).days[0], snapshot, { now: caseTime(TEAM), alwaysLive: true });

test('a team bracket\'s title carries the pill, in both scoring rules', () => {
  for (const teamScoring of ['points', 'games']) {
    const m = teamModel({ teamScoring });
    const groups = new Map();
    m.standings.filter(s => s.bracket && m.team.rowByCode.has(s.teamCode)).forEach(s => { if (!groups.has(s.bracket)) groups.set(s.bracket, []); groups.get(s.bracket).push(s); });
    assert.ok(groups.size >= 2);
    groups.forEach((rows, g) => {
      const html = groupTableHTML(m, g, rows);
      assert.match(html, new RegExp(`<h3 class="group-title">Bracket ${g}<span class="rr-status rr-status--final">Final</span></h3>`), `${teamScoring} ${g}`);
      assert.doesNotMatch(html, /rr-tie/);
    });
  }
  assert.ok(teamStandingsHTML(teamModel()).includes('rr-status'));
});

test('a team bracket with a matchup left reads In progress, and before the day is live there is no pill', () => {
  const snapshot = JSON.parse(JSON.stringify(loadSnapshot(TEAM)));
  const probe = teamModel({}, snapshot);
  const mu = probe.team.matchups.find(x => x.stage === null && x.group !== null);
  // blank every score of that matchup's matches
  const nums = new Set(mu.matches.map(x => x.num));
  snapshot.facilities.forEach(f => {
    const lines = f.matchesCsv.split(/\r?\n/);
    const h = lines[0].split(',').map(x => x.trim());
    const [iN, i1, i2] = [h.indexOf('matchNumber'), h.indexOf('team1Score'), h.indexOf('team2Score')];
    f.matchesCsv = lines.map((l, i) => {
      if (!i || !l) return l;
      const c = l.split(',');
      if (!nums.has(parseInt(c[iN], 10))) return l;
      c[i1] = ''; c[i2] = '';
      return c.join(',');
    }).join('\n');
  });
  const m = teamModel({}, snapshot);
  const rows = m.standings.filter(s => s.bracket === String(mu.group) && m.team.rowByCode.has(s.teamCode));
  const html = groupTableHTML(m, String(mu.group), rows);
  assert.match(html, /<span class="rr-status rr-status--progress">In progress · \d+\/\d+<\/span><\/h3>/);
  const dark = buildDayModel(eventConfig(TEAM), eventConfig(TEAM).days[0], { ...snapshot, isLive: false }, { now: 0 });
  assert.equal(dark.isLive, false);
  assert.doesNotMatch(teamStandingsHTML(dark), /rr-status/);
});
