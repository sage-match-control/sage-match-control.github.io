// domain/golive.js, domain/progress.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GO_LIVE_LEAD_HOURS, parseScheduleTimeToMinutes, formatMinutesAsClock, earliestScheduleMinutes, computeDayIsLive,
} from '../../../lib/v1/domain/golive.js';
import {
  DAY_ROLLOVER_MIN, courtNumberFrom, eventScheduleMinutes, eventDayNowMinutes, eventDayMinutesFromISO, isEventDayActive,
  eventClock, formatGap, computeFacilityProgress, facilityActualEnd, facilityDataIsStale, facilityProgressFor, facilityFinishParts,
} from '../../../lib/v1/domain/progress.js';

const at = iso => Date.parse(iso);

// ---- go-live -----------------------------------------------------------------------------------

test('parseScheduleTimeToMinutes reads "3:00 PM" and rejects anything else', () => {
  assert.equal(parseScheduleTimeToMinutes('9:00 AM'), 540);
  assert.equal(parseScheduleTimeToMinutes('12:00 PM'), 720);
  assert.equal(parseScheduleTimeToMinutes('12:30 am'), 30);
  assert.equal(parseScheduleTimeToMinutes(' 3:25 PM '), 925);
  for (const bad of ['', null, undefined, '15:00', '9 AM', 'noon', '9:00']) assert.equal(parseScheduleTimeToMinutes(bad), null, String(bad));
});

test('formatMinutesAsClock is the inverse', () => {
  for (const raw of ['12:00 AM', '9:05 AM', '12:00 PM', '4:40 PM', '11:59 PM']) {
    assert.equal(formatMinutesAsClock(parseScheduleTimeToMinutes(raw)), raw);
  }
});

const HEADER = 'matchNumber,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const snap = (isLive, ...times) => ({
  isLive,
  facilities: [{ name: 'Main', matchesCsv: [HEADER, ...times.map((t, i) => `${i + 1},,${t},Court 1,X_${i}a,A,B,,X_${i}b,C,D,`)].join('\n') }],
});

test('the earliest Schedule time across facilities, or null when none parse', () => {
  assert.equal(earliestScheduleMinutes(snap('auto', '10:00 AM', '9:00 AM', '2:00 PM')), 540);
  assert.equal(earliestScheduleMinutes(snap('auto', '', 'TBD')), null);
  assert.equal(earliestScheduleMinutes(null), null);
  const two = { facilities: [snap('auto', '11:00 AM').facilities[0], snap('auto', '8:30 AM').facilities[0]] };
  assert.equal(earliestScheduleMinutes(two), 510);
});

test('go-live: true and false settings win over everything', () => {
  const day = { date: '2026-10-03' };
  assert.equal(computeDayIsLive(day, snap(true, '9:00 AM'), at('2026-10-01T00:00:00+08:00')), true);
  assert.equal(computeDayIsLive(day, snap(false, '9:00 AM'), at('2026-10-04T00:00:00+08:00')), false);
});

test('go-live: auto goes live GO_LIVE_LEAD_HOURS before the first serve, Manila time', () => {
  assert.equal(GO_LIVE_LEAD_HOURS, 4);
  const day = { date: '2026-10-03' };
  const s = snap('auto', '9:00 AM', '10:00 AM'); // threshold 5:00 AM
  assert.equal(computeDayIsLive(day, s, at('2026-10-03T04:59:59+08:00')), false);
  assert.equal(computeDayIsLive(day, s, at('2026-10-03T05:00:00+08:00')), true);
  assert.equal(computeDayIsLive(day, s, at('2026-10-05T12:00:00+08:00')), true, 'permanently live after');
  assert.equal(computeDayIsLive(day, s, at('2026-10-03T05:00:00+08:00'), 2), false, 'a different lead');
});

test('go-live: a missing isLive (an older snapshot) reads as auto', () => {
  const day = { date: '2026-10-03' };
  const s = snap(undefined, '9:00 AM');
  delete s.isLive;
  assert.equal(computeDayIsLive(day, s, at('2026-10-03T12:00:00+08:00')), true);
  assert.equal(computeDayIsLive(day, s, at('2026-10-03T03:00:00+08:00')), false);
});

test('go-live: auto with no parseable times, no date, or no snapshot is not live', () => {
  const now = at('2026-10-03T12:00:00+08:00');
  assert.equal(computeDayIsLive({ date: '2026-10-03' }, snap('auto', '', 'TBD'), now), false);
  assert.equal(computeDayIsLive({}, snap('auto', '9:00 AM'), now), false);
  assert.equal(computeDayIsLive({ date: '2026-10-03' }, null, now), false);
});

// ---- event-day minutes -----------------------------------------------------------------------------

test('event-day minutes count past midnight instead of wrapping', () => {
  assert.equal(DAY_ROLLOVER_MIN, 360);
  assert.equal(eventScheduleMinutes('9:00 AM'), 540);
  assert.equal(eventScheduleMinutes('12:30 AM'), 30 + 1440);
  assert.equal(eventScheduleMinutes('5:59 AM'), 359 + 1440);
  assert.equal(eventScheduleMinutes('6:00 AM'), 360);
  assert.equal(eventScheduleMinutes('later'), null);
  const day = { date: '2026-10-03' };
  assert.equal(eventDayNowMinutes(day, at('2026-10-03T13:00:00+08:00')), 780);
  assert.equal(eventDayNowMinutes(day, at('2026-10-04T00:30:00+08:00')), 1470);
  assert.equal(eventDayNowMinutes({}, 0), null);
  assert.equal(eventDayNowMinutes(null, 0), null);
  assert.equal(eventDayMinutesFromISO(day, '2026-10-03T08:07:07.082Z'), 960 + 7); // 4:07 PM Manila
  assert.equal(eventDayMinutesFromISO(day, '2026-10-02T12:00:00Z'), null, 'before the event day');
  assert.equal(eventDayMinutesFromISO(day, 'nope'), null);
  assert.equal(eventDayMinutesFromISO(day, ''), null);
  assert.equal(isEventDayActive(0), true);
  assert.equal(isEventDayActive(1799), true);
  assert.equal(isEventDayActive(1800), false);
  assert.equal(isEventDayActive(-1), false);
  assert.equal(isEventDayActive(null), false);
});

test('eventClock and formatGap', () => {
  assert.equal(eventClock(16 * 60 + 40), '4:40 PM');
  assert.equal(eventClock(1440 + 15), '12:15 AM (+1 day)');
  assert.equal(eventClock(2 * 1440 + 60), '1:00 AM (+2 days)');
  assert.equal(formatGap(20), '20 min');
  assert.equal(formatGap(60), '1 h');
  assert.equal(formatGap(75), '1 h 15 min');
  assert.equal(courtNumberFrom('Court 12'), '12');
  assert.equal(courtNumberFrom(''), null);
  assert.equal(courtNumberFrom(undefined), null);
});

// ---- facility progress ---------------------------------------------------------------------------------

let n = 0;
const mt = (time, court, over = {}) => ({
  num: ++n, time, court, liveCourt: '', matchUp: '', t1: `A_${n}`, t1p1: 'a', t1p2: 'b', t2: `B_${n}`, t2p1: 'c', t2p2: 'd',
  t1Score: null, t2Score: null, played: false, ...over,
});
const done = (time, court) => mt(time, court, { t1Score: 11, t2Score: 5, played: true });

test('progress with no live courts: slot, grid, scheduled end and an estimate on the event day', () => {
  const ms = [mt('9:00 AM', 'Court 1'), mt('9:00 AM', 'Court 2'), mt('9:25 AM', 'Court 1'), mt('9:25 AM', 'Court 2')];
  const off = computeFacilityProgress(ms, false, null);
  assert.deepEqual([off.total, off.done, off.left, off.inPlay, off.unscheduledLeft], [4, 0, 4, 0, 0]);
  assert.deepEqual([off.slot, off.courts, off.rows, off.blanks, off.plannedEnd, off.eta], [25, 2, 2, 0, 590, null]);
  const on = computeFacilityProgress(ms, true, 560);
  assert.equal(on.eta, 560 + Math.max(4 * 25 / 2, 2 * 25));
});

test('progress with a match on court: it counts half toward the estimate', () => {
  const ms = [mt('9:00 AM', 'Court 1', { liveCourt: '1' }), mt('9:00 AM', 'Court 2'), mt('9:25 AM', 'Court 1'), mt('9:25 AM', 'Court 2')];
  const p = computeFacilityProgress(ms, true, 545);
  assert.equal(p.inPlay, 1);
  assert.equal(p.left, 4);
  // unitsLeft 3.5 over 2 courts = 43.75; the longest court queue is 2 -> 50.
  assert.equal(p.eta, 545 + 50);
});

test('progress skips BYEs and a series final’s unneeded games, and counts unscheduled work', () => {
  const bye = mt('9:00 AM', 'Court 1', { t2: 'BYE' });
  const g1 = mt('10:00 AM', 'Court 1', { t1: 'IXD_F_1_(1)', t2: 'IXD_F_2_(1)', t1Score: 11, t2Score: 3, played: true });
  const g2 = mt('10:25 AM', 'Court 1', { t1: 'IXD_F_1_(2)', t2: 'IXD_F_2_(2)' });
  const loose = mt('', '');
  const p = computeFacilityProgress([bye, g1, g2, loose, done('9:25 AM', 'Court 2')], false, null);
  assert.deepEqual([p.total, p.done, p.left, p.unscheduledLeft], [3, 2, 1, 1]);
});

test('progress after the last match: nothing left, and no estimate', () => {
  const p = computeFacilityProgress([done('9:00 AM', 'Court 1'), done('9:25 AM', 'Court 1')], true, 700);
  assert.deepEqual([p.left, p.eta, p.plannedEnd], [0, null, 9 * 60 + 2 * 25]);
  const empty = computeFacilityProgress([], true, 700);
  assert.deepEqual([empty.total, empty.plannedEnd, empty.slot], [0, null, null]);
});

test('progress: a gap in the grid is a blank slot, counted as done once play has passed it', () => {
  const ms = [done('9:00 AM', 'Court 1'), done('9:00 AM', 'Court 2'), mt('9:25 AM', 'Court 1'), done('9:50 AM', 'Court 1'), done('9:50 AM', 'Court 2')];
  const p = computeFacilityProgress(ms, false, null);
  assert.equal(p.blanks, 1);
  assert.equal(p.blanksDone, 0, 'the blank (Court 2, 9:25) is at the unplayed frontier');
  assert.equal(p.rows, 3);
});

test('facilityActualEnd: the snapshot’s stamp, else the earliest sync seen while complete', () => {
  const finished = { total: 4, left: 0 }, running = { total: 4, left: 1 };
  assert.deepEqual(facilityActualEnd(finished, 'x', '2026-10-03T08:00:00Z', undefined), { end: '2026-10-03T08:00:00Z', keep: undefined });
  assert.deepEqual(facilityActualEnd(running, '2026-10-03T08:00:00Z', null, '2026-10-03T07:00:00Z'), { end: null, keep: null });
  assert.deepEqual(facilityActualEnd(running, '2026-10-03T08:00:00Z', null, undefined), { end: null, keep: undefined });
  assert.deepEqual(facilityActualEnd({ total: 0, left: 0 }, 'x', null, undefined), { end: null, keep: undefined });
  const first = facilityActualEnd(finished, '2026-10-03T08:00:00Z', null, undefined);
  assert.deepEqual(first, { end: '2026-10-03T08:00:00.000Z', keep: '2026-10-03T08:00:00.000Z' });
  assert.deepEqual(facilityActualEnd(finished, '2026-10-03T09:00:00Z', null, '2026-10-03T08:00:00.000Z'), { end: '2026-10-03T08:00:00.000Z', keep: undefined }, 'a later sync does not move it');
  assert.equal(facilityActualEnd(finished, '2026-10-03T07:00:00Z', null, '2026-10-03T08:00:00.000Z').end, '2026-10-03T07:00:00.000Z', 'an earlier one does');
});

test('facilityDataIsStale: a failed sync, or one older than the warning age', () => {
  const s = { facilities: [{ name: 'Main', syncedAt: '2026-10-03T08:00:00Z' }, { name: 'Annex', syncedAt: '2026-10-03T08:09:00Z' }], failedFacilities: ['Annex'] };
  const now = at('2026-10-03T08:10:00Z'), five = 5 * 60 * 1000;
  assert.equal(facilityDataIsStale(s, 'Main', now, five), true);
  assert.equal(facilityDataIsStale(s, 'Annex', now, five), true, 'failed');
  assert.equal(facilityDataIsStale({ ...s, failedFacilities: [] }, 'Annex', now, five), false);
  assert.equal(facilityDataIsStale(s, 'Nowhere', now, five), false);
  assert.equal(facilityDataIsStale(null, 'Main', now, five), false);
});

test('facilityProgressFor assembles progress, staleness and the actual end', () => {
  const ms = [done('9:00 AM', 'Court 1'), mt('9:25 AM', 'Court 1')];
  const ctx = {
    matchesByFacility: new Map([['Main', ms]]),
    snapshot: { facilities: [{ name: 'Main', syncedAt: '2026-10-03T04:00:00Z' }], failedFacilities: [] },
    day: { date: '2026-10-03' }, now: at('2026-10-03T13:00:00+08:00'), kept: '2026-10-03T07:00:00.000Z', staleWarningMs: 300000,
  };
  const info = facilityProgressFor('Main', ctx);
  assert.equal(info.isEventDay, true);
  assert.equal(info.stale, true, 'event day, matches left, last sync hours ago');
  assert.equal(info.actualEnd, null);
  assert.equal(info.keep, null, 'matches are left again, so the remembered end is forgotten');
  assert.equal(facilityProgressFor('Elsewhere', ctx), null);
  const after = facilityProgressFor('Main', { ...ctx, now: at('2026-10-09T13:00:00+08:00') });
  assert.equal(after.isEventDay, false);
  assert.equal(after.stale, false, 'not stale outside the event day');
});

test('facilityFinishParts words the finish line for each situation', () => {
  const day = { date: '2026-10-03' };
  const planned = 600; // 10:00 AM
  assert.deepEqual(facilityFinishParts({ left: 0, plannedEnd: null }, true, null, day), { finish: 'All matches done', sub: null });
  const ontime = facilityFinishParts({ left: 0, plannedEnd: planned }, true, '2026-10-03T02:00:00Z', day); // 10:00 AM Manila
  assert.match(ontime.finish, /Actual end <b>10:00 AM<\/b>/);
  assert.equal(ontime.sub, 'Scheduled end 10:00 AM &middot; on schedule');
  const late = facilityFinishParts({ left: 0, plannedEnd: planned }, true, '2026-10-03T02:30:00Z', day);
  assert.match(late.sub, /30 min late/);
  const early = facilityFinishParts({ left: 0, plannedEnd: planned }, true, '2026-10-03T01:30:00Z', day);
  assert.match(early.sub, /30 min early/);
  assert.equal(facilityFinishParts({ left: 0, plannedEnd: planned }, true, null, day).sub, 'Scheduled end 10:00 AM');
  assert.deepEqual(facilityFinishParts({ left: 2, plannedEnd: null }, true, null, day), { finish: 'No scheduled times yet', sub: null });
  const behind = facilityFinishParts({ left: 2, plannedEnd: planned, eta: 640 }, true, null, day);
  assert.match(behind.finish, /Est\. finish <b>10:40 AM<\/b> &middot; <span class="fp-behind">40 min behind<\/span>/);
  assert.equal(behind.sub, 'Scheduled end 10:00 AM');
  const ahead = facilityFinishParts({ left: 2, plannedEnd: planned, eta: 585 }, true, null, day);
  assert.match(ahead.finish, /15 min ahead/);
  assert.equal(facilityFinishParts({ left: 2, plannedEnd: planned, eta: 600 }, true, null, day).sub, null);
  assert.equal(facilityFinishParts({ left: 2, plannedEnd: planned, eta: null }, false, null, day).finish, 'Scheduled end <b>10:00 AM</b>');
});
