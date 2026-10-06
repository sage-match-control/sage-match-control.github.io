// Series finals (twice-to-beat, best-of-3).
//
// A final played as a series of games carries its seat and game in each team
// code: "<prefix>_F_<seat>_(<game>)", e.g. IXD_F_1_(2). Two games is
// twice-to-beat: seat 1 (the round robin's #1) needs one win, seat 2 two.
// Three is best-of-3: two wins each. The game where a seat reaches its wins
// decides the series, and every game after it is never played. A tied game
// counts for neither seat.
//
// Mirrors sage-tools-api's facilityCompletion.mjs (seriesGameOf,
// unneededSeriesGames): _tests/unit/parity-server.test.mjs checks the two
// agree, because "matches left" here and the published completedAt would
// otherwise disagree about when the day ended.

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
 * One series, in game order.
 * @returns {{ decidedBy: object|null, tie: object|null, unneeded: object[] }}
 */
export function walkSeries(list){
  const games = list[list.length - 1].game;
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
 * The series games after the decider: never played, so never counted.
 * @param {Array<object>} matches
 * @returns {Set<object>}
 */
export function unneededSeriesGames(matches){
  const out = new Set();
  seriesGroups(matches).forEach(list => walkSeries(list).unneeded.forEach(m => out.add(m)));
  return out;
}
