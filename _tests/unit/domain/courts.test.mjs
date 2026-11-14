// domain/courts.js: court control's pure rules (control-center-court-control-spec.md §5.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchOnCourt, courtSuggestions, courtPickError, courtWarnings, clearWarnings,
} from '../../../lib/v1/domain/courts.js';

// A match as lib/v1/domain/matches.js parses it (only the fields these rules read).
let nextNum = 1;
const mk = (extra = {}) => ({
  num: nextNum++, facility: 'Main', time: '9:00 AM', court: 'Court 1', liveCourt: '',
  t1: 'ND_1', t1p1: 'Ann', t1p2: 'Bo', t1Score: null,
  t2: 'ND_2', t2p1: 'Cy', t2p2: 'Di', t2Score: null,
  played: false, ...extra,
});

test('matchOnCourt: the match on a court by its number, the higher number when two claim it, null when idle', () => {
  const a = mk({ num: 5, liveCourt: '3' }), b = mk({ num: 9, liveCourt: 'Court 3' }), c = mk({ num: 2, liveCourt: '4' });
  assert.equal(matchOnCourt([a, b, c], '3'), b);
  assert.equal(matchOnCourt([a, b, c], 3), b);
  assert.equal(matchOnCourt([a, b, c], '4'), c);
  assert.equal(matchOnCourt([a, b, c], '5'), null);
  assert.equal(matchOnCourt([mk({ num: 1, court: 'Court 3' })], '3'), null, 'scheduled is not live');
});

test('matchOnCourt never returns a BYE', () => {
  const bye = mk({ num: 9, liveCourt: '3', t2: 'bye', t2p1: 'bye', t2p2: 'bye' });
  assert.equal(matchOnCourt([bye], '3'), null);
});

test('courtSuggestions leaves out played, live and BYE matches', () => {
  const ok = mk({ num: 1 });
  const ms = [
    ok,
    mk({ num: 2, played: true, t1Score: 11, t2Score: 5 }),
    mk({ num: 3, liveCourt: '2' }),
    mk({ num: 4, t1p1: 'BYE' }),
  ];
  assert.deepEqual(courtSuggestions(ms, '1').map(m => m.num), [1]);
});

test('courtSuggestions sorts by Schedule time with none last, then this court first, then number', () => {
  const ms = [
    mk({ num: 10, time: '' }),
    mk({ num: 9, time: '10:00 AM', court: 'Court 2' }),
    mk({ num: 8, time: '10:00 AM', court: 'Court 3' }),
    mk({ num: 7, time: '9:00 AM', court: 'Court 2' }),
    mk({ num: 6, time: '10:00 AM', court: 'Court 3' }),
  ];
  assert.deepEqual(courtSuggestions(ms, '3', { limit: 10 }).map(m => m.num), [7, 6, 8, 9, 10]);
  assert.deepEqual(courtSuggestions(ms, '2', { limit: 10 }).map(m => m.num), [7, 9, 6, 8, 10]);
});

test('courtSuggestions sorts after-midnight times after the evening ones, and caps at limit (default 3)', () => {
  const ms = [mk({ num: 1, time: '12:30 AM' }), mk({ num: 2, time: '11:00 PM' }), mk({ num: 3, time: '9:00 AM' }), mk({ num: 4, time: '9:30 AM' })];
  assert.deepEqual(courtSuggestions(ms, '1').map(m => m.num), [3, 4, 2]);
  assert.deepEqual(courtSuggestions(ms, '1', { limit: 4 }).map(m => m.num), [3, 4, 2, 1]);
  assert.deepEqual(courtSuggestions(ms, '1', { limit: 1 }).map(m => m.num), [3]);
});

test('courtPickError: every message, in order', () => {
  const free = mk({ num: 1 });
  const bye = mk({ num: 2, t2: 'BYE' });
  const here = mk({ num: 3, liveCourt: '3' });
  const there = mk({ num: 4, liveCourt: 'Court 2' });
  const odd = mk({ num: 5, liveCourt: 'Roof' });
  const ms = [free, bye, here, there, odd];
  assert.equal(courtPickError(1, ms, '3'), null);
  assert.equal(courtPickError(99, ms, '3'), 'No match #99 at this venue today.');
  assert.equal(courtPickError(2, ms, '3'), 'Match #2 is a BYE: it is never played.');
  assert.equal(courtPickError(3, ms, '3'), 'Match #3 is already on this court.');
  assert.equal(courtPickError(4, ms, '3'), 'Match #4 is on Court 2 now. Clear that court first.');
  assert.equal(courtPickError(5, ms, '3'), 'Match #5 is on Court Roof now. Clear that court first.');
  assert.equal(courtPickError(3, ms, 3), 'Match #3 is already on this court.', 'a numeric court works too');
});

test('courtPickError checks the BYE before the court', () => {
  const m = mk({ num: 1, t1: 'bye', liveCourt: '3' });
  assert.equal(courtPickError(1, [m], '3'), 'Match #1 is a BYE: it is never played.');
});

const warn = (m, extra = {}) => courtWarnings({ m, court: '3', current: null, dayMatches: [], type: 'standard', ...extra });

test('courtWarnings: nothing for an ordinary match scheduled for this court', () => {
  assert.deepEqual(warn(mk({ court: 'Court 3' })), []);
});

test('courtWarnings: a played match, with its score', () => {
  assert.deepEqual(warn(mk({ num: 12, court: 'Court 3', played: true, t1Score: 11, t2Score: 7 })), ['Match #12 already has a score (11–7).']);
});

test('courtWarnings: scheduled for another court, and not when the court is the same or there is none', () => {
  assert.deepEqual(warn(mk({ court: 'Court 1' })), ['Scheduled for Court 1.']);
  assert.deepEqual(warn(mk({ court: 'Court 3' })), []);
  assert.deepEqual(warn(mk({ court: '' })), []);
});

test('courtWarnings: a player already live elsewhere, once each, naming the facility only when it differs', () => {
  const m = mk({ num: 20, court: 'Court 3', t1p1: 'Ann', t1p2: 'Bo' });
  const here = mk({ num: 21, liveCourt: '1', t1p1: 'ann', t1p2: 'Zed', t2p1: 'Yu', t2p2: 'Xi' });
  const away = mk({ num: 22, facility: 'Annex', liveCourt: 'Court 2', t1p1: 'Q', t1p2: 'R', t2p1: 'Bo', t2p2: 'S' });
  assert.deepEqual(warn(m, { dayMatches: [m, here, away] }), [
    'Ann is on Court 1 now (#21).',
    'Bo is on Court 2 now (#22 at Annex).',
  ]);
});

test('courtWarnings: a player is reported once even when live in two matches or named twice', () => {
  const m = mk({ court: 'Court 3', t1p1: 'Ann', t1p2: 'Ann', t2p1: 'M1', t2p2: 'M2' });
  const x = mk({ num: 30, liveCourt: '1', t1p1: 'Ann', t1p2: 'X1', t2p1: 'X2', t2p2: 'X3' });
  const y = mk({ num: 31, liveCourt: '2', t1p1: 'Ann', t1p2: 'Y1', t2p1: 'Y2', t2p2: 'Y3' });
  assert.deepEqual(warn(m, { dayMatches: [x, y] }), ['Ann is on Court 1 now (#30).']);
});

test('courtWarnings: the match being replaced, and the match itself, are not a clash', () => {
  const m = mk({ num: 40, court: 'Court 3', t1p1: 'Ann' });
  const current = mk({ num: 41, liveCourt: '3', t1p1: 'Ann', played: true });
  assert.deepEqual(warn(m, { current, dayMatches: [m, current] }), []);
  const live = { ...m, liveCourt: '3' };
  assert.deepEqual(warn(m, { dayMatches: [live] }), []);
});

test('courtWarnings: TBD and bye are never compared', () => {
  const m = mk({ court: 'Court 3', t1p1: 'TBD', t1p2: 'TBD', t2p1: 'BYE', t2p2: 'bye' });
  const x = mk({ num: 50, liveCourt: '1', t1p1: 'TBD', t1p2: 'TBD', t2p1: 'bye', t2p2: 'BYE' });
  const out = warn(m, { dayMatches: [x] });
  assert.deepEqual(out, ['Players for this match aren’t decided yet.']);
});

test('courtWarnings: players not decided, worded for a team event', () => {
  const m = mk({ court: 'Court 3', t2p1: 'TBD' });
  assert.deepEqual(warn(m), ['Players for this match aren’t decided yet.']);
  assert.deepEqual(warn(m, { type: 'team' }), ['Lineup not set for this match.']);
  assert.deepEqual(warn(mk({ court: 'Court 3', t1p1: 'TBD' }), { type: 'dual-meet' }), ['Players for this match aren’t decided yet.']);
});

test('courtWarnings: the match leaving the court, only when it is unscored', () => {
  const m = mk({ court: 'Court 3' });
  assert.deepEqual(warn(m, { current: mk({ num: 60, liveCourt: '3' }) }), ['#60 isn’t scored yet. It leaves the court and shows as not started.']);
  assert.deepEqual(warn(m, { current: mk({ num: 61, liveCourt: '3', played: true }) }), []);
});

test('courtWarnings: every warning together, in the spec’s order', () => {
  const m = mk({ num: 70, court: 'Court 1', played: true, t1Score: 11, t2Score: 2, t1p1: 'Ann', t1p2: 'M1', t2p1: 'TBD', t2p2: 'TBD' });
  const live = mk({ num: 71, liveCourt: '2', t1p1: 'Ann', t1p2: 'L1', t2p1: 'L2', t2p2: 'L3' });
  const current = mk({ num: 72, liveCourt: '3' });
  assert.deepEqual(warn(m, { current, dayMatches: [live, current], type: 'team' }), [
    'Match #70 already has a score (11–2).',
    'Scheduled for Court 1.',
    'Ann is on Court 2 now (#71).',
    'Lineup not set for this match.',
    '#72 isn’t scored yet. It leaves the court and shows as not started.',
  ]);
});

test('clearWarnings: the leaving match when unscored, else nothing', () => {
  assert.deepEqual(clearWarnings(mk({ num: 80 })), ['#80 isn’t scored yet. It leaves the court and shows as not started.']);
  assert.deepEqual(clearWarnings(mk({ played: true })), []);
  assert.deepEqual(clearWarnings(null), []);
});
