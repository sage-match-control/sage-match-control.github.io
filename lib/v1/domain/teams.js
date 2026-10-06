// The team type (sage-docs/docs/specs/.../pickledrive-club-anniversary-team-tournament-spec.md).
//
// A team event's teams have names (STANDINGSCSV), each team meets another in a
// "matchup" of four matches, and a matchup is won on total points. These are
// the rules from events/pickledrive-anniversary-2026/index.html (spec §4,
// §5.5-§5.9) as Control Center ports them, so the console and the public site
// agree. (PickleDrive's own page keeps its inline copy: the event has
// finished.) Everything here runs only for an event whose type is 'team'.
//
// A team code is "<SIDE>_<PAIR>": A_3, SF-1_2, SF-A_2, Br-F_4, Fi-A_1. What a
// team's name or bracket is comes from the standings rows, so those functions
// take `rowByCode` (teamCode -> standings row), built by buildTeamData().

import { parseCSV } from './csv.js';

// Pair number (the digit after "_" in a team code) -> label. A doubles type
// that appears more than once in a matchup is numbered in pair order
// ("XD 1", "XD 2"); one that appears once keeps its plain label.
export function numberRepeatedPairs(pairs){
  const keys = Object.keys(pairs).sort((a, b) => a - b);
  const total = {}, seen = {}, out = {};
  keys.forEach(k => { total[pairs[k].short] = (total[pairs[k].short] || 0) + 1; });
  keys.forEach(k => {
    const p = pairs[k];
    if(total[p.short] < 2){ out[k] = p; return; }
    const n = seen[p.short] = (seen[p.short] || 0) + 1;
    out[k] = { full: `${p.full} ${n}`, short: `${p.short} ${n}` };
  });
  return out;
}
export const PAIRS = numberRepeatedPairs({
  1: { full: "Men's Doubles",   short: 'MD' },
  2: { full: "Women's Doubles", short: 'WD' },
  3: { full: 'Mixed Doubles',   short: 'XD' },
  4: { full: 'Mixed Doubles',   short: 'XD' }
});
// Playoff stage prefix (before "-" in a side) -> label and display order.
// A side with no "-" is a group-stage side.
export const STAGES = {
  QF: { label: 'Quarterfinal', order: 1 },
  SF: { label: 'Semifinal',    order: 2 },
  Br: { label: 'Bronze',       order: 3 },
  Fi: { label: 'Final',        order: 4 }
};

// ---- Side codes ---------------------------------------------------------------

// Cached: the string parsing runs for every row on every render.
const sideCodeCache = new Map();
export function parseSideCode(code){
  let cached = sideCodeCache.get(code);
  if(cached) return cached;
  const i = code.indexOf('_');
  const side = i < 0 ? code : code.slice(0, i);
  const pairNum = i < 0 ? NaN : parseInt(code.slice(i + 1), 10);
  const d = side.indexOf('-');
  cached = {
    side,
    pair: isNaN(pairNum) ? null : pairNum,
    stage: d < 0 ? null : side.slice(0, d),
    slot: d < 0 ? side : side.slice(d + 1)
  };
  sideCodeCache.set(code, cached);
  return cached;
}
export function sideOf(code){ return parseSideCode(code).side; }
export function pairOf(code){ return parseSideCode(code).pair; }
export function stageOf(side){ return parseSideCode(side).stage; }
export function slotOf(side){ return parseSideCode(side).slot; }
export function isGroupTeamCode(code){ return stageOf(code) === null; }

// ---- Names, groups and labels (they depend on the loaded standings) --------------------

/**
 * The group-stage team a side belongs to: a group side is its own base team;
 * a playoff side's is its slot once the organiser has typed a team letter.
 */
export function baseTeamOf(side, rowByCode){
  if(stageOf(side) === null) return side;
  const slot = slotOf(side);
  return rowByCode.has(slot) && isGroupTeamCode(slot) ? slot : null;
}
export function teamNameOf(side, rowByCode){
  const row = rowByCode.get(side);
  if(row && row.teamName) return row.teamName;
  const base = baseTeamOf(side, rowByCode);
  if(base){
    const baseRow = rowByCode.get(base);
    if(baseRow && baseRow.teamName) return baseRow.teamName;
  }
  return null;
}
export function sideLabel(side, rowByCode){
  return teamNameOf(side, rowByCode) ?? (stageOf(side) !== null ? `Seed ${slotOf(side)} · TBD` : side);
}
export function groupOf(side, rowByCode){
  const base = baseTeamOf(side, rowByCode);
  const row = base ? rowByCode.get(base) : null;
  const n = row ? parseInt(row.bracket, 10) : NaN;
  return isNaN(n) ? null : n;
}
export function stageLabel(side, rowByCode){
  const stage = stageOf(side);
  if(stage === null){
    const g = groupOf(side, rowByCode);
    return g === null ? 'Bracket' : `Bracket ${g}`;
  }
  return STAGES[stage] ? STAGES[stage].label : stage;
}
/**
 * A match code's pair label. `pairs` is the event's (EventConfig.pairs). A pair
 * number the event doesn't list reads "Pair <n>" rather than blank, so a
 * workbook mistake shows; a code with no pair number has no label.
 */
export function pairLabel(code, short, pairs = PAIRS){
  const n = pairOf(code);
  if(n === null) return '';
  const p = pairs[n];
  return p ? (short ? p.short : p.full) : `Pair ${n}`;
}

// ---- Matchups ---------------------------------------------------------------------------------

/**
 * ms = the matchup's matches (same matchUp). Won on total points across its
 * matches — pair wins never decide it, and equal total points is a tie.
 * state: 'not-started' | 'in-progress' | 'final' | 'tie'; winner: 1 | 2 | null
 */
export function teamMatchupResult(ms){
  const side1 = sideOf(ms[0].t1), side2 = sideOf(ms[0].t2);
  let pts1 = 0, pts2 = 0, pairs1 = 0, pairs2 = 0, played = 0;
  ms.forEach(m => {
    if(!m.played) return;
    played++;
    pts1 += m.t1Score;
    pts2 += m.t2Score;
    if(m.t1Score > m.t2Score) pairs1++;
    else if(m.t2Score > m.t1Score) pairs2++;
  });
  const total = ms.length;
  let state, winner = null;
  if(played === 0) state = 'not-started';
  else if(played < total) state = 'in-progress';
  else if(pts1 === pts2) state = 'tie';
  else { state = 'final'; winner = pts1 > pts2 ? 1 : 2; }
  return { side1, side2, pts1, pts2, pairs1, pairs2, played, total, state, winner };
}

/**
 * Everything derived from a day's matches and standings:
 *   rowByCode  STANDINGSCSV teamCode -> row
 *   matchups   [{ matchUp, matches, side1, side2, stage, group, times, courts, result }]
 *              in the order of each matchup's lowest match number
 *   advancing  base team letters sitting in a playoff slot
 * @param {object[]} matches  sorted by match number
 * @param {object[]} standings
 */
export function buildTeamData(matches, standings){
  const rowByCode = new Map(standings.map(s => [s.teamCode, s]));

  const byMatchUp = new Map(); // insertion order = lowest match number first (matches are sorted)
  matches.forEach(m => {
    if(!m.matchUp) return;
    if(!byMatchUp.has(m.matchUp)) byMatchUp.set(m.matchUp, []);
    byMatchUp.get(m.matchUp).push(m);
  });
  const distinct = list => Array.from(new Set(list.filter(Boolean)));
  const matchups = Array.from(byMatchUp.entries()).map(([matchUp, ms]) => {
    const side1 = sideOf(ms[0].t1), side2 = sideOf(ms[0].t2);
    return {
      matchUp, matches: ms, side1, side2,
      stage: stageOf(side1),
      group: groupOf(side1, rowByCode) ?? groupOf(side2, rowByCode),
      times: distinct(ms.map(m => m.time)),
      courts: distinct(ms.map(m => m.court)),
      result: teamMatchupResult(ms)
    };
  });

  // A team advances when its letter is the slot of any playoff side — the
  // organiser types it into the workbook (spec §4.3). With quarterfinals, that
  // is the eight QF-* qualifiers; any later slot is one of them anyway.
  const advancing = new Set();
  matches.forEach(m => [m.t1, m.t2].forEach(code => {
    const side = sideOf(code);
    if(stageOf(side) !== null){
      const base = baseTeamOf(side, rowByCode);
      if(base) advancing.add(base);
    }
  }));
  return { rowByCode, matchups, advancing };
}

/**
 * Bracket ranking — the organiser's tiebreakers, in order:
 *   1. points scored (PF, from STANDINGSCSV)
 *   2. quotient (PF ÷ PA, from STANDINGSCSV)
 *   3. points scored head-to-head: among the teams still level after 1–2,
 *      the points each scored in its own played matches against the others
 *   4. pair wins: matches won in this bracket's played matches
 * Rows level on all four keep their STANDINGSCSV order (the sorts are stable).
 * Display only — the organiser decides who advances in the workbook (§4.3).
 * @param {object[]} rows     the bracket's standings rows
 * @param {object[]} matches  the day's matches
 */
export function teamRankBracket(rows, matches){
  const groupMatches = matches.filter(m => m.played && stageOf(sideOf(m.t1)) === null);
  const byPfQ = rows.slice().sort((a, b) =>
    (b.pf - a.pf) || ((b.quotient ?? -Infinity) - (a.quotient ?? -Infinity)));
  const out = [];
  for(let i = 0; i < byPfQ.length;){
    let j = i + 1;
    while(j < byPfQ.length && byPfQ[j].pf === byPfQ[i].pf && byPfQ[j].quotient === byPfQ[i].quotient) j++;
    const tied = byPfQ.slice(i, j);
    if(tied.length > 1){
      const codes = new Set(tied.map(s => s.teamCode));
      const h2h = new Map(tied.map(s => [s.teamCode, 0]));
      const wins = new Map(tied.map(s => [s.teamCode, 0]));
      groupMatches.forEach(m => {
        const s1 = sideOf(m.t1), s2 = sideOf(m.t2);
        if(codes.has(s1) && codes.has(s2)){
          h2h.set(s1, h2h.get(s1) + m.t1Score);
          h2h.set(s2, h2h.get(s2) + m.t2Score);
        }
        if(wins.has(s1) && m.t1Score > m.t2Score) wins.set(s1, wins.get(s1) + 1);
        if(wins.has(s2) && m.t2Score > m.t1Score) wins.set(s2, wins.get(s2) + 1);
      });
      tied.sort((a, b) =>
        (h2h.get(b.teamCode) - h2h.get(a.teamCode)) ||
        (wins.get(b.teamCode) - wins.get(a.teamCode)));
    }
    out.push(...tied);
    i = j;
  }
  return out;
}

// ---- Rosters (the snapshot's facilities[].rosterCsv: teamCode, player, level, gender) ---------------

/** @param {string[][]} rows  parseCSV of a rosterCsv */
export function teamRowsToRoster(rows){
  if(rows.length < 2) return [];
  const header = rows[0].map(h => h.trim());
  const idx = name => header.indexOf(name);
  const iCode = idx('teamCode'), iPlayer = idx('player'), iLevel = idx('level'), iGender = idx('gender');
  if(iCode < 0 || iPlayer < 0) return [];
  const cell = (row, i) => i > -1 ? (row[i] || '').trim() : '';
  return rows.slice(1)
    .map(row => ({ teamCode: cell(row, iCode), player: cell(row, iPlayer), level: cell(row, iLevel), gender: cell(row, iGender) }))
    .filter(r => r.teamCode && r.player);
}

/**
 * Every facility's roster rows, and the same by team in sheet order.
 * @returns {{ roster: object[], byCode: Map<string, object[]> }}
 */
export function buildTeamRoster(snapshot){
  const roster = ((snapshot && snapshot.facilities) || []).flatMap(f => teamRowsToRoster(parseCSV(f.rosterCsv || '')));
  const byCode = new Map();
  roster.forEach(r => {
    if(!byCode.has(r.teamCode)) byCode.set(r.teamCode, []);
    byCode.get(r.teamCode).push(r);
  });
  return { roster, byCode };
}

/** A team's players, lowest level first (sheet order within a level). */
export function teamRosterOf(byCode, teamCode){
  const list = byCode.get(teamCode) || [];
  const rank = r => { const n = parseFloat(r.level); return isNaN(n) ? Infinity : n; };
  return list.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map(x => x.r);
}

/** "3.5" -> "Level 3.5"; anything else as written. */
export const teamLevelLabel = v => /^\d+(\.\d+)?$/.test(v) ? `Level ${v}` : v;
