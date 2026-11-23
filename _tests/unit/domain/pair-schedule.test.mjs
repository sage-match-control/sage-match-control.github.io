// domain/pair-schedule.js: a pair's matches in schedule order, and which one is its Next Up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import { pairMatches, nextUpIndex } from '../../../lib/v1/domain/pair-schedule.js';

const MATCH_HEADER = 'matchNumber,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const STAND_HEADER = 'teamCode,player1,player2,wins,loss,quotient,bracket,match,from,seat';
const day = (matches, standings = []) => buildDayModel(
  { key: 'e', type: 'standard', title: 'E', display: {}, days: [] },
  { key: 'd', facilities: ['Main'] },
  { isLive: true, facilities: [{ name: 'Main', matchesCsv: [MATCH_HEADER, ...matches].join('\n'), standingsCsv: [STAND_HEADER, ...standings].join('\n') }] },
  { now: 0 },
);
const nums = list => list.map(m => m.num);

test('pairMatches: the pair\'s matches only, in schedule time, not match number', () => {
  // A hand-packed schedule plays numbers out of order: match 5 is first on court
  const m = day([
    '1,,10:00 AM,Court 1,NOD_1,Ann,Bo,,NOD_2,Cy,Di,',
    '2,,9:00 AM,Court 2,NOD_3,Ed,Flo,,NOD_4,Gus,Hal,',
    '5,,9:00 AM,Court 1,NOD_5,Ike,Jo,,NOD_1,Ann,Bo,',
    '7,,11:00 AM,Court 1,NOD_1,Ann,Bo,,NOD_4,Gus,Hal,',
  ]);
  assert.deepEqual(nums(pairMatches(m, ['NOD_1'])), [5, 1, 7]);
  assert.deepEqual(nums(pairMatches(m, ['NOD_3'])), [2]);
  assert.deepEqual(nums(pairMatches(m, ['NOD_9'])), []);
});

test('pairMatches: equal times keep match-number order; a time that does not parse goes last', () => {
  const m = day([
    '4,,9:00 AM,Court 1,NOD_1,Ann,Bo,,NOD_2,Cy,Di,',
    '3,,9:00 AM,Court 2,NOD_1,Ann,Bo,,NOD_3,Ed,Flo,',
    '1,,,Court 3,NOD_1,Ann,Bo,,NOD_4,Gus,Hal,',
    '2,,soon,Court 3,NOD_1,Ann,Bo,,NOD_5,Ike,Jo,',
  ]);
  assert.deepEqual(nums(pairMatches(m, ['NOD_1'])), [3, 4, 1, 2]);
});

test('pairMatches: any of the pair\'s codes counts (a pool code and a playoff code), either side', () => {
  const m = day([
    '1,,9:00 AM,Court 1,NOD_1,Ann,Bo,11,NOD_2,Cy,Di,7',
    '2,,10:00 AM,Court 1,NOD_3,Ed,Flo,,NOD_F_1,Ann,Bo,',
  ]);
  assert.deepEqual(nums(pairMatches(m, ['NOD_1', 'NOD_F_1'])), [1, 2]);
});

test('pairMatches: a BYE is not a match, whether its code or a name says so', () => {
  const m = day([
    '1,,9:00 AM,Court 1,NOD_1,Ann,Bo,,BYE,BYE,BYE,',
    '2,,9:30 AM,Court 1,NOD_1,Ann,Bo,,NOD_2,bye,Di,',
    '3,,10:00 AM,Court 1,NOD_1,Ann,Bo,,NOD_3,Ed,Flo,',
  ]);
  assert.deepEqual(nums(pairMatches(m, ['NOD_1'])), [3]);
});

test('nextUpIndex: the first match not played', () => {
  const m = day([
    '1,,9:00 AM,Court 1,NOD_1,Ann,Bo,11,NOD_2,Cy,Di,7',
    '2,,10:00 AM,Court 1,NOD_1,Ann,Bo,,NOD_3,Ed,Flo,',
    '3,,11:00 AM,Court 1,NOD_1,Ann,Bo,,NOD_4,Gus,Hal,',
  ]);
  const list = pairMatches(m, ['NOD_1']);
  assert.equal(nextUpIndex(m, list), 1);
});

test('nextUpIndex: skips a match on a live court (its Live pill already says so)', () => {
  const m = day([
    '1,2,9:00 AM,Court 2,NOD_1,Ann,Bo,,NOD_2,Cy,Di,',
    '2,,10:00 AM,Court 1,NOD_1,Ann,Bo,,NOD_3,Ed,Flo,',
  ]);
  const list = pairMatches(m, ['NOD_1']);
  assert.equal(list[0].liveCourt, '2');
  assert.equal(nextUpIndex(m, list), 1);
});

test('nextUpIndex: skips a series game after the decider', () => {
  // Seat 1 wins game 1 of a twice-to-beat Final: game 2 will never be played
  const m = day([
    '8,,12:00 PM,Court 1,NOD_F_1_(1),Ann,Bo,11,NOD_F_2_(1),Cy,Di,8',
    '9,,12:30 PM,Court 1,NOD_F_1_(2),Ann,Bo,,NOD_F_2_(2),Cy,Di,',
    '10,,1:00 PM,Court 1,NOD_B_1,Ann,Bo,,NOD_B_2,Ed,Flo,',
  ]);
  const list = pairMatches(m, ['NOD_F_1_(1)', 'NOD_F_1_(2)', 'NOD_B_1']);
  assert.deepEqual(nums(list), [8, 9, 10]);
  assert.ok(m.unneededGames.has(list[1]));
  assert.equal(nextUpIndex(m, list), 2);
});

test('nextUpIndex: -1 when everything is played, live, unneeded or the list is empty', () => {
  const m = day([
    '1,,9:00 AM,Court 1,NOD_1,Ann,Bo,11,NOD_2,Cy,Di,7',
    '2,3,10:00 AM,Court 3,NOD_1,Ann,Bo,,NOD_3,Ed,Flo,',
  ]);
  assert.equal(nextUpIndex(m, pairMatches(m, ['NOD_1'])), -1);
  assert.equal(nextUpIndex(m, []), -1);
});
