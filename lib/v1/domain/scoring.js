// An event's scoring rule and the warnings a score gets under it. events.json's optional `scoring`:
//
//   "scoring": { "to": 11, "winBy": 1, "podiumWinBy": 2 }
//     to           the points a game is played to (default 11)
//     winBy        1: the game ends when a side reaches `to`; 2: from `to - 1` all, play goes on until a side
//                  leads by 2, with no cap
//     podiumWinBy  the same for the podium matches, the final and the bronze match (default: winBy)
//
// UPAP's rules are the case it was made for: to 11, win by 1 in the eliminations, win by 2 in the podium matches.
// An event without it keeps the score dialog's general warnings (views/score-dialog.js). These are warnings only:
// nothing here stops a score being saved.

import { parseCode, roundKeyword } from './codes.js';

const isWinBy = v => v === 1 || v === 2;

/**
 * events.json's `scoring` for one event, checked. Absent -> null; malformed -> a console warning and null.
 * @param {unknown} raw
 * @param {string} eventKey
 * @returns {{ to: number, winBy: 1|2, podiumWinBy: 1|2 } | null}
 */
export function scoringFrom(raw, eventKey){
  if(raw === undefined || raw === null) return null;
  const bad = why => { console.warn(`events.json: scoring for ${eventKey} ${why}; ignoring it`); return null; };
  if(typeof raw !== 'object' || Array.isArray(raw)) return bad('must be an object');
  if(!isWinBy(raw.winBy)) return bad('"winBy" must be 1 or 2');
  const to = raw.to === undefined ? 11 : raw.to;
  if(!Number.isInteger(to) || to < 1 || to > 99) return bad('"to" must be a whole number from 1 to 99');
  const podiumWinBy = raw.podiumWinBy === undefined ? raw.winBy : raw.podiumWinBy;
  if(!isWinBy(podiumWinBy)) return bad('"podiumWinBy" must be 1 or 2');
  return { to, winBy: raw.winBy, podiumWinBy };
}

/**
 * A final or a bronze match: either side's code, after its category, names round F or B (codes.js's roundKeyword,
 * so "B45LXD_F_1" is a final and "B45HMD_1" is not, although its category starts with B).
 * @param {{ t1: string, t2: string }} m
 * @param {'standard'|'dual-meet'|'team'|null|undefined} type
 */
export function isPodiumMatch(m, type){
  return [m.t1, m.t2].some(code => {
    const k = roundKeyword(parseCode(String(code || ''), type || null).rest);
    return k === 'F' || k === 'B';
  });
}

/**
 * The rule one match plays to, or null when the event has no `scoring`.
 * @param {{ t1: string, t2: string }} m
 * @param {{ to: number, winBy: 1|2, podiumWinBy: 1|2 } | null | undefined} scoring  scoringFrom's result
 * @param {'standard'|'dual-meet'|'team'|null|undefined} type
 * @returns {{ to: number, winBy: 1|2 } | null}
 */
export function scoringRuleFor(m, scoring, type){
  if(!scoring || !m) return null;
  return { to: scoring.to, winBy: isPodiumMatch(m, type) ? scoring.podiumWinBy : scoring.winBy };
}

/**
 * What is wrong with a score under a rule: [] when the score can happen.
 * @param {number} a
 * @param {number} b
 * @param {{ to: number, winBy: 1|2 }} rule
 * @returns {string[]}
 */
export function scoreRuleWarnings(a, b, rule){
  const hi = Math.max(a, b), lo = Math.min(a, b), lead = hi - lo, { to } = rule;
  if(a === b) return ['Tied: neither side wins this match.'];
  if(hi < to) return [`Neither side reached ${to}.`];
  if(rule.winBy === 1) return hi > to ? [`Past ${to}: this game ends as soon as a side reaches ${to}.`] : [];
  if(lead < 2) return ['Won by 1 point: this game is win by 2.'];
  if(hi > to && lead > 2) return [`Past ${to} a win-by-2 game ends at a 2-point lead, so ${hi}–${lo} can’t happen.`];
  return [];
}
