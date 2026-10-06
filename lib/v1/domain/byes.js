// Bye detection (awards-podium-tab-spec §2.3).
//
// Twice-to-beat brackets often have no bronze match to actually play: the
// third-place finisher is already determined by the bracket structure. Rather
// than special-case that, it is encoded in the data: the operator types BYE
// into the opponent's team code or either player-name cell, making the real
// side a winner by walkover. Checking all three cells (not just one) is
// deliberate, since the sheet fills these by formula, so whichever cell the
// operator overrides has to work.
//
// This rule is also in sage-tools-api's src/sync/domain/facilityCompletion.mjs
// (the published completedAt); _tests/unit/parity-server.test.mjs checks the
// two agree.

export const BYE_RE = /^bye$/i;

/**
 * Whether a side is a BYE: its team code or either player name reads "bye".
 * @param {string} code @param {string} p1 @param {string} p2
 */
export function sideIsBye(code, p1, p2){
  return BYE_RE.test((code || '').trim())
      || BYE_RE.test((p1   || '').trim())
      || BYE_RE.test((p2   || '').trim());
}

/**
 * Which side of a match is a BYE: 't1', 't2', 'both' (a data error) or null.
 * @param {{ t1: string, t1p1: string, t1p2: string, t2: string, t2p1: string, t2p2: string }} m
 * @returns {'t1'|'t2'|'both'|null}
 */
export function matchByeSide(m){
  const t1Bye = sideIsBye(m.t1, m.t1p1, m.t1p2);
  const t2Bye = sideIsBye(m.t2, m.t2p1, m.t2p2);
  if(t1Bye && t2Bye) return 'both'; // data error
  if(t1Bye) return 't1';
  if(t2Bye) return 't2';
  return null;
}

/**
 * A standings row for a bye "team": never a real pair, dropped wherever
 * standings rows are consumed (spec §2.6 rule 1).
 * @param {{ teamCode?: string, player1?: string }} s
 */
export function isByeStandingRow(s){
  return BYE_RE.test((s.teamCode || '').trim()) || BYE_RE.test((s.player1 || '').trim());
}
