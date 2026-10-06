// Team events (named teams meeting in four-match matchups, won on total points): the roster
// cards, the matchup cards, the bracket tables and playoffs, the Live Matches row, and the
// team event's own Match Finder (teams and players). Control Center and a team event's Hub
// share it, so this is one component, createTeams, over the DayModel's `team` data
// (domain/teams.js builds it); the pure builders are exported for the unit tests.
//
// Extension points, for what only Control Center has (site-engine-spec §4.10):
//   options.decorateRow(m)     { className?, attrs?, metaHTML? } added to a match line in the interactive views (the
//                              Match Finder's), as ticket.decorate does for a ticket (views/ticket.js)
//   options.expandAllClass     the class of the Teams tab's Expand all / Collapse all button
//
// Presentation options (sage-docs/docs/specs/.../team-tournament-template-spec.md §2.2), whose defaults are
// what Control Center shows:
//   options.teamLetters        false: no organiser's team letter (A, B, ...) is drawn anywhere; a public Hub's
//                              reader never sees them. A builder takes it as `hooks.teamLetters` (or its own
//                              `teamLetters` option); a missing value means true
//   options.searchHint         the Match Finder's first-screen hint

import { escapeHtml } from './html.js';
import { captureScrollPositions, restoreScrollPositions } from './scroll.js';
import {
  sideOf, isGroupTeamCode, pairLabel, teamLevelLabel,
  baseTeamOf, teamNameOf, sideLabel, stageLabel, teamRankBracket, teamRosterOf,
} from '../domain/teams.js';
import { fmtQ } from '../domain/standings.js';

const CHEV_SVG = '<svg class="chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LINEUP_NOTE = `<p class="lineup-note">Some lineups aren't in yet. Matches appear here once the team captain enters them.</p>`;
const lineupUnset = m => m.t1p1 === 'TBD' || m.t2p1 === 'TBD';

// ---- labels ---------------------------------------------------------------------------------

/** "9:00 AM & 9:25 AM" -> "9:00 & 9:25 AM" when the whole matchup shares a meridiem. */
export function teamTimesLabel(times){
  const parts = times.map(t => /^(.*?)\s*(AM|PM)$/i.exec(t));
  if(!parts.length || parts.some(p => !p)) return times.join(' & ');
  const suffixes = new Set(parts.map(p => p[2].toUpperCase()));
  if(suffixes.size !== 1) return times.join(' & ');
  return parts.map((p, i) => i === parts.length - 1 ? `${p[1]} ${p[2]}` : p[1]).join(' & ');
}

/** Consecutive courts as a range ("Courts 1–2"), otherwise a list. */
export function teamCourtsLabel(courts){
  const nums = courts.map(c => { const m = /(\d+)\s*$/.exec(c); return m ? parseInt(m[1], 10) : null; });
  if(!nums.length) return '';
  if(nums.some(n => n === null)) return courts.join(', ');
  const sorted = Array.from(new Set(nums)).sort((a, b) => a - b);
  if(sorted.length === 1) return `Court ${sorted[0]}`;
  const consecutive = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
  return consecutive
    ? `Courts ${sorted[0]}–${sorted[sorted.length - 1]}`
    : `Courts ${sorted.join(', ')}`;
}

/** A matchup's lowest match number: a matchup of #3, #8, #9 and #17 sorts as 3. */
export function matchupFirstNum(mu){ return Math.min(...mu.matches.map(m => m.num)); }

// ---- rosters ----------------------------------------------------------------------------------

export function rosterListHTML(model, teamCode, highlight){
  return `<ul class="roster-list">${teamRosterOf(model.team.rosterByCode, teamCode).map(r => `
    <li class="${highlight && r.player.toLowerCase() === highlight ? 'me' : ''}"><span>${escapeHtml(r.player)}</span>
      <span class="roster-tags">${r.level ? `<span class="roster-tag">${escapeHtml(teamLevelLabel(r.level))}</span>` : ''}${r.gender ? `<span class="roster-tag">${escapeHtml(r.gender)}</span>` : ''}</span></li>`).join('')}</ul>`;
}

export function rosterCardHTML(model, teamCode, { open = false, toggle = true, highlight = null, teamLetters = true } = {}){
  const name = teamNameOf(teamCode, model.team.rowByCode) || `Team ${teamCode}`;
  const count = (model.team.rosterByCode.get(teamCode) || []).length;
  const meta = `${teamLetters ? `Team ${escapeHtml(teamCode)} · ` : ''}${count} player${count === 1 ? '' : 's'}`;
  if(!toggle){
    return `<div class="roster-card"><div class="roster-head"><span class="rt-name">${escapeHtml(name)}</span><small>${meta}</small></div>${rosterListHTML(model, teamCode, highlight)}</div>`;
  }
  return `<div class="roster-card">
    <button type="button" class="roster-toggle" data-roster-team="${escapeHtml(teamCode)}" aria-expanded="${open}">
      <span><span class="rt-name">${escapeHtml(name)}</span><small>${meta}</small></span>${CHEV_SVG}
    </button>
    ${open ? rosterListHTML(model, teamCode, highlight) : ''}
  </div>`;
}

/** The Teams tab's body: every roster card under its bracket, or a note that none are published. */
export function rostersHTML(model, openSet, { expandAllClass = '', teamLetters = true } = {}){
  const { roster, rosterByCode } = model.team;
  if(!roster.length){
    return `<div class="empty-state">Team rosters aren't published yet. They come from the workbook's Teams tab on the next sync.</div>`;
  }
  const groups = new Map();
  const seen = new Set();
  model.standings.filter(st => isGroupTeamCode(st.teamCode) && rosterByCode.has(st.teamCode)).forEach(st => {
    const g = st.bracket || '';
    if(!groups.has(g)) groups.set(g, []);
    groups.get(g).push(st.teamCode);
    seen.add(st.teamCode);
  });
  const others = Array.from(rosterByCode.keys()).filter(c => !seen.has(c));
  if(others.length) groups.set('__other__', others);
  const keys = Array.from(groups.keys()).sort((a, b) => a === '__other__' ? 1 : b === '__other__' ? -1 : a.localeCompare(b, undefined, { numeric: true }));
  const allOpen = Array.from(rosterByCode.keys()).every(c => openSet.has(c));
  return `<div class="roster-actions"><button type="button" class="${expandAllClass}" data-roster-all="${allOpen ? 'close' : 'open'}">${allOpen ? 'Collapse all' : 'Expand all'}</button></div>` +
    keys.map(g => `<h2 class="section-title">${g === '__other__' ? 'Other teams' : (g ? `Bracket ${escapeHtml(g)}` : 'Teams')}</h2>
      <div class="roster-grid">${groups.get(g).map(code => rosterCardHTML(model, code, { open: openSet.has(code), teamLetters })).join('')}</div>`).join('');
}

// ---- matchups ---------------------------------------------------------------------------------

export function sideChipHTML(model, side, hooks = {}){
  if(hooks.teamLetters === false) return '';
  const base = baseTeamOf(side, model.team.rowByCode);
  return base ? `<span class="chip">${escapeHtml(base)}</span>` : '';
}

export function matchupRowHTML(model, m, swap, hooks = {}, interactive = false){
  const a = swap ? { code: m.t2, p1: m.t2p1, p2: m.t2p2, score: m.t2Score }
                 : { code: m.t1, p1: m.t1p1, p2: m.t1p2, score: m.t1Score };
  const b = swap ? { code: m.t1, p1: m.t1p1, p2: m.t1p2, score: m.t1Score }
                 : { code: m.t2, p1: m.t2p1, p2: m.t2p2, score: m.t2Score };
  const live = model.isLive && !!m.liveCourt;
  const played = model.isLive && m.played;
  const players = (s, right) => s.p1 === 'TBD'
    ? `<div class="tm-players unset${right ? ' right' : ''}">Lineup not set</div>`
    : `<div class="tm-players${right ? ' right' : ''}"><span class="p">${escapeHtml(s.p1)}</span><span class="p">${escapeHtml(s.p2)}</span></div>`;
  const score = played
    ? `<span class="tm-rscore">${a.score > b.score ? `<b>${a.score}</b>` : a.score}–${b.score > a.score ? `<b>${b.score}</b>` : b.score}</span>`
    : `<span class="tm-rscore">–</span>`;
  const plabel = pairLabel(m.t1, true, model.event.pairs || undefined);
  // Match Finder only (interactive): the page may make the line clickable (spec §5.7).
  const extra = interactive && hooks.decorateRow ? hooks.decorateRow(m) : {};
  return `<div class="tm-row${live ? ' live' : ''}${extra.className || ''}"${extra.attrs || ''}>
    <div class="tm-row-meta">
      <span>#${m.num}</span>${plabel ? `<span class="tm-plabel">${escapeHtml(plabel)}</span>` : ''}
      ${live ? `<span class="tm-live"><span class="live-dot" aria-hidden="true"></span>Court ${escapeHtml(m.liveCourt)}</span>` : ''}
      ${extra.metaHTML || ''}
    </div>
    <div class="tm-row-body">${players(a, false)}${score}${players(b, true)}</div>
  </div>`;
}

/**
 * The one matchup component. focusBase: put that base team on the left (display only). compact:
 * headline only, matches behind a toggle. onlyMatch: show just the row for that match number (a
 * player's result). isNext: flag "Next up". interactive: Match Finder's calls only; lets the page act
 * on each match line (Standings' cards stay read-only, spec §5.7).
 * `expanded` is the set of matchup keys whose compact card shows its matches.
 */
export function matchupCardHTML(model, mu, { focusBase = null, compact = false, onlyMatch = null, isNext = false, interactive = false } = {}, expanded = new Set(), hooks = {}){
  const rowByCode = model.team.rowByCode;
  const r = mu.result;
  const swap = focusBase !== null && baseTeamOf(mu.side1, rowByCode) !== focusBase && baseTeamOf(mu.side2, rowByCode) === focusBase;
  const L = swap ? 2 : 1, R = swap ? 1 : 2;
  const sideOfN = n => n === 1 ? mu.side1 : mu.side2;
  const ptsOf = n => n === 1 ? r.pts1 : r.pts2;
  const isLive = model.isLive;
  const started = isLive && r.played > 0;
  const settled = isLive && (r.state === 'final' || r.state === 'tie');

  const pill = !isLive ? ''
    : r.state === 'in-progress' ? '<span class="tm-pill progress">In progress</span>'
    : r.state === 'final' ? '<span class="tm-pill final">Final</span>'
    : r.state === 'tie' ? '<span class="tm-pill tie">Tie</span>' : '';
  const nextPill = isLive && isNext ? '<span class="next-pill">Next up</span>' : '';

  const when = [
    `<span class="tm-stage">${escapeHtml(stageLabel(mu.side1, rowByCode))}</span>`,
    escapeHtml(teamTimesLabel(mu.times)),
    escapeHtml(teamCourtsLabel(mu.courts))
  ].filter(s => s && s.trim()).join(' &middot; ');

  const sideHTML = (n, right) => {
    const side = sideOfN(n);
    const won = settled && r.winner === n, lost = settled && r.winner !== null && r.winner !== n;
    const base = baseTeamOf(side, rowByCode);
    const name = teamNameOf(side, rowByCode);
    return `<div class="tm-side${right ? ' right' : ''}${won ? ' win' : ''}${lost ? ' lose' : ''}">
      <div class="tm-name${name ? '' : ' tbd'}">${escapeHtml(sideLabel(side, rowByCode))}${sideChipHTML(model, side, hooks)}${focusBase && base === focusBase ? '<span class="you-badge">You</span>' : ''}</div>
      ${won ? '<span class="tm-tag">Winner</span>' : ''}
    </div>`;
  };

  const middle = started
    ? `<div class="tm-mid"><div class="tm-score">${ptsOf(L)} – ${ptsOf(R)}</div><div class="tm-pairs">pairs ${L === 1 ? r.pairs1 : r.pairs2}–${R === 1 ? r.pairs1 : r.pairs2}</div></div>`
    : `<div class="tm-mid"><div class="tm-vs">VS</div></div>`;

  const isExpanded = !compact || expanded.has(mu.matchUp);
  const rowMatches = onlyMatch === null ? mu.matches : mu.matches.filter(m => m.num === onlyMatch);
  const rows = isExpanded
    ? `<div class="tm-rows">${rowMatches.map(m => matchupRowHTML(model, m, swap, hooks, interactive)).join('')}</div>`
    : '';
  const toggle = compact
    ? `<button type="button" class="tm-toggle" data-tm-toggle="${escapeHtml(mu.matchUp)}" aria-expanded="${isExpanded}">${isExpanded ? 'Hide matches' : 'Show matches'}</button>`
    : '';
  const stateClass = !isLive ? '' : r.state === 'in-progress' ? ' is-progress' : settled ? ' is-final' : '';

  return `<div class="tm-card${stateClass}${nextPill ? ' next' : ''}">
    <div class="tm-head">
      <div class="tm-when">${when}</div>
      <div class="tm-badges">${nextPill}${pill}</div>
    </div>
    <div class="tm-headline">${sideHTML(L, false)}${middle}${sideHTML(R, true)}</div>
    ${rows}${toggle}
  </div>`;
}

// ---- standings --------------------------------------------------------------------------------

export function groupTableHTML(model, group, rows, hooks = {}){
  // Rank numbers appear once any team in the bracket has a result.
  const anyQuotient = rows.some(s => s.quotient !== null);
  const ranked = anyQuotient ? teamRankBracket(rows, model.matches) : rows;
  const label = group === '' ? 'No bracket' : `Bracket ${group}`;
  return `<div class="group-card">
    <h3 class="group-title">${escapeHtml(label)}</h3>
    <div class="gt-wrap" data-group-key="${escapeHtml(group)}">
      <table class="gt">
        <thead><tr><th class="rk">${anyQuotient ? '#' : ''}</th><th>Team</th><th class="num">PF</th><th class="num">PA</th><th class="num">Quotient</th></tr></thead>
        <tbody>${ranked.map((s, i) => `<tr>
          <td class="rk">${anyQuotient ? i + 1 : ''}</td>
          <td class="tm">${escapeHtml(s.teamName || s.teamCode)}${hooks.teamLetters === false ? '' : `<span class="chip">${escapeHtml(s.teamCode)}</span>`}${model.team.advancing.has(s.teamCode) ? '<br><span class="adv-pill">Advances</span>' : ''}</td>
          <td class="num">${s.pf}</td>
          <td class="num">${s.pa}</td>
          <td class="q">${s.quotient === null ? '—' : fmtQ(s.quotient)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </div>`;
}

/** The team standings: bracket tables, the playoff rounds, and each bracket's matchups behind a toggle. */
export function teamStandingsHTML(model, { expanded = new Set(), openGroups = new Set() } = {}, hooks = {}){
  const matchups = model.team.matchups;
  const groups = new Map();
  model.standings.filter(s => isGroupTeamCode(s.teamCode)).forEach(s => {
    if(!groups.has(s.bracket)) groups.set(s.bracket, []);
    groups.get(s.bracket).push(s);
  });
  const groupKeys = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  let html = `<h2 class="section-title">Brackets</h2><div class="group-grid">${groupKeys.map(g => groupTableHTML(model, g, groups.get(g), hooks)).join('')}</div>`;

  html += `<h2 class="section-title">Playoffs</h2>`;
  const stageHTML = (stage, title) => {
    const list = matchups.filter(mu => mu.stage === stage);
    if(!list.length) return '';
    return `<div class="playoff-stage"><div class="section-caption">${title}</div><div class="playoff-cards">${list.map(mu => matchupCardHTML(model, mu, {}, expanded, hooks)).join('')}</div></div>`;
  };
  html += stageHTML('QF', 'Quarterfinals') + stageHTML('SF', 'Semifinals') + stageHTML('Br', 'Bronze') + stageHTML('Fi', 'Final');

  const groupNumbers = Array.from(new Set(matchups.filter(mu => mu.stage === null && mu.group !== null).map(mu => mu.group)))
    .sort((a, b) => a - b);
  if(groupNumbers.length){
    html += `<h2 class="section-title">Bracket matchups</h2>`;
    groupNumbers.forEach(g => {
      const list = matchups.filter(mu => mu.stage === null && mu.group === g);
      const open = openGroups.has(g);
      html += `<section class="group-section">
        <button type="button" class="group-toggle" data-tm-group="${g}" aria-expanded="${open}">
          <span>Bracket ${g}<small>${list.length} matchups</small></span>
          ${CHEV_SVG}
        </button>
        ${open ? `<div class="group-body">${list.map(mu => matchupCardHTML(model, mu, { compact: true }, expanded, hooks)).join('')}</div>` : ''}
      </section>`;
    });
  }
  return html;
}

// ---- Live Matches -------------------------------------------------------------------------------

/** A court's two table lines for a team event's match (spec §5.9). */
export function liveRowHTML(model, court, m, hooks = {}){
  const rowByCode = model.team.rowByCode;
  const side1 = sideOf(m.t1), side2 = sideOf(m.t2);
  const t1TBD = m.t1p1 === 'TBD';
  const t2TBD = m.t2p1 === 'TBD';
  const detailText = [stageLabel(side1, rowByCode), pairLabel(m.t1, false, model.event.pairs || undefined)].filter(Boolean).join(' · ');
  const scoreHTML = m.played
    ? `${escapeHtml(String(m.t1Score))}&ndash;${escapeHtml(String(m.t2Score))}`
    : 'VS';
  const mu = model.team.matchups.find(x => x.matchUp === m.matchUp);
  const matchupHTML = mu ? `Matchup ${mu.result.pts1} – ${mu.result.pts2}` : '&nbsp;';

  const teamCellHTML = (side, tbd, p1, p2) => `<div class="live-team-cell-inner"><div class="live-team-text">
      <div class="live-team-name">${escapeHtml(sideLabel(side, rowByCode))}${sideChipHTML(model, side, hooks)}</div>
      <div class="live-team-players">${tbd ? 'Lineup not set' : `<span class="p">${escapeHtml(p1)}</span><span class="p">${escapeHtml(p2)}</span>`}</div>
    </div></div>`;

  return `<tr>
    <td class="live-court-cell" rowspan="2"><span class="live-dot" aria-hidden="true"></span>${escapeHtml(court)}</td>
    <td class="live-cat-cell" colspan="3"><span class="live-round">${escapeHtml(detailText)}</span></td>
  </tr>
  <tr class="live-match-row">
    <td class="live-team-cell">${teamCellHTML(side1, t1TBD, m.t1p1, m.t1p2)}</td>
    <td class="live-vs-cell"><span class="live-match-pill">#${m.num}</span><div class="live-vs-score">${scoreHTML}</div><div class="live-matchup">${matchupHTML}</div></td>
    <td class="live-team-cell right">${teamCellHTML(side2, t2TBD, m.t2p1, m.t2p2)}</td>
  </tr>`;
}

// ---- Match Finder (spec §5.8) -------------------------------------------------------------------------

/** Match Finder's entries: the teams (sheet order), then every player (A-Z), rostered or lined up. */
export function buildTeamIndex(model){
  const rowByCode = model.team.rowByCode;
  const teams = model.standings.filter(s => isGroupTeamCode(s.teamCode)).map(s => ({
    kind: 'team',
    base: s.teamCode,
    label: s.teamName || s.teamCode,
    labelLower: (s.teamName || s.teamCode).toLowerCase(),
    group: parseInt(s.bracket, 10) || null
  }));

  const byName = new Map();
  model.matches.forEach(m => {
    [[m.t1, m.t1p1, m.t1p2], [m.t2, m.t2p1, m.t2p2]].forEach(([code, p1, p2]) => {
      const side = sideOf(code);
      [p1, p2].forEach(name => {
        if(!name || name === 'TBD') return;
        const key = name.toLowerCase();
        if(!byName.has(key)) byName.set(key, { kind: 'player', name, nameLower: key, teams: [], matchNums: [] });
        const entry = byName.get(key);
        const teamName = teamNameOf(side, rowByCode);
        if(teamName && !entry.teams.includes(teamName)) entry.teams.push(teamName);
        if(!entry.matchNums.includes(m.num)) entry.matchNums.push(m.num);
      });
    });
  });
  // Roster players too, so a player is findable before any lineup names them.
  model.team.roster.forEach(r => {
    const key = r.player.toLowerCase();
    if(!byName.has(key)) byName.set(key, { kind: 'player', name: r.player, nameLower: key, teams: [], matchNums: [] });
    const entry = byName.get(key);
    if(!entry.rosterTeam){
      entry.rosterTeam = r.teamCode;
      entry.level = r.level;
      entry.gender = r.gender;
    }
    const teamName = teamNameOf(r.teamCode, rowByCode);
    if(teamName && !entry.teams.includes(teamName)) entry.teams.push(teamName);
  });
  const players = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  return [...teams, ...players];
}

/** A search is saved as "team:<letter>" or "player:<name>", never a playoff code (it changes mid-event). */
export function searchKeyFor(entry){
  return entry.kind === 'team' ? `team:${entry.base}` : `player:${entry.name}`;
}

export function entryForSearchKey(index, key){
  const m = /^(team|player):(.*)$/.exec(key);
  if(!m) return null;
  return index.find(e => m[1] === 'team'
    ? e.kind === 'team' && e.base === m[2]
    : e.kind === 'player' && e.nameLower === m[2].toLowerCase()) || null;
}

/** Up to 8 suggestions, teams first (in sheet order), then players (A-Z). */
export function autocompleteMatches(index, q){
  return [
    ...index.filter(e => e.kind === 'team' && e.labelLower.includes(q)),
    ...index.filter(e => e.kind === 'player' && e.nameLower.includes(q))
  ].slice(0, 8);
}

export function autocompleteHTML(matches, hooks = {}){
  return matches.map((e, i) => e.kind === 'team'
    ? `<div class="ac-item" data-i="${i}"><span>${escapeHtml(e.label)}${hooks.teamLetters === false ? '' : `<span class="chip">${escapeHtml(e.base)}</span>`}</span>${e.group ? `<small>Bracket ${e.group}</small>` : ''}</div>`
    : `<div class="ac-item" data-i="${i}"><span>${escapeHtml(e.name)}</span>${e.teams.length ? `<small>${escapeHtml(e.teams.join(', '))}</small>` : ''}</div>`
  ).join('');
}

/** The entry a typed search means: `{ entry }`, `{ ambiguous: [entries] }`, or neither. `selection` wins. */
export function resolveEntry(index, raw, selection){
  if(selection) return { entry: selection, ambiguous: null };
  const q = raw.trim().toLowerCase();
  if(!q) return { entry: null, ambiguous: null };
  const nameOf = e => e.kind === 'team' ? e.labelLower : e.nameLower;
  const exact = index.filter(e => nameOf(e) === q);
  if(exact.length === 1) return { entry: exact[0], ambiguous: null };
  if(exact.length > 1) return { entry: null, ambiguous: exact };
  const partial = index.filter(e => nameOf(e).includes(q));
  if(partial.length === 1) return { entry: partial[0], ambiguous: null };
  if(partial.length > 1) return { entry: null, ambiguous: partial };
  return { entry: null, ambiguous: null };
}

export function teamResultHTML(model, entry, expanded, hooks = {}){
  const letters = hooks.teamLetters !== false;
  const rowByCode = model.team.rowByCode;
  const base = entry.base;
  const list = model.team.matchups.filter(mu => baseTeamOf(mu.side1, rowByCode) === base || baseTeamOf(mu.side2, rowByCode) === base);
  const nextIdx = list.findIndex(mu => mu.result.state === 'not-started' && !mu.matches.some(m => m.liveCourt));
  const unset = list.some(mu => mu.matches.some(lineupUnset));
  return `
    <div class="results-head">
      <h2>${escapeHtml(entry.label)}${letters ? `<span class="chip">${escapeHtml(base)}</span>` : ''}</h2>
      ${entry.group ? `<span class="division-tag">Bracket ${entry.group}</span>` : ''}
    </div>
    <div class="results-meta">${list.length} matchup${list.length===1?'':'s'} found, in schedule order</div>
    ${model.team.rosterByCode.has(base) ? `<div style="margin:0 0 14px">${rosterCardHTML(model, base, { toggle: false, teamLetters: letters })}</div>` : ''}
    ${list.map((mu, i) => matchupCardHTML(model, mu, { focusBase: base, isNext: i === nextIdx, interactive: true }, expanded, hooks)).join('')}
    ${unset ? LINEUP_NOTE : ''}`;
}

export function playerResultHTML(model, entry, expanded, hooks = {}){
  const matches = entry.matchNums
    .map(n => model.matches.find(m => m.num === n))
    .filter(Boolean)
    .sort((a, b) => a.num - b.num);
  const cards = matches.map(m => {
    const mu = model.team.matchups.find(x => x.matchUp === m.matchUp);
    return mu ? matchupCardHTML(model, mu, { onlyMatch: m.num, interactive: true }, expanded, hooks) : '';
  }).join('');
  const teamNames = entry.teams.length ? entry.teams.join(', ') + ' · ' : '';
  const unset = model.matches.some(lineupUnset);
  const tagValues = [entry.level ? teamLevelLabel(entry.level) : '', entry.gender].filter(Boolean);
  const tags = tagValues.length
    ? `<span class="roster-tags">${tagValues.map(v => `<span class="roster-tag">${escapeHtml(v)}</span>`).join('')}</span>`
    : '';
  return `
    <div class="results-head">
      <span class="player-head"><h2>${escapeHtml(entry.name)}</h2>${tags}</span>
    </div>
    <div class="results-meta">${escapeHtml(teamNames)}${matches.length} match${matches.length===1?'':'es'}</div>
    ${entry.rosterTeam && model.team.rosterByCode.has(entry.rosterTeam) ? `<div style="margin:0 0 14px">${rosterCardHTML(model, entry.rosterTeam, { toggle: false, highlight: entry.nameLower, teamLetters: hooks.teamLetters !== false })}</div>` : ''}
    ${cards}
    ${unset ? LINEUP_NOTE : ''}`;
}

/** Before anyone searches, every matchup of the day, ordered by its lowest match number. */
export function allMatchupsHTML(model, hint, expanded, hooks){
  const list = model.team.matchups.slice().sort((a, b) => matchupFirstNum(a) - matchupFirstNum(b));
  if(!list.length) return '';
  return `<div class="results-meta">All ${list.length} matchups, by match number. ${hint}</div>
    ${list.map(mu => matchupCardHTML(model, mu, { interactive: true }, expanded, hooks)).join('')}`;
}

export function introHTML(model, index, hint, expanded, hooks = {}){
  const teams = index.filter(e => e.kind === 'team');
  const groups = new Map();
  teams.forEach(t => {
    const g = t.group === null ? 0 : t.group;
    if(!groups.has(g)) groups.set(g, []);
    groups.get(g).push(t);
  });
  const groupKeys = Array.from(groups.keys()).sort((a, b) => a - b);
  return `
    <div class="stats-row">
      <div class="stat"><b>${model.matches.length || '—'}</b><span>Matches</span></div>
      <div class="stat"><b>${model.team.matchups.length || '—'}</b><span>Matchups</span></div>
      <div class="stat"><b>${teams.length || '—'}</b><span>Teams</span></div>
    </div>
    ${teams.length ? `<div class="team-groups">${groupKeys.map(g => `
      <h3>${g === 0 ? 'Teams' : `Bracket ${g}`}</h3>
      <div class="team-chips">${groups.get(g).map(t => `<button type="button" class="team-chip-btn" data-team="${escapeHtml(t.base)}">${escapeHtml(t.label)}${hooks.teamLetters === false ? '' : `<span class="chip">${escapeHtml(t.base)}</span>`}</button>`).join('')}</div>`).join('')}
    </div>` : ''}
    ${allMatchupsHTML(model, hint, expanded, hooks)}`;
}

// ---- the component ----------------------------------------------------------------------------

/**
 * Wires a team event's views to the page.
 *
 * @param {object} options
 *   getModel()        the current DayModel (its `team` data)
 *   getFinder()       the page's Match Finder (views/finder.js); the team finder is its `delegate`
 *   input, acList, resultsEl           the finder's elements
 *   standingsEl       the Standings panel; rostersEl: the Teams panel body
 *   saveSearch(key)   the page's persistence of the last search
 *   renderStandings() the page's Standings render, called after a card or bracket is toggled
 *   decorateRow(m), expandAllClass, teamLetters, searchHint     see the top of the file
 *   onTabsChanged()   called after the Teams tab is shown or hidden
 * @returns the component: `delegate` (for createFinder), renderStandings, renderRosters, syncTab, reset,
 *   liveRow, matchupCard, matchupFor, entryForSearchKey, nameOf
 */
export function createTeams(options){
  const { getModel, getFinder, input, acList, resultsEl, standingsEl, rostersEl, saveSearch, onTabsChanged } = options;
  const hooks = { decorateRow: options.decorateRow, teamLetters: options.teamLetters !== false };
  const expanded = new Set();     // matchUp keys whose compact card shows its matches
  const openGroups = new Set();   // group numbers whose "Bracket matchups" section is open
  const rosterOpen = new Set();   // roster cards left open across the poll's re-render
  let index = [];                 // Match Finder entries: teams, then players

  const renderStandings = () => {
    const model = getModel();
    const scrollPositions = captureScrollPositions(standingsEl);
    if(model.standings.length === 0){
      standingsEl.innerHTML = `<div class="empty-state">No standings yet.</div>`;
      return;
    }
    standingsEl.innerHTML = teamStandingsHTML(model, { expanded, openGroups }, hooks);
    restoreScrollPositions(standingsEl, scrollPositions);
  };
  const renderRosters = () => {
    if(rostersEl) rostersEl.innerHTML = rostersHTML(getModel(), rosterOpen, { expandAllClass: options.expandAllClass, teamLetters: hooks.teamLetters });
  };

  // The Teams tab shows for a team event whose snapshot carries a roster.
  const syncTab = () => {
    const btn = document.querySelector('.view-tab[data-view="teams"]');
    if(!btn) return;
    const model = getModel();
    const on = model.event.type === 'team' && !!model.team && model.team.roster.length > 0;
    btn.hidden = !on;
    btn.style.display = on ? '' : 'none';
    if(onTabsChanged) onTabsChanged();
  };

  const reset = () => {
    rosterOpen.clear();
    index = [];
    expanded.clear();
    openGroups.clear();
  };

  // ---- the team event's Match Finder, as the finder's `delegate` ----
  const hint = options.searchHint || 'Search a team, a player or a match number above.';
  const delegate = {
    handles: model => model.event.type === 'team',
    rebuildIndex(){
      const finder = getFinder();
      index = buildTeamIndex(getModel());
      // The entry the reader picked was built from the previous load; point it at the fresh one so a
      // search keeps working as lineups and slots change.
      if(finder.selection){
        finder.selection = index.find(e => e.kind === finder.selection.kind &&
          (e.kind === 'team' ? e.base === finder.selection.base : e.nameLower === finder.selection.nameLower)) || null;
      }
      finder.refresh();
    },
    renderAutocomplete(query){
      const q = query.trim().toLowerCase();
      if(!q){ acList.classList.remove('show'); acList.innerHTML=''; return; }
      const matches = autocompleteMatches(index, q);
      if(matches.length === 0){ acList.classList.remove('show'); acList.innerHTML=''; return; }
      acList.innerHTML = autocompleteHTML(matches, hooks);
      acList.classList.add('show');
      getFinder().acIndex = -1;
    },
    selectAcItem(el){
      const finder = getFinder();
      const entry = autocompleteMatches(index, input.value.trim().toLowerCase())[parseInt(el.dataset.i, 10)]
        || (finder.selection && input.value === (finder.selection.label || finder.selection.name) ? finder.selection : null);
      if(!entry) return;
      input.value = entry.kind === 'team' ? entry.label : entry.name;
      finder.selection = entry;
      finder.updateClear();
    },
    run(){
      const finder = getFinder();
      const model = getModel();
      const raw = input.value.trim();
      if(!raw){
        finder.renderIntro();
        return;
      }

      const { entry, ambiguous } = resolveEntry(index, raw, finder.selection);

      if(ambiguous && ambiguous.length){
        resultsEl.innerHTML = `
      <div class="empty-state">
        Several teams or players match <strong>${escapeHtml(raw)}</strong> — pick one:<br><br>
        ${ambiguous.slice(0,8).map(e => `<strong>${escapeHtml(e.kind === 'team' ? e.label : e.name)}</strong>`).join('<br>')}
      </div>`;
        return;
      }

      if(!entry){
        const firstWord = raw.toLowerCase().split(' ')[0];
        const suggestions = index.filter(e => (e.kind === 'team' ? e.labelLower : e.nameLower).startsWith(firstWord)).slice(0, 6);
        resultsEl.innerHTML = `
      <div class="empty-state">
        No matches found for <strong>${escapeHtml(raw)}</strong>.<br>
        Double-check the spelling, or start typing a name to see suggestions.
        ${suggestions.length ? `<br><br>Did you mean: ${suggestions.map(s=>`<strong>${escapeHtml(s.kind === 'team' ? s.label : s.name)}</strong>`).join(', ')}?` : ''}
      </div>`;
        return;
      }

      finder.selection = entry;
      resultsEl.innerHTML = entry.kind === 'team' ? teamResultHTML(model, entry, expanded, hooks) : playerResultHTML(model, entry, expanded, hooks);
      saveSearch(searchKeyFor(entry));
    },
    renderIntro(){
      resultsEl.innerHTML = introHTML(getModel(), index, hint, expanded, hooks);
    },
    fresh: e => e ? (index.find(x => x.kind === e.kind &&
      (x.kind === 'team' ? x.base === e.base : x.nameLower === e.nameLower)) || null) : null,
  };

  // The Standings cards' "Show matches" toggles and the Bracket matchups sections keep their open state
  // here, so the full rebuild on every poll doesn't fold them shut; the Teams tab's roster cards too; and
  // a team chip on the Match Finder intro runs that team's search.
  if(standingsEl) standingsEl.addEventListener('click', (e) => {
    if(getModel().event.type !== 'team') return;
    const cardToggle = e.target.closest('[data-tm-toggle]');
    if(cardToggle){
      const key = cardToggle.dataset.tmToggle;
      if(expanded.has(key)) expanded.delete(key); else expanded.add(key);
      options.renderStandings();
      return;
    }
    const groupToggle = e.target.closest('[data-tm-group]');
    if(groupToggle){
      const g = parseInt(groupToggle.dataset.tmGroup, 10);
      if(openGroups.has(g)) openGroups.delete(g); else openGroups.add(g);
      options.renderStandings();
    }
  });
  if(rostersEl) rostersEl.addEventListener('click', (e) => {
    const all = e.target.closest('[data-roster-all]');
    if(all){
      if(all.dataset.rosterAll === 'open') getModel().team.rosterByCode.forEach((_, c) => rosterOpen.add(c));
      else rosterOpen.clear();
      renderRosters();
      return;
    }
    const btn = e.target.closest('[data-roster-team]');
    if(!btn) return;
    const code = btn.dataset.rosterTeam;
    if(rosterOpen.has(code)) rosterOpen.delete(code); else rosterOpen.add(code);
    renderRosters();
  });
  resultsEl.addEventListener('click', (e) => {
    if(getModel().event.type !== 'team') return;
    const btn = e.target.closest('.team-chip-btn');
    if(!btn) return;
    const entry = index.find(t => t.kind === 'team' && t.base === btn.dataset.team);
    if(!entry) return;
    const finder = getFinder();
    finder.selection = entry;
    input.value = entry.label;
    finder.updateClear();
    finder.run();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  return {
    delegate, renderStandings, renderRosters, syncTab, reset,
    liveRow: (court, m) => liveRowHTML(getModel(), court, m, hooks),
    matchupCard: (mu, opts) => matchupCardHTML(getModel(), mu, opts, expanded, hooks),
    matchupFor: m => getModel().team.matchups.find(x => x.matchUp === m.matchUp),
    entryForSearchKey: key => entryForSearchKey(index, key),
    nameOf: side => teamNameOf(side, getModel().team.rowByCode),
  };
}
