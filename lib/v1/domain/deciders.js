// A team playoff matchup's tiebreaker game (sage-docs/docs/specs/.../ladies-dink-club-tournament-spec.md §4).
//
// Both its team codes end in "_TB" (QF-1_TB v QF-2_TB). It is played only when the matchup's other games leave
// the two sides level on games won: once they are all played and one side has won more, it is never played,
// so it is not a match left. A game with equal scores counts for neither side. A tiebreaker row with no
// matchUp value is always counted.
//
// Mirrors sage-tools-api's facilityCompletion.mjs (isDeciderCode, unneededDeciders):
// _tests/unit/parity-server.test.mjs checks the two agree, because "matches left" here and the published
// completedAt would otherwise disagree about when the day ended.

export const DECIDER_RE = /_TB$/;

/** @param {string} code */
export function isDeciderCode(code){ return DECIDER_RE.test((code || '').trim()); }

/** @param {{ t1: string, t2: string }} m */
export function isDecider(m){ return isDeciderCode(m.t1) && isDeciderCode(m.t2); }

// The side of a team code: everything before the first "_" (QF-A1_2 -> QF-A1).
const sideOfCode = code => { const c = (code || '').trim(); const i = c.indexOf('_'); return i < 0 ? c : c.slice(0, i); };

/**
 * The tiebreaker games whose matchup the other games already settled.
 * @param {Array<{ matchUp?: string, t1: string, t2: string, t1Score: number|null, t2Score: number|null, played: boolean }>} matches
 * @returns {Set<object>}  the unneeded tiebreaker games, as the same objects
 */
export function unneededDeciders(matches){
  const byMatchUp = new Map();
  matches.forEach(m => {
    if(!m.matchUp) return;
    if(!byMatchUp.has(m.matchUp)) byMatchUp.set(m.matchUp, []);
    byMatchUp.get(m.matchUp).push(m);
  });
  const out = new Set();
  byMatchUp.forEach(ms => {
    const deciders = ms.filter(isDecider);
    const games = ms.filter(m => !isDecider(m));
    if(!deciders.length || !games.length || !games.every(m => m.played)) return;
    const wins = new Map();
    games.forEach(m => {
      if(m.t1Score === m.t2Score) return;
      const side = sideOfCode(m.t1Score > m.t2Score ? m.t1 : m.t2);
      wins.set(side, (wins.get(side) || 0) + 1);
    });
    const [a = 0, b = 0] = Array.from(wins.values());
    if(a !== b) deciders.forEach(d => out.add(d));
  });
  return out;
}
