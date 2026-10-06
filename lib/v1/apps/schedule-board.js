// The venue schedule board: the wall display, courts across and time slots down, one card per match, with a
// court filter, a venue filter, a compact header and print/PDF sheets. Linked from nowhere public; Control
// Center's Mission Control opens it. Shows one day of an event, reads the same published snapshot the
// Hub does, and needs nothing from events.json (the court count comes from the data).
//
// The page is a shell (site-engine-spec §4.5): its markup, its theme and one call to mountScheduleBoard.
//
//   mountScheduleBoard({ eventKey, dayKey, liveBaseUrl, categoryColors, clubOrder, type })
//     eventKey         required. The event's folder in event-data
//     dayKey           required. The one day the board shows (a day key from events.json)
//     liveBaseUrl      the live Worker's wss:// address; '' turns push off for this page
//     categoryColors   { '<DIVISION><EVENT>': { short, color } }: each category's chip label and the hue that tints
//                      its cells. These are the organiser's own colours, read by eye off the colour-coded
//                      SCHEDULE tab of the source spreadsheet; nothing detects that drift
//     clubOrder        a dual meet's two club codes, [A, B]; each match's club tags take .club-a / .club-b by it
//     type             'standard' | 'dual-meet' | 'team'; where a match's category and stage come from. Without it,
//                      inferred from clubOrder as before (a dual meet with it, a standard event without). A team
//                      event's board shows each side's team name and the pair, so it also reads the event's pair
//                      labels from events.json; its categories are the brackets, keyed "G<n>", and "PO" for a playoff

import { loadRegistry, eventConfigFrom } from '../data/registry.js';
import { readableOn, courtsToParam, chunkBalanced, clubOf, parseCourtsParam as parseCourts, buildScheduleData as buildData } from '../domain/schedule-grid.js';
import { fixtureName } from '../platform.js';
import { createLiveChannel } from '../data/live-channel.js';
import { createPoller } from '../data/snapshot.js';
import * as Snapshot from '../data/snapshot.js';
import { escapeHtml as esc } from '../views/html.js';

const KNOWN_SETTINGS = ['eventKey', 'dayKey', 'liveBaseUrl', 'categoryColors', 'clubOrder', 'type'];
const KNOWN_TYPES = ['standard', 'dual-meet', 'team'];
const FALLBACK = { short:'?', color:'#5B6B74' };

// Stage of the ladder, from the tail of the team code. The regexes are the ones roundKeyword() uses
// (lib/v1/domain/codes.js), so this page classifies a code exactly the way the rest of the site does.
//
// Current data only carries "1".."4" (pool), "B" and "F", but QF/SF/R16 are supported because the bracket
// generator emits them and this must not need editing the first time a bigger event runs.
//
// Order matters: SF is tested before F, and "SF_1" cannot match the F pattern anyway because that requires F
// at the start or after an underscore.
const STAGE_META = {
  RR:  { label: 'RR',     playoff: false },
  R16: { label: 'R16',    playoff: true  },
  QF:  { label: 'QF',     playoff: true  },
  SF:  { label: 'SF',     playoff: true  },
  B:   { label: 'BRONZE', playoff: true  },
  F:   { label: 'FINAL',  playoff: true  }
};

// Height/width budgets of a printed sheet are measured, not guessed. A landscape A4 at 96dpi gives ~1054px
// usable. Fitting 5 courts leaves 196px columns and truncates 87 of 504 player names — unacceptable on paper,
// where there is no hover to recover the rest. 4 balances to 3+3+3 at 328px columns with zero truncation. One
// extra sheet is a cheap price for nothing being cut off.
const PRINT_COURTS_PER_PAGE = 4;
// A landscape A4 gives ~726px usable; the page header and column-head row take ~70px, and a print row measures
// ~42px including its gap, leaving room for about 15 slots. A 12-hour day at 25-minute slots is ~29 rows, so
// this axis genuinely has to paginate too — without it the browser breaks a sheet mid-row.
const PRINT_SLOTS_PER_PAGE = 15;

export async function mountScheduleBoard(settings = {}){
  for(const name of Object.keys(settings)){
    if(!KNOWN_SETTINGS.includes(name)){
      console.error(`mountScheduleBoard: unknown setting "${name}" (known: ${KNOWN_SETTINGS.join(', ')})`);
      return;
    }
  }
  const { eventKey, dayKey, liveBaseUrl = '', categoryColors = {}, clubOrder = null, type = null } = settings;
  if(!eventKey || !dayKey){
    console.error('mountScheduleBoard: the settings "eventKey" and "dayKey" are required');
    return;
  }
  if(type !== null && !KNOWN_TYPES.includes(type)){
    console.error(`mountScheduleBoard: unknown type "${type}" (known: ${KNOWN_TYPES.join(', ')})`);
    return;
  }
  // Where the category sits in a team code: "<CATEGORY>_<REST>" or "<CLUB>_<CATEGORY>_<REST>"; a team event has none.
  const EVENT_TYPE = type || (clubOrder ? 'dual-meet' : 'standard');
  const teamEvent = EVENT_TYPE === 'team';
  let pairs;   // a team event's pair labels, read from events.json before the first load (below)

  // Local testing only: on localhost, ?fixture=<name> reads /_fixtures/<event>/<name>.json instead of the
  // published snapshot (lib/v1/platform.js). Inert on the live site.
  const FIXTURE = fixtureName();

  const liveChannel = createLiveChannel({
    baseUrl: liveBaseUrl,
    enabled: !!liveBaseUrl && !FIXTURE,
    onSnapshot: () => loadSchedule(false),
  });

  // A bracket the page lists no colour for (G<n>) still gets a chip: "BR <n>" in the neutral hue.
  const meta = c => {
    if(categoryColors[c]) return categoryColors[c];
    const bracket = /^G(\d+)$/.exec(c);
    return bracket ? { short: 'BR ' + bracket[1], color: FALLBACK.color } : FALLBACK;
  };
  const byId = id => document.getElementById(id);
  const titleHTML = (document.querySelector('.bezel h1') || {}).innerHTML || '';

  // Which fill each club's tag gets. The index decides the .club-a / .club-b class, so the colours follow the
  // configured club order instead of being hardcoded to one event's club codes. Anything unrecognised falls
  // back to .club-x rather than rendering an unstyled tag.
  const clubClass = code => {
    const i = clubOrder.indexOf(clubOf(code));
    return i === 0 ? 'club-a' : i === 1 ? 'club-b' : 'club-x';
  };

  function ladderStageOf(code){
    const m = String(code).match(clubOrder ? /^[A-Z]+_[A-Z]+_(.+)$/ : /^[A-Z0-9]+_(.+)$/);
    const rest = m ? m[1] : '';
    if(/^\d+$/.test(rest)) return 'RR';           // plain pool number
    if(/(^|_)R16(_|\d|$)/.test(rest)) return 'R16';
    if(/(^|_)QF(_|\d|$)/.test(rest))  return 'QF';
    if(/(^|_)SF(_|\d|$)/.test(rest))  return 'SF';
    if(/(^|_)F(_|\d|$)/.test(rest))   return 'F';
    if(/(^|_)B(_|\d|$)/.test(rest))   return 'B';
    return 'RR';                                   // unrecognised -> pool, as standingsStageKey does
  }

  function nameHTML(n, codeFallback){
    return n
      ? `<span class="fo-name">${esc(n)}</span>`
      : `<span class="fo-name unknown">${esc(codeFallback)}</span>`;
  }

  // One side of a team event's face-off: the team name, then the pair. A lineup that isn't set yet leaves the
  // player cells empty or holding the side's own code, so either reads "Lineup TBD" rather than a raw code.
  function teamSideNamesHTML(team, code, a, b){
    const unset = !a || a === code;
    return `<span class="fo-team">${esc(team)}</span>` +
      (unset ? `<span class="fo-name unknown">Lineup TBD</span>` : nameHTML(a, code) + nameHTML(b, ' '));
  }

  function cellHTML(m){
    if(!m) return `<div class="cell empty">Open</div>`;
    const cm = meta(m.cat);
    // Stage is read from team 1; both sides of a match are always the same stage. A team day's rows carry it.
    const sm = STAGE_META[teamEvent ? m.stage : ladderStageOf(m.c1)] || STAGE_META.RR;
    const live = !!m.liveCourt;
    const done = m.s1 !== null && m.s2 !== null;
    const w1 = done && m.s1 > m.s2, w2 = done && m.s2 > m.s1;

    const centre = done
      ? `<div class="fo-score"><span class="${w2?'lose':''}">${m.s1}</span><span class="sep">:</span><span class="${w1?'lose':''}">${m.s2}</span></div>`
      : `<div class="fo-vs">VS</div>`;

    return `
  <div class="cell ${m.notNeeded?'not-needed':(live?'live':(done?'done':''))}${teamEvent?' team':''}"${m.notNeeded?' title="Not needed"':''} style="--cat:${cm.color};--cat-text:${readableOn(cm.color)}">
    <div class="cell-top">
      <span class="cell-num">#${m.num}</span>
      <span class="cell-cat">${cm.short}</span>
      <span class="cell-stage${sm.playoff ? ' playoff' : ''}">${sm.label}</span>
      ${teamEvent && m.pair ? `<span class="cell-pair">${esc(m.pair)}</span>` : ''}
      ${live?`<span class="cell-live"><span class="dot"></span>Court ${esc(m.liveCourt)}</span>`:''}
    </div>
    <div class="faceoff">
      <div class="fo-side">
        ${clubOrder && !teamEvent ? `<span class="fo-club ${clubClass(m.c1)}">${esc(clubOf(m.c1))}</span>` : ''}<span class="fo-names">${teamEvent ? teamSideNamesHTML(m.team1, m.c1, m.p1a, m.p1b) : nameHTML(m.p1a, m.c1) + nameHTML(m.p1b, ' ')}</span>
      </div>
      <div class="fo-center">${centre}</div>
      <div class="fo-side right">
        ${clubOrder && !teamEvent ? `<span class="fo-club ${clubClass(m.c2)}">${esc(clubOf(m.c2))}</span>` : ''}<span class="fo-names">${teamEvent ? teamSideNamesHTML(m.team2, m.c2, m.p2a, m.p2b) : nameHTML(m.p2a, m.c2) + nameHTML(m.p2b, ' ')}</span>
      </div>
    </div>
  </div>`;
  }

  // ---------- COURT FILTER STATE ----------
  // Held in the URL (?courts=1-5 or ?courts=1,2,7) rather than only in memory, so each wall screen can be
  // bookmarked to its own range and returns to it after a refresh or power cycle with nobody touching the machine.
  let DATA = null;
  let SNAPSHOT = null;                 // last good snapshot, so switching venue needs no fetch
  let visibleCourts = null;            // Set of court numbers; null = all of DATA.courtList

  // Venue to narrow the board to, or null for every venue. Held in the URL (?venue=PCPH%20Annex) for the same
  // reason as ?courts: a screen at each venue boots straight into its own board. A name the data doesn't have
  // shows every venue, and stays in the URL until someone picks from the filter.
  let venue = new URLSearchParams(location.search).get("venue");

  // Every court this view can show: the whole day's, or one venue's.
  const allCourts = () => new Set(DATA.courtList);

  const parseCourtsParam = courtList => parseCourts(new URLSearchParams(location.search).get("courts"), courtList);

  let compact = new URLSearchParams(location.search).get("compact") === "1";

  // The sub line has two forms. Expanded carries the operator detail (slots and which courts this screen is
  // showing); collapsed keeps only what a spectator needs — the date and how many matches are on this board.
  // Both are computed in renderGrid and re-painted whenever the toggle flips.
  let subFull = "", subCompact = "";
  function paintSub(){
    const el = byId("sub");
    if(el) el.textContent = compact ? subCompact : subFull;
  }

  function syncUrl(){
    const p = DATA ? courtsToParam(visibleCourts, DATA.courtList) : null;
    const url = new URL(location.href);
    if(p) url.searchParams.set("courts", p); else url.searchParams.delete("courts");
    if(DATA && DATA.venue) url.searchParams.set("venue", DATA.venue);
    else if(DATA) url.searchParams.delete("venue");
    if(compact) url.searchParams.set("compact", "1"); else url.searchParams.delete("compact");
    history.replaceState(null, "", url);
  }

  // Collapsed state rides in the URL alongside ?courts, so a wall screen can be bookmarked to boot straight into
  // the stripped-down header.
  function applyCompact(){
    const bar = document.querySelector(".bezel");
    const btn = byId("bezelToggle");
    bar.classList.toggle("compact", compact);
    btn.setAttribute("aria-expanded", String(!compact));
    btn.title = compact ? "Show header details" : "Hide header details";
    paintSub();
  }

  byId("bezelToggle").addEventListener("click", () => {
    compact = !compact;
    applyCompact();
    syncUrl();
  });

  // ---------- EXPORT (print / PDF) ----------
  // Print rather than a canvas render: the board is far too wide for one sheet, and pagination is the whole
  // requirement. The browser already does page breaking, page size and DPI properly, and "Save as PDF" is built
  // into every print dialog. A hand-drawn canvas would mean re-implementing every cell in Canvas 2D and chunking
  // pages by hand, and that copy would drift from the CSS the moment either changed.
  function buildPrintPages(){
    const shown = [...(visibleCourts || allCourts())].sort((a, b) => a - b);

    // Two-dimensional: courts across, time slots down. Either axis alone can overflow a sheet — 9 courts is too
    // wide, a 12-hour day too tall — so both are chunked and the pages are the cross product. Courts are the
    // outer loop so one court group's whole day stays on consecutive sheets.
    const courtGroups = chunkBalanced(shown, PRINT_COURTS_PER_PAGE);
    const slotGroups  = chunkBalanced(DATA.rows, PRINT_SLOTS_PER_PAGE);

    const sheets = [];
    courtGroups.forEach(courts => {
      slotGroups.forEach(rows => sheets.push({ courts, rows }));
    });

    const courtLabel = c => c.length === 1 ? `Court ${c[0]}` : `Courts ${c[0]}–${c[c.length - 1]}`;
    // Only worth naming a time window when the day is actually split.
    const timeLabel = rows => slotGroups.length === 1
      ? "" : ` &middot; ${esc(rows[0].slot)}–${esc(rows[rows.length - 1].slot)}`;

    byId("printRoot").innerHTML = sheets.map((s, i) => `
    <section class="print-page">
      <div class="print-head">
        <div class="print-head-left">
          <span class="print-eyebrow">S.A.G.E. &middot; Match Control Experts</span>
          <span class="print-title">${titleHTML}</span>
        </div>
        <div class="print-head-right">
          <span class="print-scope">${DATA.venue ? esc(DATA.venue) + " &middot; " : ""}${courtLabel(s.courts)}${timeLabel(s.rows)}</span>
          <span class="print-meta">${esc(DATA.label)} &middot; ${DATA.matchCount} matches &middot; page ${i + 1} of ${sheets.length}</span>
        </div>
      </div>
      <div class="sched-grid print-grid" style="--cols:${s.courts.length}">${gridHTML(s.courts, s.rows)}</div>
    </section>`).join("");
  }

  byId("exportBtn").addEventListener("click", () => {
    if(!DATA) return;
    buildPrintPages();
    window.print();
  });

  // Rebuild on a print triggered outside our button (Ctrl+P, or the dialog being reopened) so the sheet always
  // reflects the current filter.
  window.addEventListener("beforeprint", () => { if(DATA) buildPrintPages(); });

  function renderVenueFilter(){
    const el = byId("venuefilter");
    el.hidden = DATA.venues.length < 2;
    if(el.hidden){ el.innerHTML = ""; return; }
    let html = `<span class="cf-label">Venue</span>`;
    html += `<button class="cf-btn all ${DATA.venue ? "" : "on"}" data-venue="">All</button>`;
    DATA.venues.forEach(v => {
      html += `<button class="cf-btn ${DATA.venue === v ? "on" : ""}" data-venue="${esc(v)}">${esc(v)}</button>`;
    });
    el.innerHTML = html;
  }

  function renderFilter(){
    const list = DATA.courtList;
    const showing = visibleCourts || allCourts();
    const allOn = showing.size === list.length;
    let html = `<span class="cf-label">Courts</span>`;
    html += `<button class="cf-btn all ${allOn ? "on" : ""}" data-all="1">All</button>`;
    list.forEach(c => {
      html += `<button class="cf-btn ${showing.has(c) ? "on" : ""}" data-court="${c}">${c}</button>`;
    });
    byId("courtfilter").innerHTML = html;
  }

  function renderGrid(){
    const list = DATA.courtList;
    const shown = [...(visibleCourts || allCourts())].sort((a, b) => a - b);
    const rows = DATA.rows;
    const grid = byId("grid");
    grid.style.setProperty("--cols", shown.length);

    // The legend keys what is actually on screen, so it follows the filter.
    const inView = m => m && shown.includes(m.court);
    const cats = [...new Set(rows.flatMap(r => r.courts.filter(inView).map(m => m.cat)))];
    const scope = shown.length === list.length
      ? "all courts"
      : "courts " + courtsToParam(new Set(shown), list);
    const where = DATA.venue ? `${DATA.venue} · ` : "";

    // Match count covers the venue this board is set to (or the whole day), not the court filter; it is the
    // scope ("courts 1-5") that says what this particular screen is showing. Counting only visible courts would
    // make the same label mean different things on the two halves of a split-screen setup. It also includes any
    // unplaced (overflow) matches, not just the ones that landed in a visible cell.
    subFull = `${DATA.label} · ${where}${DATA.matchCount} matches · ${rows.length} slots · ${scope}`;
    subCompact = `${DATA.label} · ${where}${DATA.matchCount} matches`;
    paintSub();
    byId("legend").innerHTML = cats.map(c =>
      `<span class="legend-item"><span class="legend-swatch" style="background:${meta(c).color}"></span>${meta(c).short}</span>`
    ).join("");

    grid.innerHTML = gridHTML(shown);
  }

  // Everything that depends on DATA, redrawn together. A venue with nothing published yet gets a message rather
  // than an empty grid.
  function renderBoard(){
    applyCompact();
    renderVenueFilter();
    renderFilter();
    renderGrid();
    if(DATA.matchCount === 0) showBoardMessage(`No matches at ${esc(DATA.venue)} yet.`);
    else hideBoardMessage();
  }

  // Grid markup for an arbitrary set of courts. Shared by the live board and by each printed page, so the export
  // can never drift from what is on screen — there is exactly one implementation of a cell and a row.
  function gridHTML(shown, rows = DATA.rows){
    let html = `<div class="corner"></div>`;
    shown.forEach(c => {
      html += `<div class="col-head"><span class="ch-label">Court</span><span class="ch-num">${c}</span></div>`;
    });
    rows.forEach(row => {
      // Only warn about overflow this view can actually show.
      const un = row.unplaced.filter(m => m.court == null || shown.includes(m.court));
      const warn = un.length
        ? `<span class="tc-warn" title="No free court: #${un.map(m => m.num).join(", #")}">+${un.length}</span>`
        : "";
      html += `<div class="time-cell"><span class="tc-time">${esc(row.slot)}</span>${warn}</div>`;
      shown.forEach(c => { html += cellHTML(row.courts[c - 1]); });
    });
    return html;
  }

  byId("courtfilter").addEventListener("click", e => {
    const btn = e.target.closest(".cf-btn");
    if(!btn || !DATA) return;
    if(btn.dataset.all){
      visibleCourts = null;
    } else {
      const c = +btn.dataset.court;
      const set = new Set(visibleCourts || allCourts());
      if(set.has(c)) set.delete(c); else set.add(c);
      if(set.size === 0) set.add(c);          // never leave a blank board
      visibleCourts = set.size === DATA.courtList.length ? null : set;
    }
    syncUrl(); renderFilter(); renderGrid();
  });

  byId("venuefilter").addEventListener("click", e => {
    const btn = e.target.closest(".cf-btn");
    if(!btn || !SNAPSHOT) return;
    const next = btn.dataset.venue || null;
    if(next === DATA.venue) return;
    venue = next;
    visibleCourts = null;          // one venue's court selection means nothing at another
    DATA = buildScheduleData(SNAPSHOT, venue);
    syncUrl();
    renderBoard();
    document.querySelector(".grid-wrap").scrollTop = 0;
  });

  // ============================================================================
  // LIVE DATA — CSV parsing and court assignment (spec §5)
  // ============================================================================

  function buildScheduleData(snapshot, venueName){ return buildData(snapshot, venueName, EVENT_TYPE, { pairs }); }

  function fetchDaySnapshot(){
    return Snapshot.fetchDaySnapshot(eventKey, dayKey, { liveChannel, fixture: FIXTURE });
  }

  function showBoardMessage(html){
    const grid = byId("grid");
    const msg = byId("boardMsg");
    grid.style.display = "none";
    msg.style.display = "flex";
    msg.innerHTML = html;
  }
  function hideBoardMessage(){
    byId("grid").style.display = "";
    byId("boardMsg").style.display = "none";
  }

  async function loadSchedule(isInitial){
    const wrap = document.querySelector(".grid-wrap");
    const savedScroll = wrap ? wrap.scrollTop : 0;
    try {
      const snapshot = await fetchDaySnapshot();
      const data = buildScheduleData(snapshot, venue);
      if(data.dayMatchCount === 0) throw new Error('No matches parsed from any facility');

      SNAPSHOT = snapshot;
      DATA = data;
      if(isInitial){
        visibleCourts = parseCourtsParam(DATA.courtList);
      } else if(visibleCourts){
        // Court count can't normally shrink mid-event, but never let a stale selection point past the current grid.
        const clipped = new Set([...visibleCourts].filter(c => DATA.courtList.includes(c)));
        visibleCourts = clipped.size === 0 ? null : clipped;
      }

      renderBoard();
      // Preserve scroll position across a poll-driven re-render — a wall display re-rendering on every update
      // must not visibly jump.
      if(wrap) wrap.scrollTop = savedScroll;
    } catch(err){
      // A failed poll must leave the last good board on screen — a wall display showing stale data beats one
      // showing an error. Only the very first load (nothing on screen yet) is allowed to show this message at all.
      if(DATA) return;
      const notPublishedYet = err.status === 404;
      const message = notPublishedYet
        ? `Schedule isn't published yet &mdash; check back soon.`
        : `Couldn't load the schedule (${esc(err.message)}).<button type="button" class="retry-btn" id="retryBtn">Retry</button>`;
      showBoardMessage(message);
      const retryBtn = byId("retryBtn");
      if(retryBtn) retryBtn.addEventListener("click", () => loadSchedule(true));
    }
  }

  // A team event's pair labels (MD, WD, XD 1…) are the event's, in events.json; the other types never read it.
  if(teamEvent){
    try { pairs = eventConfigFrom(await loadRegistry({ fixture: FIXTURE }), eventKey)?.pairs; }
    catch(err){ console.warn(`mountScheduleBoard: couldn't read events.json (${err.message}); using the default pair labels`); }
  }

  liveChannel.follow(eventKey, dayKey);
  loadSchedule(true);

  // Pause polling while the tab/app is backgrounded — no point spending battery and mobile data re-fetching a
  // snapshot nobody's looking at — and catch up with an immediate refresh as soon as it's visible again.
  createPoller({ onTick: () => loadSchedule(false), liveChannel }).start();
}
