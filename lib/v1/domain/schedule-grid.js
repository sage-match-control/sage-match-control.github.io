// The schedule board's layout: a day's matches placed on a grid of courts (the
// columns) and time slots (the rows), and the court filter the board keeps in
// its URL (spec §5 of the schedule board).
//
// Board row = { num, slot, c1, c2, cat, p1a, p1b, p2a, p2b, s1, s2, liveCourt, court }
//   court is the parsed CourtAssignment number, null when blank or unparseable.
//   A team day's rows also carry matchUp, team1, team2, pair and stage (see parseFacilityCsv), and
//   their cat is "G<bracket>" or "PO" rather than a segment of the code.

import { parseCSV } from './csv.js';
import { unneededSeriesGames } from './series.js';
import { rowsToStandings } from './standings.js';
import { sideOf, stageOf, groupOf, sideLabel, pairLabel, PAIRS } from './teams.js';

/**
 * Spec §5.1: empty or "#REF!" collapses to "no name" (rendered as the muted
 * team-code fallback); everything else — including a placeholder bracket slot
 * where the sheet repeats the team code as the player name — is taken as
 * literal text, unchanged.
 */
export function nameOrNull(raw){
  const v = (raw || '').trim();
  return (v === '' || v === '#REF!') ? null : v;
}

export function scoreOrNull(raw){
  const v = (raw || '').trim();
  return v !== '' && !isNaN(v) ? parseInt(v, 10) : null;
}

/**
 * CourtAssignment holds "Court 1".."Court 9" — pull the trailing integer.
 * Blank or unparseable (e.g. a stray "SCORE") both come back null, which
 * assignCourts() below treats as "needs a free lane" rather than a specific one.
 */
export function parseCourtAssignment(raw){
  const m = String(raw || '').match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * A chip's text colour: white on the dark hues, navy on the light ones. The
 * palette spans very light to very dark, so it is derived per category
 * rather than fixed.
 * @param {string} hex "#RRGGBB"
 */
export function readableOn(hex){
  const [r,g,b] = [1,3,5].map(i => parseInt(hex.substr(i,2),16));
  return (0.2126*r + 0.7152*g + 0.0722*b) > 140 ? '#14263C' : '#FFFFFF';
}

/** The club of a dual-meet team code ("PNF_LIWD_1" -> "PNF"), read per side. */
export const clubOf = code => (String(code).split('_')[0] || '').toUpperCase();

/**
 * A team match's stage on the board (STAGE_META's key), from the side's prefix: a group-stage side
 * and an unknown prefix are 'RR'.
 */
export function ladderStageForTeam(code){
  switch(stageOf(sideOf(code))){
    case 'QF': return 'QF';
    case 'SF': return 'SF';
    case 'Br': return 'B';
    case 'Fi': return 'F';
    default: return 'RR';
  }
}

/**
 * One facility's matches tab as board rows.
 * @param {string} text   the facility's matchesCsv
 * @param {'standard'|'dual-meet'|'team'} type  where the category sits in a team code:
 *   "<CATEGORY>_<REST>" or "<CLUB>_<CATEGORY>_<REST>"; a team event has none: its rows take
 *   the bracket (cat "G<n>") or "PO" for a playoff, from the side of the code
 * @param {{ rowByCode: Map<string, object>, pairs: object }} [team]  for 'team': the day's
 *   standings rows by team code (names and brackets) and the event's pair labels
 */
export function parseFacilityCsv(text, type, team = null){
  const rows = parseCSV(text);
  if(rows.length < 2) return [];
  const header = rows[0].map(h => h.trim());
  const idx = name => header.indexOf(name);
  const iNum = idx('matchNumber'), iSched = idx('Schedule'), iCourtAssign = idx('CourtAssignment'),
        iLiveCourt = idx('court'), iT1 = idx('teamCode1'), iT2 = idx('teamCode2'),
        iP1a = idx('team1Player1'), iP1b = idx('team1Player2'),
        iP2a = idx('team2Player1'), iP2b = idx('team2Player2'),
        iS1 = idx('team1Score'), iS2 = idx('team2Score'), iMatchUp = idx('matchUp');
  const catAt = type === 'dual-meet' ? 1 : 0;
  const teamInfo = type === 'team' ? (team || { rowByCode: new Map(), pairs: PAIRS }) : null;

  const out = [];
  for(let r = 1; r < rows.length; r++){
    const row = rows[r];
    if(!row || row.length === 0) continue;
    const c1 = (row[iT1] || '').trim();
    if(c1 === '-') continue; // spacer row
    const num = parseInt(row[iNum], 10);
    if(!num) continue;
    const c2 = (row[iT2] || '').trim();
    const m = {
      num,
      slot: (row[iSched] || '').trim(),
      c1,
      c2,
      // no DIVISIONS/EVENTS config needed: the category token is a segment of the code
      cat: c1.split('_')[catAt] || '',
      p1a: nameOrNull(row[iP1a]), p1b: nameOrNull(row[iP1b]),
      p2a: nameOrNull(row[iP2a]), p2b: nameOrNull(row[iP2b]),
      s1: scoreOrNull(row[iS1]), s2: scoreOrNull(row[iS2]),
      liveCourt: (row[iLiveCourt] || '').trim(),
      court: parseCourtAssignment(row[iCourtAssign])
    };
    if(teamInfo){
      const side1 = sideOf(c1), side2 = sideOf(c2);
      const group = groupOf(side1, teamInfo.rowByCode);
      m.matchUp = iMatchUp > -1 ? (row[iMatchUp] || '').trim() : '';
      m.team1 = sideLabel(side1, teamInfo.rowByCode);
      m.team2 = sideLabel(side2, teamInfo.rowByCode);
      m.pair = pairLabel(c1, true, teamInfo.pairs);
      m.stage = ladderStageForTeam(c1);
      m.cat = stageOf(side1) !== null ? 'PO' : group !== null ? `G${group}` : '';
    }
    out.push(m);
  }
  return out;
}

/** Board rows carry c1/c2/s1/s2; the series rule reads t1/t2/scores. Sets `notNeeded` on each. */
export function markUnneededGames(rows){
  const views = rows.map(m => ({ src: m, t1: m.c1, t2: m.c2, t1Score: m.s1, t2Score: m.s2, played: m.s1 !== null && m.s2 !== null }));
  const skip = unneededSeriesGames(views);
  views.forEach(v => { v.src.notNeeded = skip.has(v); });
}

/**
 * Defensive placement (spec §5.2), in order:
 *   1. valid court, lane free -> place there
 *   2. blank / unparseable / duplicate -> first free lane
 *   3. slot already full -> surface, never drop (returned in `unplaced`)
 * Never falls back to row order implying court — an earlier build did, and it
 * happened to be correct, which is exactly what made it dangerous: an
 * undocumented contract that breaks silently on a row reorder.
 *
 * `lanes` is the court numbers this view shows, so a match with no usable
 * court falls into one of this venue's own lanes rather than another venue's
 * hidden column.
 */
export function assignCourts(matches, total, lanes){
  const courts = new Array(total).fill(null);
  const remaining = [];
  matches.forEach(m => {
    if(m.court && lanes.includes(m.court) && !courts[m.court - 1]) courts[m.court - 1] = m;
    else remaining.push(m);
  });
  const unplaced = [];
  remaining.forEach(m => {
    const free = lanes.find(c => !courts[c - 1]);
    if(free === undefined) unplaced.push(m);
    else courts[free - 1] = m;
  });
  return { courts, unplaced };
}

/**
 * Rows = time slots in first-appearance order once matches are sorted by
 * number. Within one venue, match numbers rise with time. Across venues
 * numbered in separate ranges (Main 1001..., Annex 2001...) they don't, so the
 * all-venues board takes its slot order from the first-numbered venue and
 * adds any time only a later venue uses at the bottom. A venue view has no
 * such problem.
 * Courts = derived from the highest CourtAssignment actually seen, rather
 * than a hand-maintained constant — one fewer value to keep in sync with
 * FACILITIES elsewhere on this event's pages. Court numbers run on across a
 * day's venues (Main 1-4, Annex 5-9), so the grid is sized from every venue
 * and a venue view shows only the span of courts its own matches use.
 *
 * @param {object} snapshot
 * @param {string|null} venueName  a facility name to narrow to, or null. A name the
 *                                 snapshot doesn't have is treated as null.
 * @param {'standard'|'dual-meet'|'team'} type
 * @param {{ pairs?: object }} [options]  a team day's pair labels (EventConfig.pairs); the defaults without
 */
export function buildScheduleData(snapshot, venueName, type, { pairs } = {}){
  // A team day's names and brackets come from every facility's standings.
  const team = type === 'team'
    ? {
        rowByCode: new Map((snapshot.facilities || []).flatMap(f => rowsToStandings(parseCSV(f.standingsCsv || ''))).map(s => [s.teamCode, s])),
        pairs: pairs || PAIRS
      }
    : null;
  const facilities = (snapshot.facilities || []).map(f => ({
    name: f.name || '', rows: parseFacilityCsv(f.matchesCsv, type, team)
  }));
  const venues = facilities.map(f => f.name).filter(Boolean);
  const chosen = venueName && venues.includes(venueName) ? venueName : null;
  const everyRow = facilities.flatMap(f => f.rows);
  facilities.forEach(f => markUnneededGames(f.rows));
  const allRows = chosen
    ? facilities.filter(f => f.name === chosen).flatMap(f => f.rows)
    : everyRow.slice();
  allRows.sort((a, b) => a.num - b.num);

  const slotOrder = [];
  const bySlot = new Map();
  allRows.forEach(m => {
    if(!bySlot.has(m.slot)){ bySlot.set(m.slot, []); slotOrder.push(m.slot); }
    bySlot.get(m.slot).push(m);
  });

  const total = Math.max(1, ...everyRow.map(m => m.court || 0));
  const range = (lo, hi) => Array.from({length: hi - lo + 1}, (_, i) => lo + i);
  const own = allRows.map(m => m.court).filter(c => c && c <= total);
  const courtList = chosen && own.length
    ? range(Math.min(...own), Math.max(...own))
    : range(1, total);
  const rows = slotOrder.map(slot => {
    const { courts, unplaced } = assignCourts(bySlot.get(slot), total, courtList);
    return { slot, courts, unplaced };
  });

  return {
    courts: total, courtList, venues, venue: chosen, rows,
    matchCount: allRows.length, dayMatchCount: everyRow.length, label: snapshot.label || ''
  };
}

/**
 * The court filter held in the URL (?courts=1-5 or ?courts=1,2,7), so each
 * wall screen can be bookmarked to its own range.
 * @param {string|null} raw        the `courts` query parameter
 * @param {number[]} courtList     the courts this board has
 * @returns {Set<number>|null}     null = no filter
 */
export function parseCourtsParam(raw, courtList){
  if(!raw) return null;
  const set = new Set();
  raw.split(",").forEach(part => {
    const t = part.trim();
    const m = t.match(/^(\d+)\s*-\s*(\d+)$/);
    if(m){ for(let i = +m[1]; i <= +m[2]; i++) if(courtList.includes(i)) set.add(i); }
    else if(/^\d+$/.test(t) && courtList.includes(+t)) set.add(+t);
  });
  return set.size ? set : null;
}

/** Collapse the selection back to the shortest readable form (1,2,3,4 -> 1-4). */
export function courtsToParam(set, courtList){
  if(!set || set.size === 0 || set.size === courtList.length) return null;
  const s = [...set].sort((a, b) => a - b), out = [];
  for(let i = 0; i < s.length; ){
    let j = i;
    while(j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? String(s[i]) : s[i] + "-" + s[j]);
    i = j + 1;
  }
  return out.join(",");
}

/**
 * Balanced chunking for the printed sheets: prefers even pages over a
 * full-then-orphan split, so 9 courts at 4/page becomes 3+3+3 rather than 4+4+1.
 */
export function chunkBalanced(list, maxPerPage){
  if(list.length === 0) return [];
  const pages = Math.ceil(list.length / maxPerPage);
  const per = Math.ceil(list.length / pages);
  const out = [];
  for(let i = 0; i < list.length; i += per) out.push(list.slice(i, i + per));
  return out;
}
