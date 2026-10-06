// When a day goes live on the public pages.
//
// A published snapshot carries the day's `isLive` setting: true, false, or
// 'auto'. 'auto' (or missing, in a snapshot published before the setting
// existed) means live once we're at or after GO_LIVE_LEAD_HOURS before the
// day's earliest scheduled match time, read straight from the synced Schedule
// column (e.g. "3:00 PM", Manila time) — not a hand-set hour. Nothing here
// is per-event config, so there is nothing to keep in sync by hand.
//
// Control Center shows scores regardless: it asks for `alwaysLive` in
// buildDayModel (model.js) instead of calling computeDayIsLive.

import { parseCSV } from './csv.js';
import { rowsToMatches } from './matches.js';

export const GO_LIVE_LEAD_HOURS = 4;

/**
 * "3:00 PM" -> minutes since midnight, or null when it doesn't read as a time.
 * @param {string} raw
 */
export function parseScheduleTimeToMinutes(raw){
  const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if(!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if(/pm/i.test(m[3])) h += 12;
  return h * 60 + parseInt(m[2], 10);
}

/**
 * Minutes -> "4:40 PM".
 * (Control Center's go-live description and the facility progress finish line
 * both read it, so it lives here with the time parsing it undoes.)
 */
export function formatMinutesAsClock(mins){
  const h24 = Math.floor(mins / 60), m = mins % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * The earliest parseable Schedule time across every facility of a snapshot,
 * in minutes since midnight. null if none parse (the day's spreadsheet has no
 * Schedule values entered yet) or there is no snapshot.
 * @param {{ facilities?: Array<{ matchesCsv: string }> } | null} snapshot
 */
export function earliestScheduleMinutes(snapshot){
  let earliest = null;
  ((snapshot && snapshot.facilities) || []).forEach(f => {
    rowsToMatches(parseCSV(f.matchesCsv)).forEach(m => {
      const mins = parseScheduleTimeToMinutes(m.time);
      if(mins !== null && (earliest === null || mins < earliest)) earliest = mins;
    });
  });
  return earliest;
}

/**
 * Whether the day's scores and live tabs are showing.
 * @param {{ date?: string }} day           the day's config: `date` is "YYYY-MM-DD", Manila
 * @param {object|null} snapshot            the day's published snapshot, or null before the first fetch
 *                                          (always not-live until real data says otherwise)
 * @param {number} now                      ms since the epoch
 * @param {number} [leadHours]
 */
export function computeDayIsLive(day, snapshot, now, leadHours = GO_LIVE_LEAD_HOURS){
  const raw = snapshot ? snapshot.isLive : undefined;
  if(raw === true) return true;
  if(raw === false) return false;
  // 'auto' (or missing — a snapshot published before the setting shipped):
  // live once we're at/after leadHours before the day's earliest scheduled
  // match time, and permanently live after that point.
  if(!snapshot || !day.date) return false;
  const earliestMin = earliestScheduleMinutes(snapshot);
  if(earliestMin === null) return false; // no parseable Schedule values synced yet -> stays hidden
  const hh = String(Math.floor(earliestMin / 60)).padStart(2, '0');
  const mm = String(earliestMin % 60).padStart(2, '0');
  const firstServe = new Date(`${day.date}T${hh}:${mm}:00+08:00`);
  return now >= firstServe.getTime() - leadHours * 60 * 60 * 1000;
}
