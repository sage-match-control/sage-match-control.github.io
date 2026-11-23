// The Tournament Hub: the public page for one event. Reads the event's days, facilities and labels from
// event-data/config/events.json (data/registry.js), loads a day's snapshot (pushed over the live channel,
// polled as the fallback), and draws Match Finder, Live Matches and Standings into the page's markup. A
// team event (type "team") gets its own views from views/teams.js, and a fourth tab, Teams (the rosters).
//
// The page is a shell (site-engine-spec §4.5): its markup, its theme and one call to mountHub.
//
//   mountHub({ eventKey, liveBaseUrl, clubLogos })
//     eventKey     required. The event's key in events.json, its folder in event-data and under events/, and
//                  the namespace of what the page remembers in the browser
//     liveBaseUrl  the live Worker's wss:// address; '' turns push off for this page, as a finished event's
//                  pages do (_templates/CLAUDE.md §7)
//     clubLogos    a dual meet's { '<CLUB>': '<logo path>' }

import { fixtureName } from '../platform.js';
import { loadRegistry, eventConfigFrom } from '../data/registry.js';
import { createLiveChannel } from '../data/live-channel.js';
import { createPoller } from '../data/snapshot.js';
import * as Snapshot from '../data/snapshot.js';
import { buildDayModel } from '../domain/model.js';
import { initialDayIndex, manilaIsoDate } from '../domain/initial-day.js';
import { parseCode, splitCategory } from '../domain/codes.js';
import { escapeHtml } from '../views/html.js';
import * as Ticket from '../views/ticket.js';
import { createFinder } from '../views/finder.js';
import { clubBarHTML } from '../views/club-bar.js';
import * as Live from '../views/live-matches.js';
import { createStandings } from '../views/standings.js';
import { createTeams } from '../views/teams.js';
import { revealResults } from '../views/reveal.js';
import { createHubBar } from '../views/hub-bar.js';

const KNOWN_SETTINGS = ['eventKey', 'liveBaseUrl', 'clubLogos'];

export async function mountHub(settings = {}){
  for(const name of Object.keys(settings)){
    if(!KNOWN_SETTINGS.includes(name)){
      console.error(`mountHub: unknown setting "${name}" (known: ${KNOWN_SETTINGS.join(', ')})`);
      return;
    }
  }
  const { eventKey, liveBaseUrl = '', clubLogos = {} } = settings;
  if(!eventKey){
    console.error('mountHub: the setting "eventKey" is required');
    return;
  }

  const byId = id => document.getElementById(id);
  const dayPickerEl = byId('dayPicker');
  const dayPickerWrapEl = byId('dayPickerWrap');
  const viewTabsWrapEl = byId('viewTabsWrap');
  const dayPromptEl = byId('dayPrompt');
  const syncStatusEl = byId('syncStatus');
  const viewTabs = document.querySelectorAll('.view-tab');
  const searchPanelEl = byId('searchPanel');
  const resultsEl = byId('results');
  const standingsResultsEl = byId('standingsResults');
  const liveResultsEl = byId('liveResults');
  const standingsBodyEl = byId('standingsBody');
  const liveBoardEl = byId('liveBoard');
  const liveBoardMetaEl = byId('liveBoardMeta');

  // Local testing only: on localhost, ?fixture=<name> reads /_fixtures/<event>/<name>.json instead of the
  // published snapshot (lib/v1/platform.js). Inert on the live site.
  const FIXTURE = fixtureName();

  // ---- the event, from events.json ----
  let EVENT_CONFIG;
  try {
    EVENT_CONFIG = eventConfigFrom(await loadRegistry({ fixture: FIXTURE }), eventKey);
  } catch(err){
    dayPromptEl.textContent = `Couldn't load this event's settings (${err.message}).`;
    return;
  }
  if(!EVENT_CONFIG || (EVENT_CONFIG.type !== 'standard' && EVENT_CONFIG.type !== 'dual-meet' && EVENT_CONFIG.type !== 'team')){
    dayPromptEl.textContent = !EVENT_CONFIG
      ? `This event isn't in the schedule settings yet (${eventKey}).`
      : `This event's type isn't set up for a Tournament Hub (type: ${EVENT_CONFIG.type}).`;
    return;
  }
  const DAYS = EVENT_CONFIG.days;
  const EVENT_TYPE = EVENT_CONFIG.type;
  const DISPLAY = EVENT_CONFIG.display;
  const dualMeet = EVENT_TYPE === 'dual-meet';
  const teamEvent = EVENT_TYPE === 'team';

  // The bar the banner folds into (views/hub-bar.js): always on a phone, on a computer once the reader folds the
  // banner. It reads the banner's own tabs, day picker and sync line, so the page keeps one set of them; update() is
  // called wherever one of them changes.
  let bar = { update(){} };

  // ---- Browser storage keys ----
  // Namespaced off the event key, so a new event can never read or clobber another event's saved state in a
  // shared browser. Used to remember the last day picked, last tab + last search across page reloads.
  const STORAGE_DAY_KEY = `${eventKey}.dayIndex`;
  const STORAGE_SEARCH_KEY = `${eventKey}.search`;
  const STORAGE_VIEW_KEY = `${eventKey}.view`;

  const liveChannel = createLiveChannel({
    baseUrl: liveBaseUrl,
    enabled: !!liveBaseUrl && !FIXTURE,
    onSnapshot: () => loadLiveData(),
  });

  let currentDayIndex = null; // no day chosen yet — gates the tabs until one is picked
  let dayIsLive = false; // resolved from the day's snapshot — set on every load

  // the day's DayModel (domain/model.js), rebuilt with every snapshot; the views read it
  let MODEL = buildDayModel(EVENT_CONFIG, DAYS[0] || { key: '', facilities: [] }, null, { now: Date.now() });

  function fetchDaySnapshot(dayKey){
    return Snapshot.fetchDaySnapshot(eventKey, dayKey, { liveChannel, fixture: FIXTURE });
  }

  async function loadLiveData(){
    // Nothing to load until the person has actually picked a day.
    if(currentDayIndex === null) return false;

    // Snapshot which day this specific call is loading for. Days can switch (or a Retry can be clicked) while
    // a fetch is still in flight — without this guard, a slow/stale response for a day the person has since
    // navigated away from can land after a newer one and silently overwrite the correct data with the
    // wrong day's.
    const dayIndexAtStart = currentDayIndex;
    const day = DAYS[dayIndexAtStart];
    const statusEl = syncStatusEl;
    const tabsShowing = viewTabsWrapEl.style.display !== 'none';

    if(tabsShowing){
      statusEl.textContent = 'Loading live schedule…';
      statusEl.className = 'sync-status loading';
    } else {
      dayPromptEl.textContent = `Loading ${day.label}…`;
    }

    try {
      const snapshot = await fetchDaySnapshot(day.key);
      if(currentDayIndex !== dayIndexAtStart) return false; // superseded by a newer day switch — discard

      // Server-side (Cloud Run) already fetched each facility, so this is just re-assembling what it
      // published — no per-facility network calls happen here. matchNumber/teamCode are unique across a
      // day's facilities, so combining is just a concatenation.
      const model = buildDayModel(EVENT_CONFIG, DAYS[dayIndexAtStart], snapshot, { now: Date.now(), hideUnshownLineups: !!EVENT_CONFIG.lineupReveal });
      if(model.matches.length === 0) throw new Error('No rows parsed from any facility');

      MODEL = model;
      // The Teams tab shows whenever the snapshot carries a roster, before go-live too. It is settled before
      // revealLiveTabsAfterLoad, which restores a saved Teams view only when the tab is showing.
      if(teamEvent) teams.syncTab();

      // Re-checked every poll (not just on day-select) so a page left open across the go-live threshold flips
      // over on its own, without needing a reload. Only re-sync tab visibility when it actually changed,
      // though — calling this on every update regardless would yank the person off whatever tab they're
      // currently looking at.
      const wasLive = dayIsLive;
      dayIsLive = model.isLive;
      if(dayIsLive !== wasLive) revealLiveTabsAfterLoad();

      finder.rebuildIndex(); // also re-renders the Match Finder panel (search results or intro)
      if(teamEvent && teamsTabActive()) teams.renderRosters();
      if(dayIsLive){
        renderStandings();
        renderLiveMatches();
      }

      // "Synced" reflects when Cloud Run actually published this snapshot (i.e. when the sheet was last
      // edited and Apps Script synced it), not when this browser happened to re-poll or receive a push —
      // that's the meaningful freshness signal now, not the poll time.
      const syncedAt = snapshot.generatedAt ? new Date(snapshot.generatedAt) : new Date();
      const failedFacilities = snapshot.failedFacilities || [];
      if(failedFacilities.length){
        statusEl.textContent = `${day.label} · Live (partial) · last synced ${syncedAt.toLocaleTimeString()} · couldn't reach: ${failedFacilities.join(', ')}`;
        statusEl.className = 'sync-status error';
      } else {
        statusEl.textContent = `${day.label} · Live · last synced ` + syncedAt.toLocaleTimeString();
        statusEl.className = 'sync-status ok';
      }
      bar.update();
      return true;
    } catch(err){
      if(currentDayIndex !== dayIndexAtStart) return false; // superseded — let the newer call's UI stand

      const notPublishedYet = err.status === 404;
      const baseMessage = notPublishedYet
        ? `${day.label}: schedule isn't loaded yet — check back soon.`
        : `Couldn't load ${escapeHtml(day.label)} data (` + escapeHtml(err.message) + ').';
      const message = notPublishedYet
        ? baseMessage
        : baseMessage + ' <button id="retryBtn" class="retry-btn">Retry</button>';

      if(tabsShowing){
        statusEl.innerHTML = message;
        statusEl.className = 'sync-status error';
      } else {
        dayPromptEl.innerHTML = message;
      }

      bar.update();
      const retryBtn = byId('retryBtn');
      if(retryBtn) retryBtn.addEventListener('click', async () => {
        const ok = await loadLiveData();
        if(ok) revealLiveTabsAfterLoad();
      });
      return false;
    }
  }

  // Shared by the day picker and the retry button: once loadLiveData resolves true, reveal the tabs/status and
  // land on a tab so a successful retry doesn't leave the person stuck on the error prompt. A first-time
  // visitor lands on Match Finder — most people open the hub to find their own matches first; a returning one
  // gets the tab they last picked back, unless it isn't showing for this day (Live Matches/Standings before
  // go-live).
  function revealLiveTabsAfterLoad(){
    if(dayPromptEl) dayPromptEl.style.display = 'none';
    if(viewTabsWrapEl) viewTabsWrapEl.style.display = '';
    if(syncStatusEl) syncStatusEl.style.display = '';

    const liveTabBtn = document.querySelector('.view-tab[data-view="live"]');
    const standingsTabBtn = document.querySelector('.view-tab[data-view="standings"]');
    if(liveTabBtn) liveTabBtn.style.display = dayIsLive ? '' : 'none';
    if(standingsTabBtn) standingsTabBtn.style.display = dayIsLive ? '' : 'none';

    const saved = loadSavedView();
    const savedBtn = [...document.querySelectorAll('.view-tab')].find(b => b.dataset.view === saved);
    const savedShowing = savedBtn && savedBtn.style.display !== 'none';
    showView(savedShowing ? saved : 'finder');
    bar.update();
  }

  // ---- Persistence: remember the last day, tab + search across reloads ----
  // Wrapped in try/catch since localStorage can throw in some private-browsing or embedded contexts — this is
  // a nice-to-have, never worth breaking the app over.
  function saveDayIndex(idx){ try{ localStorage.setItem(STORAGE_DAY_KEY, String(idx)); } catch(e){} }
  function loadSavedDayIndex(){
    try{
      const v = localStorage.getItem(STORAGE_DAY_KEY);
      const idx = v === null ? NaN : parseInt(v, 10);
      return (!isNaN(idx) && idx >= 0 && idx < DAYS.length) ? idx : null;
    } catch(e){ return null; }
  }
  function saveSearchState(raw){ try{ localStorage.setItem(STORAGE_SEARCH_KEY, raw); } catch(e){} }
  function loadSavedSearch(){ try{ return localStorage.getItem(STORAGE_SEARCH_KEY) || ''; } catch(e){ return ''; } }
  function clearSavedSearch(){ try{ localStorage.removeItem(STORAGE_SEARCH_KEY); } catch(e){} }
  function saveView(view){ try{ localStorage.setItem(STORAGE_VIEW_KEY, view); } catch(e){} }
  function loadSavedView(){ try{ return localStorage.getItem(STORAGE_VIEW_KEY); } catch(e){ return null; } }

  // ---- a dual meet's club logos (the page passes the paths) ----
  // The club a team code belongs to, when the code is a known club, division and event with something after.
  function clubOf(teamCode){
    const p = parseCode(teamCode, EVENT_TYPE), split = splitCategory(p.category, DISPLAY);
    return split && p.rest && clubLogos[p.club] ? p.club : null;
  }
  const logoHTML = (className, teamCode) => {
    const club = clubOf(teamCode);
    return club ? `<img class="${className}" src="${escapeHtml(clubLogos[club])}" alt="${escapeHtml(club)} logo">` : '';
  };
  // .score-logo (the ticket's) is a different, larger-still size tuned for that card; the live table's is its own.
  const teamLogoHTML = dualMeet ? teamCode => logoHTML('score-logo', teamCode) : undefined;
  const liveTeamLogoHTML = dualMeet ? teamCode => logoHTML('live-team-logo', teamCode) : undefined;

  // ---- the views ----
  const input = byId('teamInput');
  // After a search, on a phone: close the keyboard and scroll to the results (views/reveal.js). False on a computer.
  const reveal = () => revealResults({ resultsEl, searchPanelEl, input });
  const teamsResultsEl = byId('teamsResults');
  // A team event's views (lib/v1/views/teams.js): matchup cards, bracket tables, the rosters and its own Match
  // Finder (the finder's `delegate`). A public page: no organiser's team letters, and no match-number search.
  let teams = null;
  if(teamEvent){
    teams = createTeams({
      getModel: () => MODEL, getFinder: () => finder,
      input, acList: byId('acList'), resultsEl,
      standingsEl: standingsBodyEl, rostersEl: byId('teamsBody'),
      saveSearch: saveSearchState,
      onSearched: reveal,
      renderStandings: () => teams.renderStandings(),
      searchHint: 'Search a team or a player above.',
      teamLetters: false,
      podium: true,
    });
  }
  // A club's logo in the club bar: Standings' bar and, at a dual meet, Match Finder's first screen.
  const clubLogoHTML = (code, name) => {
    const path = clubLogos[code];
    return path ? `<img class="cs-logo" src="${escapeHtml(path)}" alt="${escapeHtml(name)} logo">` : '';
  };
  // Match Finder (lib/v1/views/finder.js): the pair index, the search box with its suggestions, the results.
  const finder = createFinder({
    input, acList: byId('acList'), resultsEl,
    clearBtn: byId('clearInputBtn'),
    searchBtn: byId('searchBtn'),
    getModel: () => MODEL,
    ticket: dualMeet ? { teamLogoHTML } : {},
    delegate: teams ? teams.delegate : null,
    saveSearch: saveSearchState,
    clearSavedSearch,
    onSearched: reveal,
    ...(dualMeet ? { introTop: m => clubBarHTML(m, { clubLogoHTML }) } : {}),
  });

  // A Standings row opens its pair in Match Finder: the tab switches, the search box holds the pair and the results
  // show it, with the summary card first. On a phone the results land under the pinned search box; on a computer,
  // where revealResults does nothing, the page goes to the search box, so the results are in view rather than
  // wherever Standings had been scrolled to (leaving room for the bar while it shows: its measured --hub-bar-h).
  function openPairInFinder(code){
    const team = finder.pairs.find(t => t.codes.includes(code));
    if(!team) return;
    document.querySelector('.view-tab[data-view="finder"]').click();
    input.value = team.label;
    finder.selection = team;
    finder.updateClear();
    finder.run();
    if(!reveal()){
      const barSpace = document.body.classList.contains('hub-bar-on')
        ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hub-bar-h')) || 54) : 0;
      window.scrollTo({ top: Math.max(0, searchPanelEl.getBoundingClientRect().top + window.scrollY - 16 - barSpace) });
    }
  }

  // Standings (lib/v1/views/standings.js): a category card per category with the toggle bar and the phone
  // category search; a dual meet's per-club columns, its Round Robin as one table with a bracket column. A team
  // event's Standings are teams.renderStandings (bracket tables and playoffs).
  const standings = teamEvent ? null : createStandings({
    bodyEl: standingsBodyEl, panelEl: standingsResultsEl,
    toggleBarEl: byId('categoryToggleBar'),
    catInput: byId('catFilterInput'), catAcList: byId('catAcList'), clearCatBtn: byId('clearCatBtn'),
    getModel: () => MODEL,
    onPairSelect: openPairInFinder,
    podium: true,
    ...(dualMeet ? {
      rrBracketLayout: 'column',
      clubLogoHTML,
      jumpChips: true,
    } : {}),
  });
  const renderStandings = () => { if(teamEvent) teams.renderStandings(); else standings.render(); };
  const teamsTabActive = () => !!document.querySelector('.view-tab[data-view="teams"].active');

  // Live Matches (lib/v1/views/live-matches.js): one table per facility, a row per court.
  function renderLiveMatches(){
    Live.renderLiveMatches(MODEL, {
      boardEl: liveBoardEl, metaEl: liveBoardMetaEl,
      ...(teamEvent
        ? { liveRow: teams.liveRow, emptyMatchupHTML: '<div class="live-matchup">&nbsp;</div>' }
        : { teamLogoHTML: liveTeamLogoHTML }),
    });
  }

  // The bar (views/hub-bar.js) is made once the views and their panels exist. A shell without a banner or its tabs
  // keeps the no-op above.
  const heroEl = document.querySelector('header.hero');
  if(heroEl && viewTabsWrapEl){
    bar = createHubBar({
      heroEl, tabsWrapEl: viewTabsWrapEl, dayPickerEl, dayPickerWrapEl, syncStatusEl,
      panelFor: v => ({ finder: searchPanelEl, live: liveResultsEl, standings: standingsResultsEl, teams: teamsResultsEl })[v],
    });
  }

  // Switches to one view: marks its tab active, shows its panel, hides the rest and renders it. The tab
  // buttons call it (and remember the choice); revealLiveTabsAfterLoad calls it to land on the remembered tab.
  function showView(view){
    viewTabs.forEach(b => b.classList.toggle('active', b.dataset.view === view));
    liveResultsEl.style.display = view === 'live' ? '' : 'none';
    searchPanelEl.style.display = view === 'finder' ? '' : 'none';
    resultsEl.style.display = view === 'finder' ? '' : 'none';
    standingsResultsEl.style.display = view === 'standings' ? '' : 'none';
    if(teamsResultsEl) teamsResultsEl.style.display = view === 'teams' ? '' : 'none';
    if(view === 'standings') renderStandings();
    if(view === 'live') renderLiveMatches();
    if(teamEvent && view === 'teams') teams.renderRosters();
    bar.update();
  }
  viewTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      showView(btn.dataset.view);
      saveView(btn.dataset.view);
    });
  });

  // ---- Day picker: gates the tabs until a day is actually chosen ----
  // Shared by the change listener below and the initial-load hydration at the bottom, so a page reload can
  // silently re-run the exact same flow as picking the day by hand. isInitialLoad only affects whether a
  // previously-saved search is brought back afterwards.
  async function selectDay(idx, { isInitialLoad = false } = {}){
    currentDayIndex = idx;
    liveChannel.follow(eventKey, DAYS[idx].key);
    if(dayPickerEl) dayPickerEl.value = String(idx);
    const day = DAYS[idx];

    // Switching days always drops back to the same "first screen" shown on initial page load — tabs/status
    // hidden, just the centered prompt — so nothing from the previous day (tabs, search results, standings)
    // stays on screen while the new day's data is loading. Whether this day is actually ready is discovered
    // by loadLiveData() itself (a 404 means Cloud Run hasn't published it yet), not known upfront.
    viewTabsWrapEl.style.display = 'none';
    syncStatusEl.style.display = 'none';
    liveResultsEl.style.display = 'none';
    searchPanelEl.style.display = 'none';
    resultsEl.style.display = 'none';
    standingsResultsEl.style.display = 'none';
    if(teamsResultsEl) teamsResultsEl.style.display = 'none';
    bar.update();
    dayPromptEl.textContent = `Loading ${day.label}…`;
    dayPromptEl.style.display = '';

    // Reset per-day UI state so nothing carries over from a previous day.
    finder.reset();
    if(teamEvent) teams.reset(); else standings.reset();

    saveDayIndex(idx);
    // A manually-chosen day drops any search saved for a different day, same as clearing the input above — the
    // initial-load hydration path re-adds it right back below if there is one.
    if(!isInitialLoad) clearSavedSearch();

    const loaded = await loadLiveData();

    if(loaded){
      revealLiveTabsAfterLoad();

      if(isInitialLoad){
        let savedSearch = loadSavedSearch();
        // A team event saves "team:<letter>" / "player:<name>" (never a playoff code); the other types save the
        // raw text. The key is shared across a browser's events, so each type only takes back what it wrote.
        const isTeamKey = /^(team|player):/.test(savedSearch);
        if(teamEvent){
          const entry = isTeamKey ? teams.entryForSearchKey(savedSearch) : null;
          if(entry){ finder.selection = entry; savedSearch = entry.kind === 'team' ? entry.label : entry.name; }
          else savedSearch = '';
        } else if(isTeamKey){
          savedSearch = '';
        }
        if(savedSearch){
          finder.setQuery(savedSearch);
          // A returning visit lands on the saved search's results, when Match Finder is the tab that opened.
          if(document.querySelector('.view-tab[data-view="finder"].active')) reveal();
        }
      }
    }
    // If not loaded, loadLiveData() has already written the right message (either "not published yet", or an
    // error + Retry button) into dayPromptEl, which is still visible — nothing else to do here.
  }

  if(dayPickerEl){
    dayPickerEl.innerHTML = '<option value="" selected disabled hidden>Choose a day…</option>' +
      DAYS.map((d, i) => `<option value="${i}">${escapeHtml(d.label)}</option>`).join('');

    dayPickerEl.addEventListener('change', async () => {
      const idx = parseInt(dayPickerEl.value, 10);
      if(isNaN(idx)) return;
      await selectDay(idx);
    });
  }

  // A single-day event has nothing to pick between, so the picker itself (and the need to ever gate on a
  // choice) is just friction — see the DAYS.length === 1 branch below, which auto-selects the one day
  // instead of waiting for a click here.
  if(DAYS.length <= 1 && dayPickerWrapEl) dayPickerWrapEl.style.display = 'none';

  finder.renderIntro();

  // A day loads on opening (tabs/status stay hidden behind the loading prompt until it resolves): the day this
  // browser picked last time, else today's, else the nearest (domain/initial-day.js). A one-day event loads its one
  // day. The person never has to pick a day before seeing anything.
  const savedDayIdx = loadSavedDayIndex();
  const openingIdx = initialDayIndex({
    days: DAYS,
    savedKey: savedDayIdx !== null ? DAYS[savedDayIdx].key : null,
    today: manilaIsoDate(new Date()),
  });
  if(openingIdx !== null) selectDay(openingIdx, { isInitialLoad: true });

  // Pause the 15s poll while the tab/app is backgrounded — no point spending battery and mobile data
  // re-fetching three spreadsheets nobody's looking at — and catch up with an immediate refresh as soon as it's
  // visible again.
  createPoller({ onTick: loadLiveData, liveChannel }).start();
}
