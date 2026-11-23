// domain/initial-day.js: which day a multi-day event's Hub or Control Center loads on opening.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialDayIndex, manilaIsoDate } from '../../../lib/v1/domain/initial-day.js';

const DAYS = [
  { key: 'generation-cup-day1', label: 'Nov 28 · Next Gen', date: '2026-11-28' },
  { key: 'generation-cup-day2', label: 'Nov 29 · Gen X', date: '2026-11-29' },
];
const at = (today, savedKey = null, days = DAYS) => initialDayIndex({ days, savedKey, today });

test('the day this browser last picked for the event comes first', () => {
  assert.equal(at('2026-11-28', 'generation-cup-day2'), 1);
  assert.equal(at('2026-12-25', 'generation-cup-day1'), 0, 'even long after the event');
});

test('a saved day that is no longer one of the event’s is ignored', () => {
  assert.equal(at('2026-11-29', 'generation-cup-day9'), 1);
});

test('with nothing saved: today’s day', () => {
  assert.equal(at('2026-11-28'), 0);
  assert.equal(at('2026-11-29'), 1);
});

test('with nothing saved and no day today: the nearest day', () => {
  assert.equal(at('2026-11-24'), 0, 'before the event, its first day');
  assert.equal(at('2026-12-01'), 1, 'after it, its last');
  const twoWeekends = [
    { key: 'a', date: '2026-08-14' }, { key: 'b', date: '2026-08-15' },
    { key: 'c', date: '2026-08-21' }, { key: 'd', date: '2026-08-22' },
  ];
  assert.equal(at('2026-08-17', null, twoWeekends), 1, 'two days after the first weekend: its last day');
  assert.equal(at('2026-08-19', null, twoWeekends), 2, 'two days before the second: its first day');
  assert.equal(at('2026-08-18', null, twoWeekends), 2, 'three days from each: the later day');
});

test('days without dates: the first day; an undated day never wins over a dated one', () => {
  assert.equal(at('2026-11-29', null, [{ key: 'x' }, { key: 'y' }]), 0);
  assert.equal(at('2026-11-29', null, [{ key: 'x' }, { key: 'y', date: '2026-11-20' }]), 1);
  assert.equal(at('2026-11-29', null, [{ key: 'x', date: 'soon' }, { key: 'y' }]), 0, 'a malformed date counts as none');
});

test('a one-day event is its one day; an event with no days has none', () => {
  assert.equal(at('2026-01-01', null, [DAYS[0]]), 0);
  assert.equal(at('2026-11-28', null, []), null);
  assert.equal(initialDayIndex({ days: undefined, today: '2026-11-28' }), null);
});

test('today is the Philippines’ date, whatever the computer’s own time zone', () => {
  assert.equal(manilaIsoDate(new Date('2026-11-27T16:30:00Z')), '2026-11-28', '00:30 on the 28th in Manila');
  assert.equal(manilaIsoDate(new Date('2026-11-28T15:59:00Z')), '2026-11-28', '23:59 on the 28th in Manila');
});
