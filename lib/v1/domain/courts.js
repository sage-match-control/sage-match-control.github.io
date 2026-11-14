// Court control's rules (control-center-court-control-spec.md §5.3): which match is on a court, which
// to suggest for it, whether one can be put there, and what to warn about. Pure functions of the matches
// the page holds; the court dialog (views/court-dialog.js) draws them and the API (PUT …/courts/{court}/match)
// has the last word. A court is its number as a string ("3"), as courtNumberFrom gives it.

import { courtNumberFrom, eventScheduleMinutes } from './progress.js';
import { matchByeSide } from './byes.js';

const isBye = m => matchByeSide(m) !== null;

/**
 * The match on court `court` ("3") among one facility's matches: the highest-numbered whose
 * liveCourt's number is `court`, as buildFacilityCourtGroups picks. null when idle.
 * @param {object[]} facilityMatches
 * @param {string|number} court
 * @returns {object|null}
 */
export function matchOnCourt(facilityMatches, court){
  const c = String(court);
  let best = null;
  facilityMatches.forEach(m => {
    if(isBye(m) || !m.liveCourt || courtNumberFrom(m.liveCourt) !== c) return;
    if(best === null || m.num > best.num) best = m;
  });
  return best;
}

/**
 * Up to `limit` matches to suggest for court `court`: not played, on no court, not a BYE;
 * sorted by Schedule time (none last), then those scheduled on this court first, then number.
 * @param {object[]} facilityMatches
 * @param {string|number} court
 * @param {{ limit?: number }} [opts]
 * @returns {object[]}
 */
export function courtSuggestions(facilityMatches, court, { limit = 3 } = {}){
  const c = String(court);
  const key = m => {
    const t = eventScheduleMinutes(m.time);
    return t === null ? Number.MAX_SAFE_INTEGER : t;
  };
  return facilityMatches
    .filter(m => !m.played && !m.liveCourt && !isBye(m))
    .sort((a, b) =>
      key(a) - key(b)
      || (courtNumberFrom(a.court) === c ? 0 : 1) - (courtNumberFrom(b.court) === c ? 0 : 1)
      || a.num - b.num)
    .slice(0, limit);
}

/**
 * Why match number n can't be picked for court `court`, or null when it can.
 * @param {number} n
 * @param {object[]} facilityMatches
 * @param {string|number} court
 * @returns {string|null}
 */
export function courtPickError(n, facilityMatches, court){
  const c = String(court);
  const m = facilityMatches.find(x => x.num === n);
  if(!m) return `No match #${n} at this venue today.`;
  if(isBye(m)) return `Match #${n} is a BYE: it is never played.`;
  if(courtNumberFrom(m.liveCourt) === c) return `Match #${n} is already on this court.`;
  if(m.liveCourt) return `Match #${n} is on Court ${courtNumberFrom(m.liveCourt) ?? m.liveCourt} now. Clear that court first.`;
  return null;
}

/** Rule 5, shared by a set and a clear: the match leaving the court has no score. */
function leavingWarning(current){
  return current && !current.played
    ? [`#${current.num} isn’t scored yet. It leaves the court and shows as not started.`]
    : [];
}

/**
 * The Review step's warnings for putting `m` on court `court` (D5), in order.
 * @param {{ m: object, court: string|number, current: object|null, dayMatches: object[], type: string }} args
 * @returns {string[]}
 */
export function courtWarnings({ m, court, current, dayMatches, type }){
  const c = String(court), out = [];
  if(m.played) out.push(`Match #${m.num} already has a score (${m.t1Score}–${m.t2Score}).`);

  const scheduled = courtNumberFrom(m.court);
  if(scheduled !== null && scheduled !== c) out.push(`Scheduled for Court ${scheduled}.`);

  const reported = new Set();
  [m.t1p1, m.t1p2, m.t2p1, m.t2p2].forEach(name => {
    const key = String(name || '').trim().toLowerCase();
    if(!key || key === 'tbd' || key === 'bye' || reported.has(key)) return;
    const x = dayMatches.find(o => o.liveCourt && o !== m && o !== current
      && !(o.num === m.num && o.facility === m.facility)
      && !(current && o.num === current.num && o.facility === current.facility)
      && [o.t1p1, o.t1p2, o.t2p1, o.t2p2].some(p => String(p || '').trim().toLowerCase() === key));
    if(!x) return;
    reported.add(key);
    out.push(`${String(name).trim()} is on Court ${courtNumberFrom(x.liveCourt) ?? x.liveCourt} now ` +
             `(#${x.num}${x.facility !== m.facility ? ' at ' + x.facility : ''}).`);
  });

  if(m.t1p1 === 'TBD' || m.t2p1 === 'TBD'){
    out.push(type === 'team' ? 'Lineup not set for this match.' : 'Players for this match aren’t decided yet.');
  }
  return out.concat(leavingWarning(current));
}

/**
 * The warning for clearing a court whose match `current` is unscored, or [].
 * @param {object|null} current
 * @returns {string[]}
 */
export function clearWarnings(current){
  return leavingWarning(current);
}
