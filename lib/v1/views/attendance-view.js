// The staff check-in list: reads each facility workbook's ATTENDANCE tab (published CSV export, polled)
// and marks people through sage-tools-api. Control Center's Attendance tab and the per-event desk page
// both use it; everything that differs between them is passed to createAttendanceView. Its stylesheet is
// lib/v1/css/attendance.css.

import { attClockTime, parseAttendanceCsv, groupForDesk } from '../domain/attendance.js';

export function attendanceCsvUrl(sheetId){
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&headers=1&sheet=ATTENDANCE`;
}

// PUT one person's check-in. Rejects with Error(body.error || "HTTP <status>")
// and err.status; a fetch that never got an answer rejects with no status.
export async function markPerson({ apiBase, token, day, facility, key, present }){
  const url = `${apiBase}/v3/days/${encodeURIComponent(day)}/facilities/${encodeURIComponent(facility)}/people/${encodeURIComponent(key)}/attendance`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ present }),
  });
  let body = null;
  try{ body = await res.json(); }catch(e){ /* not JSON */ }
  if(!res.ok){
    const err = new Error((body && typeof body.error === 'string' && body.error) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}


// The attendance UI. Renders into `root`; returns { refresh(), destroy(), setShowWithdrawn(v) }.
//   mode        'console' (Control Center: loads every facility, so counts are complete) | 'desk'
//   apiBase     sage-tools-api's base URL
//   getToken    () => bearer token, or null when not signed in (switches stay disabled)
//   event, day  the event key and the day key
//   facilities  [{ name, sheetId }]
//   type        'dual-meet' | 'standard' | 'team'
//   teamName    code => string | null           (team events)
//   categoryLabel code => string                (standard / dual meet)
//   notify      optional (kind, text) => void   messages go here when given, else to the status line
//   onData      optional (facilities) => void   [{ name, people, loaded }] after every load and mark
//   showWithdrawn  optional initial value
//   pollMs      how often the lists are re-read (ATTENDANCE_POLL_MS in lib/v1/platform.js)
//   fixture     a fixture name (localhost only): read /_fixtures/<event>/attendance-<facility>-<fixture>.csv
//               and mark in memory; add ?attfail to the page URL and the first mark fails.
export function createAttendanceView(opts){
  const root = opts.root;
  const facilities = (opts.facilities || []).filter(f => f && f.name && f.sheetId);
  const isTeam = opts.type === 'team';
  const fixture = opts.fixture || null;
  const venueKey = `sage.attendance.venue.${opts.day}`;
  const filterKey = `sage.attendance.filter.${opts.day}`;

  const store = {
    get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
    set(k, v){ try{ localStorage.setItem(k, v); }catch(e){} },
    del(k){ try{ localStorage.removeItem(k); }catch(e){} },
  };

  const st = {
    venue: (facilities.find(f => f.name === store.get(venueKey)) || facilities[0] || {}).name || null,
    filter: store.get(filterKey) || 'all',
    search: '',
    showWithdrawn: !!opts.showWithdrawn,
    data: new Map(facilities.map(f => [f.name, { people: [], loaded: false }])),
    saving: new Set(),
    loadSeq: 0,
    loadMsg: null, markMsg: null,
    destroyed: false,
    failOnce: !!fixture && new URLSearchParams(location.search).has('attfail'),
    focusKey: null,
  };

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if(cls) e.className = cls;
    if(text !== undefined) e.textContent = text;
    return e;
  };

  // ---- skeleton: built once, so typing in the search box never loses focus ----
  root.textContent = '';
  const box = el('div', 'att-root');
  const venuesEl = el('div', 'att-venues');
  const bar = el('div', 'att-bar');
  const searchEl = el('input');
  searchEl.type = 'search';
  searchEl.placeholder = 'Search a name, team or shirt size';
  searchEl.autocomplete = 'off';
  searchEl.setAttribute('aria-label', 'Search a name, team or shirt size');
  const refreshBtn = el('button', '', 'Refresh');
  refreshBtn.type = 'button';
  bar.append(searchEl, refreshBtn);
  const countEl = el('div', 'att-count');
  const catbar = el('div', 'att-catbar');
  const catrow = el('div', 'att-catrow');
  const chipsEl = el('div', 'att-chips');
  const jumpEl = el('select', 'att-jump');
  jumpEl.setAttribute('aria-label', 'Jump to a section');
  catrow.append(chipsEl, jumpEl);
  const statusEl = el('div', 'att-status');
  statusEl.setAttribute('role', 'status');
  catbar.append(catrow, statusEl);
  const listEl = el('div', 'att-list');
  box.append(venuesEl, bar, countEl, catbar, listEl);
  root.append(box);

  // ---- helpers ----
  const rec = () => st.data.get(st.venue) || { people: [], loaded: false };
  const canMark = () => !!fixture || !!(opts.getToken && opts.getToken());
  const findPerson = (facility, key) => (st.data.get(facility) || { people: [] }).people.find(p => p.key === key);
  const stamp = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  function groups(){
    return groupForDesk(rec().people, {
      type: opts.type, teamName: opts.teamName, categoryLabel: opts.categoryLabel, showWithdrawn: st.showWithdrawn,
    });
  }
  const tally = people => {
    const unique = new Map();
    people.forEach(p => unique.set(p.key, p));
    const list = [...unique.values()];
    return { present: list.filter(p => p.present).length, total: list.length };
  };
  const sectionPeople = sec => sec.cards.flatMap(c => c.players);

  function matches(card){
    const q = st.search.trim().toLowerCase();
    if(!q) return true;
    return String(card.teamCode).toLowerCase().includes(q) ||
      card.players.some(p => p.player.toLowerCase().includes(q) || (p.shirt || '').toLowerCase() === q);
  }

  // ---- messages ----
  function say(kind, text, source){
    // A host that wants messages as toasts gets only the ones worth a toast: an
    // in-progress "Loading…" would never be replaced, and a success says nothing.
    if(opts.notify){ if(text && kind !== 'loading') opts.notify(kind, text); return; }
    st[source] = text ? { kind, text } : null;
    renderStatus();
  }
  function renderStatus(){
    const m = st.markMsg || st.loadMsg;
    statusEl.textContent = m ? m.text : '';
    statusEl.classList.toggle('att-error', !!m && m.kind === 'error');
  }

  // ---- rendering ----
  function renderVenues(){
    venuesEl.textContent = '';
    venuesEl.style.display = facilities.length > 1 ? '' : 'none';
    facilities.forEach(f => {
      const b = el('button', '', f.name);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(f.name === st.venue));
      b.addEventListener('click', () => {
        if(f.name === st.venue) return;
        st.venue = f.name;
        store.set(venueKey, f.name);
        render();
        load();
      });
      venuesEl.append(b);
    });
  }

  function playerRow(facility, card, p){
    const k = `${facility}|${p.key}`;
    const saving = st.saving.has(k);
    const row = el('label', 'att-player' + (p.present ? ' att-in' : ''));
    const who = el('span', 'att-who');
    const name = el('span', 'att-name', p.player);
    if(p.shirt) name.append(el('span', 'att-shirt', p.shirt));
    if(p.withdrawn) name.append(el('span', 'att-tag', 'Withdrawn'));
    who.append(name);
    const time = saving ? 'Saving…' : (p.present && p.timeIn ? `In ${attClockTime(p.timeIn)}` : '');
    if(time) who.append(el('span', 'att-time', time));
    const sw = el('input', 'att-switch');
    sw.type = 'checkbox';
    sw.setAttribute('role', 'switch');
    sw.checked = p.present;
    sw.disabled = saving || !canMark();
    sw.dataset.k = p.key;
    sw.setAttribute('aria-label', `${p.player} present`);
    sw.addEventListener('change', () => { st.focusKey = p.key; toggle(facility, p.key, sw.checked); });
    row.append(who, sw);
    return row;
  }

  function render(){
    renderVenues();
    const r = rec();
    const live = r.people.filter(p => !p.withdrawn);
    const t = tally(live);
    countEl.textContent = live.length ? `${t.present} / ${t.total} in` : '';

    const secs = groups();
    if(st.filter !== 'all' && !secs.some(s => s.id === st.filter)){
      st.filter = 'all';
      store.del(filterKey);
    }
    renderChips(secs);

    listEl.textContent = '';
    if(!facilities.length){
      listEl.append(el('p', 'att-empty', 'No facility on this day has a workbook yet.'));
    }else if(!r.loaded){
      listEl.append(el('p', 'att-empty', 'Loading…'));
    }else if(r.people.length === 0){
      listEl.append(el('p', 'att-empty', 'No roster yet — the operator runs Update roster in Control Center.'));
    }else if(secs.length === 0){
      listEl.append(el('p', 'att-empty', 'No one to show. Everyone on this roster is withdrawn.'));
    }else{
      let shown = 0;
      secs.forEach((sec, n) => {
        if(st.filter !== 'all' && sec.id !== st.filter) return;
        const cards = sec.cards.filter(matches);
        if(!cards.length) return;
        shown++;
        const section = el('section', 'att-sec');
        const h = el('h2', '', sec.label);
        h.id = `att-sec-${n}`;
        const tl = tally(sectionPeople(sec));
        h.append(el('span', '', `${tl.present} / ${tl.total}`));
        section.append(h);
        cards.forEach(card => {
          const ready = card.players.length > 0 && card.players.every(p => p.present);
          const pair = el('div', 'att-pair' + (ready ? ' att-ready' : ''));
          const headText = isTeam ? '' : card.teamCode;
          if(headText || ready){
            const head = el('div', 'att-pair-head', headText);
            if(ready) head.append(el('span', 'att-badge', 'Ready'));
            pair.append(head);
          }
          card.players.forEach(p => pair.append(playerRow(st.venue, card, p)));
          section.append(pair);
        });
        listEl.append(section);
      });
      if(!shown) listEl.append(el('p', 'att-empty', 'No one matches that search.'));
    }

    if(st.focusKey){
      const sw = listEl.querySelector(`.att-switch[data-k="${CSS.escape(st.focusKey)}"]:not(:disabled)`);
      if(sw){ sw.focus({ preventScroll: true }); st.focusKey = null; }
    }
    renderStatus();
    if(opts.onData){
      opts.onData(facilities.map(f => ({ name: f.name, people: st.data.get(f.name).people, loaded: st.data.get(f.name).loaded })));
    }
  }

  function renderChips(secs){
    chipsEl.textContent = '';
    const q = st.search.trim().toLowerCase();
    const chip = (id, label, tl, dim) => {
      const b = el('button', 'att-chip' + (dim ? ' att-dim' : ''), `${label} ${tl.present}/${tl.total}`);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(st.filter === id));
      b.addEventListener('click', () => {
        st.filter = id;
        if(id === 'all') store.del(filterKey); else store.set(filterKey, id);
        render();
      });
      chipsEl.append(b);
    };
    chip('all', 'All', tally(secs.flatMap(sectionPeople)), false);
    secs.forEach(sec => chip(sec.id, sec.label, tally(sectionPeople(sec)), !!q && !sec.cards.some(matches)));

    jumpEl.textContent = '';
    jumpEl.style.display = st.filter === 'all' && secs.length > 1 ? '' : 'none';
    const first = el('option', '', 'Jump to…');
    first.value = '';
    jumpEl.append(first);
    secs.forEach((sec, n) => {
      const o = el('option', '', sec.label);
      o.value = String(n);
      jumpEl.append(o);
    });
  }

  // ---- loading ----
  async function fetchFacility(f){
    const url = fixture
      ? `/_fixtures/${encodeURIComponent(opts.event)}/attendance-${encodeURIComponent(f.name.toLowerCase().replace(/\s+/g, '-'))}-${encodeURIComponent(fixture)}.csv`
      : `${attendanceCsvUrl(f.sheetId)}&_=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    // No ATTENDANCE tab yet: Google answers an error page. That is "no roster", not a failure.
    if(res.status === 400 || res.status === 404) return [];
    if(!res.ok) throw new Error(`The attendance sheet replied ${res.status}.`);
    return parseAttendanceCsv(await res.text());
  }

  async function load(quiet){
    if(st.destroyed) return;
    const seq = ++st.loadSeq;
    const targets = opts.mode === 'console' ? facilities : facilities.filter(f => f.name === st.venue);
    if(!targets.length){ render(); return; }
    if(!quiet) say('loading', 'Loading…', 'loadMsg');
    const results = await Promise.all(targets.map(f => fetchFacility(f).then(people => ({ f, people }), error => ({ f, error }))));
    if(st.destroyed || seq !== st.loadSeq) return;       // a newer load started: drop this reply
    const failures = [];
    results.forEach(({ f, people, error }) => {
      if(error){ failures.push(`Could not load ${f.name}: ${error.message}`); return; }
      const slot = st.data.get(f.name);
      // Someone this device is still saving keeps their local state: the sheet may not have the change yet.
      const old = new Map(slot.people.map(p => [p.key, p]));
      people.forEach(p => {
        const mine = st.saving.has(`${f.name}|${p.key}`) && old.get(p.key);
        if(mine){ p.present = mine.present; p.timeIn = mine.timeIn; }
      });
      slot.people = people;
      slot.loaded = true;
    });
    if(failures.length) say('error', failures.join(' '), 'loadMsg');
    else say('ok', '', 'loadMsg');
    render();
  }

  // ---- marking ----
  async function doMark(facility, key, present){
    if(fixture){
      if(st.failOnce){ st.failOnce = false; throw Object.assign(new Error('Simulated failure (fixture)'), { status: 500 }); }
      const p = findPerson(facility, key);
      return { key, player: p ? p.player : key, present, timeIn: present ? stamp(new Date()) : '', withdrawn: p ? p.withdrawn : false };
    }
    return markPerson({ apiBase: opts.apiBase, token: opts.getToken && opts.getToken(), day: opts.day, facility, key, present });
  }

  function markFailure(err, player){
    let text;
    if(err.status === undefined) text = "Couldn't reach the server. Check this device's connection.";
    else text = String(err.message || '').startsWith('{') ? `HTTP ${err.status}` : err.message;
    if(err.status === 403) text += ' Ask the operator for a new desk link.';
    if(err.status === 401) text += opts.mode === 'console' ? ' Sign in again.' : ' This desk link has expired.';
    return `Not saved (${player}): ${text}`;
  }

  async function toggle(facility, key, want){
    const person = findPerson(facility, key);
    if(!person) return;
    const before = { present: person.present, timeIn: person.timeIn };
    const k = `${facility}|${key}`;
    person.present = want;
    if(!want) person.timeIn = '';
    st.saving.add(k);
    render();
    let ok = false;
    try{
      const res = await doMark(facility, key, want);
      const p = findPerson(facility, key);                 // a poll may have replaced the object meanwhile
      if(p){ p.present = !!res.present; p.timeIn = res.timeIn || ''; }
      say('ok', '', 'markMsg');
      ok = true;
    }catch(err){
      const p = findPerson(facility, key);
      if(p){ p.present = before.present; p.timeIn = before.timeIn; }
      say('error', markFailure(err, person.player), 'markMsg');
    }finally{
      st.saving.delete(k);
      render();
    }
    if(ok && !fixture) load(true);                          // see the other devices' marks straight away
  }

  // ---- events ----
  searchEl.addEventListener('input', () => { st.search = searchEl.value; render(); });
  refreshBtn.addEventListener('click', () => { st.markMsg = null; load(); });
  jumpEl.addEventListener('change', () => {
    const target = document.getElementById(`att-sec-${jumpEl.value}`);
    jumpEl.value = '';
    if(!target) return;
    target.style.scrollMarginTop = `${catbar.offsetHeight + 8}px`;
    target.scrollIntoView({ block: 'start' });
  });
  const onVisible = () => { if(!document.hidden && !fixture) load(true); };
  document.addEventListener('visibilitychange', onVisible);
  const timer = fixture ? null : setInterval(() => { if(!document.hidden) load(true); }, opts.pollMs);

  render();
  load();

  return {
    refresh: () => load(),
    setShowWithdrawn(v){ st.showWithdrawn = !!v; render(); },
    destroy(){
      st.destroyed = true;
      if(timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      root.textContent = '';
    },
  };
}
