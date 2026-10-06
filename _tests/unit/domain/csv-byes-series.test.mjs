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
