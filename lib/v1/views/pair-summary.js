// Match Finder's pair summary: the card above a searched pair's tickets saying where the pair stands.
// Its category and bracket, its rank in that bracket's round robin with W, L, PF, PA and Q (the same
// numbers and order as the Standings tab), and once it is in the playoffs a row per round it has
// reached: the opponent (or the seat's label while it is not known), then the match's number and time,
// "Live · Court n", or the result. A status pill sums it up: In the Semifinals, Playing now, Champions,
// Did not advance.
//
// Standard and dual meet events only: a team event's finder is its own (views/teams.js). Nothing is
// shown while the day is not live, as the tickets show no scores then.

import { escapeHtml } from './html.js';
import { pointsFromMatches } from './standings.js';
import { divisionLabel, parseCode, standingsStageKey, roundKeyword, STAGE_ORDER } from '../domain/codes.js';
import { rankStandings, isEmptyStanding, fmtQ } from '../domain/standings.js';
import { isUnnamedScheduledPair } from '../domain/matches.js';
import { isByeStandingRow, matchByeSide } from '../domain/byes.js';
import { categoryRoundRobinDone, standingsBronzeWalkover } from '../domain/awards.js';
import { seriesGameOf, walkSeries } from '../domain/series.js';
import { parseFrom } from '../domain/bracket.js';

const ROUND_NAME = { R16: 'Round of 16', QF: 'Quarterfinal', SF: 'Semifinal', F: 'Final', B: 'Bronze' };
const IN_ROUND = { R16: 'In the Round of 16', QF: 'In the Quarterfinals', SF: 'In the Semifinals', F: 'In the Finals', B: 'In the Bronze match' };
const OUT_ROUND = { R16: 'Out in the Round of 16', QF: 'Out in the Quarterfinals', SF: 'Out in the Semifinals' };
const KEYWORD_STAGE = { R16: 'R16', QF: 'QF', SF: 'SF', B: 'BRONZE', F: 'FINAL' };
const stageIndex = keyword => STAGE_ORDER.indexOf(KEYWORD_STAGE[keyword]);

const normName = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const namesKey = (p1, p2) => [normName(p1), normName(p2)].sort().join('|');

/** "SF-2" -> "Semifinal 2", "F" -> "Final", "F (2)" -> "Final · Game 2"; anything else as it is. */
export function matchIdText(id){
  const text = String(id ?? '').trim();
  if(text === 'F') return 'Final';
  if(text === 'B') return 'Bronze';
  const series = /^F \((\d+)\)$/.exec(text);
  if(series) return `Final · Game ${series[1]}`;
  const m = /^(R16|QF|SF)-(\d+)$/.exec(text);
  return m ? `${ROUND_NAME[m[1]]} ${m[2]}` : text;
}

/** A match side not filled in yet: blank names, the slot's own code, or TBD. */
function sideIsOpen(code, p1){
  const name = String(p1 ?? '').trim();
  const slot = String(code).replace(/_?\(\d+\)\s*$/, '');
  return !name || name === 'TBD' || name === code || name === slot;
}

/** What an open seat says: "Winner of Semifinal 2", the workbook's seat label, or ''. */
function openSeatLabel(code, model){
  const row = model.standings.find(s => s.teamCode === code);
  if(!row) return '';
  const from = parseFrom(row.from);
  if(from) return `${from.kind === 'W' ? 'Winner' : 'Loser'} of ${matchIdText(from.match)}`;
  return (row.seat || '').trim();
}

/**
 * The pair's round-robin standing: its row, its rank in its bracket's group (as Standings orders it),
 * the group's size and label, and whether its category shows more than one bracket. null when the
 * pair has no round-robin row.
 */
export function roundRobinStanding(team, model){
  const type = model.event.type;
  const code = team.codes.find(c => standingsStageKey(c, type) === 'RR' && model.standings.some(s => s.teamCode === c));
  if(!code) return null;
  const row = model.standings.find(s => s.teamCode === code);
  const { category, club } = parseCode(code, type);
  const sameCategory = model.standings.filter(s => {
    const p = parseCode(s.teamCode, type);
    return p.category === category && p.club === club && standingsStageKey(s.teamCode, type) === 'RR'
      && !isByeStandingRow(s) && (!isEmptyStanding(s) || isUnnamedScheduledPair(s, model.matchByCode, type));
  });
  const bracket = (row.bracket || '').trim();
  const labels = new Set(sameCategory.map(s => (s.bracket || '').trim()).filter(Boolean));
  const group = rankStandings(sameCategory.filter(s => (s.bracket || '').trim() === bracket), model.matches);
  const points = pointsFromMatches([row], model.matches).get(code);
  const played = model.matches.some(m => m.played && !matchByeSide(m) && (m.t1 === code || m.t2 === code));
  return {
    code, row, category, bracket, multiBracket: labels.size > 1, played,
    rank: group.indexOf(row) + 1, of: group.length, pf: points.pf, pa: points.pa,
    done: categoryRoundRobinDone(model, category),
  };
}

/**
 * One row per playoff round the pair has reached, in stage order. A series final (twice-to-beat,
 * best-of-3) is one row over its games. Each row: { keyword, round, opponent, openLabel, state, ... }
 *   state  'won' | 'lost' | 'live' | 'upcoming' | 'walkover'
 */
export function playoffRounds(team, model, standing){
  const type = model.event.type;
  const codes = team.codes.filter(c => standingsStageKey(c, type) !== 'RR');
  const rounds = [];
  const seen = new Set();
  const isLive = m => model.isLive && !!m.liveCourt;
  const timeOf = m => `#${m.num}${m.time ? ` · ${m.time}` : ''}`;

  codes.forEach(code => {
    const keyword = roundKeyword(parseCode(code, type).rest);
    const game = seriesGameOf(code);
    const key = game ? game.series : code;
    if(!keyword || seen.has(key)) return;
    seen.add(key);
    const all = model.matches
      .filter(m => (game ? seriesGameOf(m.t1)?.series === game.series && [m.t1, m.t2].some(c => team.codes.includes(c)) : (m.t1 === code || m.t2 === code)))
      .filter(m => !matchByeSide(m))
      .sort((a, b) => a.num - b.num);
    // A series game after the decider is never played
    const games = all.filter(m => !model.unneededGames.has(m));
    if(!games.length) return;
    const sideOf = m => team.codes.includes(m.t1) ? 1 : 2;
    const opp = m => sideOf(m) === 1 ? { code: m.t2, p1: m.t2p1, p2: m.t2p2 } : { code: m.t1, p1: m.t1p1, p2: m.t1p2 };
    const scoreOf = m => sideOf(m) === 1 ? [m.t1Score, m.t2Score] : [m.t2Score, m.t1Score];
    const o = opp(games[0]);
    const open = sideIsOpen(o.code, o.p1);
    const row = { keyword, round: ROUND_NAME[keyword], opponent: open ? '' : `${o.p1} / ${o.p2}`, openLabel: open ? openSeatLabel(o.code, model) : '' };

    let decided = null; // { won, text }
    if(game){
      const list = all.map(m => { const a = seriesGameOf(m.t1), b = seriesGameOf(m.t2); return { m, game: a.game, seat1: a.seat, seat2: b.seat }; })
        .sort((x, y) => x.game - y.game);
      const { decidedBy } = walkSeries(list);
      const playedGames = games.filter(m => m.played);
      if(decidedBy){
        const won = scoreOf(decidedBy)[0] > scoreOf(decidedBy)[1];
        const w = playedGames.filter(m => scoreOf(m)[0] > scoreOf(m)[1]).length;
        const l = playedGames.filter(m => scoreOf(m)[0] < scoreOf(m)[1]).length;
        const each = playedGames.map(m => scoreOf(m).join('–')).join(', ');
        decided = { won, text: `${won ? 'Won' : 'Lost'} ${w}–${l} (${each})` };
      } else if(playedGames.length){
        row.sofar = playedGames.map((m, i) => `Game ${i + 1}: ${scoreOf(m)[0] > scoreOf(m)[1] ? 'won' : 'lost'} ${scoreOf(m).join('–')}`).join(' · ');
      }
    } else if(games[0].played){
      const [a, b] = scoreOf(games[0]);
      if(a !== b) decided = { won: a > b, text: `${a > b ? 'Won' : 'Lost'} ${a}–${b}` };
    }

    const live = games.find(m => !m.played && isLive(m));
    const next = games.find(m => !m.played);
    if(decided){ row.state = decided.won ? 'won' : 'lost'; row.result = decided.text; }
    else if(live){ row.state = 'live'; row.result = `Live · Court ${live.liveCourt}`; }
    else { row.state = 'upcoming'; row.result = next ? timeOf(next) : ''; row.court = next ? next.court : ''; }
    rounds.push(row);
  });

  // A bronze taken without a match: the round robin's #3 against a BYE, with no Bronze match scheduled
  if(standing){
    const walkover = standingsBronzeWalkover(model, standing.category);
    if(walkover.pair && namesKey(walkover.pair.player1, walkover.pair.player2) === namesKey(team.p1, team.p2)){
      rounds.push({ keyword: 'B', round: 'Bronze', opponent: '', openLabel: '', state: 'walkover', result: '3rd in the round robin · no match' });
    }
  }
  return rounds.sort((a, b) => stageIndex(a.keyword) - stageIndex(b.keyword));
}

/** Whether every first-round playoff seat of the category has its pair (the round robin has seeded it). */
function playoffsSeeded(model, standing){
  const type = model.event.type;
  const { club } = parseCode(standing.code, type);
  const rows = model.standings.filter(s => {
    const p = parseCode(s.teamCode, type);
    return p.category === standing.category && (type !== 'dual-meet' || p.club === club || ['BRONZE', 'FINAL'].includes(standingsStageKey(s.teamCode, type)))
      && standingsStageKey(s.teamCode, type) !== 'RR' && !isByeStandingRow(s);
  });
  if(!rows.length) return null; // no playoffs at all
  const first = Math.min(...rows.map(s => STAGE_ORDER.indexOf(standingsStageKey(s.teamCode, type))));
  return rows.filter(s => STAGE_ORDER.indexOf(standingsStageKey(s.teamCode, type)) === first).every(s => !isEmptyStanding(s));
}

/** The status pill: { text, kind } or null. kind: 'gold' | 'silver' | 'bronze' | 'live' | 'in' | 'out' */
export function pairStatus(rounds, standing, model){
  if(rounds.some(r => r.state === 'live')) return { text: 'Playing now', kind: 'live' };
  const final = rounds.find(r => r.keyword === 'F');
  if(final && final.state === 'won') return { text: 'Champions', kind: 'gold' };
  if(final && final.state === 'lost') return { text: 'Runners-up', kind: 'silver' };
  const bronze = rounds.find(r => r.keyword === 'B');
  if(bronze && (bronze.state === 'won' || bronze.state === 'walkover')) return { text: 'Bronze medal', kind: 'bronze' };
  if(bronze && bronze.state === 'lost') return { text: '4th place', kind: 'out' };
  const last = rounds[rounds.length - 1];
  if(last && last.state === 'upcoming') return { text: IN_ROUND[last.keyword], kind: 'in' };
  if(last && last.state === 'lost') return { text: OUT_ROUND[last.keyword] || 'Out', kind: 'out' };
  if(last && last.state === 'won') return { text: `Won the ${last.round}`, kind: 'in' };
  if(!rounds.length && standing && standing.done && playoffsSeeded(model, standing)) return { text: 'Did not advance', kind: 'out' };
  return null;
}

/**
 * The card's markup, or '' when there is nothing to show (a team event, the day not live yet, a pair
 * with no round-robin row).
 * @param {{ codes: string[], p1: string, p2: string }} team  a pair of buildPairIndex
 * @param {import('../domain/model.js').DayModel} model
 */
export function pairSummaryHTML(team, model){
  const type = model.event.type;
  if(type === 'team' || !model.isLive) return '';
  const standing = roundRobinStanding(team, model);
  if(!standing) return '';
  const rounds = playoffRounds(team, model, standing);
  const status = pairStatus(rounds, standing, model);
  const s = standing;
  const label = divisionLabel(s.code, type, model.event.display || {});
  const bracketText = s.multiBracket && s.bracket ? `Bracket ${s.bracket}` : '';

  const pills = [
    label ? `<span class="ps-pill ps-cat">${escapeHtml(label)}</span>` : '',
    bracketText ? `<span class="ps-pill ps-bracket">${escapeHtml(bracketText)}</span>` : '',
  ].join('');
  const statusHTML = status ? `<span class="ps-status ps-status--${status.kind}">${status.kind === 'live' ? '<span class="live-dot"></span>' : ''}${escapeHtml(status.text)}</span>` : '';
  const rankNote = [`of ${s.of}`, bracketText ? `in ${bracketText}` : '', s.done ? '· round robin final' : ''].filter(Boolean).join(' ');
  const stat = (name, value, cls = '') => `<div class="ps-stat${cls}"><small>${name}</small><b>${value}</b></div>`;

  const roundRow = r => {
    const who = r.state === 'walkover' ? ''
      : r.opponent ? `vs ${escapeHtml(r.opponent)}` : 'vs to be decided';
    const under = [r.state === 'walkover' ? '' : r.openLabel, r.sofar || '', r.state === 'upcoming' && r.court ? r.court : '']
      .filter(Boolean).map(escapeHtml).join(' · ');
    const result = r.state === 'walkover' ? `<span class="ps-who">${escapeHtml(r.result)}</span>`
      : `<span class="ps-who">${who}${under ? `<i>${under}</i>` : ''}</span>${r.result ? `<span class="ps-res ps-res--${r.state}">${escapeHtml(r.result)}</span>` : ''}`;
    return `<div class="ps-round"><span class="ps-round-name">${escapeHtml(r.round)}</span>${result}</div>`;
  };

  return `<div class="pair-summary">
    <div class="ps-top"><div class="ps-pills">${pills}</div>${statusHTML}</div>
    <div class="ps-rank"><b>${s.played ? `#${s.rank}` : '—'}</b><span>${escapeHtml(rankNote)}</span></div>
    <div class="ps-stats">${stat('W', s.row.wins)}${stat('L', s.row.loss)}${stat('PF', s.pf)}${stat('PA', s.pa)}${stat('Q', fmtQ(s.row.quotient), ' ps-q')}</div>
    ${rounds.length ? `<div class="ps-playoffs"><div class="ps-playoffs-title">Playoffs</div>${rounds.map(roundRow).join('')}</div>` : ''}
  </div>`;
}
