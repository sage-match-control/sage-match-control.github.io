// The score dialog's own warnings (lib/v1/views/score-dialog.js). A playoff matchup's tiebreaker game is played to 7
// (sage-docs/docs/specs/.../ladies-dink-club-tournament-spec.md §1), so it is not warned about for stopping short of 11.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreBasicWarnings } from '../../../lib/v1/views/score-dialog.js';

const game = { t1: 'QF-1_1', t2: 'QF-2_1' };
const tiebreaker = { t1: 'QF-1_TB', t2: 'QF-2_TB' };

test('a game to 11: warns when neither side reached 11, a tie, a one-point win and a very high score', () => {
  assert.deepEqual(scoreBasicWarnings(11, 4, game), []);
  assert.deepEqual(scoreBasicWarnings(7, 3, game), ['Neither side reached 11.']);
  assert.deepEqual(scoreBasicWarnings(9, 9, game), ['Tied: neither side wins this match.']);
  assert.deepEqual(scoreBasicWarnings(11, 10, game), ['Won by 1 point.']);
  assert.deepEqual(scoreBasicWarnings(23, 21, game), ['Unusually high: over 21.']);
});

test('without a match the warnings are those of a game to 11', () => {
  assert.deepEqual(scoreBasicWarnings(7, 3), ['Neither side reached 11.']);
  assert.deepEqual(scoreBasicWarnings(11, 4), []);
});

test('a group-stage tiebreaker is to 5: 5 or more is not warned about, short of 5 is', () => {
  const groupTiebreaker = { t1: 'A2_TB', t2: 'A4_TB' };
  assert.deepEqual(scoreBasicWarnings(5, 3, groupTiebreaker), []);
  assert.deepEqual(scoreBasicWarnings(2, 5, groupTiebreaker), []);
  assert.deepEqual(scoreBasicWarnings(4, 2, groupTiebreaker), ['Neither side reached 5.']);
});

test('a tiebreaker is to 7: 7 or more is not warned about, short of 7 is', () => {
  assert.deepEqual(scoreBasicWarnings(7, 3, tiebreaker), []);
  assert.deepEqual(scoreBasicWarnings(4, 7, tiebreaker), []);
  assert.deepEqual(scoreBasicWarnings(5, 3, tiebreaker), ['Neither side reached 7.']);
});

test('a tiebreaker keeps the other warnings', () => {
  assert.deepEqual(scoreBasicWarnings(6, 6, tiebreaker), ['Tied: neither side wins this match.']);
  assert.deepEqual(scoreBasicWarnings(7, 6, tiebreaker), ['Won by 1 point.']);
  assert.deepEqual(scoreBasicWarnings(23, 2, tiebreaker), ['Unusually high: over 21.']);
});

test('only a match with a _TB code on both sides is a tiebreaker', () => {
  assert.deepEqual(scoreBasicWarnings(7, 3, { t1: 'QF-1_TB', t2: 'QF-2_2' }), ['Neither side reached 11.']);
});
