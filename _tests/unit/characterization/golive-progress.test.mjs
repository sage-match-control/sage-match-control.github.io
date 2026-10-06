// Characterization (site-engine-spec §5.2): golive.js and progress.js against
// the Hub's go-live code and Control Center's facility progress.
import test from 'node:test';
import assert from 'node:assert/strict';
import { oldCode, plain } from '../../helpers/old.mjs';
import { SNAPSHOTS, STATES, loadSnapshot, deriveState, eventConfig } from '../../helpers/fixtures.mjs';
import { parseCSV } from '../../../lib/v1/domain/csv.js';
import { rowsToMatches } from '../../../lib/v1/domain/matches.js';
import * as GoLive from '../../../lib/v1/domain/golive.js';
import * as Progress from '../../../lib/v1/domain/progress.js';

const CC = 'tools/control-center.html';
const STD = '_templates/standard-tournament-template/index.html';
const DM = '_templates/dual-meet-template/index.html';

/** A Date whose clock a test sets: what the vm context sees as `Date`. */
function fakeDate(state) {
  return class FakeDate extends Date {
    static now() { return state.now; }
  };
}

const dateOf = event => eventConfig(event).days[0].date;
const nowsFor = date => [
  `${date}T00:00:00+08:00`, `${date}T04:59:59+08:00`, `${date}T05:00:00+08:00`, `${date}T10:59:59+08:00`, `${date}T11:00:00+08:00`,
  `${date}T13:00:00+08:00`, `${date}T20:30:00+08:00`, `${date}T23:59:00+08:00`,
].map(Date.parse).concat(Date.parse(`${date}T12:00:00+08:00`) + 30 * 3600e3, Date.parse(`${date}T12:00:00+08:00`) - 3 * 86400e3);

// ---- go-live -----------------------------------------------------------------------------------------

test('go-live: parseScheduleTimeToMinutes, formatMinutesAsClock and earliestScheduleMinutes are the pages’', () => {
  const times = ['9:00 AM', '12:00 AM', '12:30 PM', '11:59 pm', ' 3:25 PM ', '', 'TBD', '15:00', undefined, null];
  const cc = oldCode(CC, { functions: ['parseScheduleTimeToMinutes', 'formatMinutesAsClock', 'earliestScheduleMinutes'], globals: { MATCHES: [] } });
  for (const rel of [CC, STD, DM]) {
    const old = oldCode(rel, { functions: ['parseScheduleTimeToMinutes'] });
    for (const t of times) assert.equal(GoLive.parseScheduleTimeToMinutes(t), old.parseScheduleTimeToMinutes(t), `${rel} ${t}`);
  }
  for (let mins = 0; mins < 1440; mins += 7) assert.equal(GoLive.formatMinutesAsClock(mins), cc.formatMinutesAsClock(mins), String(mins));
  for (const event of Object.keys(SNAPSHOTS)) for (const state of STATES) {
    const snap = deriveState(loadSnapshot(event), state);
    cc.MATCHES = snap.facilities.flatMap(f => rowsToMatches(parseCSV(f.matchesCsv)));
    assert.equal(GoLive.earliestScheduleMinutes(snap), cc.earliestScheduleMinutes(), `${event}/${state}`);
  }
});

for (const [label, rel] of [['std index', STD], ['dm index', DM]]) {
  test(`go-live: ${label}’s computeDayIsLive and earliestScheduleMinutesFrom are the module’s`, () => {
    const clock = { now: 0 };
    const old = oldCode(rel, {
      consts: ['GO_LIVE_LEAD_HOURS'],
      functions: ['parseCSV', 'rowsToMatches', 'parseScheduleTimeToMinutes', 'earliestScheduleMinutesFrom', 'computeDayIsLive'],
      globals: { Date: fakeDate(clock) },
    });
    let checked = 0;
    for (const event of Object.keys(SNAPSHOTS)) for (const state of STATES) {
      const base = deriveState(loadSnapshot(event), state);
      assert.equal(GoLive.earliestScheduleMinutes(base), old.earliestScheduleMinutesFrom(base), `${event}/${state}`);
      const date = dateOf(event);
      for (const isLive of [true, false, 'auto', undefined]) for (const day of [{ date }, {}]) for (const now of nowsFor(date)) {
        const snap = { ...base, isLive };
        if (isLive === undefined) delete snap.isLive;
        clock.now = now;
        assert.equal(GoLive.computeDayIsLive(day, snap, now), old.computeDayIsLive(day, snap), `${event}/${state} isLive=${isLive} date=${day.date} ${new Date(now).toISOString()}`);
        checked++;
      }
      clock.now = Date.parse(`${date}T13:00:00+08:00`);
      assert.equal(GoLive.computeDayIsLive({ date }, null, clock.now), old.computeDayIsLive({ date }, null));
    }
    assert.ok(checked > 500);
  });
}

// ---- facility progress -----------------------------------------------------------------------------------

const PROGRESS_FUNCTIONS = [
  'parseScheduleTimeToMinutes', 'formatMinutesAsClock', 'eventScheduleMinutes', 'eventDayNowMinutes', 'eventDayMinutesFromISO',
  'isEventDayActive', 'eventClock', 'formatGap', 'courtNumberFrom', 'computeFacilityProgress', 'facilityFinishParts',
  'facilityActualEnd', 'facilityDataIsStale', 'facilityProgressFor', 'facilityEndKey', 'loadFacilityEnds', 'saveFacilityEnds',
  'unneededSeriesGames', 'seriesGroups', 'walkSeries', 'seriesGameOf', 'matchByeSide', 'sideIsBye',
];
const PROGRESS_CONSTS = ['DAY_ROLLOVER_MIN', 'STORAGE_FACILITY_END_KEY', 'SERIES_GAME_RE', 'BYE_RE', 'STALE_WARNING_MS'];

/** A localStorage the old code can read and write, and what it left in it. */
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; } };
}

test('progress: the pure helpers are CC’s, over a wide range of inputs', () => {
  const clock = { now: 0 };
  const day = { key: 'd', date: '2026-10-03' };
  const old = oldCode(CC, { consts: PROGRESS_CONSTS, functions: PROGRESS_FUNCTIONS, globals: { Date: fakeDate(clock), currentDayIndex: 0, DAYS: [day], CURRENT_EVENT_KEY: 'e', localStorage: fakeStorage() } });
  for (const raw of ['9:00 AM', '12:00 AM', '12:30 AM', '5:59 AM', '6:00 AM', '11:59 PM', '', 'x', undefined]) assert.equal(Progress.eventScheduleMinutes(raw), old.eventScheduleMinutes(raw), String(raw));
  for (const raw of ['Court 1', 'Court 12', '', undefined, 'x', 'Court']) assert.equal(Progress.courtNumberFrom(raw), old.courtNumberFrom(raw), String(raw));
  for (const mins of [0, 5, 59, 60, 61, 125, 600]) assert.equal(Progress.formatGap(mins), old.formatGap(mins));
  for (const mins of [0, 30, 540, 960.4, 1439, 1440, 1470, 2000, 2 * 1440 + 61]) assert.equal(Progress.eventClock(mins), old.eventClock(mins), String(mins));
  for (const nowMin of [null, -5, 0, 780, 1799, 1800, 4000]) assert.equal(Progress.isEventDayActive(nowMin), old.isEventDayActive(nowMin), String(nowMin));
  for (const now of nowsFor('2026-10-03')) {
    clock.now = now;
    assert.equal(Progress.eventDayNowMinutes(day, now), old.eventDayNowMinutes(), String(now));
  }
  for (const iso of ['2026-10-03T08:07:07.082Z', '2026-10-02T12:00:00Z', '2026-10-04T05:00:00Z', 'nope', '', null]) {
    assert.equal(Progress.eventDayMinutesFromISO(day, iso), old.eventDayMinutesFromISO(iso), String(iso));
  }
  old.currentDayIndex = null;
  assert.equal(Progress.eventDayNowMinutes(null, 5), old.eventDayNowMinutes());
  assert.equal(Progress.eventDayMinutesFromISO(null, '2026-10-03T08:07:07.082Z'), old.eventDayMinutesFromISO('2026-10-03T08:07:07.082Z'));
});

test('progress: computeFacilityProgress, facilityFinishParts and facilityProgressFor are CC’s on every fixture facility, state and moment', () => {
  let checked = 0;
  for (const event of Object.keys(SNAPSHOTS)) for (const state of STATES) {
    const snap = deriveState(loadSnapshot(event), state);
    const date = dateOf(event);
    const day = { key: SNAPSHOTS[event].day, date };
    const matchesByFacility = snap.facilities.map(f => ({ name: f.name, matches: rowsToMatches(parseCSV(f.matchesCsv)) }));
    const clock = { now: 0 };
    const storage = fakeStorage();
    const old = oldCode(CC, {
      consts: PROGRESS_CONSTS, functions: PROGRESS_FUNCTIONS,
      globals: { Date: fakeDate(clock), currentDayIndex: 0, DAYS: [day], CURRENT_EVENT_KEY: event, localStorage: storage, MATCHES_BY_FACILITY: matchesByFacility, LAST_SNAPSHOT: snap },
    });
    for (const now of nowsFor(date)) {
      clock.now = now;
      const nowMin = Progress.eventDayNowMinutes(day, now);
      const isEventDay = Progress.isEventDayActive(nowMin);
      for (const f of matchesByFacility) {
        const where = `${event}/${state}/${f.name} ${new Date(now).toISOString()}`;
        const p = Progress.computeFacilityProgress(f.matches, isEventDay, nowMin);
        assert.deepStrictEqual(p, plain(old.computeFacilityProgress(f.matches, isEventDay, nowMin)), where);

        // The same remembered end on both sides, then compare what each did with it.
        for (const remembered of [undefined, '2026-10-03T08:00:00.000Z']) {
          const key = `${event}|${day.key}|${f.name}`;
          for (const k of Object.keys(storage.data)) delete storage.data[k];
          if (remembered) storage.data[old.STORAGE_FACILITY_END_KEY] = JSON.stringify({ [key]: remembered });
          const before = remembered;
          const theirs = plain(old.facilityProgressFor(f.name));
          const after = JSON.parse(storage.data[old.STORAGE_FACILITY_END_KEY] || '{}')[key];
          const mine = Progress.facilityProgressFor(f.name, {
            matchesByFacility: new Map(matchesByFacility.map(x => [x.name, x.matches])), snapshot: snap, day, now, kept: before, staleWarningMs: old.STALE_WARNING_MS,
          });
          const { keep, ...rest } = mine;
          assert.deepStrictEqual(rest, theirs, where);
          const applied = keep === undefined ? before : keep === null ? undefined : keep;
          assert.equal(applied, after, `${where}: what is remembered afterwards (kept ${before})`);
          const finishNew = Progress.facilityFinishParts(rest.p, rest.isEventDay, rest.actualEnd, day);
          assert.deepStrictEqual(finishNew, plain(old.facilityFinishParts(theirs.p, theirs.isEventDay, theirs.actualEnd)), where);
          checked++;
        }
      }
    }
  }
  assert.ok(checked >= 250, `${checked} comparisons`);
});
