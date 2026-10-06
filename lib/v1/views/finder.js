// Match Finder: find a pair by name and see its matches in schedule order, or
// see every match of the day. The pure parts (the pair index, the results'
// markup) are functions of the DayModel; createFinder wires them to the page's
// search box.
//
// What differs between the public Hub and Control Center is added through
// extension points that do nothing by default (site-engine-spec §4.10):
//   options.ticket          passed to every ticket (decorate, teamLogoHTML: views/ticket.js)
//   options.searchHandlers  tried in order before the pair search: Control Center's search by match number
//   options.searchHint      the line under "All N matches" that says what else can be searched
//   options.delegate        a team event's own finder (views/teams.js), taking over every step

import { escapeHtml } from './html.js';
import { ticketHTML } from './ticket.js';
import { divisionLabel, parseCode } from '../domain/codes.js';
import { pairKey } from '../domain/matches.js';
import { matchByeSide, sideIsBye } from '../domain/byes.js';

export const DEFAULT_SEARCH_HINT = "Search a name above for one pair's.";

// ---- the pair index ---------------------------------------------------------------

/**
 * Every pair on the day's schedule, once, however its code changes as it
 * advances (pool code -> playoff code). Grouped by player names *within the
 * same category* (and club) so a pair that advances under a new bracket code
 * still shows up as a single entry, while same-named pairs in different
 * divisions/events never get merged together. A pair of TBD or a BYE is not a
 * pair.
 * @returns {Array<{ p1, p2, label, codes: string[], idx: number, p1Lower, p2Lower, labelLower }>}
 */
export function buildPairIndex(model){
  const type = model.event.type;
  const byPair = new Map();
  const addSide = (code, p1, p2) => {
    if(p1 === 'TBD' || sideIsBye(code, p1, p2)) return;
    const key = pairKey(code, p1, p2, type);
    if(!byPair.has(key)){
      byPair.set(key, { p1, p2, label: `${p1} / ${p2}`, codes: new Set() });
    }
    byPair.get(key).codes.add(code);
  };
  model.matches.forEach(m => {
    addSide(m.t1, m.t1p1, m.t1p2);
    addSide(m.t2, m.t2p1, m.t2p2);
  });
  return Array.from(byPair.values())
    .map(t => ({...t, codes: Array.from(t.codes)}))
    .sort((a,b) => a.label.localeCompare(b.label))
    // Search fields are looked up on every keystroke in the autocomplete
    // (and every submitted search), so compute them once here rather than
    // re-lowercasing every team's name on every render.
    .map((t, idx) => ({
      ...t, idx,
      p1Lower: t.p1.toLowerCase(),
      p2Lower: t.p2.toLowerCase(),
      labelLower: t.label.toLowerCase()
    }));
}

/** The pair a typed search means: `{ team }`, `{ ambiguous: [pairs] }`, or neither. `selected` wins. */
export function resolvePair(raw, allTeams, selected){
  if(selected) return { team: selected, ambiguous: null };
  const q = raw.trim().toLowerCase();
  if(!q) return { team: null, ambiguous: null };
  // exact match on full pair label or either player's name
  let exact = allTeams.filter(t => t.labelLower === q || t.p1Lower === q || t.p2Lower === q);
  if(exact.length === 1) return { team: exact[0], ambiguous: null };
  if(exact.length > 1) return { team: null, ambiguous: exact };
  // partial match on either player's name or the combined label
  let partial = allTeams.filter(t => t.p1Lower.includes(q) || t.p2Lower.includes(q) || t.labelLower.includes(q));
  if(partial.length === 1) return { team: partial[0], ambiguous: null };
  if(partial.length > 1) return { team: null, ambiguous: partial };
  return { team: null, ambiguous: null };
}

/** The autocomplete's suggestions for what has been typed, or '' for none. */
export function autocompleteHTML(query, allTeams, model){
  const q = query.trim().toLowerCase();
  if(!q) return '';
  const matches = allTeams.filter(t =>
    t.p1Lower.includes(q) || t.p2Lower.includes(q) || t.labelLower.includes(q)
  ).slice(0, 8);
  if(matches.length === 0) return '';
  return matches.map((t,i) => {
    const label = divisionLabel(t.codes[0], model.event.type, model.event.display || {});
    return `<div class="ac-item" data-idx="${t.idx}" data-i="${i}"><span>${escapeHtml(t.label)}</span>${label ? `<small>${label}</small>` : ''}</div>`;
  }).join('');
}

// ---- results ---------------------------------------------------------------------------

/**
 * Every match of the day by match number, with a line saying what else can be
 * searched. A BYE is never a real match, so it is left out.
 * @param {{ ticket?: object, searchHint?: string }} [options]
 */
export function allMatchesHTML(model, { ticket = {}, searchHint = DEFAULT_SEARCH_HINT } = {}){
  const all = model.matches.filter(m => matchByeSide(m) === null).sort((a, b) => a.num - b.num);
  if(!all.length) return '';
  return `<div class="results-meta">All ${all.length} matches, by match number. ${searchHint}</div>
    ${all.map(m => ticketHTML(m, model, { ...ticket })).join('')}`;
}

/** The first screen: the day's counts, then every match. */
export function introHTML(model, options = {}){
  const type = model.event.type;
  const teams = new Set();
  const divisions = new Set();
  // Playoff slots (NWD_SF_1, HIMD_QF_3…) sit in the match list as t1/t2 too;
  // only a code that ends in a bare number is an actual pair.
  model.matches.forEach(m => { [m.t1, m.t2].forEach(c => { const p = parseCode(c, type); if(/^\d+$/.test(p.rest)) teams.add(c); if(p.category) divisions.add(p.category); }); });
  return `
    <div class="stats-row">
      <div class="stat"><b>${model.matches.length || '—'}</b><span>Matches</span></div>
      <div class="stat"><b>${teams.size || '—'}</b><span>Teams</span></div>
      <div class="stat"><b>${divisions.size || '—'}</b><span>Divisions</span></div>
    </div>
    ${allMatchesHTML(model, options)}`;
}

/**
 * The results of searching `raw`, and the pair they are for (null when there is none to show).
 * @returns {{ html: string, team: object|null }}
 */
export function pairResultsHTML(raw, model, allTeams, selected, { ticket = {} } = {}){
  const { team, ambiguous } = resolvePair(raw, allTeams, selected);

  if(ambiguous && ambiguous.length){
    return { team: null, html: `
      <div class="empty-state">
        Several pairs match <strong>${escapeHtml(raw)}</strong> — pick one:<br><br>
        ${ambiguous.slice(0,8).map(t => `<strong>${escapeHtml(t.label)}</strong>`).join('<br>')}
      </div>` };
  }

  if(!team){
    // suggest close matches by player name
    const q = raw.toLowerCase();
    const firstWord = q.split(' ')[0];
    const suggestions = allTeams.filter(t =>
      t.p1Lower.startsWith(firstWord) || t.p2Lower.startsWith(firstWord)
    ).slice(0,6);
    return { team: null, html: `
      <div class="empty-state">
        No matches found for <strong>${escapeHtml(raw)}</strong>.<br>
        Double-check the spelling, or start typing a name to see suggestions.
        ${suggestions.length ? `<br><br>Did you mean: ${suggestions.map(s=>`<strong>${escapeHtml(s.label)}</strong>`).join(', ')}?` : ''}
      </div>` };
  }

  const codes = team.codes;
  // A bye is never a real match — exclude it so no "Next Up" ticket ever
  // points at one (awards-podium-tab-spec §2.6).
  const teamMatches = model.matches.filter(m => (codes.includes(m.t1) || codes.includes(m.t2)) && matchByeSide(m) === null)
                                   .sort((a,b) => a.num - b.num);
  // "Next" = the first match in schedule order that hasn't been played and
  // isn't currently live (a live one is already flagged by the Live pill), nor
  // a series game that will never be played.
  const nextIdx = teamMatches.findIndex(m => !m.played && !m.liveCourt && !model.unneededGames.has(m));

  // Use whichever code is relevant per match to build the ticket
  const label = divisionLabel(codes[0], model.event.type, model.event.display || {});
  return { team, html: `
    <div class="results-head">
      <h2>${escapeHtml(team.label)}</h2>
      ${label ? `<span class="division-tag">${label}</span>` : ''}
    </div>
    <div class="results-meta">${teamMatches.length} match${teamMatches.length>1?'es':''} found, in schedule order</div>
    ${teamMatches.map((m, i) => ticketHTML(m, model, { ...ticket, teamCode: codes.includes(m.t1) ? m.t1 : m.t2, isNext: i === nextIdx })).join('')}
  ` };
}

// ---- the component ------------------------------------------------------------------------

/**
 * Wires Match Finder to a search box, its suggestions and a results panel.
 *
 * @param {object} options
 *   input, acList, resultsEl   the elements
 *   clearBtn, searchBtn        optional: the × button, the Find button
 *   getModel()                 the current DayModel
 *   ticket                     passed to every ticket
 *   searchHandlers             [(raw, model, finder) => html | null]: tried before the pair search; the first
 *                              to answer sets the results
 *   searchHint                 what else can be searched
 *   delegate                   a team event's finder: { handles(model), rebuildIndex(finder), renderAutocomplete(query, finder),
 *                              selectAcItem(el, finder), run(finder), renderIntro(finder), fresh(selection) }
 *   saveSearch(raw), clearSavedSearch()   the page's persistence of the last search
 * @returns the finder: rebuildIndex, refresh, run, renderIntro, reset, setQuery, updateClear, and `selection` /
 *   `shown` / `shownQuery` / `acIndex` / `pairs` for a delegate to read and set
 */
export function createFinder(options){
  const {
    input, acList, resultsEl, clearBtn, searchBtn, getModel, ticket = {}, searchHandlers = [],
    searchHint = DEFAULT_SEARCH_HINT, delegate = null, saveSearch = () => {}, clearSavedSearch = () => {},
  } = options;
  let allTeams = [];
  let acIndex = -1;
  let selection = null;   // the chosen pair (or, for a delegate, entry)
  // What the results show: the last search actually run (Find, Enter, a pick
  // from the suggestions, a team chip, a restored search), not whatever is
  // half-typed in the box. A data refresh redraws that one, so the list doesn't
  // change under someone still typing.
  let shownQuery = '';
  let shown = null;
  const delegated = () => !!delegate && delegate.handles(getModel());

  const finder = {
    get selection(){ return selection; }, set selection(v){ selection = v; },
    get shown(){ return shown; }, set shown(v){ shown = v; },
    get shownQuery(){ return shownQuery; }, set shownQuery(v){ shownQuery = v; },
    get acIndex(){ return acIndex; }, set acIndex(v){ acIndex = v; },
    get pairs(){ return allTeams; },

    /** Rebuilt whenever the day's data refreshes; re-runs the current search or intro against it. */
    rebuildIndex(){
      if(delegated()){ delegate.rebuildIndex(finder); return; }
      allTeams = buildPairIndex(getModel());
      finder.refresh();
    },

    /** Redraw what the results show against fresh data, leaving the box as typed. */
    refresh(){
      if(!shownQuery){ finder.renderIntro(); return; }
      const typed = input.value, picked = selection;
      input.value = shownQuery;
      selection = delegated() ? delegate.fresh(shown) : shown;
      finder.run();
      input.value = typed; selection = picked;
    },

    renderIntro(){
      if(delegated()){ delegate.renderIntro(finder); return; }
      resultsEl.innerHTML = introHTML(getModel(), { ticket, searchHint });
    },

    run(){
      shownQuery = input.value.trim(); shown = selection;
      const raw = input.value.trim();
      for(const handler of searchHandlers){
        const html = handler(raw, getModel(), finder);
        if(html !== null && html !== undefined){ resultsEl.innerHTML = html; return; }
      }
      if(delegated()){ delegate.run(finder); return; }
      if(!raw){
        finder.renderIntro();
        return;
      }
      const result = pairResultsHTML(raw, getModel(), allTeams, selection, { ticket });
      resultsEl.innerHTML = result.html;
      if(!result.team) return;
      selection = result.team;
      saveSearch(raw);
    },

    updateClear(){
      if(clearBtn) clearBtn.classList.toggle('show', input.value.length > 0);
    },

    renderAutocomplete(query){
      if(delegated()){ delegate.renderAutocomplete(query, finder); return; }
      const html = autocompleteHTML(query, allTeams, getModel());
      acList.innerHTML = html;
      if(!html){ acList.classList.remove('show'); return; }
      acList.classList.add('show');
      acIndex = -1;
    },

    selectAcItem(el){
      if(delegated()){ delegate.selectAcItem(el, finder); return; }
      const team = allTeams[parseInt(el.dataset.idx, 10)];
      if(!team) return;
      input.value = team.label;
      selection = team;
      finder.updateClear();
    },

    /** A new day: nothing typed, nothing chosen, nothing shown. */
    reset(){
      selection = null;
      input.value = '';
      shownQuery = ''; shown = null;
      finder.updateClear();
    },

    /** Put `raw` in the box and search it (a restored search). */
    setQuery(raw){
      input.value = raw;
      finder.updateClear();
      finder.run();
    },
  };

  if(clearBtn){
    clearBtn.addEventListener('click', () => {
      input.value = '';
      selection = null;
      acList.classList.remove('show');
      acList.innerHTML = '';
      finder.updateClear();
      finder.run();
      clearSavedSearch();
      input.focus();
    });
  }

  input.addEventListener('input', () => { selection = null; finder.renderAutocomplete(input.value); finder.updateClear(); });
  input.addEventListener('focus', () => finder.renderAutocomplete(input.value));
  document.addEventListener('click', (e) => {
    if(!e.target.closest('.autocomplete')) acList.classList.remove('show');
  });
  acList.addEventListener('click', (e) => {
    const item = e.target.closest('.ac-item');
    if(!item) return;
    finder.selectAcItem(item);
    acList.classList.remove('show');
    finder.run();
  });
  input.addEventListener('keydown', (e) => {
    const items = Array.from(acList.querySelectorAll('.ac-item'));
    if(e.key === 'ArrowDown' && items.length){
      e.preventDefault();
      acIndex = Math.min(acIndex+1, items.length-1);
      items.forEach(it=>it.classList.remove('active'));
      items[acIndex].classList.add('active');
      finder.selectAcItem(items[acIndex]);
    } else if(e.key === 'ArrowUp' && items.length){
      e.preventDefault();
      acIndex = Math.max(acIndex-1, 0);
      items.forEach(it=>it.classList.remove('active'));
      items[acIndex].classList.add('active');
      finder.selectAcItem(items[acIndex]);
    } else if(e.key === 'Enter'){
      acList.classList.remove('show');
      finder.run();
    } else if(e.key === 'Escape'){
      acList.classList.remove('show');
    }
  });
  if(searchBtn) searchBtn.addEventListener('click', () => finder.run());

  return finder;
}
