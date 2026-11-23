// domain/standings-status.js: how far a round-robin table has got, how a tie in it was broken, and a team
// bracket's progress. Hand-made matches for the rules, the fixture events for the real tables.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import { rankStandings } from '../../../lib/v1/domain/standings.js';
import { tableProgress, tieBreaks, teamTableProgress, progressLabel, tieLabel } from '../../../lib/v1/domain/standings-status.js';
import { eventConfig, loadSnapshot, caseTime, deriveState, parseCsv, toCsv } from '../../helpers/fixtures.mjs';

// ---- hand-made data ------------------------------------------------------------------------------------

const row = (code, wins, loss, quotient = null, extra = {}) => ({ teamCode: code, player1: code + 'a', player2: code + 'b', wins, loss, quotient, bracket: '', ...extra });
let nextNum = 1;
const match = (t1, s1, t2, s2, extra = {}) => ({
  num: nextNum++, t1, t2, t1p1: t1 + 'a', t1p2: t1 + 'b', t2p1: t2 + 'a', t2p2: t2 + 'b',
  t1Score: s1, t2Score: s2, played: s1 !== null && s2 !== null, bestOf: null, facility: 'Main', matchUp: '', ...extra,
});

test('tableProgress counts a table\'s round-robin meetings, played over total', () => {
  const rows = [row('NOD_1', 1, 0), row('NOD_2', 0, 1), row('NOD_3', 0, 0)];
  const matches = [match('NOD_1', 11, 'NOD_2', 4), match('NOD_1', null, 'NOD_3', null), match('NOD_2', null, 'NOD_3', null)];
  assert.deepEqual(tableProgress(rows, matches, 'standard'), { played: 1, total: 3 });
  matches.forEach(m => { m.t1Score = 11; m.t2Score = 3; m.played = true; });
  assert.deepEqual(tableProgress(rows, matches, 'standard'), { played: 3, total: 3 });
});

test('a playoff match, another category\'s match and a BYE meeting are not the table\'s meetings', () => {
  const rows = [row('NOD_1', 1, 0), row('NOD_2', 0, 1), row('NOD_3', 0, 0)];
  const matches = [
    match('NOD_1', 11, 'NOD_2', 4),
    match('NOD_QF_1', 11, 'NOD_QF_2', 2),               // a playoff
    match('NXD_1', null, 'NXD_2', null),                 // another category's table
    match('NOD_3', null, 'BYE', null),                   // a BYE, by code
    { ...match('NOD_2', null, 'NOD_9', null), t2p1: 'Bye', t2p2: 'bye' }, // a BYE, by player name
  ];
  assert.deepEqual(tableProgress(rows, matches, 'standard'), { played: 1, total: 1 });
});

test('a match counts once, however many of its sides are rows of the table', () => {
  const rows = [row('NOD_1', 0, 0), row('NOD_2', 0, 0)];
  assert.deepEqual(tableProgress(rows, [match('NOD_1', 11, 'NOD_2', 7)], 'standard'), { played: 1, total: 1 });
});

test('a best-of-3 meeting is one meeting, played once a side has two games', () => {
  const rows = [row('NOD_1', 0, 0), row('NOD_2', 0, 0), row('NOD_3', 0, 0)];
  const bo3 = (a, b, g) => g.map(([s1, s2]) => match(a, s1, b, s2, { bestOf: 3 }));
  // 1 v 2: the first two games both go to NOD_1, the third is never played; 1 v 3: split 1-1 so far
  const matches = [...bo3('NOD_1', 'NOD_2', [[11, 3], [11, 5], [null, null]]), ...bo3('NOD_1', 'NOD_3', [[11, 3], [4, 11], [null, null]]), match('NOD_2', 11, 'NOD_3', 6)];
  assert.deepEqual(tableProgress(rows, matches, 'standard'), { played: 2, total: 3 });
  matches[5].t1Score = 11; matches[5].t2Score = 8; matches[5].played = true;
  assert.deepEqual(tableProgress(rows, matches, 'standard'), { played: 3, total: 3 });
});

test('a dual meet\'s club table counts the cross-club matches its rows play in', () => {
  const rows = [row('PNF_LIMD_1', 1, 0), row('PNF_LIMD_2', 0, 1)];
  const matches = [match('PNF_LIMD_1', 11, 'BUP_LIMD_1', 4), match('PNF_LIMD_2', null, 'BUP_LIMD_2', null), match('BUP_LIMD_3', null, 'BUP_LIMD_4', null)];
  assert.deepEqual(tableProgress(rows, matches, 'dual-meet'), { played: 1, total: 2 });
});

test('a table with no meetings has total 0', () => {
  assert.deepEqual(tableProgress([row('NOD_1', 0, 0)], [], 'standard'), { played: 0, total: 0 });
});

// ---- tie pills, on hand-made data ------------------------------------------------------------------------

test('two pairs level on wins are separated by head-to-head, with the pair\'s own side first', () => {
  const rows = [row('A', 2, 1, 0.9), row('B', 2, 1, 1.4), row('C', 0, 3, 0.2)];
  const ties = tieBreaks(rows, [match('A', 11, 'B', 5)]);
  assert.deepEqual(ties.get('A'), { size: 2, rule: 'h2h', won: true, score: '11–5' });
  assert.deepEqual(ties.get('B'), { size: 2, rule: 'h2h', won: false, score: '5–11' });
  assert.equal(ties.has('C'), false);
  // the same meeting entered the other way round reads the same for each pair
  const flipped = tieBreaks(rows, [match('B', 5, 'A', 11)]);
  assert.equal(flipped.get('A').score, '11–5');
  assert.equal(flipped.get('B').score, '5–11');
});

test('a best-of-3 meeting reads in games, a double round robin in meetings', () => {
  const rows = [row('A', 1, 1, 1), row('B', 1, 1, 1)];
  const bo3 = [match('A', 11, 'B', 5, { bestOf: 3 }), match('B', 11, 'A', 3, { bestOf: 3 }), match('A', 11, 'B', 9, { bestOf: 3 })];
  const games = tieBreaks(rows, bo3);
  assert.equal(games.get('A').rule, 'h2h');
  assert.equal(games.get('A').score, '2–1');
  assert.equal(games.get('B').score, '1–2');
  const double = tieBreaks(rows, [match('A', 11, 'B', 5), match('B', 4, 'A', 11)]);
  assert.equal(double.get('A').score, '2–0');
  assert.equal(double.get('B').score, '0–2');
});

test('a drawn match or an undecided meeting counts for neither pair: they are level on head-to-head', () => {
  const rows = [row('A', 0, 1, 0.5), row('B', 0, 1, 0.25)];
  const drawn = tieBreaks(rows, [match('A', 11, 'B', 11)]);
  assert.deepEqual(drawn.get('A'), { size: 2, rule: 'quotient' });
  assert.deepEqual(drawn.get('B'), { size: 2, rule: 'quotient' });
  const undecided = tieBreaks(rows, [match('A', 11, 'B', 3, { bestOf: 3 })]);
  assert.equal(undecided.get('A').rule, 'quotient');
});

test('level on head-to-head and on quotient: Tied; pairs that never met go on quotient', () => {
  const same = tieBreaks([row('A', 0, 1, 0.5), row('B', 0, 1, 0.5)], [match('A', 11, 'B', 11)]);
  assert.deepEqual(same.get('A'), { size: 2, rule: 'none' });
  assert.deepEqual(same.get('B'), { size: 2, rule: 'none' });
  const apart = tieBreaks([row('PNF_1', 2, 2, 1.0), row('PNF_2', 2, 2, 0.79)], []);
  assert.deepEqual(apart.get('PNF_1'), { size: 2, rule: 'quotient' });
  // an empty quotient is the lowest, and two of them are level
  const empty = tieBreaks([row('A', 0, 1, null), row('B', 0, 1, null)], []);
  assert.equal(empty.get('A').rule, 'none');
});

test('three or more: a row whose head-to-head wins are its own reads head-to-head, the rest go on quotient or are Tied', () => {
  // A beat B and C; B and C never met: A is on head-to-head, B and C share 0 wins, their quotients differ
  const rows = [row('A', 2, 2, 1), row('B', 2, 2, 1.2), row('C', 2, 2, 0.8)];
  const ties = tieBreaks(rows, [match('A', 11, 'B', 5), match('A', 11, 'C', 5)]);
  assert.deepEqual(ties.get('A'), { size: 3, rule: 'h2h' });
  assert.deepEqual(ties.get('B'), { size: 3, rule: 'quotient' });
  assert.deepEqual(ties.get('C'), { size: 3, rule: 'quotient' });
  // the same with B and C on one quotient: Tied
  const level = tieBreaks([row('A', 2, 2, 1), row('B', 2, 2, 1.2), row('C', 2, 2, 1.2)], [match('A', 11, 'B', 5), match('A', 11, 'C', 5)]);
  assert.equal(level.get('A').rule, 'h2h');
  assert.equal(level.get('B').rule, 'none');
  assert.equal(level.get('C').rule, 'none');
  // a circle: every pair has one head-to-head win, so the quotients decide
  const circle = tieBreaks([row('A', 1, 1, 1), row('B', 1, 1, 1.5), row('C', 1, 1, 0.7)],
    [match('A', 11, 'B', 5), match('B', 11, 'C', 5), match('C', 11, 'A', 5)]);
  ['A', 'B', 'C'].forEach(c => assert.deepEqual(circle.get(c), { size: 3, rule: 'quotient' }));
});

test('rows with nothing played get nothing, and a row level with no other has no pill', () => {
  const ties = tieBreaks([row('A', 0, 0, null), row('B', 0, 0, null), row('C', 1, 0, 2)], []);
  assert.equal(ties.size, 0);
});

// ---- the fixture tables --------------------------------------------------------------------------------

const PFS = 'pickle-for-sight-2026';
function fixtureModel(ev, state = 'final', edit) {
  let snapshot = state === 'final' ? loadSnapshot(ev) : deriveState(loadSnapshot(ev), state);
  if (edit) { snapshot = JSON.parse(JSON.stringify(snapshot)); edit(snapshot); }
  return buildDayModel(eventConfig(ev), eventConfig(ev).days[0], snapshot, { now: caseTime(ev) });
}
const table = (m, cat, bracket) => m.standings.filter(s => s.bracket === bracket && new RegExp(`^${cat}_\\d+$`).test(s.teamCode));
const progress = (m, cat, bracket) => tableProgress(table(m, cat, bracket), m.matches, m.event.type);

/** Match 1085 with its scores swapped (Jairus Villanueva's pair beats Charles Casas's 11-10) and the two standings rows recounted. */
function swap1085(snapshot) {
  for (const f of snapshot.facilities) {
    const rows = parseCsv(f.matchesCsv);
    const h = rows[0].map(x => x.trim());
    const r = rows.find((x, i) => i && x[h.indexOf('matchNumber')] === '1085');
    if (!r) continue;
    const [i1, i2] = [h.indexOf('team1Score'), h.indexOf('team2Score')];
    [r[i1], r[i2]] = [r[i2], r[i1]];
    f.matchesCsv = toCsv(rows);
    const st = parseCsv(f.standingsCsv);
    const sh = st[0].map(x => x.trim());
    const set = (code, wins, loss, q) => {
      const s = st.find((x, i) => i && x[sh.indexOf('teamCode')] === code);
      s[sh.indexOf('wins')] = wins; s[sh.indexOf('loss')] = loss; s[sh.indexOf('quotient')] = q;
    };
    set('NXD_6', '1', '2', '0.8125'); // 11-10, 3-11... recounted: PF 26, PA 32
    set('NXD_8', '1', '2', '0.5313'); // PF 17, PA 32
    f.standingsCsv = toCsv(st);
  }
}

test('counts on the final, mid and pre fixture states', () => {
  assert.deepEqual(progress(fixtureModel(PFS, 'final'), 'NXD', '2'), { played: 6, total: 6 });
  assert.deepEqual(progress(fixtureModel(PFS, 'pre'), 'NXD', '2'), { played: 0, total: 6 });
  // mid-day keeps the lower-numbered half of the matches: Novice Men's Doubles Brackets 1 and 2 are
  // 6 of 10 meetings in, Bracket 3 is over, and Novice Mixed Doubles has not started
  const mid = fixtureModel(PFS, 'mid');
  assert.deepEqual(progress(mid, 'NMD', '1'), { played: 6, total: 10 });
  assert.deepEqual(progress(mid, 'NMD', '2'), { played: 6, total: 10 });
  assert.deepEqual(progress(mid, 'NMD', '3'), { played: 6, total: 6 });
  assert.deepEqual(progress(mid, 'NXD', '2'), { played: 0, total: 6 });
  // every table of the final fixture is over
  const m = fixtureModel(PFS, 'final');
  const brackets = new Set(m.standings.filter(s => /^[A-Z]+_\d+$/.test(s.teamCode)).map(s => s.teamCode.split('_')[0] + '|' + s.bracket));
  brackets.forEach(key => {
    const [cat, br] = key.split('|');
    const p = progress(m, cat, br);
    assert.equal(p.played, p.total, `${key} is not over: ${p.played}/${p.total}`);
    assert.ok(p.total > 0, key);
  });
});

test('a dual meet\'s club table counts the matches against the other club', () => {
  const ev = 'pnf-x-bup-dual-meet';
  const m = fixtureModel(ev, 'final');
  const rows = m.standings.filter(s => /^PNF_LIWD_\d+$/.test(s.teamCode));
  const p = tableProgress(rows, m.matches, m.event.type);
  assert.equal(p.played, p.total);
  assert.ok(p.total >= 4);
  assert.equal(tableProgress(rows, fixtureModel(ev, 'pre').matches, m.event.type).played, 0);
});

test('Pickle for Sight\'s Novice Mixed Doubles Bracket 2: a circle on 2 wins, three on quotient', () => {
  const m = fixtureModel(PFS, 'final');
  const rows = table(m, 'NXD', '2');
  const ties = tieBreaks(rows, m.matches);
  ['NXD_6', 'NXD_7', 'NXD_9'].forEach(c => assert.deepEqual(ties.get(c), { size: 3, rule: 'quotient' }, c));
  assert.equal(ties.has('NXD_8'), false);
});

test('the same bracket with match 1085 swapped: two pairs on head-to-head, scores 11–5 and 11–10', () => {
  const m = fixtureModel(PFS, 'final', swap1085);
  assert.equal(m.matches.find(x => x.num === 1085).t1Score, 10);
  const ties = tieBreaks(table(m, 'NXD', '2'), m.matches);
  assert.deepEqual(ties.get('NXD_7'), { size: 2, rule: 'h2h', won: true, score: '11–5' });   // Chun Sa beat Mark Luz
  assert.deepEqual(ties.get('NXD_9'), { size: 2, rule: 'h2h', won: false, score: '5–11' });
  assert.deepEqual(ties.get('NXD_8'), { size: 2, rule: 'h2h', won: true, score: '11–10' });  // Jairus Villanueva's pair beat Charles Casas's
  assert.deepEqual(ties.get('NXD_6'), { size: 2, rule: 'h2h', won: false, score: '10–11' });
});

test('Novice Men\'s Doubles Bracket 3: two pairs on 0 wins who drew with the same quotient are Tied', () => {
  const m = fixtureModel(PFS, 'final');
  const ties = tieBreaks(table(m, 'NMD', '3'), m.matches);
  assert.deepEqual(ties.get('NMD_11'), { size: 2, rule: 'none' });
  assert.deepEqual(ties.get('NMD_13'), { size: 2, rule: 'none' });
  assert.equal(ties.has('NMD_12'), false);
  assert.equal(ties.has('NMD_14'), false);
});

test('PNF x BUP: pairs of a club table never meet, so their ties read on quotient', () => {
  const m = fixtureModel('pnf-x-bup-dual-meet', 'final');
  const rows = m.standings.filter(s => /^PNF_LIWD_\d+$/.test(s.teamCode));
  const ties = tieBreaks(rows, m.matches);
  assert.deepEqual(ties.get('PNF_LIWD_1'), { size: 2, rule: 'quotient' });
  assert.deepEqual(ties.get('PNF_LIWD_2'), { size: 2, rule: 'quotient' });
});

test("the pills' rules put the pairs in rankStandings' order on every tie case", () => {
  // The pills' rules as a sort of their own: wins, then a two-way head-to-head's winner above its loser, then quotient;
  // pairs still level (Tied) keep their order in the table.
  const orderByPills = (rows, matches) => {
    const ties = tieBreaks(rows, matches);
    const side = c => { const t = ties.get(c); return t && t.size === 2 && t.rule === 'h2h' ? (t.won ? 1 : -1) : 0; };
    return rows.slice().sort((a, b) =>
      (b.wins - a.wins) || (side(b.teamCode) - side(a.teamCode)) || ((b.quotient ?? -Infinity) - (a.quotient ?? -Infinity)))
      .map(s => s.teamCode);
  };
  [
    ['a circle, three on quotient', fixtureModel(PFS, 'final'), 'NXD', '2'],
    ['two settled on head-to-head', fixtureModel(PFS, 'final', swap1085), 'NXD', '2'],
    ['two Tied', fixtureModel(PFS, 'final'), 'NMD', '3'],
  ].forEach(([name, m, cat, br]) => {
    const rows = table(m, cat, br);
    assert.deepEqual(orderByPills(rows, m.matches), rankStandings(rows, m.matches).map(s => s.teamCode), name);
  });
  // and where head-to-head and quotient disagree the pills follow head-to-head, as the ranking does
  const m = fixtureModel(PFS, 'final', swap1085);
  const order = rankStandings(table(m, 'NXD', '2'), m.matches).map(s => s.teamCode);
  assert.ok(order.indexOf('NXD_8') < order.indexOf('NXD_6'));
});

// ---- a team bracket ------------------------------------------------------------------------------------

test('teamTableProgress counts a bracket\'s group matchups, played once their result is final or a tie', () => {
  const mu = (group, state, extra = {}) => ({ matchUp: 'x' + Math.random(), stage: null, group, matches: [], result: { state }, ...extra });
  const matchups = [
    mu('1', 'final'), mu('1', 'tie'), mu('1', 'in-progress'), mu('1', 'not-started'),
    mu('2', 'final'),
    mu(null, 'final', { stage: 'QF' }),
  ];
  assert.deepEqual(teamTableProgress(matchups, '1'), { played: 2, total: 4 });
  assert.deepEqual(teamTableProgress(matchups, '2'), { played: 1, total: 1 });
  assert.deepEqual(teamTableProgress(matchups, '9'), { played: 0, total: 0 });
  // a playoff matchup is never a bracket's, even with a group
  assert.deepEqual(teamTableProgress([mu('1', 'final', { stage: 'SF' })], '1'), { played: 0, total: 0 });
});

test('teamTableProgress on the team fixture: every bracket of the finished day is over', () => {
  const ev = 'pickledrive-anniversary-2026';
  const m = buildDayModel(eventConfig(ev), eventConfig(ev).days[0], loadSnapshot(ev), { now: caseTime(ev), alwaysLive: true });
  const groups = new Set(m.standings.filter(s => s.bracket).map(s => s.bracket));
  assert.ok(groups.size >= 2);
  groups.forEach(g => {
    const p = teamTableProgress(m.team.matchups, g);
    assert.ok(p.total > 0, g);
    assert.equal(p.played, p.total, g);
  });
});

// ---- the pills' words ----------------------------------------------------------------------------------

test('the status pill reads In progress with the count, or Final; a table with no meetings has none', () => {
  assert.deepEqual(progressLabel({ played: 6, total: 10 }), { kind: 'progress', text: 'In progress · 6/10' });
  assert.deepEqual(progressLabel({ played: 0, total: 3 }), { kind: 'progress', text: 'In progress · 0/3' });
  assert.deepEqual(progressLabel({ played: 10, total: 10 }), { kind: 'final', text: 'Final' });
  assert.equal(progressLabel({ played: 0, total: 0 }), null);
});

test("the tie pill's words, for each rule and group size", () => {
  assert.deepEqual(tieLabel({ size: 2, rule: 'h2h', won: true, score: '11–5' }), { text: 'Tie · won head-to-head 11–5', tied: false });
  assert.deepEqual(tieLabel({ size: 2, rule: 'h2h', won: false, score: '5–11' }), { text: 'Tie · lost head-to-head 5–11', tied: false });
  assert.deepEqual(tieLabel({ size: 3, rule: 'h2h' }), { text: '3-way tie · head-to-head', tied: false });
  assert.deepEqual(tieLabel({ size: 2, rule: 'quotient' }), { text: 'Tie · on quotient', tied: false });
  assert.deepEqual(tieLabel({ size: 3, rule: 'quotient' }), { text: '3-way tie · on quotient', tied: false });
  assert.deepEqual(tieLabel({ size: 4, rule: 'quotient' }), { text: '4-way tie · on quotient', tied: false });
  assert.deepEqual(tieLabel({ size: 2, rule: 'none' }), { text: 'Tied', tied: true });
  assert.deepEqual(tieLabel({ size: 3, rule: 'none' }), { text: 'Tied', tied: true });
});
