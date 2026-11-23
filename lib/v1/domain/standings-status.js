// What a round-robin table's standings leave unsaid: how far the table has got (the pill in its
// header, "In progress · 6/10" or "Final"), and how pairs level on wins were told apart (the pill under
// a row's names). Pure functions of the standings rows and the day's matches.
//
// The ordering itself is domain/standings.js's rankStandings (wins, then head-to-head among the pairs
// level on wins, then quotient); tieBreaks says what that order did and uses the same headToHeadWins,
// so the pills and the order cannot disagree.
// sage-docs/docs/specs/.../hub-player-experience-spec.md §6.

import { parseCode, roundKeyword } from './codes.js';
import { matchByeSide } from './byes.js';
import { rrSeriesGroups, walkSeries } from './series.js';
import { headToHeadWins } from './standings.js';

/**
 * How many of a table's round-robin meetings are played. A table's meetings are the round-robin matches
 * (no playoff round in the code) with a side that is a row of the table and no BYE side, each counted
 * once; a best-of-3 meeting (matches flagged bestOf 3, series.js rrSeriesGroups) is one meeting, played
 * when a side has won two games. A dual meet's club table has one side of each cross-club match, so
 * both clubs' tables count the same matches.
 * @param {object[]} rows     the table's standings rows
 * @param {object[]} matches  the day's matches
 * @param {'standard'|'dual-meet'|'team'|null} type  the event's type
 * @returns {{ played: number, total: number }}
 */
export function tableProgress(rows, matches, type){
  const codes = new Set(rows.map(s => s.teamCode));
  let played = 0, total = 0;
  const meetings = [];
  matches.forEach(m => {
    const own = codes.has(m.t1) ? m.t1 : codes.has(m.t2) ? m.t2 : null;
    if(own === null || roundKeyword(parseCode(own, type).rest) !== null || matchByeSide(m) !== null) return;
    if(m.bestOf === 3){ meetings.push(m); return; }
    total++;
    if(m.played) played++;
  });
  rrSeriesGroups(meetings).forEach(list => {
    total++;
    if(walkSeries(list, 3).decidedBy) played++;
  });
  return { played, total };
}

/**
 * How each pair level on wins with another was told apart. Only rows that have played (wins + loss > 0)
 * are looked at. The rows level on wins form a group; within it, head-to-head wins
 * (standings.js headToHeadWins) come first, then quotient:
 *   'h2h'       this row's head-to-head wins differ from every other row's in the group
 *   'quotient'  it shares them with another, and its quotient differs from theirs
 *   'none'      it shares both with another: the table keeps them in the sheet's order
 * `size` is the whole group. In a group of two told apart by head-to-head the row also carries `won`
 * (this pair took it) and `score`, its own side first: the one match's points ("11–5"), a best-of-3
 * meeting's games ("2–1"), or, for two or more meetings (a double round robin), the meetings won and lost.
 * A row level on wins with no other is not in the map.
 * @param {object[]} rows     one table's standings rows
 * @param {object[]} matches  the day's matches
 * @returns {Map<string, { size: number, rule: 'h2h'|'quotient'|'none', won?: boolean, score?: string }>}
 */
export function tieBreaks(rows, matches){
  const byWins = new Map();
  rows.forEach(s => {
    if(s.wins + s.loss <= 0) return;
    if(!byWins.has(s.wins)) byWins.set(s.wins, []);
    byWins.get(s.wins).push(s);
  });
  const out = new Map();
  byWins.forEach(group => {
    if(group.length < 2) return;
    const h2h = headToHeadWins(group, matches);
    const q = s => s.quotient ?? -Infinity;
    group.forEach(s => {
      const sameH2h = group.filter(o => o !== s && h2h.get(o.teamCode) === h2h.get(s.teamCode));
      if(sameH2h.length === 0){
        const tie = { size: group.length, rule: 'h2h' };
        if(group.length === 2){
          const other = group.find(o => o !== s);
          tie.won = h2h.get(s.teamCode) > h2h.get(other.teamCode);
          tie.score = headToHeadScore(s.teamCode, other.teamCode, matches, h2h);
        }
        out.set(s.teamCode, tie);
      } else {
        const rule = sameH2h.some(o => q(o) === q(s)) ? 'none' : 'quotient';
        out.set(s.teamCode, { size: group.length, rule });
      }
    });
  });
  return out;
}

/** "11–5": a pair's own side first, from the matches between it and `other` (see tieBreaks). */
function headToHeadScore(code, other, matches, h2h){
  const between = m => (m.t1 === code && m.t2 === other) || (m.t1 === other && m.t2 === code);
  const own = m => (m.t1 === code ? [m.t1Score, m.t2Score] : [m.t2Score, m.t1Score]);
  const singles = matches.filter(m => m.bestOf !== 3 && m.played && between(m));
  const series = Array.from(rrSeriesGroups(matches.filter(m => between(m)))).map(([, list]) => list).filter(list => list.some(g => g.m.played));
  if(singles.length + series.length === 1){
    if(singles.length === 1){
      const [a, b] = own(singles[0]);
      return `${a}–${b}`;
    }
    let a = 0, b = 0;
    series[0].forEach(g => {
      if(!g.m.played) return;
      const [x, y] = own(g.m);
      if(x > y) a++; else if(y > x) b++;
    });
    return `${a}–${b}`;
  }
  return `${h2h.get(code)}–${h2h.get(other)}`;
}

/**
 * The words of a table's status pill: "In progress · 6/10" while meetings are left, "Final" once every
 * one is played; none for a table with no meetings.
 * @param {{ played: number, total: number }} progress  tableProgress or teamTableProgress
 * @returns {{ kind: 'progress'|'final', text: string } | null}
 */
export function progressLabel({ played, total }){
  if(!total) return null;
  return played < total ? { kind: 'progress', text: `In progress · ${played}/${total}` } : { kind: 'final', text: 'Final' };
}

/**
 * The words of a row's tie pill, from its tieBreaks entry. `tied` is the pill's own colour: level on
 * everything, which the table settles by the sheet's order.
 * @param {{ size: number, rule: 'h2h'|'quotient'|'none', won?: boolean, score?: string }} tie
 * @returns {{ text: string, tied: boolean }}
 */
export function tieLabel(tie){
  if(tie.rule === 'none') return { text: 'Tied', tied: true };
  const lead = tie.size === 2 ? 'Tie' : `${tie.size}-way tie`;
  if(tie.rule === 'quotient') return { text: `${lead} · on quotient`, tied: false };
  return { text: tie.size === 2 ? `${lead} · ${tie.won ? 'won' : 'lost'} head-to-head ${tie.score}` : `${lead} · head-to-head`, tied: false };
}

/**
 * How many of a team event's bracket matchups are played: the matchups of the group stage (no playoff
 * stage) in that bracket, played once the matchup's result is final or a tie.
 * @param {object[]} matchups  model.team.matchups
 * @param {string} group       the bracket, as the standings rows carry it
 * @returns {{ played: number, total: number }}
 */
export function teamTableProgress(matchups, group){
  const list = matchups.filter(mu => mu.stage === null && mu.group !== null && String(mu.group) === String(group));
  return { played: list.filter(mu => mu.result.state === 'final' || mu.result.state === 'tie').length, total: list.length };
}
