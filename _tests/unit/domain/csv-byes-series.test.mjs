// domain/csv.js, domain/byes.js, domain/series.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV } from '../../../lib/v1/domain/csv.js';
import { BYE_RE, sideIsBye, matchByeSide, isByeStandingRow } from '../../../lib/v1/domain/byes.js';
import { SERIES_GAME_RE, seriesGameOf, seriesGroups, walkSeries, unneededSeriesGames } from '../../../lib/v1/domain/series.js';

// ---- csv ----------------------------------------------------------------------

test('parseCSV reads quoted fields, doubled quotes and embedded commas and newlines', () => {
  assert.deepEqual(parseCSV('a,b\n"x,y","he said ""hi"""\n"two\nlines",z\n'),
    [['a', 'b'], ['x,y', 'he said "hi"'], ['two\nlines', 'z']]);
});

test('parseCSV skips \\r, keeps a last row with no newline, and drops blank lines', () => {
  assert.deepEqual(parseCSV('a,b\r\n\r\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCSV(''), []);
});

test('parseCSV keeps empty cells and a row of empty cells', () => {
  assert.deepEqual(parseCSV('a,b,c\n,,\n1,,3\n'), [['a', 'b', 'c'], ['', '', ''], ['1', '', '3']]);
});

// ---- byes -----------------------------------------------------------------------

test('a side is a BYE by its team code, or by either player name, in any case', () => {
  assert.ok(sideIsBye('BYE', 'A', 'B'));
  assert.ok(sideIsBye('X_1', 'bye', 'B'));
  assert.ok(sideIsBye('X_1', 'A', 'Bye'));
  assert.ok(sideIsBye(' bYe ', '', ''));
  assert.ok(!sideIsBye('X_1', 'A', 'B'));
  assert.ok(!sideIsBye('BYE_1', 'A', 'B'), 'only an exact "bye"');
  assert.ok(!sideIsBye(undefined, null, ''));
  assert.ok(BYE_RE.test('BYE') && !BYE_RE.test('byes'));
});

test('matchByeSide says which side, both (a data error) or neither', () => {
  const m = (over = {}) => ({ t1: 'A_1', t1p1: 'a', t1p2: 'b', t2: 'A_2', t2p1: 'c', t2p2: 'd', ...over });
  assert.equal(matchByeSide(m()), null);
  assert.equal(matchByeSide(m({ t1: 'BYE' })), 't1');
  assert.equal(matchByeSide(m({ t2p2: 'bye' })), 't2');
  assert.equal(matchByeSide(m({ t1p1: 'BYE', t2: 'bye' })), 'both');
});

test('a standings row is a BYE row by team code or first player', () => {
  assert.ok(isByeStandingRow({ teamCode: 'BYE', player1: '' }));
  assert.ok(isByeStandingRow({ teamCode: 'X_3', player1: 'bye' }));
  assert.ok(!isByeStandingRow({ teamCode: 'X_3', player1: 'Ana', player2: 'bye' }), 'player2 does not count for a standings row');
});

// ---- series -----------------------------------------------------------------------

const game = (series, seat1, seat2, g, s1 = null, s2 = null) => ({
  t1: `${series}_${seat1}_(${g})`, t2: `${series}_${seat2}_(${g})`,
  t1Score: s1, t2Score: s2, played: s1 !== null && s2 !== null,
});

test('seriesGameOf reads <prefix>_F_<seat>_(<game>) and nothing else', () => {
  assert.deepEqual(seriesGameOf('IXD_F_1_(2)'), { series: 'IXD_F', seat: 1, game: 2 });
  assert.deepEqual(seriesGameOf(' B35XD_F_2_(1) '), { series: 'B35XD_F', seat: 2, game: 1 });
  assert.equal(seriesGameOf('IXD_F_1'), null);
  assert.equal(seriesGameOf('IXD_SF_1_(1)'), null);
  assert.equal(seriesGameOf(undefined), null);
  assert.ok(SERIES_GAME_RE.test('X_F_1_(1)'));
});

test('twice-to-beat: seat 1 needs one win, so game 2 is never played', () => {
  const g1 = game('IXD_F', 1, 2, 1, 11, 7), g2 = game('IXD_F', 1, 2, 2);
  assert.deepEqual([...unneededSeriesGames([g1, g2])], [g2]);
});

test('twice-to-beat: seat 2 winning game 1 forces game 2, which is needed', () => {
  const g1 = game('IXD_F', 1, 2, 1, 5, 11), g2 = game('IXD_F', 1, 2, 2);
  assert.equal(unneededSeriesGames([g1, g2]).size, 0);
});

test('twice-to-beat: seat 2 needs two wins, so after both the series is decided', () => {
  const g1 = game('IXD_F', 1, 2, 1, 5, 11), g2 = game('IXD_F', 1, 2, 2, 4, 11);
  const { decidedBy, tie, unneeded } = walkSeries(seriesGroups([g1, g2]).get('IXD_F'));
  assert.equal(decidedBy, g2);
  assert.equal(tie, null);
  assert.deepEqual(unneeded, []);
});

test('best-of-3: two wins each, and the third game drops once one seat has two', () => {
  const g1 = game('IXD_F', 1, 2, 1, 11, 5), g2 = game('IXD_F', 1, 2, 2, 11, 9), g3 = game('IXD_F', 1, 2, 3);
  assert.deepEqual([...unneededSeriesGames([g1, g2, g3])], [g3]);
  const split = game('IXD_F', 1, 2, 2, 9, 11);
  assert.equal(unneededSeriesGames([g1, split, g3]).size, 0, '1-1 after two games: game 3 is needed');
});

test('a tied game counts for neither seat and is reported', () => {
  const g1 = game('IXD_F', 1, 2, 1, 10, 10), g2 = game('IXD_F', 1, 2, 2);
  const result = walkSeries(seriesGroups([g1, g2]).get('IXD_F'));
  assert.equal(result.decidedBy, null);
  assert.equal(result.tie, g1);
  assert.equal(unneededSeriesGames([g1, g2]).size, 0);
});

test('games whose two codes name different series or games are not a series', () => {
  const odd = { t1: 'A_F_1_(1)', t2: 'B_F_2_(1)', t1Score: 11, t2Score: 3, played: true };
  const odd2 = { t1: 'A_F_1_(1)', t2: 'A_F_2_(2)', t1Score: null, t2Score: null, played: false };
  assert.equal(seriesGroups([odd, odd2]).size, 0);
  assert.equal(unneededSeriesGames([{ t1: 'ND_1', t2: 'ND_2', played: true, t1Score: 11, t2Score: 0 }]).size, 0);
});

// ---- a team playoff matchup's tiebreaker game (sage-docs/docs/specs/.../ladies-dink-club-tournament-spec.md §4) ----
import { DECIDER_RE, isDeciderCode, isDecider, unneededDeciders } from '../../../lib/v1/domain/deciders.js';
import * as DkTeams from '../../../lib/v1/domain/teams.js';
import { computeFacilityProgress as dkProgress } from '../../../lib/v1/domain/progress.js';
import { markUnneededGames as dkMarkUnneeded } from '../../../lib/v1/domain/schedule-grid.js';

// One match of matchup `mu`: [code1, score1, code2, score2], a null score unplayed.
const dkMatch = (mu, t1, s1, t2, s2) => ({ matchUp: mu, t1, t2, t1Score: s1, t2Score: s2, played: s1 !== null && s2 !== null });
// QF 1: game 1, game 2 and the tiebreaker, with the scores given ([s1, s2] or null each).
const dkQf = (g1, g2, tb = null, mu = 'QF-1 v QF-2') => [
  dkMatch(mu, 'QF-1_1', g1 ? g1[0] : null, 'QF-2_1', g1 ? g1[1] : null),
  dkMatch(mu, 'QF-1_2', g2 ? g2[0] : null, 'QF-2_2', g2 ? g2[1] : null),
  dkMatch(mu, 'QF-1_TB', tb ? tb[0] : null, 'QF-2_TB', tb ? tb[1] : null),
];
const dkUnneeded = ms => Array.from(unneededDeciders(ms)).map(m => m.t1);

test('isDeciderCode: a team code ending in _TB', () => {
  assert.equal(DECIDER_RE.source, '_TB$');
  for (const c of ['QF-1_TB', ' SF-2_TB ', 'Fi-A1_TB']) assert.equal(isDeciderCode(c), true, c);
  for (const c of ['QF-1_1', 'A1_2', 'IXD_F_1_(2)', 'QF-1_tb', '', undefined, null]) assert.equal(isDeciderCode(c), false, String(c));
  assert.equal(isDecider({ t1: 'QF-1_TB', t2: 'QF-2_TB' }), true);
  assert.equal(isDecider({ t1: 'QF-1_TB', t2: 'QF-2_2' }), false);
});

test('unneededDeciders: the tiebreaker is not needed once the other games settle the matchup', () => {
  assert.deepEqual(dkUnneeded(dkQf(null, null)), [], 'nothing played');
  assert.deepEqual(dkUnneeded(dkQf([11, 5], null)), [], 'one game played');
  assert.deepEqual(dkUnneeded(dkQf([11, 5], [11, 9])), ['QF-1_TB'], '2-0');
  assert.deepEqual(dkUnneeded(dkQf([5, 11], [9, 11])), ['QF-1_TB'], '0-2');
  assert.deepEqual(dkUnneeded(dkQf([11, 5], [9, 11])), [], '1-1: needed');
  assert.deepEqual(dkUnneeded(dkQf([11, 5], [9, 9])), ['QF-1_TB'], '1-0 and a level game: one side won more');
  assert.deepEqual(dkUnneeded(dkQf([11, 5], [9, 11], [7, 4])), [], '1-1 and played: it was needed');
  assert.deepEqual(dkUnneeded(dkQf([11, 5], [11, 9], null, '')), [], 'no matchUp: always counted');
  // Two matchups in one list are judged apart.
  const two = [...dkQf([11, 5], [11, 9]), ...dkQf([11, 5], [9, 11], null, 'QF-3 v QF-4').map(m => ({ ...m, t1: m.t1.replace('QF-1', 'QF-3'), t2: m.t2.replace('QF-2', 'QF-4') }))];
  assert.deepEqual(dkUnneeded(two), ['QF-1_TB']);
  // A team typed over the seeds: the sides change, the rule doesn't.
  const typed = dkQf([11, 5], [11, 9], null, 'QF-A1 v QF-B2').map(m => ({ ...m, t1: m.t1.replace('QF-1', 'QF-A1'), t2: m.t2.replace('QF-2', 'QF-B2') }));
  assert.deepEqual(dkUnneeded(typed), ['QF-A1_TB']);
});

test('unneededSeriesGames also returns a tiebreaker that is not needed', () => {
  const ms = dkQf([11, 5], [11, 9]);
  assert.deepEqual(Array.from(unneededSeriesGames(ms)).map(m => m.t1), ['QF-1_TB']);
  assert.deepEqual(Array.from(unneededSeriesGames(dkQf([11, 5], [9, 11]))), []);
});

test('teamMatchupResult: a settled matchup is final without its tiebreaker; 1-1 waits for it', () => {
  const twoNil = DkTeams.teamMatchupResult(dkQf([11, 5], [11, 9]), 'games');
  assert.deepEqual([twoNil.state, twoNil.winner, twoNil.total, twoNil.played, twoNil.pairs1, twoNil.pairs2], ['final', 1, 2, 2, 2, 0]);
  const level = DkTeams.teamMatchupResult(dkQf([11, 5], [9, 11]), 'games');
  assert.deepEqual([level.state, level.total, level.played], ['in-progress', 3, 2]);
  const decided = DkTeams.teamMatchupResult(dkQf([11, 5], [9, 11], [4, 7]), 'games');
  assert.deepEqual([decided.state, decided.winner, decided.pairs1, decided.pairs2, decided.total], ['final', 2, 1, 2, 3]);
  // No tiebreaker rows: unchanged.
  const plain = DkTeams.teamMatchupResult(dkQf([11, 5], [11, 9]).slice(0, 2), 'games');
  assert.deepEqual([plain.state, plain.total], ['final', 2]);
});

test('pairLabel: a tiebreaker reads Tiebreaker / TB', () => {
  assert.equal(DkTeams.pairLabel('QF-1_TB', true), 'TB');
  assert.equal(DkTeams.pairLabel('QF-1_TB', false), 'Tiebreaker');
  const pairs = { 1: { full: 'Pair 1', short: 'P1' }, 2: { full: 'Pair 2', short: 'P2' } };
  assert.equal(DkTeams.pairLabel('QF-1_2', true, pairs), 'P2');
  assert.equal(DkTeams.pairLabel('A1_3', true, pairs), 'Pair 3');
});

test('facility progress leaves out a tiebreaker that is not needed', () => {
  const ms = dkQf([11, 5], [11, 9]).map((m, i) => ({ ...m, num: i + 1, time: '6:45 PM', court: 'Court 1', liveCourt: '', t1p1: 'a', t1p2: 'b', t2p1: 'c', t2p2: 'd' }));
  const p = dkProgress(ms, false, null);
  assert.deepEqual([p.total, p.done, p.left], [2, 2, 0]);
  const open = dkQf([11, 5], [9, 11]).map((m, i) => ({ ...m, num: i + 1, time: '6:45 PM', court: 'Court 1', liveCourt: '', t1p1: 'a', t1p2: 'b', t2p1: 'c', t2p2: 'd' }));
  assert.deepEqual([dkProgress(open, false, null).total, dkProgress(open, false, null).left], [3, 1]);
});

test('the schedule board marks a tiebreaker that is not needed', () => {
  const rows = dkQf([11, 5], [11, 9]).map(m => ({ matchUp: m.matchUp, c1: m.t1, c2: m.t2, s1: m.t1Score, s2: m.t2Score }));
  dkMarkUnneeded(rows);
  assert.deepEqual(rows.map(r => r.notNeeded), [false, false, true]);
});
