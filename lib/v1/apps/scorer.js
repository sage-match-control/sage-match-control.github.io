// The scorer page: staff enter scores with a scorer link, one link per event day and every venue of it, scoped
// to entering scores and nothing else, good for 24 hours. Linked from nowhere public; Mission Control's Issue
// scorer link produces the link. See sage-docs/docs/specs/.../control-center-score-entry-spec.md §6.
//
// The page is a shell (site-engine-spec §4.5): its markup, its theme and one call to mountScorer.
//
//   mountScorer({ eventKey, liveBaseUrl })
//     eventKey     required. The event's key in events.json; also the namespace of the stored link and filters
//     liveBaseUrl  the live Worker's wss:// address; '' turns push off for this page

import { parseCSV } from '../domain/csv.js';
import { rowsToMatches } from '../domain/matches.js';
import { matchByeSide } from '../domain/byes.js';
import { unneededSeriesGames } from '../domain/series.js';

// The engine's data layer: constants, the registry, the snapshot and its poll, the live channel, link tokens, API errors.
import { CLOUD_RUN_BASE_URL, fixtureName } from '../platform.js';
import { loadRegistry } from '../data/registry.js';
import { createPoller } from '../data/snapshot.js';
import { createLiveChannel } from '../data/live-channel.js';
import { friendlyApiMessage } from '../data/api.js';
import { scorerDecode, scorerLoadToken, scorerStorageKey } from '../data/tokens.js';
import * as Snapshot from '../data/snapshot.js';
import { escapeHtml } from '../views/html.js';
import { createScoreDialog } from '../views/score-dialog.js';

const KNOWN_SETTINGS = ['eventKey', 'liveBaseUrl'];

let EVENT_KEY = '';
let LIVE_BASE_URL = '';
let SCORER_STORAGE_KEY = '';
// Local testing only: on localhost, ?fixture=<name> reads /_fixtures/ instead of the published data and
// simulates saves (lib/v1/platform.js). Inert on the live site.
let FIXTURE = null;

export function mountScorer(settings = {}){
  for(const name of Object.keys(settings)){
    if(!KNOWN_SETTINGS.includes(name)){
      console.error(`mountScorer: unknown setting "${name}" (known: ${KNOWN_SETTINGS.join(', ')})`);
      return;
    }
  }
  if(!settings.eventKey){
    console.error('mountScorer: the setting "eventKey" is required');
    return;
  }
  EVENT_KEY = settings.eventKey;
  FIXTURE = fixtureName();
  LIVE_BASE_URL = settings.liveBaseUrl || '';
  SCORER_STORAGE_KEY = scorerStorageKey(EVENT_KEY);
  bindPage();
  scorerStart();
}

// ============================================================================
// THE SCORER PAGE
// ============================================================================
let messageEl, pickerEl, filtersEl, countEl, listEl, toastEl, dayLabelEl;

// The page's elements and the list's click handling, bound when the page is mounted.
function bindPage(){
  messageEl = document.getElementById('scorerMessage');
  pickerEl = document.getElementById('facilityPicker');
  filtersEl = document.getElementById('scorerFilters');
  countEl = document.getElementById('scorerCount');
  listEl = document.getElementById('scorerList');
  toastEl = document.getElementById('scorerToast');
  dayLabelEl = document.getElementById('dayLabel');

  listEl.addEventListener('click', (e) => {
    const card = e.target.closest('[data-score-num]');
    if(card) openScore(Number(card.dataset.scoreNum));
  });
  listEl.addEventListener('keydown', (e) => {
    if((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-score-num]')){
      e.preventDefault();
      openScore(Number(e.target.dataset.scoreNum));
    }
  });
}

function say(text){ messageEl.textContent = text; }

let toastTimer = null;
const TOAST_MS = { ok: 4500, warn: 7000, error: 9000 };
function toast(kind, text){
  clearTimeout(toastTimer);
  toastEl.className = `scorer-toast ${kind}`;
  toastEl.textContent = text;
  toastEl.hidden = false;
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, TOAST_MS[kind] || TOAST_MS.ok);
}

function store(key, value){ try{ localStorage.setItem(key, value); }catch(e){} }
function recall(key){ try{ return localStorage.getItem(key); }catch(e){ return null; } }

// ---- state ----
let token = null;          // the stored scorer token
let info = null;           // its decoded payload { day, exp }
let entry = null;          // this event's entry in events.json
let dayEntry = null;       // this token's day
let facilities = [];       // [{ name, sheetId }] with a sheetId
let facility = null;       // the chosen venue's name
let lastSnapshot = null;   // the day's latest snapshot: every venue's data
let matches = [];          // the chosen venue's matches, byes dropped
let teamNames = {};        // team events: code -> name, for the chosen venue
let loadError = '';        // why the schedule could not be loaded, or ''
let loadMessageShown = false; // the message line currently holds loadError
let filters = { q: '', court: '', hideScored: true };
let scoreDialog = null;
let liveChannel = null;
let poller = null;
let expiryTimer = null;

// ---- data ----

function fetchDaySnapshot(dayKey){
  return Snapshot.fetchDaySnapshot(EVENT_KEY, dayKey, { liveChannel, fixture: FIXTURE });
}

async function loadData(){
  if(!info) return;
  try {
    lastSnapshot = await fetchDaySnapshot(info.day);
    loadError = '';
  } catch(err){
    loadError = err.status === 404
      ? 'This day’s schedule isn’t published yet.'
      : `Couldn’t load the schedule (${err.message}). Retrying.`;
  }
  applySnapshot();
}

// Rebuilds the chosen venue's matches from the snapshot already loaded (one
// snapshot holds every venue's data, so a venue switch needs no fetch).
function applySnapshot(){
  matches = []; teamNames = {};
  if(facility && lastSnapshot){
    const f = (lastSnapshot.facilities || []).find(x => x.name === facility);
    if(f){
      matches = rowsToMatches(parseCSV(f.matchesCsv || ''))
        .map(m => ({ ...m, facility: f.name }))
        .filter(m => matchByeSide(m) === null);
      if(entry.type === 'team'){
        const rows = parseCSV(f.standingsCsv || '');
        const head = (rows[0] || []).map(h => h.trim());
        const iCode = head.indexOf('teamCode'), iName = head.indexOf('teamName');
        if(iCode !== -1 && iName !== -1){
          rows.slice(1).forEach(r => { if(r[iCode] && r[iName] && r[iName].trim()) teamNames[r[iCode].trim()] = r[iName].trim(); });
        }
      }
    }
  }
  renderList();
  if(scoreDialog) scoreDialog.refresh();
}

// ---- venue picker ----

function filtersKey(name){ return `${SCORER_STORAGE_KEY}.filters.${name}`; }

function loadFilters(name){
  filters = { q: '', court: '', hideScored: true };
  try{
    const saved = JSON.parse(recall(filtersKey(name)) || 'null');
    if(saved && typeof saved === 'object'){
      if(typeof saved.q === 'string') filters.q = saved.q;
      if(typeof saved.court === 'string') filters.court = saved.court;
      if(typeof saved.hideScored === 'boolean') filters.hideScored = saved.hideScored;
    }
  }catch(e){}
}
function saveFilters(){ if(facility) store(filtersKey(facility), JSON.stringify(filters)); }

function updateTitleLine(){
  dayLabelEl.textContent = ` · ${dayEntry.label || info.day}` + (facility ? ` · ${facility}` : '');
}

function renderPicker(){
  pickerEl.textContent = '';
  const label = document.createElement('div');
  label.className = 'venue-label';
  if(facilities.length === 1){
    label.textContent = 'Venue';
    const only = document.createElement('div');
    only.className = 'venue-single';
    only.textContent = facilities[0].name;
    pickerEl.append(label, only);
    return;
  }
  if(!facility){ label.textContent = 'Which venue are you at?'; label.classList.add('prompt'); }
  else label.textContent = 'Venue';
  const row = document.createElement('div');
  row.className = 'venue-buttons';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Venue');
  facilities.forEach(f => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'venue-btn';
    b.textContent = f.name;
    b.setAttribute('aria-pressed', f.name === facility ? 'true' : 'false');
    b.addEventListener('click', () => chooseFacility(f.name));
    row.append(b);
  });
  pickerEl.append(label, row);
}

function chooseFacility(name){
  if(name === facility) return;
  if(scoreDialog && scoreDialog.isOpen()) return;   // the dialog is modal; nothing to switch while it shows
  facility = name;
  store(`${SCORER_STORAGE_KEY}.facility`, name);
  loadFilters(name);
  updateTitleLine();
  renderPicker();
  buildFilters();
  courtChipsKey = null;
  applySnapshot();        // from the snapshot already loaded: no fetch for a venue switch
}

// ---- filters ----

function buildFilters(){
  filtersEl.textContent = '';
  if(!facility) return;
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'filter-search';
  search.placeholder = 'Match #, team or player';
  search.setAttribute('aria-label', 'Search matches');
  search.autocomplete = 'off';
  search.value = filters.q;
  search.addEventListener('input', () => { filters.q = search.value; saveFilters(); renderList(); });
  const courts = document.createElement('div');
  courts.className = 'filter-courts';
  courts.id = 'scorerCourts';
  const hide = document.createElement('label');
  hide.className = 'filter-hide';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = filters.hideScored;
  box.addEventListener('change', () => { filters.hideScored = box.checked; saveFilters(); renderList(); });
  hide.append(box, document.createTextNode('Hide scored'));
  filtersEl.append(search, courts, hide);
}

function courtNumber(court){
  const m = String(court).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

let courtChipsKey = null;
function renderCourtChips(){
  const holder = document.getElementById('scorerCourts');
  if(!holder) return;
  const courts = [...new Set(matches.map(m => m.court).filter(Boolean))]
    .sort((a, b) => courtNumber(a) - courtNumber(b) || a.localeCompare(b));
  if(filters.court && !courts.includes(filters.court) && matches.length) filters.court = '';
  const key = `${facility}|${courts.join('|')}|${filters.court}`;
  if(key === courtChipsKey) return;
  courtChipsKey = key;
  holder.textContent = '';
  if(courts.length < 2) return;
  [['', 'All courts'], ...courts.map(c => [c, c])].forEach(([value, text]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'court-chip';
    b.textContent = text;
    b.setAttribute('aria-pressed', filters.court === value ? 'true' : 'false');
    b.addEventListener('click', () => { filters.court = value; saveFilters(); courtChipsKey = null; renderList(); });
    holder.append(b);
  });
}

// ---- the list ----

function sideName(code){
  return entry.type === 'team' ? (teamNames[String(code).split('_')[0]] || code) : code;
}

function searchText(m){
  return `#${m.num} ${m.num} ${m.t1} ${m.t2} ${sideName(m.t1)} ${sideName(m.t2)} ${m.t1p1} ${m.t1p2} ${m.t2p1} ${m.t2p2}`.toLowerCase();
}

function sideCardHTML(code, p1, p2, right){
  const name = sideName(code);
  const unset = p1 === 'TBD';
  return `<div class="sc-side${right ? ' right' : ''}">
    <div class="sc-name">${escapeHtml(name)}</div>
    ${name !== code ? `<span class="sc-chip">${escapeHtml(code)}</span>` : ''}
    <div class="sc-players${unset ? ' unset' : ''}">${unset
      ? (entry.type === 'team' ? 'Lineup not set' : 'To be decided')
      : `${escapeHtml(p1)}<br>${escapeHtml(p2)}`}</div>
  </div>`;
}

function renderList(){
  if(!facility){ listEl.textContent = ''; countEl.textContent = ''; return; }
  renderCourtChips();
  const played = matches.filter(m => m.played).length;
  countEl.textContent = matches.length ? `${played} of ${matches.length} scored` : '';
  const q = filters.q.trim().toLowerCase();
  const shown = matches.filter(m =>
    (!filters.court || m.court === filters.court) &&
    (!filters.hideScored || !m.played) &&
    (!q || searchText(m).includes(q)));
  showLoadMessage();
  if(!shown.length){
    const hiddenAll = matches.length > 0 && filters.hideScored && matches.every(m => m.played) && !q && !filters.court;
    const text = hiddenAll ? 'Every match here is scored.'
      : lastSnapshot === null ? (loadError ? '' : `Loading ${escapeHtml(facility)}…`)
      : 'No matches to score here.';
    listEl.innerHTML = `<p class="scorer-empty">${text}</p>`;
    return;
  }
  listEl.innerHTML = shown.map(m => `<div class="score-card scoreable${m.played ? ' played' : ''}" data-score-num="${m.num}" role="button" tabindex="0"
      aria-label="${m.played ? 'Edit' : 'Enter'} score for match ${m.num}">
    <div class="sc-meta">#${m.num}${m.time ? ` · ${escapeHtml(m.time)}` : ''}${m.court ? ` · ${escapeHtml(m.court)}` : ''}</div>
    <div class="sc-body">
      ${sideCardHTML(m.t1, m.t1p1, m.t1p2, false)}
      <div class="sc-score${m.played ? '' : ' none'}">${m.played ? `${escapeHtml(String(m.t1Score))}–${escapeHtml(String(m.t2Score))}` : '–'}</div>
      ${sideCardHTML(m.t2, m.t2p1, m.t2p2, true)}
    </div>
  </div>`).join('');
}

// A failed load shows above the list (the list keeps the last good data); a good one clears it.
function showLoadMessage(){
  if(loadError){ say(loadError); loadMessageShown = true; }
  else if(loadMessageShown){ say(''); loadMessageShown = false; }
}

function openScore(num){
  const m = matches.find(x => x.num === num);
  if(!m){ toast('error', `Match #${num} isn’t loaded. Refresh and try again.`); return; }
  scoreDialog.open(info.day, facility, m);
}

// ---- the dialog ----

function createDialog(){
  return createScoreDialog({
    dialog: document.getElementById('scoreDialog'),
    apiBase: CLOUD_RUN_BASE_URL,
    getToken: () => token,
    fixture: FIXTURE,
    describe(m){
      const title = `Match #${m.num}` + (m.court ? ` · ${m.court}` : '') + (m.time ? ` · ${m.time}` : '');
      let sub;
      if(entry.type === 'team'){
        sub = m.matchUp || '';
      }else{
        const parts = String(m.t1).split('_');
        const category = entry.type === 'dual-meet' ? (parts[1] || parts[0]) : parts[0];
        const rest = parts.slice(entry.type === 'dual-meet' ? 2 : 1).join('_');
        sub = [category, scorerStage(rest)].filter(Boolean).join(' · ');
      }
      const side = (c, p1, p2) => ({
        name: sideName(c),
        code: c,
        players: p1 === 'TBD' ? null : [p1, p2],
        missing: entry.type === 'team' ? 'Lineup not set' : 'To be decided',
      });
      return { title, sub, sides: [side(m.t1, m.t1p1, m.t1p2), side(m.t2, m.t2p1, m.t2p2)] };
    },
    readOnlyReason(m){
      return entry.type !== 'team' && (m.t1p1 === 'TBD' || m.t2p1 === 'TBD') ? 'Players for this match aren’t decided yet.' : null;
    },
    extraWarnings(m){
      const out = [];
      if([...unneededSeriesGames(matches)].some(x => x.num === m.num && x.facility === m.facility)){
        out.push('This series game isn’t needed: the series is already decided.');
      }
      if(entry.type === 'team' && (m.t1p1 === 'TBD' || m.t2p1 === 'TBD')) out.push('Lineup not set for this match.');
      return out;
    },
    findMatch: (f, n) => (f === facility ? matches.find(x => x.num === n) || null : null),
    notify: (kind, text) => toast(kind, text),
    friendlyError: friendlyApiMessage,
    unreachable: err => `Couldn’t reach the server. Check this device’s connection and try again. (${err && err.message || err})`,
    expiredText: 'This scorer link has expired. Ask the operator for a new one.',
    resyncHint: 'Tell the operator so they can resync.',
    onFixtureSave(s, a, b){
      const m = matches.find(x => x.num === s.num);
      if(m){ m.t1Score = a; m.t2Score = b; m.played = a !== null; }
      renderList();
    },
  });
}

// The stage of a match from the rest of its team code (what follows the
// category): Round Robin, or the bracket round.
const SCORER_STAGES = { R16: 'Round of 16', QF: 'Quarterfinal', SF: 'Semifinal', F: 'Final', B: 'Bronze Match' };
function scorerStage(rest){
  if(!/^\d+$/.test(rest)){
    for(const k of ['R16', 'QF', 'SF', 'F', 'B']){
      if(new RegExp(`(^|_)${k}(_|\\d|$)`).test(rest)) return SCORER_STAGES[k];
    }
  }
  return 'Round Robin';
}

// ---- start-up ----

function stopEverything(text){
  if(scoreDialog) scoreDialog.close();
  if(poller) poller.stop(); clearInterval(expiryTimer);
  if(liveChannel) liveChannel.pause();
  pickerEl.textContent = ''; filtersEl.textContent = ''; countEl.textContent = ''; listEl.textContent = '';
  say(text);
}

async function scorerStart(){
  token = scorerLoadToken(EVENT_KEY);
  info = token ? scorerDecode(token) : null;
  if(!info){
    say('Ask the operator for a scorer link.');
    return;
  }
  if(Date.now() >= info.exp){
    say('This scorer link has expired. Ask the operator for a new one.');
    return;
  }

  try{
    const config = await loadRegistry({ fixture: FIXTURE });
    entry = config.events && config.events[EVENT_KEY];
  }catch(err){
    say(`Could not load this event (${err.message.replace(/^HTTP (\d+)$/, 'replied $1')}). Check this device’s connection and reload.`);
    return;
  }
  if(!entry || entry.scoreEntry !== 'links'){
    say('Scorer links are stopped for this event. Ask the operator.');
    return;
  }
  dayEntry = entry.days && entry.days[info.day];
  if(!dayEntry){
    say('This scorer link doesn’t match a day of this event. Ask the operator for a new one.');
    return;
  }
  facilities = (dayEntry.facilities || []).filter(f => f && f.name && f.sheetId);
  if(!facilities.length){
    say('No venues are set up for this day yet. Ask the operator.');
    return;
  }

  const remembered = recall(`${SCORER_STORAGE_KEY}.facility`);
  facility = facilities.length === 1 ? facilities[0].name
    : (facilities.some(f => f.name === remembered) ? remembered : null);
  if(facility) loadFilters(facility);
  updateTitleLine();

  scoreDialog = createDialog();
  liveChannel = createLiveChannel({
    baseUrl: LIVE_BASE_URL,
    enabled: !!LIVE_BASE_URL && !FIXTURE,
    onSnapshot: () => loadData(),
  });
  liveChannel.follow(EVENT_KEY, info.day);

  renderPicker();
  buildFilters();
  renderList();           // "Loading <venue>…" until the first snapshot arrives
  await loadData();

  // Poll while visible; pause the channel and the poll while the tab or app is backgrounded.
  poller = createPoller({ onTick: loadData, liveChannel });
  poller.start();

  // The link stops working at exp: say so instead of failing every save.
  expiryTimer = setInterval(() => {
    if(Date.now() >= info.exp) stopEverything('This scorer link has expired. Ask the operator for a new one.');
  }, 60000);
}

