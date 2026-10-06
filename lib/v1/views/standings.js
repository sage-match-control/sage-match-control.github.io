// Standings: a standard event's one card per category (Round Robin tables, then
// the playoff stages as head-to-head matchups), and a dual meet's per-club
// columns with the cross-club Bronze and Final underneath. The markup builders
// are functions of the DayModel; createStandings wires them to the page's panel,
// category toggle bar and category search.
//
// What differs between the public Hub and Control Center is added through
// extension points that do nothing by default (site-engine-spec §4.10):
//   options.dualMeetDesktopLayout  'grid' (default): one row per division, leftover categories in a side column;
//                                  'row': one row of columns that scrolls sideways (Control Center)
//   options.rrBracketLayout        'grid' (default): each Round Robin bracket is its own table in a grid;
//                                  'column': one table with a bracket badge column (the dual-meet Hub)
//   options.clubLogoHTML(code, name)  a club's logo in the win-totals bar
//   options.unresolved             a Set that collects the category codes the event's display settings cannot
//                                  label (Control Center shows a warning for them)

import { escapeHtml } from './html.js';
import { captureScrollPositions, restoreScrollPositions } from './scroll.js';
import { standingRowClass, pairCell } from './ticket.js';
import {
  STAGE_META, STAGE_ORDER, CROSS_CLUB_STAGE_KEYS, BADGE_CLASSES,
  parseCode, splitCategory, divisionEventLabel, clubLabel, buildCategoryOrderIndex, categorySortKey,
  standingsStageKey, matchInstanceOf,
} from '../domain/codes.js';
import { rankStandings, isEmptyStanding, fmtQ } from '../domain/standings.js';
import { isUnnamedScheduledPair } from '../domain/matches.js';
import { isByeStandingRow } from '../domain/byes.js';
import { categoryBronzeIsByeDecided } from '../domain/awards.js';

// Desktop standings need room both ways: 900px wide, and 600px tall so a big
// phone turned sideways (up to ~956px wide but under ~450px tall) keeps the
// mobile layout. The same query is in the stylesheet's @media rules; change
// one and change the other.
export const DESKTOP_STANDINGS_QUERY = '(min-width:900px) and (min-height:600px)';
export function isDesktopStandings(){
  return window.matchMedia(DESKTOP_STANDINGS_QUERY).matches;
}

// ---- playoff matchups -----------------------------------------------------------------------

/** Sensible stage order (STAGE_ORDER), unknown stage keys appended at the end. */
export function sortStageKeys(keys){
  return keys.sort((a,b) => {
    const ia = STAGE_ORDER.indexOf(a), ib = STAGE_ORDER.indexOf(b);
    if(ia === -1 && ib === -1) return a.localeCompare(b);
    if(ia === -1) return 1;
    if(ib === -1) return -1;
    return ia - ib;
  });
}

/**
 * Groups a playoff stage's rows into head-to-head matchups so it's obvious
 * who's facing whom, instead of a flat list of teams. Uses the match-instance
 * number encoded in the code itself when every row has one, else the same
 * "bracket" column RR pools use (as a per-match slot id) when every row in the
 * stage has one set; otherwise falls back to pairing rows in the order they
 * arrived (a spreadsheet naturally lists a match's two sides together).
 */
export function pairUpMatchups(rows){
  const allHaveMatchInstance = rows.length > 0 && rows.every(s => matchInstanceOf(s.teamCode) !== null);
  if(allHaveMatchInstance){
    const groups = new Map();
    rows.forEach(s => {
      const key = matchInstanceOf(s.teamCode);
      if(!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    });
    return Array.from(groups.keys()).sort((a, b) => a - b).map(k => groups.get(k));
  }

  const allBracketed = rows.length > 0 && rows.every(s => (s.bracket || '').trim() !== '');
  if(allBracketed){
    const groups = new Map();
    rows.forEach(s => {
      const key = s.bracket.trim();
      if(!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    });
    return Array.from(groups.values());
  }
  const pairs = [];
  for(let i = 0; i < rows.length; i += 2){
    pairs.push(rows.slice(i, i + 2));
  }
  return pairs;
}

/**
 * The actual match score for a playoff slot, found by cross-referencing its
 * teamCode against the schedule, rather than the aggregate W-L/quotient stat,
 * which is only meaningful for Round Robin. null until the match is played.
 */
export function scoreForTeamCode(teamCode, model){
  const m = model.matchByCode.get(teamCode);
  if(!m || !m.played) return null;
  return m.t1 === teamCode ? m.t1Score : m.t2Score;
}

export function matchupSideHTML(s, side){
  const sideClass = side === 'right' ? ' right' : '';
  if(!s || isEmptyStanding(s)){
    return `<div class="matchup-side${sideClass}"><span class="mu-pair tbd">TBD</span></div>`;
  }
  return `<div class="matchup-side${sideClass} ${standingRowClass(s)}">
    <span class="mu-pair" title="${escapeHtml(s.player1 + ' / ' + s.player2)}"><span class="p">${escapeHtml(s.player1)}</span><span class="p">${escapeHtml(s.player2)}</span></span>
  </div>`;
}

export function matchupScoreHTML(s, model){
  if(!s || isEmptyStanding(s)) return `<span class="mu-score">&ndash;</span>`;
  const score = scoreForTeamCode(s.teamCode, model);
  const scoreLabel = score !== null ? escapeHtml(String(score)) : '&ndash;';
  return `<span class="mu-score ${standingRowClass(s)}">${scoreLabel}</span>`;
}

/**
 * A "Match N" label for a twice-to-beat matchup card from either side's team
 * code (they share the same instance number by construction). Falls back to
 * whichever side actually has a code, since a not-yet-seeded TBD slot still
 * carries its bracket-slot code even with no players decided.
 */
export function matchupInstanceLabel(pair){
  const withCode = pair.find(s => s && s.teamCode);
  if(!withCode) return '';
  const instance = matchInstanceOf(withCode.teamCode);
  return instance ? `Match ${instance}` : '';
}

/** One matchup card; a series game after the decider is greyed out ("Not needed"). */
export function matchupHTML(pair, model){
  const label = matchupInstanceLabel(pair);
  const game = pair[0] ? model.matchByCode.get(pair[0].teamCode) : null;
  const notNeeded = !!game && model.unneededGames.has(game);
  return `<div class="matchup${notNeeded ? ' not-needed' : ''}"${notNeeded ? ' title="Not needed"' : ''}>
    ${label ? `<div class="matchup-label">${escapeHtml(label)}</div>` : ''}
    <div class="matchup-row">
      ${matchupSideHTML(pair[0], 'left')}
      <div class="matchup-center">
        ${matchupScoreHTML(pair[0], model)}
        <span class="matchup-vs">VS</span>
        ${matchupScoreHTML(pair[1], model)}
      </div>
      ${matchupSideHTML(pair[1], 'right')}
    </div>
  </div>`;
}

/** One playoff stage's block: a banner or caption, then its matchup cards. */
export function stageBlockHTML(key, rows, model){
  const meta = STAGE_META[key] || { label: key.charAt(0) + key.slice(1).toLowerCase(), banner:false };
  let html = `<div class="stage-block">`;
  html += meta.banner
    ? `<div class="stage-banner"><span class="stage-title">${escapeHtml(meta.label)}</span></div>`
    : `<div class="stage-caption">${escapeHtml(meta.label)}</div>`;
  pairUpMatchups(rows).forEach(pair => { html += matchupHTML(pair, model); });
  html += `</div>`;
  return html;
}

// ---- a category's stages ----------------------------------------------------------------------

/**
 * A category's Round Robin tables and playoff stages. The playoff stage comes
 * from the teamCode (SF/QF/F/B pattern); the bracket column only sub-groups
 * Round Robin rows (e.g. "A"/"B" or "1"/"2"). A blank bracket means every RR
 * row for this division is one group, with no bracket shown at all. Unused RR
 * slots are skipped, but playoff slots are always shown (as TBD if empty) so
 * the bracket stages are visible before pairs have been seeded in. A BYE is
 * never a real standings row, and a Bronze decided by a bye has no contest to
 * report, so its whole block goes (the medalist still shows in the Round Robin).
 * @returns {{ html: string, hasMultiBracket: boolean }}
 */
export function stageTablesHTML(rows, model, { rrBracketLayout = 'grid' } = {}){
  const type = model.event.type;
  rows = rows.filter(s => !isByeStandingRow(s));

  const stages = new Map(); // stageKey -> array of rows
  const rrGroups = new Map(); // bracket label -> rows
  rows.forEach(s => {
    const stageKey = standingsStageKey(s.teamCode, type);
    if(stageKey === 'RR'){
      if(isEmptyStanding(s) && !isUnnamedScheduledPair(s, model.matchByCode, type)) return;
      const brLabel = (s.bracket || '').trim();
      if(!rrGroups.has(brLabel)) rrGroups.set(brLabel, []);
      rrGroups.get(brLabel).push(s);
    } else {
      if(!stages.has(stageKey)) stages.set(stageKey, []);
      stages.get(stageKey).push(s);
    }
  });
  // Order each bracket group by wins, head-to-head, then quotient
  rrGroups.forEach((group, brLabel) => rrGroups.set(brLabel, rankStandings(group, model.matches)));

  if(stages.has('BRONZE') && rows.length){
    const category = parseCode(rows[0].teamCode, type).category;
    if(categoryBronzeIsByeDecided(model, category)) stages.delete('BRONZE');
  }

  if(rrGroups.size === 0 && stages.size === 0) return { html: '', hasMultiBracket: false };

  let html = '';
  let hasMultiBracket = false;

  if(rrGroups.size > 0){
    const bracketLabels = Array.from(rrGroups.keys()).sort((a,b) => a.localeCompare(b, undefined, {numeric:true}));
    const hasBrackets = bracketLabels.some(k => k !== '');
    hasMultiBracket = rrBracketLayout === 'grid' && hasBrackets && bracketLabels.length >= 2;
    let badgeIdx = 0;
    const badgeMap = new Map();
    bracketLabels.forEach(brLabel => {
      if(brLabel !== '' && !badgeMap.has(brLabel)){ badgeMap.set(brLabel, BADGE_CLASSES[badgeIdx % BADGE_CLASSES.length]); badgeIdx++; }
    });
    if(rrBracketLayout === 'column'){
      // One table, a Br column naming each row's bracket.
      html += `<div class="stage-block"><div class="stage-caption">Round Robin</div>
      <div class="br-table-wrap"><table class="br-table"><thead><tr>
        ${hasBrackets ? '<th class="br-badge">Br</th>' : ''}<th>Pair</th><th class="num">W</th><th class="num">L</th><th class="quo">Q</th>
      </tr></thead><tbody>`;
      bracketLabels.forEach(brNum => {
        const badgeClass = badgeMap.get(brNum);
        rrGroups.get(brNum).forEach(s => {
          html += `<tr class="${standingRowClass(s)}">
          ${hasBrackets ? `<td class="br-badge ${badgeClass || ''}">${escapeHtml(brNum)}</td>` : ''}
          ${pairCell(s, model)}
          <td class="num">${s.wins}</td>
          <td class="num">${s.loss}</td>
          <td class="quo">${fmtQ(s.quotient)}</td>
        </tr>`;
        });
      });
      html += `</tbody></table></div></div>`;
    } else {
      const rrTable = tableRows => `<div class="br-table-wrap"><table class="br-table"><thead><tr>
        <th>Pair</th><th class="num">W</th><th class="num">L</th><th class="quo">Q</th>
      </tr></thead><tbody>${tableRows.map(s => `<tr class="${standingRowClass(s)}">
          ${pairCell(s, model)}
          <td class="num">${s.wins}</td>
          <td class="num">${s.loss}</td>
          <td class="quo">${fmtQ(s.quotient)}</td>
        </tr>`).join('')}</tbody></table></div>`;
      // Multiple sub-brackets (e.g. "1"/"2") each get their own mini table laid out in a grid, so a
      // big division reads as parallel pools instead of one long flat table with a Br column.
      html += `<div class="stage-block"><div class="stage-caption">Round Robin</div>`;
      if(hasBrackets){
        html += `<div class="rr-bracket-grid">`;
        bracketLabels.forEach(brLabel => {
          const badgeClass = brLabel === '' ? 'badge-x' : badgeMap.get(brLabel);
          html += `<div class="rr-bracket">
          <div class="rr-bracket-label ${badgeClass}">Bracket ${brLabel ? escapeHtml(brLabel) : '—'}</div>
          ${rrTable(rrGroups.get(brLabel))}
        </div>`;
        });
        html += `</div>`;
      } else {
        html += rrTable(rrGroups.get(''));
      }
      html += `</div>`;
    }
  }

  // Playoff-style stages, in a sensible order, unknown stages appended at the end
  sortStageKeys(Array.from(stages.keys())).forEach(key => {
    html += stageBlockHTML(key, stages.get(key), model);
  });

  return { html, hasMultiBracket };
}

/** A standard event's category: its title (with a column toggle when it has several brackets) and its stages. */
export function categoryCardHTML(cat, rows, model, { stacked: stackedSet = new Set(), rrBracketLayout } = {}){
  const { html: stageHtml, hasMultiBracket } = stageTablesHTML(rows, model, { rrBracketLayout });
  if(!stageHtml) return '';
  const stacked = hasMultiBracket && stackedSet.has(cat);
  const colClass = !hasMultiBracket ? '' : stacked ? ' standings-col--stacked' : ' standings-col--wide';
  const toggleHTML = hasMultiBracket
    ? `<button type="button" class="bracket-cols-toggle" data-cat="${escapeHtml(cat)}" aria-pressed="${stacked}" title="${stacked ? 'Show brackets side by side' : 'Stack brackets in one column'}">${stacked ? '2 cols' : '1 col'}</button>`
    : '';
  return `<div class="standings-col${colClass}" data-cat-key="${escapeHtml(cat)}">
    <div class="standings-col-head${hasMultiBracket ? ' has-toggle' : ''}">
      <span class="cat-title">${escapeHtml(cat)}</span>
      ${toggleHTML}
    </div>
    <div class="standings-col-body">${stageHtml}</div>
  </div>`;
}

// ---- a dual meet's columns --------------------------------------------------------------------------

/** One club's bracket within a shared category column: the stage tables under a small club heading. */
export function clubSubsectionHTML(clubCode, rows, model, options = {}){
  const stageHtml = stageTablesHTML(rows, model, options).html;
  if(!stageHtml) return '';
  return `<div class="club-subsection">
    <div class="club-subhead">${escapeHtml(clubLabel(clubCode, model.event.display || {}))}</div>
    ${stageHtml}
  </div>`;
}

/**
 * Bronze/Final rows (CROSS_CLUB_STAGE_KEYS) combined across both clubs and
 * rendered as one shared block, spanning the full category column instead of
 * sitting inside either club's own subsection. Combining them before
 * pairUpMatchups is what makes each matchup pair one club's row against the
 * other's.
 */
export function sharedStagesHTML(rows, model){
  const type = model.event.type;
  rows = rows.filter(s => !isByeStandingRow(s));
  const stages = new Map();
  rows.forEach(s => {
    const stageKey = standingsStageKey(s.teamCode, type);
    if(!stages.has(stageKey)) stages.set(stageKey, []);
    stages.get(stageKey).push(s);
  });
  if(stages.has('BRONZE') && rows.length){
    const category = parseCode(rows[0].teamCode, type).category;
    if(categoryBronzeIsByeDecided(model, category)) stages.delete('BRONZE');
  }
  if(stages.size === 0) return '';
  let html = `<div class="shared-stages">`;
  sortStageKeys(Array.from(stages.keys())).forEach(key => {
    html += stageBlockHTML(key, stages.get(key), model);
  });
  html += `</div>`;
  return html;
}

/**
 * One column per division+event category, with each club's Round Robin/R16/QF/SF bracket stacked (or
 * side by side at the desktop breakpoint) inside it. Bronze/Final are cross-club, so they are pulled
 * out and rendered once, spanning both clubs below. `styleAttr` places the column in the desktop grid.
 */
export function categoryColumnHTML(cat, rows, clubOrder, styleAttr, model, options = {}){
  const type = model.event.type;
  const perClubRows = [];
  const sharedRows = [];
  rows.forEach(s => {
    (CROSS_CLUB_STAGE_KEYS.includes(standingsStageKey(s.teamCode, type)) ? sharedRows : perClubRows).push(s);
  });

  const byClub = new Map();
  perClubRows.forEach(s => {
    const clubCode = parseCode(s.teamCode, type).club || 'OTHER';
    if(!byClub.has(clubCode)) byClub.set(clubCode, []);
    byClub.get(clubCode).push(s);
  });
  let inner = '';
  clubOrder.filter(c => byClub.has(c)).forEach(clubCode => {
    inner += clubSubsectionHTML(clubCode, byClub.get(clubCode), model, options);
  });
  const sharedHtml = sharedStagesHTML(sharedRows, model);
  if(!inner && !sharedHtml) return '';
  return `<div class="standings-col" data-cat-key="${escapeHtml(cat)}"${styleAttr ? ` style="${styleAttr}"` : ''}>
    <div class="standings-col-head">
      <span class="cat-title">${escapeHtml(cat)}</span>
    </div>
    <div class="standings-col-body">
      ${inner ? `<div class="category-clubs-row" data-cat-key="${escapeHtml(cat)}">${inner}</div>` : ''}
      ${sharedHtml}
    </div>
  </div>`;
}

/**
 * The club win-totals bar: wins summed over Round Robin rows only, per club,
 * with whichever club is ahead highlighted. Only shown once more than one club
 * is present in the data.
 */
export function clubSummaryHTML(byClub, clubOrder, model, { clubLogoHTML } = {}){
  const type = model.event.type, display = model.event.display || {};
  const clubWins = clubOrder.map(clubCode => ({
    code: clubCode,
    name: clubLabel(clubCode, display),
    wins: byClub.get(clubCode)
      .filter(s => standingsStageKey(s.teamCode, type) === 'RR')
      .reduce((sum, s) => sum + (s.wins || 0), 0)
  }));
  if(clubWins.length <= 1) return '';
  const topWins = Math.max(...clubWins.map(c => c.wins));
  let html = `<div class="club-summary">`;
  clubWins.forEach((c, i) => {
    if(i > 0) html += `<div class="club-summary-vs">VS</div>`;
    const isLeader = c.wins === topWins && topWins > 0;
    const identityHTML = `<div class="cs-identity">
        ${clubLogoHTML ? clubLogoHTML(c.code, c.name) : ''}
        <span class="cs-name">${escapeHtml(c.name)}</span>
      </div>`;
    const statHTML = `<div class="cs-stat">
        <span class="cs-wins">${c.wins}</span>
        <span class="cs-label">wins</span>
      </div>`;
    // Mirror the last item's internal order (stat then identity) so every logo lands on the bar's
    // outer edge and every wins stat on the inner side, next to VS.
    const isLast = i === clubWins.length - 1;
    html += `<div class="club-summary-item${isLeader ? ' leader' : ''}">${isLast ? statHTML + identityHTML : identityHTML + statHTML}</div>`;
  });
  html += `</div>`;
  return html;
}

/** The standings grouped by category label, with the labels in display order. */
export function groupByCategory(model, { unresolved } = {}){
  const type = model.event.type, display = model.event.display || {};
  const categories = new Map();
  model.standings.forEach(s => {
    const cat = divisionEventLabel(s.teamCode, type, display, unresolved);
    if(!categories.has(cat)) categories.set(cat, []);
    categories.get(cat).push(s);
  });
  const orderIndex = buildCategoryOrderIndex(Array.from(new Set(model.standings.map(s => parseCode(s.teamCode, type).category))), display);
  const sortedCats = Array.from(categories.keys())
    .sort((a, b) => categorySortKey(categories.get(a)[0], orderIndex, type) - categorySortKey(categories.get(b)[0], orderIndex, type));
  return { categories, sortedCats };
}

/** A dual meet's whole standings: the club bar, then a column per category. */
export function dualMeetStandingsHTML(model, options = {}){
  const { dualMeetDesktopLayout = 'grid', unresolved } = options;
  const type = model.event.type, display = model.event.display || {};
  // Group by club first: needed for the club order, the win-totals bar and each category's per-club split.
  const byClub = new Map();
  model.standings.forEach(s => {
    const clubCode = parseCode(s.teamCode, type).club || 'OTHER';
    if(!byClub.has(clubCode)) byClub.set(clubCode, []);
    byClub.get(clubCode).push(s);
  });
  const knownClubOrder = display.clubs ? Object.keys(display.clubs) : [];
  const clubOrder = knownClubOrder.filter(c => byClub.has(c))
    .concat(Array.from(byClub.keys()).filter(c => !knownClubOrder.includes(c)));

  let html = clubSummaryHTML(byClub, clubOrder, model, options);

  const { categories, sortedCats } = groupByCategory(model, { unresolved });

  if(isDesktopStandings()){
    html += `<div class="standings-board standings-board-desktop">`;
    if(dualMeetDesktopLayout === 'row'){
      // One column per category, each club's bracket stacked inside, in a single row (division then
      // event order reads left to right) that scrolls horizontally past the viewport.
      sortedCats.forEach(cat => { html += categoryColumnHTML(cat, categories.get(cat), clubOrder, '', model, options); });
    } else {
      // One column per division+event category, laid out 3-per-row (see the .standings-board-desktop
      // media query for why this naturally groups by division), except a division with fewer
      // categories than the event configures (e.g. Advanced having only Men's Doubles) doesn't get a
      // half-empty row of its own: it is set aside into a 4th column, spanning (and vertically
      // centred within) the full height of the rows beside it.
      const runs = [];
      sortedCats.forEach(cat => {
        const split = splitCategory(parseCode(categories.get(cat)[0].teamCode, type).category, display);
        const division = split ? split.divCode : null;
        const lastRun = runs[runs.length - 1];
        if(lastRun && lastRun.division === division) lastRun.cats.push(cat);
        else runs.push({ division, cats: [cat] });
      });
      const fullEventCount = Object.keys(display.events || {}).length;
      const mainRuns = runs.filter(r => r.cats.length >= fullEventCount);
      const overflowCats = runs.filter(r => r.cats.length < fullEventCount).flatMap(r => r.cats);
      mainRuns.forEach((run, rowIdx) => {
        run.cats.forEach((cat, colIdx) => {
          html += categoryColumnHTML(cat, categories.get(cat), clubOrder, `grid-column:${colIdx + 1};grid-row:${rowIdx + 1};`, model, options);
        });
      });
      if(overflowCats.length > 0){
        let overflowHtml = '';
        overflowCats.forEach(cat => { overflowHtml += categoryColumnHTML(cat, categories.get(cat), clubOrder, '', model, options); });
        html += `<div class="standings-col-overflow" style="grid-row:1 / ${mainRuns.length + 1};">${overflowHtml}</div>`;
      }
    }
    html += `</div>`;
  } else {
    // Mobile/tablet: the same per-category card as desktop, as a single full-width column.
    html += `<div class="standings-board">`;
    sortedCats.forEach(cat => { html += categoryColumnHTML(cat, categories.get(cat), clubOrder, '', model, options); });
    html += `</div>`;
  }
  return html;
}

// ---- a standard event's category controls ------------------------------------------------------

/** The desktop row of toggle chips (one per category) with "Show all" / "Hide all". */
export function categoryToggleBarHTML(categoryOptions, hidden){
  if(categoryOptions.length === 0) return '';
  const chips = categoryOptions.map(cat => {
    const isHidden = hidden.has(cat);
    return `<button type="button" class="cat-toggle-chip${isHidden ? ' hidden-cat' : ' active'}" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`;
  }).join('');
  return `<span class="cat-toggle-label">Categories</span>${chips}<button type="button" class="cat-toggle-action" data-action="all">Show all</button><button type="button" class="cat-toggle-action" data-action="none">Hide all</button>`;
}

/** The mobile category search's suggestions (at most 20), or '' for none. */
export function categoryAutocompleteHTML(query, categoryOptions){
  const q = query.trim().toLowerCase();
  const matches = (q ? categoryOptions.filter(c => c.toLowerCase().includes(q)) : categoryOptions).slice(0, 20);
  if(matches.length === 0) return '';
  return matches.map((c,i) => `<div class="ac-item" data-cat="${escapeHtml(c)}" data-i="${i}"><span>${escapeHtml(c)}</span></div>`).join('');
}

// ---- the component ---------------------------------------------------------------------------------

/**
 * Wires Standings to a panel: draws it for the DayModel (a standard event's category cards with the
 * toggle bar and the phone category search, or a dual meet's columns) and keeps the choices the
 * reader makes (hidden categories, stacked brackets, the chosen category). A team event is the
 * page's own (views/teams.js), so the page does not call render() for it.
 *
 * @param {object} options
 *   bodyEl                          the panel the standings are drawn into
 *   panelEl                         the section holding it: a resize only redraws a panel that is showing
 *   toggleBarEl, catInput, catAcList, clearCatBtn   optional: the standard event's category controls
 *   getModel()                      the current DayModel
 *   dualMeetDesktopLayout, rrBracketLayout, clubLogoHTML, unresolved   extension points (see the top of the file)
 * @returns {{ render(), renderBody(), reset(), selectCategory(cat), updateClear() }}
 */
export function createStandings(options){
  const { bodyEl, panelEl, toggleBarEl, catInput, catAcList, clearCatBtn, getModel } = options;
  const state = { selected: null, categoryOptions: [], categoriesMap: new Map(), hidden: new Set(), stacked: new Set() };
  let acIndex = -1;

  const cardOptions = () => ({ stacked: state.stacked, rrBracketLayout: options.rrBracketLayout });

  function updateClear(){
    if(clearCatBtn) clearCatBtn.classList.toggle('show', !!(catInput && catInput.value.length > 0));
  }

  function renderToggleBar(){
    if(toggleBarEl) toggleBarEl.innerHTML = categoryToggleBarHTML(state.categoryOptions, state.hidden);
  }

  // The standard event's body: a column per visible category on desktop, the chosen category on a phone.
  function renderBody(){
    if(!bodyEl) return;
    const model = getModel();

    if(state.categoryOptions.length === 0){
      bodyEl.innerHTML = `<div class="empty-state">No standings data yet.</div>`;
      return;
    }

    let html;
    if(isDesktopStandings()){
      const visibleCats = state.categoryOptions.filter(cat => !state.hidden.has(cat));
      if(visibleCats.length === 0){
        html = `<div class="empty-state">All categories are hidden. Use the toggles above to show one.</div>`;
      } else {
        html = `<div class="standings-board standings-board-desktop">`;
        visibleCats.forEach(cat => { html += categoryCardHTML(cat, state.categoriesMap.get(cat), model, cardOptions()); });
        html += `</div>`;
      }
    } else if(state.selected){
      html = `<div class="standings-cards">${categoryCardHTML(state.selected, state.categoriesMap.get(state.selected), model, cardOptions())}</div>`;
    } else {
      html = `<div class="empty-state">Search and select a category above to view its standings.</div>`;
    }

    bodyEl.innerHTML = html;
  }

  function render(){
    if(!bodyEl) return;
    const model = getModel();
    const scrollPositions = captureScrollPositions(bodyEl);
    const standard = model.event.type === 'standard';

    if(model.standings.length === 0){
      if(standard){ state.categoryOptions = []; state.categoriesMap = new Map(); renderToggleBar(); }
      bodyEl.innerHTML = `<div class="empty-state">No standings data yet.</div>`;
      return;
    }

    if(standard){
      const { categories, sortedCats } = groupByCategory(model, { unresolved: options.unresolved });
      state.categoriesMap = categories;
      state.categoryOptions = sortedCats;
      renderToggleBar();

      // If a previously-selected phone category vanished from a data refresh, clear the selection
      // instead of holding onto stale data.
      if(state.selected && !categories.has(state.selected)){
        state.selected = null;
        if(catInput) catInput.value = '';
        updateClear();
      }
      renderBody();
    } else {
      bodyEl.innerHTML = dualMeetStandingsHTML(model, options);
    }
    restoreScrollPositions(bodyEl, scrollPositions);
  }

  function selectCategory(cat){
    if(!state.categoriesMap.has(cat)) return;
    state.selected = cat;
    if(catInput) catInput.value = cat;
    updateClear();
    renderBody();
  }

  /** A new day: nothing chosen yet. */
  function reset(){
    state.selected = null;
    state.hidden = new Set();
    if(catInput) catInput.value = '';
    updateClear();
  }

  function renderAutocomplete(query){
    if(!catAcList) return;
    const html = categoryAutocompleteHTML(query, state.categoryOptions);
    if(!html){ catAcList.classList.remove('show'); catAcList.innerHTML = ''; return; }
    catAcList.innerHTML = html;
    catAcList.classList.add('show');
    acIndex = -1;
  }

  // The toggle bar: a chip hides or shows its category; "Show all" / "Hide all".
  if(toggleBarEl){
    toggleBarEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.cat-toggle-chip');
      const standard = () => getModel().event.type === 'standard';
      if(chip){
        const cat = chip.dataset.cat;
        if(state.hidden.has(cat)) state.hidden.delete(cat);
        else state.hidden.add(cat);
        renderToggleBar();
        if(standard()) renderBody();
        return;
      }
      const actionBtn = e.target.closest('.cat-toggle-action');
      if(actionBtn){
        if(actionBtn.dataset.action === 'all') state.hidden.clear();
        else if(actionBtn.dataset.action === 'none') state.hidden = new Set(state.categoryOptions);
        renderToggleBar();
        if(standard()) renderBody();
      }
    });
  }

  // A category with several brackets: switch between side by side and one column.
  if(bodyEl){
    bodyEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.bracket-cols-toggle');
      if(!btn) return;
      const cat = btn.dataset.cat;
      if(state.stacked.has(cat)) state.stacked.delete(cat);
      else state.stacked.add(cat);
      render();
    });
  }

  // The phone category search.
  if(clearCatBtn){
    clearCatBtn.addEventListener('click', () => {
      catInput.value = '';
      state.selected = null;
      catAcList.classList.remove('show');
      catAcList.innerHTML = '';
      updateClear();
      renderBody();
      catInput.focus();
    });
  }
  if(catInput){
    catInput.addEventListener('input', () => { renderAutocomplete(catInput.value); updateClear(); });
    catInput.addEventListener('focus', () => renderAutocomplete(catInput.value));
    document.addEventListener('click', (e) => {
      if(!e.target.closest('#categoryFilterWrap')) catAcList.classList.remove('show');
    });
    catAcList.addEventListener('click', (e) => {
      const item = e.target.closest('.ac-item');
      if(!item) return;
      selectCategory(item.dataset.cat);
      catAcList.classList.remove('show');
    });
    catInput.addEventListener('keydown', (e) => {
      const items = Array.from(catAcList.querySelectorAll('.ac-item'));
      if(e.key === 'ArrowDown' && items.length){
        e.preventDefault();
        acIndex = Math.min(acIndex+1, items.length-1);
        items.forEach(it=>it.classList.remove('active'));
        items[acIndex].classList.add('active');
      } else if(e.key === 'ArrowUp' && items.length){
        e.preventDefault();
        acIndex = Math.max(acIndex-1, 0);
        items.forEach(it=>it.classList.remove('active'));
        items[acIndex].classList.add('active');
      } else if(e.key === 'Enter'){
        e.preventDefault();
        const active = catAcList.querySelector('.ac-item.active') || catAcList.querySelector('.ac-item');
        if(active) selectCategory(active.dataset.cat);
        catAcList.classList.remove('show');
      } else if(e.key === 'Escape'){
        catAcList.classList.remove('show');
      }
    });
  }

  // Redraw when the viewport crosses the desktop/phone breakpoint (resizing, rotating a tablet).
  let lastIsDesktop = isDesktopStandings();
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const nowDesktop = isDesktopStandings();
      if(nowDesktop !== lastIsDesktop){
        lastIsDesktop = nowDesktop;
        if(panelEl && panelEl.style.display !== 'none') render();
      }
    }, 200);
  });

  return { render, renderBody, reset, selectCategory, updateClear };
}
