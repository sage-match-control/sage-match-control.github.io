// A day's matches: the CSV rows of a facility's matches tab turned into
// Match objects, and the small lookups every view asks of them.
//
// Match = { num, time, court, liveCourt, matchUp, t1, t1p1, t1p2, t2, t2p1,
//           t2p2, t1Score, t2Score, played }
//   court      the scheduled court (CourtAssignment), e.g. "Court 3"
//   liveCourt  set only while the match is on court (the sheet's `court` column)
//   matchUp    team events only; '' elsewhere
//   played     both scores are present: a match is played only when both are

import { parseCode, standingsStageKey } from './codes.js';
import { isEmptyStanding } from './standings.js';

// matchInstanceOf parses a team code, so it lives with the other code
// parsers in codes.js; it is re-exported here, where site-engine-spec §5.1
// lists it.
export { matchInstanceOf } from './codes.js';

/**
 * @param {string[][]} rows  parseCSV of a facility's matchesCsv
 * @returns {object[]} Match[] sorted by match number
 */
export function rowsToMatches(rows){
  if(rows.length < 2) return [];
  const header = rows[0].map(h => h.trim());
  const idx = name => header.indexOf(name);
  const iNum = idx('matchNumber'), iT1 = idx('teamCode1'), iP1a = idx('team1Player1'),
        iP1b = idx('team1Player2'), iT2 = idx('teamCode2'), iP2a = idx('team2Player1'),
        iP2b = idx('team2Player2'), iSched = idx('Schedule'),
        iS1 = idx('team1Score'), iS2 = idx('team2Score'), iCourt = idx('CourtAssignment'),
        iLiveCourt = idx('court'), iMatchUp = idx('matchUp');

  const out = [];
  for(let r = 1; r < rows.length; r++){
    const row = rows[r];
    if(!row || row.length === 0) continue;
    const num = parseInt(row[iNum], 10);
    if(!num) continue;
    const t1 = (row[iT1]||'').trim();
    const t2 = (row[iT2]||'').trim();
    let t1p1 = (row[iP1a]||'').trim();
    let t1p2 = (row[iP1b]||'').trim();
    let t2p1 = (row[iP2a]||'').trim();
    let t2p2 = (row[iP2b]||'').trim();
    // Placeholder bracket slots repeat the team code as the player name
    if(t1p1 === t1 || t1p1 === '') { t1p1 = 'TBD'; t1p2 = 'TBD'; }
    if(t2p1 === t2 || t2p1 === '') { t2p1 = 'TBD'; t2p2 = 'TBD'; }
    // Scores are optional — only present once a match has been played
    const rawS1 = iS1 > -1 ? (row[iS1]||'').trim() : '';
    const rawS2 = iS2 > -1 ? (row[iS2]||'').trim() : '';
    const t1Score = rawS1 !== '' && !isNaN(rawS1) ? parseInt(rawS1, 10) : null;
    const t2Score = rawS2 !== '' && !isNaN(rawS2) ? parseInt(rawS2, 10) : null;
    const played = t1Score !== null && t2Score !== null;
    const court = iCourt > -1 ? (row[iCourt]||'').trim() : '';
    // A value here means the match is currently being played on that court —
    // separate from CourtAssignment above, which is just the scheduled court.
    const liveCourt = iLiveCourt > -1 ? (row[iLiveCourt]||'').trim() : '';
    out.push({
      num,
      time: (row[iSched]||'').trim(),
      court,
      liveCourt,
      matchUp: iMatchUp > -1 ? (row[iMatchUp]||'').trim() : '', // team type only; '' elsewhere
      t1, t1p1, t1p2, t2, t2p1, t2p2,
      t1Score, t2Score, played
    });
  }
  out.sort((a,b) => a.num - b.num);
  return out;
}

/**
 * teamCode -> the match it plays in (the last one listed, when a code appears in several).
 * @param {object[]} matches
 * @returns {Map<string, object>}
 */
export function buildMatchByCodeIndex(matches){
  const idx = new Map();
  matches.forEach(m => {
    if(m.t1) idx.set(m.t1, m);
    if(m.t2) idx.set(m.t2, m);
  });
  return idx;
}

/**
 * A Round Robin pair whose names aren't in yet: its name cells still hold its
 * own code. Shown in the RR table under that code, so standings read before
 * the rosters are pasted in. Only when the code is on the schedule, though —
 * hand-built workbooks had fixed-size rosters, and an unused slot has no
 * match, which is what isEmptyStanding() was hiding. Playoff slots are
 * excluded: they keep reading TBD until they're seeded.
 * @param {object} s            a standings row
 * @param {Map<string, object>} matchByCode  buildMatchByCodeIndex(matches)
 * @param {string} type         the event's type
 */
export function isUnnamedScheduledPair(s, matchByCode, type){
  return isEmptyStanding(s) && standingsStageKey(s.teamCode, type) === 'RR' && matchByCode.has(s.teamCode);
}

/**
 * One entry per pair however it is spelled: the club, category and the two
 * names, lower-cased and order-free, so a pair that plays several matches
 * still shows up as a single entry, while same-named pairs in different
 * clubs/divisions/events never get merged together — including two pairs
 * with the same names on opposite clubs.
 * @param {string} code @param {string} p1 @param {string} p2 @param {string} type
 */
export function pairKey(code, p1, p2, type){
  const { club, category } = parseCode(code, type);
  const names = [p1.trim().toLowerCase(), p2.trim().toLowerCase()].sort().join('|');
  return `${club||''}|${category||''}|${names}`;
}
