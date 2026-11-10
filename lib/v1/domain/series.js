// Series finals (twice-to-beat, best-of-3) and best-of-3 round-robin meetings.
//
// A final played as a series of games carries its seat and game in each team
// code: "<prefix>_F_<seat>_(<game>)", e.g. IXD_F_1_(2). Two games is
// twice-to-beat: seat 1 (the round robin's #1) needs one win, seat 2 two.
// Three is best-of-3: two wins each. The game where a seat reaches its wins
// decides the series, and every game after it is never played. A tied game
// counts for neither seat.
//
// A best-of-3 round-robin meeting (a category planned with rr_best_of 3) has
// no game in its codes: its three games are rows with the same two team codes,
// flagged 3 in the CSV tab's bestOf column, and match number puts them in order
// (rrSeriesGroups). The first side to win two takes the meeting.
//
// Mirrors sage-tools-api's facilityCompletion.mjs (seriesGameOf,
// unneededSeriesGames, unneededMeetingGames): _tests/unit/parity-server.test.mjs
// checks the two agree, because "matches left" here and the published
// completedAt would otherwise disagree about when the day ended.

import { unneededDeciders } from './deciders.js';

export const SERIES_GAME_RE = /^(.*_F)_(\d+)_\((\d+)\)$/;

/**
 * @param {string} code
 * @returns {{ series: string, seat: number, game: number } | null}
 */
export function seriesGameOf(code){
  const m = SERIES_GAME_RE.exec((code || '').trim());
  return m ? { series: m[1], seat: parseInt(m[2], 10), game: parseInt(m[3], 10) } : null;
}

/**
 * @param {Array<{ t1: string, t2: string }>} matches
 * @returns {Map<string, Array<{ m: object, game: number, seat1: number, seat2: number }>>}
 *   series -> its games, in game order
 */
export function seriesGroups(matches){
  const groups = new Map();
  matches.forEach(m => {
    const a = seriesGameOf(m.t1), b = seriesGameOf(m.t2);
    if(!a || !b || a.series !== b.series || a.game !== b.game) return;
    if(!groups.has(a.series)) groups.set(a.series, []);
    groups.get(a.series).push({ m, game: a.game, seat1: a.seat, seat2: b.seat });
  });
  groups.forEach(list => list.sort((x, y) => x.game - y.game));
  return groups;
}

/**
 * One series, in game order. `games` is the length of the series (2 is twice-to-beat); it defaults to the
 * last game's number, which is what every series final passes implicitly.
 * @returns {{ decidedBy: object|null, tie: object|null, unneeded: object[] }}
 */
export function walkSeries(list, games = list[list.length - 1].game){
  const need = games === 2 ? { 1: 1, 2: 2 } : { 1: Math.ceil(games / 2), 2: Math.ceil(games / 2) };
  const wins = { 1: 0, 2: 0 };
  let decidedBy = null, tie = null;
  const unneeded = [];
  list.forEach(g => {
    if(decidedBy){ unneeded.push(g.m); return; }
    if(!g.m.played) return;
    if(g.m.t1Score === g.m.t2Score){ tie = tie || g.m; return; }
    const seat = g.m.t1Score > g.m.t2Score ? g.seat1 : g.seat2;
    wins[seat] = (wins[seat] || 0) + 1;
    if(wins[seat] >= (need[seat] ?? Infinity)) decidedBy = g.m;
  });
  return { decidedBy, tie, unneeded };
}

/**
 * A best-of-3 round-robin meeting's games: the matches flagged bestOf 3 with the same
 * facility and the same two codes, in match-number order, the first three of them. Seat 1
 * is the code that sorts first. Shaped like seriesGroups' lists, so walkSeries(list, 3)
 * reads them. Control Center and the scorer pass every facility's matches at once, and
 * match numbers repeat across facilities, so the facility is part of the key.
 * Mirrors sage-tools-api's facilityCompletion.mjs (unneededMeetingGames).
 * @param {object[]} matches
 * @returns {Map<string, Array<{ m: object, game: number, seat1: number, seat2: number }>>}
 *   "<facility>|<code>|<code>" -> its games
 */
export function rrSeriesGroups(matches){
  const byPair = new Map();
  matches.forEach(m => {
    if(m.bestOf !== 3) return;
    const key = [m.facility || '', ...[m.t1, m.t2].sort()].join('|');
    if(!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(m);
  });
  const out = new Map();
  byPair.forEach((list, key) => {
    const first = key.split('|')[1];
    out.set(key, list.sort((x, y) => x.num - y.num).slice(0, 3).map((m, i) => ({
      m, game: i + 1, seat1: m.t1 === first ? 1 : 2, seat2: m.t1 === first ? 2 : 1 })));
  });
  return out;
}

/** A best-of-3 meeting's games after the one that gave a side its second win. */
export function unneededMeetingGames(matches){
  const out = new Set();
  rrSeriesGroups(matches).forEach(list => walkSeries(list, 3).unneeded.forEach(m => out.add(m)));
  return out;
}

/**
 * The games never played, so never counted: a series final's games after the decider (walkSeries), a team
 * playoff matchup's tiebreaker game once the matchup's other games settled it (deciders.js), and a best-of-3
 * round-robin meeting's games after its decider.
 * @param {Array<object>} matches
 * @returns {Set<object>}
 */
export function unneededSeriesGames(matches){
  const out = new Set();
  seriesGroups(matches).forEach(list => walkSeries(list).unneeded.forEach(m => out.add(m)));
  unneededDeciders(matches).forEach(m => out.add(m));
  unneededMeetingGames(matches).forEach(m => out.add(m));
  return out;
}
