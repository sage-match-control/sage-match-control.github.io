// Facility progress: how far a venue's day is, and when it should finish.
//
// All times are "event-day minutes" (spec §3.1): minutes since midnight Manila
// time at the start of the selected day's date, so play that runs past
// midnight keeps counting up (12:30 AM next morning = 1470) instead of
// wrapping to 0. Anything before DAY_ROLLOVER_MIN belongs to the night after
// the event day, not its morning.
//
// Nothing here reads the clock or storage: the caller passes `now` (ms since
// the epoch), the day's config and, where a value is remembered between
// visits, what it remembered.

import { parseScheduleTimeToMinutes, formatMinutesAsClock } from './golive.js';
import { matchByeSide } from './byes.js';
import { unneededSeriesGames } from './series.js';

export const DAY_ROLLOVER_MIN = 6 * 60;

/**
 * The court number in a CourtAssignment ("Court 3" -> "3"), or null.
 * (Used by the Live Matches board too; views/live-matches.js re-exports it.)
 */
export function courtNumberFrom(courtAssignment){
  const m = String(courtAssignment || '').match(/(\d+)/);
  return m ? m[1] : null;
}

/** A Schedule cell ("12:30 AM") in event-day minutes, or null. */
export function eventScheduleMinutes(raw){
  const t = parseScheduleTimeToMinutes(raw);
  if(t === null) return null;
  return t < DAY_ROLLOVER_MIN ? t + 1440 : t;
}

/** Now, in event-day minutes of `day`; null when there is no day or it has no date. */
export function eventDayNowMinutes(day, now){
  if(!day || !day.date) return null;
  return Math.floor((now - Date.parse(`${day.date}T00:00:00+08:00`)) / 60000);
}

/**
 * A snapshot timestamp (facility syncedAt) in the same event-day minutes the
 * rest of this block works in, or null if it falls outside the event day.
 */
export function eventDayMinutesFromISO(day, iso){
  if(!day || !day.date || !iso) return null;
  const t = Date.parse(iso);
  if(isNaN(t)) return null;
  const mins = Math.floor((t - Date.parse(`${day.date}T00:00:00+08:00`)) / 60000);
  return mins < 0 ? null : mins;
}

/** From midnight at the start of day.date until DAY_ROLLOVER_MIN the next morning. */
export function isEventDayActive(nowMin){
  return nowMin !== null && nowMin >= 0 && nowMin < 1440 + DAY_ROLLOVER_MIN;
}

/**
 * Event-day minutes -> "4:40 PM", or "12:15 AM (+1 day)" once past the event
 * date's midnight. The offset is from the event's date, not from now.
 */
export function eventClock(mins){
  const r = Math.round(mins);
  const dayOffset = Math.floor(r / 1440);
  const label = formatMinutesAsClock(((r % 1440) + 1440) % 1440);
  return dayOffset > 0 ? `${label} (+${dayOffset} day${dayOffset === 1 ? '' : 's'})` : label;
}

/** Minutes -> "20 min", "1 h", "1 h 15 min". */
export function formatGap(mins){
  const h = Math.floor(mins / 60), m = mins % 60;
  if(h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * One facility's progress: matches done and left, the schedule's own end and
 * an estimate of when play will actually finish.
 * @param {object[]} matches   the facility's matches
 * @param {boolean} isEventDay isEventDayActive(nowMin)
 * @param {number|null} nowMin eventDayNowMinutes(day, now)
 */
export function computeFacilityProgress(matches, isEventDay, nowMin){
  // A series final's games after the decider are never played (seriesGameOf).
  const unneeded = unneededSeriesGames(matches);
  const real = matches.filter(m => matchByeSide(m) === null && !unneeded.has(m));
  const total = real.length;
  const done = real.filter(m => m.played).length;
  const left = total - done;
  const inPlay = real.filter(m => !m.played && m.liveCourt).length;

  const placed = [];
  let unscheduledLeft = 0;
  real.forEach(m => {
    const c = courtNumberFrom(m.court);
    const t = eventScheduleMinutes(m.time);
    if(c === null || t === null){ if(!m.played) unscheduledLeft++; return; }
    placed.push({ c, t, played: m.played });
  });
  const base = { total, done, left, inPlay, unscheduledLeft };
  if(placed.length === 0){
    return { ...base, slot: null, courts: 0, rows: 0, blanks: 0, blanksDone: 0,
             plannedEnd: null, eta: null };
  }

  // Slot length: median positive gap between consecutive times on one court.
  const timesByCourt = new Map();
  placed.forEach(p => {
    if(!timesByCourt.has(p.c)) timesByCourt.set(p.c, new Set());
    timesByCourt.get(p.c).add(p.t);
  });
  const gaps = [];
  timesByCourt.forEach(set => {
    const sorted = Array.from(set).sort((a, b) => a - b);
    for(let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);
  });
  gaps.sort((a, b) => a - b);
  const slot = gaps.length ? gaps[Math.floor((gaps.length - 1) / 2)] : 25;

  // The grid: rows are slots from the day's first match, columns are courts.
  const start = Math.min(...placed.map(p => p.t));
  placed.forEach(p => { p.row = Math.round((p.t - start) / slot); });
  const rows = Math.max(...placed.map(p => p.row)) + 1;
  const courts = timesByCourt.size;
  const occupied = new Set(placed.map(p => p.c + '|' + p.row));
  const unplayedRows = placed.filter(p => !p.played).map(p => p.row);
  const frontier = unplayedRows.length ? Math.min(...unplayedRows) : rows;
  let blanks = 0, blanksDone = 0;
  timesByCourt.forEach((_, c) => {
    for(let r = 0; r < rows; r++){
      if(occupied.has(c + '|' + r)) continue;
      blanks++;
      if(r < frontier) blanksDone++;
    }
  });
  const plannedEnd = start + rows * slot;

  const unitsLeft = (left - 0.5 * inPlay) + (blanks - blanksDone);
  const queueByCourt = new Map();
  real.forEach(m => {
    const c = courtNumberFrom(m.court);
    if(m.played || c === null || eventScheduleMinutes(m.time) === null) return;
    queueByCourt.set(c, (queueByCourt.get(c) || 0) + (m.liveCourt ? 0.5 : 1));
  });
  const queue = queueByCourt.size ? Math.max(...queueByCourt.values()) : 0;

  let eta = null;
  if(isEventDay && left > 0){
    eta = Math.max(nowMin, start) + Math.max(unitsLeft * slot / courts, queue * slot);
  }

  return { ...base, slot, courts, rows, blanks, blanksDone, plannedEnd, eta };
}

/**
 * Actual end. The snapshot answers this itself: SyncService stamps
 * facilities[].completedAt the first round a facility shows every match
 * scored and then carries it forward, so it survives a manual resync and
 * reads the same on every device — see facilityCompletion.mjs in
 * sage-tools-api. Everything else here is only the fallback for snapshots
 * published before that shipped: syncedAt is the facility's last edit, so
 * the earliest one seen while complete is the best local guess. It is
 * per-device, so a phone that first opens the page after a resync will read
 * that resync instead — which is exactly why completedAt is preferred.
 *
 * Pure: the fallback's per-device memory is passed in (`kept`, the ISO time
 * remembered for this facility, or undefined) and what to remember comes back.
 * @param {object} p              computeFacilityProgress(...)
 * @param {string|null} syncedAt  the facility's last sync
 * @param {string|null} completedAt  the snapshot's own stamp
 * @param {string|undefined} kept
 * @returns {{ end: string|null, keep: string|null|undefined }}
 *   `keep`: a string to remember, null to forget what was remembered, undefined to leave it
 */
export function facilityActualEnd(p, syncedAt, completedAt, kept){
  if(completedAt) return { end: completedAt, keep: undefined };
  if(p.total === 0 || p.left > 0) return { end: null, keep: kept ? null : undefined };
  const seen = Date.parse(syncedAt || '');
  const keptMs = Date.parse(kept || '');
  let stored = kept, keep;
  if(!isNaN(seen) && (isNaN(keptMs) || seen < keptMs)){
    stored = new Date(seen).toISOString();
    keep = stored;
  }
  return { end: stored || null, keep };
}

/**
 * Whether a facility's data is old enough to flag: it failed its last sync, or
 * it was last synced more than `staleWarningMs` ago.
 * @param {object|null} snapshot  the day's last snapshot
 * @param {string} name           the facility
 * @param {number} now            ms since the epoch
 * @param {number} staleWarningMs
 */
export function facilityDataIsStale(snapshot, name, now, staleWarningMs){
  const entry = snapshot ? (snapshot.facilities || []).find(f => f.name === name) : null;
  if(!entry) return false;
  const failed = (snapshot.failedFacilities || []).includes(name);
  const ageMs = now - new Date(entry.syncedAt || 0).getTime();
  return failed || ageMs > staleWarningMs;
}

/**
 * Everything both displays need for one facility, or null if it has no
 * matches loaded. `stale` already applies spec §2.3's event-day/left conditions.
 * @param {string} name
 * @param {{ matchesByFacility: Map<string, object[]>, snapshot: object|null,
 *           day: object|null, now: number, kept: string|undefined, staleWarningMs: number }} ctx
 *   kept: what this device remembered as the facility's end (see facilityActualEnd)
 * @returns {{ p: object, isEventDay: boolean, syncedAt: string|null, stale: boolean,
 *             actualEnd: string|null, keep: string|null|undefined } | null}
 */
export function facilityProgressFor(name, ctx){
  const matches = ctx.matchesByFacility.get(name);
  if(!matches) return null;
  const nowMin = eventDayNowMinutes(ctx.day, ctx.now);
  const isEventDay = isEventDayActive(nowMin);
  const p = computeFacilityProgress(matches, isEventDay, nowMin);
  const entry = ctx.snapshot ? (ctx.snapshot.facilities || []).find(x => x.name === name) : null;
  const syncedAt = entry ? entry.syncedAt || null : null;
  const end = facilityActualEnd(p, syncedAt, entry ? entry.completedAt || null : null, ctx.kept);
  return {
    p, isEventDay, syncedAt,
    stale: isEventDay && p.left > 0 && facilityDataIsStale(ctx.snapshot, name, ctx.now, ctx.staleWarningMs),
    actualEnd: end.end,
    keep: end.keep
  };
}

/**
 * The finish line (spec §2.1 line 4), shared by the card and Mission Control.
 * `sub` is the card's extra line (already whole), or null.
 *
 * A finished facility keeps both end times rather than collapsing to a bare
 * "All matches done": the schedule's own end, and when play actually wrapped.
 * Nothing in the feed timestamps a match, so the actual end is inferred from
 * the facility's last edit (see facilityActualEnd).
 * @param {object} p  computeFacilityProgress(...)
 * @param {boolean} isEventDay
 * @param {string|null} actualEnd
 * @param {object|null} day  the day's config, for reading actualEnd in event-day minutes
 * @returns {{ finish: string, sub: string|null }} HTML strings
 */
export function facilityFinishParts(p, isEventDay, actualEnd, day){
  const round5 = x => Math.round(x / 5) * 5;
  if(p.left === 0){
    const endMin = eventDayMinutesFromISO(day, actualEnd);
    const finish = endMin === null
      ? 'All matches done'
      : `All matches done &middot; Actual end <b>${eventClock(round5(endMin))}</b>`;
    if(p.plannedEnd === null) return { finish, sub: null };
    const scheduled = `Scheduled end ${eventClock(p.plannedEnd)}`;
    if(endMin === null) return { finish, sub: scheduled };
    const diff = round5(endMin - p.plannedEnd);
    const sub = diff > 0 ? `${scheduled} &middot; <span class="fp-behind">${formatGap(diff)} late</span>`
      : diff < 0 ? `${scheduled} &middot; ${formatGap(-diff)} early`
      : `${scheduled} &middot; on schedule`;
    return { finish, sub };
  }
  if(p.plannedEnd === null) return { finish: 'No scheduled times yet', sub: null };
  if(isEventDay && p.eta !== null){
    const diff = round5(p.eta - p.plannedEnd);
    const etaText = `Est. finish <b>${eventClock(round5(p.eta))}</b>`;
    const finish = diff > 0 ? `${etaText} &middot; <span class="fp-behind">${formatGap(diff)} behind</span>`
      : diff < 0 ? `${etaText} &middot; ${formatGap(-diff)} ahead`
      : `${etaText} &middot; on schedule`;
    return { finish, sub: diff !== 0 ? `Scheduled end ${eventClock(p.plannedEnd)}` : null };
  }
  return { finish: `Scheduled end <b>${eventClock(p.plannedEnd)}</b>`, sub: null };
}
