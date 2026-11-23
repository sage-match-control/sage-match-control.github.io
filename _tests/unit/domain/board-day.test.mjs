// domain/board-day.js: which day a schedule board shows when its event has more than one
// (sage-docs/docs/specs/.../ultimate-generation-cup-2026-spec.md §4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boardDay, localIsoDate } from '../../../lib/v1/domain/board-day.js';

const DAYS = [
  { key: 'generation-cup-day1', label: 'Nov 28 · Next Gen', date: '2026-11-28' },
  { key: 'generation-cup-day2', label: 'Nov 29 · Gen X', date: '2026-11-29' },
];

test('a ?day= that is one of the event\'s days wins over everything', () => {
  assert.equal(boardDay({ days: DAYS, dayKey: 'generation-cup-day1', requested: 'generation-cup-day2', today: '2026-11-28' }), 'generation-cup-day2');
});

test('a ?day= the event does not have is ignored', () => {
  assert.equal(boardDay({ days: DAYS, dayKey: 'generation-cup-day1', requested: 'upap-day1', today: '2026-11-20' }), 'generation-cup-day1');
});

test('without ?day=, the day whose date is today', () => {
  assert.equal(boardDay({ days: DAYS, dayKey: 'generation-cup-day1', requested: null, today: '2026-11-29' }), 'generation-cup-day2');
});

test('without ?day= and on no event day, the page\'s own day', () => {
  assert.equal(boardDay({ days: DAYS, dayKey: 'generation-cup-day1', requested: null, today: '2026-11-23' }), 'generation-cup-day1');
});

test('with no days read (events.json failed), the page\'s own day', () => {
  assert.equal(boardDay({ days: [], dayKey: 'generation-cup-day1', requested: 'generation-cup-day2', today: '2026-11-29' }), 'generation-cup-day1');
});

test('a day without a date is never today', () => {
  assert.equal(boardDay({ days: [{ key: 'x' }, { key: 'y' }], dayKey: 'x', requested: '', today: '2026-11-29' }), 'x');
});

test('localIsoDate reads the local calendar date, zero-padded', () => {
  assert.equal(localIsoDate(new Date(2026, 10, 9, 23, 59)), '2026-11-09');
  assert.equal(localIsoDate(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
});
