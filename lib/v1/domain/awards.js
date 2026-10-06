// Awards podium derivation (awards-podium-tab-spec §2).
//
// Everything here is a pure function over a day's matches and standings — no
// fetch, no config, no new failure mode. See
// sage-docs/docs/specs/.../awards-podium-tab-spec.md.
//
// Each function takes the DayModel (model.js), reading only `matches`,
// `standings`, `event.type`, `event.display` and, for the team type, `team`.

import { parseCode, roundKeyword, standingsStageKey, buildCategoryOrderIndex, clubLabel } from './codes.js';
import { matchInstanceOf } from './matches.js';
import { matchByeSide, isByeStandingRow } from './byes.js';
import { seriesGroups, walkSeries } from './series.js';
import { rankStandings, isEmptyStanding } from './standings.js';
import { baseTeamOf, sideLabel, sideOf } from './teams.js';

const displayOf = model => model.event.display || {};

/**
 * The non-bye side's code — used to read a match's category/round/instance
 * off the *real* team's code, since a literal "BYE" code parses to garbage.
 */
export function nonByeCode(m){
  return matchByeSide(m) === 't1' ? m.t2 : m.t1;
}
export function matchCategoryOf(m, type){ return parseCode(nonByeCode(m), type).category; }
export function matchRestOf(m, type){ return parseCode(nonByeCode(m), type).rest; }

/**
 * The decisive match (§2.4) for one category+round keyword: among all
 * matches for that round, the resolved instance with the highest instance
 * number (missing instance treated as 0). "Resolved" means played, or
 * decided by a bye walkover. Returns:
 *   { any:false }                        — no such round exists for this category
 *   { any:true, match:null, error:null } — round exists, nothing resolved yet (pending)
 *   { any:true, match, error:null }      — resolved cleanly, `match` is decisive
 *   { any:true, match, error:'tie'|'bothBye' } — a data error at that instance
 */
export function resolveDecisiveMatch(model, category, keyword){
  const type = model.event.type;
  const candidates = model.matches.filter(m => matchCategoryOf(m, type) === category && roundKeyword(matchRestOf(m, type)) === keyword);
  if(candidates.length === 0) return { any: false, match: null, error: null };
  // A series final (twice-to-beat, best-of-3) is decided by the game where a
  // seat reaches its wins, not by the last game played: a challenger who wins
  // twice-to-beat's game 1 has forced game 2, not won the final.
  const series = seriesGroups(candidates);
  if(series.size === 1){
    const list = series.values().next().value;
    if(list.length === candidates.length){
      const { decidedBy, tie } = walkSeries(list);
      if(decidedBy) return { any: true, match: decidedBy, error: null };
      if(tie) return { any: true, match: tie, error: 'tie' };
      return { any: true, match: null, error: null };
    }
  }
  const byInstanceDesc = candidates.slice().sort((a, b) =>
    (matchInstanceOf(matchRestOf(b, type)) || 0) - (matchInstanceOf(matchRestOf(a, type)) || 0));
  for(const m of byInstanceDesc){
    const side = matchByeSide(m);
    if(side === 'both') return { any: true, match: m, error: 'bothBye' };
    if(side === 't1' || side === 't2') return { any: true, match: m, error: null };
    if(m.played){
      if(m.t1Score === m.t2Score) return { any: true, match: m, error: 'tie' };
      return { any: true, match: m, error: null };
    }
    // this instance hasn't happened yet — fall through to a lower instance
  }
  return { any: true, match: null, error: null }; // exists, nothing resolved yet
}

export function winnerOfMatch(m){
  const side = matchByeSide(m);
  if(side === 't1') return { p1: m.t2p1, p2: m.t2p2, code: m.t2 };
  if(side === 't2') return { p1: m.t1p1, p2: m.t1p2, code: m.t1 };
  return m.t1Score > m.t2Score
    ? { p1: m.t1p1, p2: m.t1p2, code: m.t1 }
    : { p1: m.t2p1, p2: m.t2p2, code: m.t2 };
}
/**
 * The loser is only meaningful for a real, non-bye-decided match — a bye
 * side is never rendered as a person (§2.3).
 */
export function loserOfMatch(m){
  if(matchByeSide(m)) return null;
  return m.t1Score > m.t2Score
    ? { p1: m.t2p1, p2: m.t2p2, code: m.t2 }
    : { p1: m.t1p1, p2: m.t1p2, code: m.t1 };
}

export function medalistFromTeam(model, team){
  if(!team) return null;
  const club = model.event.type === 'dual-meet' ? parseCode(team.code, model.event.type).club : null;
  return { p1: team.p1, p2: team.p2, club, clubLabel: club ? clubLabel(club, displayOf(model)) : null };
}

/**
 * True when a category's decisive Bronze match was won by walkover — used
 * to drop the whole BRONZE block from Standings (§2.6 rule 2), not just the
 * BYE row, since a one-sided "Bronze Battle" block is worse than none.
 */
export function categoryBronzeIsByeDecided(model, category){
  const res = resolveDecisiveMatch(model, category, 'B');
  return !!(res.match && !res.error && matchByeSide(res.match)) || standingsBronzeWalkover(model, category).walkover;
}

/**
 * A bronze decided in the standings alone: its two slots are one real pair
 * and a BYE, and no Bronze match is scheduled (a twice-to-beat category's
 * round-robin #3 takes bronze without playing). `pair` is that row once its
 * names are in, else null (still pending).
 */
export function standingsBronzeWalkover(model, category){
  const type = model.event.type;
  const rows = model.standings.filter(s => parseCode(s.teamCode, type).category === category && standingsStageKey(s.teamCode, type) === 'BRONZE');
  const byes = rows.filter(isByeStandingRow);
  const real = rows.filter(s => !isByeStandingRow(s));
  if(byes.length !== 1 || real.length !== 1) return { walkover: false, pair: null };
  return { walkover: true, pair: isEmptyStanding(real[0]) ? null : real[0] };
}

/**
 * §2.5 — categories with no bracket at all fall back to the top three RR
 * standings rows, same sort Standings already applies.
 */
export function standingsTop3ForCategory(model, category){
  const type = model.event.type;
  const rows = rankStandings(model.standings.filter(s => parseCode(s.teamCode, type).category === category && !isEmptyStanding(s) && !isByeStandingRow(s)), model.matches);
  return rows.slice(0, 3).map(s => {
    const club = type === 'dual-meet' ? parseCode(s.teamCode, type).club : null;
    return { p1: s.player1, p2: s.player2, club, clubLabel: club ? clubLabel(club, displayOf(model)) : null };
  });
}

/**
 * True once every Round Robin match in the category has a score. Byes are
 * never played, so they don't count against it.
 */
export function categoryRoundRobinDone(model, category){
  const type = model.event.type;
  const rr = model.matches.filter(m => matchCategoryOf(m, type) === category && !matchByeSide(m) && !roundKeyword(matchRestOf(m, type)));
  return rr.length > 0 && rr.every(m => m.played);
}

/**
 * -> [{ category, source: 'bracket'|'standings', gold, silver, bronze,
 *       warning, orderIdx }], ordered by the category order so the Awards
 * tab agrees with Standings' own category order.
 */
export function buildPodiums(model){
  const type = model.event.type;
  const categoryTokens = Array.from(new Set(model.matches.map(m => matchCategoryOf(m, type)).filter(Boolean)));
  const orderIndex = buildCategoryOrderIndex(categoryTokens, displayOf(model));
  const results = [];

  categoryTokens.forEach(category => {
    const orderIdx = orderIndex.has(category) ? orderIndex.get(category) : 999;
    const finalRes = resolveDecisiveMatch(model, category, 'F');

    if(!finalRes.any){
      // No Final ever plays for this category — pure round robin, standings decide it.
      // Standings only settle a podium once every Round Robin match has a
      // score — before that, the top three are just the current leaders, so
      // all three placings stay Pending (§2.7: never guess).
      const top3 = standingsTop3ForCategory(model, category);
      if(top3.length === 0) return; // nothing to show at all — omitted (§2.7)
      const done = categoryRoundRobinDone(model, category);
      results.push({
        category, source: 'standings',
        gold: done ? top3[0] || null : null,
        silver: done ? top3[1] || null : null,
        bronze: done ? top3[2] || null : null,
        warning: null, orderIdx
      });
      return;
    }

    if(finalRes.error){
      results.push({
        category, source: 'bracket',
        gold: null, silver: null, bronze: null,
        warning: `Check the score for match #${finalRes.match.num}`, orderIdx
      });
      return;
    }

    const bronzeRes = resolveDecisiveMatch(model, category, 'B');
    if(bronzeRes.error){
      results.push({
        category, source: 'bracket',
        gold: null, silver: null, bronze: null,
        warning: `Check the score for match #${bronzeRes.match.num}`, orderIdx
      });
      return;
    }

    // No Bronze match at all: a walkover set up in the standings alone
    // (standingsBronzeWalkover) still awards it.
    const standingsBronze = bronzeRes.any ? null : standingsBronzeWalkover(model, category);
    let bronze = medalistFromTeam(model, bronzeRes.match ? winnerOfMatch(bronzeRes.match) : null);
    if(standingsBronze && standingsBronze.pair){
      const s = standingsBronze.pair;
      bronze = medalistFromTeam(model, { p1: s.player1, p2: s.player2, code: s.teamCode });
    }

    results.push({
      category, source: 'bracket',
      gold: medalistFromTeam(model, finalRes.match ? winnerOfMatch(finalRes.match) : null),
      silver: medalistFromTeam(model, finalRes.match ? loserOfMatch(finalRes.match) : null),
      bronze,
      warning: null, orderIdx
    });
  });

  results.sort((a, b) => a.orderIdx - b.orderIdx);
  return results;
}

/**
 * Dual-meet only: which club is ahead overall — same metric, same source
 * data, as the Standings tab's own club-summary bar (renderClubSummary):
 * total wins across Round Robin rows only, per club. Deliberately the same
 * computation rather than a podium-derived one (e.g. gold count), so the
 * two tabs never disagree about who's "ahead." Named explicitly as "Tied"
 * rather than inventing a tiebreak — consistent with this tab's "never
 * guess" rule elsewhere (§2.7).
 * -> null (not a dual-meet, or nothing to compare yet) | {
 *      rows: [{ club, clubLabel, wins }],  // per display.clubs order
 *      champion: <row> | null,   // null when 0-0 so far, or tied
 *      tied: boolean
 *    }
 */
export function computeOverallChampion(model){
  const type = model.event.type;
  if(type !== 'dual-meet' || model.standings.length === 0) return null;

  const byClub = new Map();
  model.standings.forEach(s => {
    const clubCode = parseCode(s.teamCode, type).club || 'OTHER';
    if(!byClub.has(clubCode)) byClub.set(clubCode, []);
    byClub.get(clubCode).push(s);
  });

  const display = displayOf(model);
  const knownClubOrder = display.clubs ? Object.keys(display.clubs) : Array.from(byClub.keys());
  if(knownClubOrder.length < 2) return null; // nothing meaningful to compare

  const rows = knownClubOrder.map(code => {
    const clubRows = byClub.get(code) || [];
    const wins = clubRows
      .filter(s => standingsStageKey(s.teamCode, type) === 'RR')
      .reduce((sum, s) => sum + (s.wins || 0), 0);
    return { club: code, clubLabel: clubLabel(code, display), wins };
  });

  const maxWins = Math.max(...rows.map(r => r.wins));
  let champion = null, tied = false;
  if(maxWins > 0){
    const leaders = rows.filter(r => r.wins === maxWins);
    if(leaders.length === 1) champion = leaders[0]; else tied = true;
  }
  return { rows, champion, tied };
}

// ---- Team type (spec §9.6) ----------------------------------------------------------------------

/** Every distinct player who played a match for that base team, A–Z. */
export function teamRosterFor(model, base){
  const rowByCode = model.team.rowByCode;
  const names = new Set();
  model.matches.forEach(m => {
    [[m.t1, m.t1p1, m.t1p2], [m.t2, m.t2p1, m.t2p2]].forEach(([code, p1, p2]) => {
      if(baseTeamOf(sideOf(code), rowByCode) !== base) return;
      [p1, p2].forEach(n => { if(n && n !== 'TBD') names.add(n); });
    });
  });
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

export function teamMedalist(model, side){
  const base = baseTeamOf(side, model.team.rowByCode);
  const teamName = sideLabel(side, model.team.rowByCode);
  return { teamName, base, roster: base ? teamRosterFor(model, base) : [], p1: teamName, p2: '', club: null, clubLabel: null };
}

/**
 * One podium in the existing shape: Gold = the Final matchup's winner,
 * Silver = its loser, Bronze = the Bronze matchup's winner, all by total
 * points. Each is null (Pending) until that matchup is final.
 */
export function buildTeamPodium(model){
  const matchups = model.team.matchups;
  const finalMu = matchups.find(mu => mu.stage === 'Fi');
  const bronzeMu = matchups.find(mu => mu.stage === 'Br');
  const lowestNum = mu => Math.min(...mu.matches.map(m => m.num));

  const warnings = [];
  if(finalMu && finalMu.result.state === 'tie') warnings.push(`Final is a tie on points — check match #${lowestNum(finalMu)}`);
  if(bronzeMu && bronzeMu.result.state === 'tie') warnings.push(`Bronze is a tie on points — check match #${lowestNum(bronzeMu)}`);

  let gold = null, silver = null, bronze = null;
  if(!warnings.length){
    const f = finalMu ? finalMu.result : null;
    if(f && f.state === 'final'){
      gold = teamMedalist(model, f.winner === 1 ? f.side1 : f.side2);
      silver = teamMedalist(model, f.winner === 1 ? f.side2 : f.side1);
    }
    const b = bronzeMu ? bronzeMu.result : null;
    if(b && b.state === 'final') bronze = teamMedalist(model, b.winner === 1 ? b.side1 : b.side2);
  }
  return {
    category: '__team__', source: 'bracket',
    gold, silver, bronze,
    warning: warnings.length ? warnings.join('; ') : null,
    orderIdx: 0
  };
}
