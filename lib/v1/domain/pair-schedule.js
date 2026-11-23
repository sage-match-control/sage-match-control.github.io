// A pair's matches in schedule order, and which of them is its Next Up. Match Finder's results (views/finder.js)
// and its pair summary card (views/pair-summary.js) both read the pair's day this way.

import { matchByeSide } from './byes.js';
import { eventScheduleMinutes } from './progress.js';

const minutesOf = m => { const t = eventScheduleMinutes(m.time); return t === null ? Infinity : t; };

/**
 * The matches of the pair whose team codes are `codes` (a pair's pool code and its playoff codes), in schedule
 * order. A BYE is never a real match, so none is listed and no "Next Up" ever points at one. Schedule order is
 * the Schedule time, not the match number: a hand-packed SCHEDULE (a standard event's) plays numbers out of
 * order. A time that doesn't parse goes last; equal times keep match-number order.
 * @param {import('./model.js').DayModel} model
 * @param {string[]} codes
 */
export function pairMatches(model, codes){
  return model.matches
    .filter(m => (codes.includes(m.t1) || codes.includes(m.t2)) && matchByeSide(m) === null)
    .sort((a, b) => (minutesOf(a) - minutesOf(b)) || (a.num - b.num));
}

/**
 * The index in `list` of the pair's Next Up: the first match not played and not on a live court (a live one
 * is already flagged by the Live pill), nor a series game that will never be played. -1 when there is none.
 * @param {import('./model.js').DayModel} model
 * @param {object[]} list  pairMatches' result, or a filtered copy of it
 */
export function nextUpIndex(model, list){
  return list.findIndex(m => !m.played && !m.liveCourt && !model.unneededGames.has(m));
}
