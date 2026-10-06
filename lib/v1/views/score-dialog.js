// The score dialog: Enter -> Review -> Save, conflicts, and the save request. Control Center's
// Match Finder and the scorer page both open it; everything that differs between them is passed in
// (the options below), so the dialog itself knows neither page. The markup it drives is the
// <dialog> each page carries (control-center-score-entry-spec.md §5.2).

import { escapeHtml } from './html.js';

const SCORE_SAVE_TIMEOUT_MS = 120000;
const SCORE_KEY_GUARD_MS = 400;
const SCORE_SLOW_MS = 5000;

/**
 * opts:
 *   dialog            the <dialog> element (markup §5.2, the same in every page)
 *   apiBase           Cloud Run base URL
 *   getToken()        bearer token, or null
 *   fixture           string | null: when set, saves are simulated (onFixtureSave)
 *   describe(m)       -> { title, sub, sides: [side, side] },
 *                        side = { name, code, players: [p1, p2] | null, missing }  // missing: shown when players is null
 *   readOnlyReason(m) -> string | null   (non-null opens the dialog read-only with that text)
 *   extraWarnings(m)  -> string[]        (series, lineup: page-specific)
 *   findMatch(facility, num) -> the page's current copy of that match, or null
 *   notify(kind, text)                   kind: 'ok' | 'warn' | 'error'
 *   friendlyError(raw) -> string
 *   unreachable(err)  -> string
 *   expiredText       shown on a 401
 *   resyncHint        appended to the "publishing failed" message
 *   onFixtureSave(state, team1Score, team2Score)  page patches its data and redraws
 * -> { open(day, facility, m), close(), refresh(), isOpen() }
 */
export function createScoreDialog(opts){
  const dlg = opts.dialog;
  const part = id => dlg.querySelector('#' + id);
  const titleEl = part('scoreDialogTitle');
  const subEl = part('scoreDialogSub');
  const bodyEl = part('scoreDialogBody');
  const noteEl = part('scoreDialogNote');
  const errorEl = part('scoreDialogError');
  const actionsEl = part('scoreDialogActions');
  const closeBtn = part('scoreDialogClose');
  const esc = escapeHtml;
  const SLOW_TEXT = 'Still waiting on the workbook. Large workbooks can take up to a minute.';

  let s = null;          // the open match's state; null when closed
  let slowTimer = null;

  function scoreBasicWarnings(a, b){
    const hi = Math.max(a, b), out = [];
    if(a === b) out.push('Tied: neither side wins this match.');
    else if(hi < 11) out.push('Neither side reached 11.');
    else if(Math.abs(a - b) === 1) out.push('Won by 1 point.');
    if(hi > 21) out.push('Unusually high: over 21.');
    return out;
  }

  function open(day, facility, m){
    clearSlowTimer();
    s = {
      day, facility, num: m.num, m: { ...m },
      expected: { teamCode1: m.t1, teamCode2: m.t2, team1Score: m.t1Score, team2Score: m.t2Score },
      step: opts.readOnlyReason(m) ? 'readonly' : 'enter',
      t1: m.t1Score === null ? '' : String(m.t1Score),
      t2: m.t2Score === null ? '' : String(m.t2Score),
      clear: false, note: '', error: '', conflict: null, reviewShownAt: 0, saves: 0,
    };
    render();
    if(!dlg.open) dlg.showModal();
    focusStep();
  }

  function close(){
    clearSlowTimer();
    s = null;
    if(dlg.open) dlg.close();
  }

  function isOpen(){ return !!s && dlg.open; }

  function clearSlowTimer(){
    if(slowTimer !== null){ clearTimeout(slowTimer); slowTimer = null; }
  }

  // ---- drawing ----

  // A side with no name of its own (a pair, whose "name" is just its code) is led by
  // its players: they are what a scorer recognises, and the code is only a small chip.
  // A side with a real name (a team) keeps the name as its headline.
  const byPlayers = side => !!side.players && side.name === side.code;
  const sideLabel = side => byPlayers(side) ? side.players[0] + ' / ' + side.players[1] : side.name;

  function sideHTML(side, input){
    const showCode = side.code && (side.code !== side.name || byPlayers(side));
    let head, players;
    if(byPlayers(side)){
      head = `<div class="score-side-name">${esc(side.players[0])}<br>${esc(side.players[1])}</div>`;
      players = '';
    } else {
      head = `<div class="score-side-name">${esc(side.name)}</div>`;
      players = side.players
        ? `<div class="score-side-players">${esc(side.players[0])}<br>${esc(side.players[1])}</div>`
        : `<div class="score-side-players unset">${esc(side.missing || '')}</div>`;
    }
    return `<div class="score-side">
      ${head}
      ${showCode ? `<span class="score-chip">${esc(side.code)}</span>` : ''}
      ${players}
      ${input || ''}
    </div>`;
  }

  function inputHTML(n, side){
    return `<input class="score-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off"` +
           ` data-score-side="${n}" aria-label="Score for ${esc(sideLabel(side))}" value="${esc(n === 1 ? s.t1 : s.t2)}">`;
  }

  function button(label, cls, onClick, extra){
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    if(extra && extra.disabled) b.disabled = true;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderNote(){
    const text = s && s.step === 'saving' ? (s.slow ? SLOW_TEXT : '') : (s ? s.note : '');
    noteEl.textContent = text;
    noteEl.hidden = !text;
  }

  function render(){
    if(!s) return;
    const d = opts.describe(s.m);
    titleEl.textContent = d.title;
    subEl.textContent = d.sub || '';
    subEl.hidden = !d.sub;
    errorEl.textContent = s.error;
    errorEl.hidden = !s.error;
    renderNote();
    closeBtn.disabled = s.step === 'saving';
    actionsEl.textContent = '';
    const [side1, side2] = d.sides;

    if(s.step === 'readonly'){
      bodyEl.innerHTML = `<div class="score-sides">${sideHTML(side1)}${sideHTML(side2)}</div>
        <p class="score-note">${esc(opts.readOnlyReason(s.m) || '')}</p>`;
      actionsEl.append(button('Close', 'score-btn secondary', close));
      return;
    }

    if(s.step === 'enter'){
      bodyEl.innerHTML = `<div class="score-sides">${sideHTML(side1, inputHTML(1, side1))}${sideHTML(side2, inputHTML(2, side2))}</div>`;
      const inputs = bodyEl.querySelectorAll('.score-input');
      const reviewBtn = button('Review →', 'score-btn primary', () => goReview(), { disabled: !(s.t1 !== '' && s.t2 !== '') });
      const sync = () => { reviewBtn.disabled = !(s.t1 !== '' && s.t2 !== ''); };
      inputs.forEach(inp => {
        inp.addEventListener('input', () => {
          const digits = inp.value.replace(/\D/g, '').slice(0, 2);
          if(inp.value !== digits) inp.value = digits;
          if(inp.dataset.scoreSide === '1') s.t1 = digits; else s.t2 = digits;
          sync();
        });
        inp.addEventListener('keydown', (e) => {
          if(e.key !== 'Enter') return;
          e.preventDefault();
          if(inp.dataset.scoreSide === '1') inputs[1].focus();
          else if(!reviewBtn.disabled) goReview();
        });
      });
      actionsEl.append(button('Cancel', 'score-btn secondary', close));
      if(s.m.played) actionsEl.append(button('Clear score', 'score-btn secondary', () => { s.clear = true; goStep('review'); }));
      actionsEl.append(reviewBtn);
      return;
    }

    if(s.step === 'review' || s.step === 'saving'){
      const saving = s.step === 'saving';
      const a = Number(s.t1), b = Number(s.t2);
      let html;
      if(s.clear){
        const was = s.m.t1Score === null || s.m.t2Score === null ? 'no score' : `${s.m.t1Score} – ${s.m.t2Score}`;
        html = `<div class="score-winner">Clear the score of match #${esc(s.num)}</div>
          <div class="score-was">Now ${esc(was)}</div>`;
      } else {
        const extra = side => byPlayers(side) ? `<span class="score-winner-players"> · ${esc(side.code)}</span>`
          : side.players ? `<span class="score-winner-players"> · ${esc(side.players[0])} / ${esc(side.players[1])}</span>` : '';
        const headline = a === b
          ? `<div class="score-winner">Tied — neither side wins this match</div>`
          : (() => {
            const w = a > b ? side1 : side2;
            // a team: its name, then its players on their own line; a pair is led by its players
            if(!byPlayers(w) && w.players){
              return `<div class="score-winner team">Winner: ${esc(w.name)}</div>
              <div class="score-winner-names">${esc(w.players[0])} / ${esc(w.players[1])}</div>`;
            }
            return `<div class="score-winner">Winner: ${esc(sideLabel(w))}${extra(w)}</div>`;
          })();
        const warnings = scoreBasicWarnings(a, b).concat(opts.extraWarnings(s.m) || []);
        html = `${headline}
          <div class="score-big">${esc(a)} – ${esc(b)}</div>
          <div class="score-big-names"><span>${esc(sideLabel(side1))}</span><span>${esc(sideLabel(side2))}</span></div>
          ${s.m.played ? `<div class="score-was">Was ${esc(s.m.t1Score)} – ${esc(s.m.t2Score)}</div>` : ''}
          ${warnings.length ? `<ul class="score-warn">${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`;
      }
      bodyEl.innerHTML = html;
      if(saving){
        const msg = document.createElement('span');
        msg.className = 'score-saving';
        msg.textContent = 'Saving to the sheet…';
        actionsEl.append(msg);
        actionsEl.append(button('← Back', 'score-btn secondary', () => {}, { disabled: true }));
        actionsEl.append(button(s.clear ? 'Clear score' : `Save ${a}–${b} to sheet`, 'score-btn primary', () => {}, { disabled: true }));
        return;
      }
      actionsEl.append(button('← Back', 'score-btn secondary', () => goStep('enter')));
      actionsEl.append(button(s.clear ? 'Clear score' : `Save ${a}–${b} to sheet`, 'score-btn primary', save));
      return;
    }

    if(s.step === 'conflict'){
      const c = s.conflict, e = s.expected;
      const codesChanged = c.teamCode1 !== e.teamCode1 || c.teamCode2 !== e.teamCode2;
      if(codesChanged){
        bodyEl.innerHTML = `<p class="score-conflict">This match number now belongs to ${esc(c.teamCode1)} v ${esc(c.teamCode2)}. Close it and open the match again.</p>`;
        actionsEl.append(button('Close', 'score-btn primary', close));
        return;
      }
      const now = c.team1Score === null && c.team2Score === null
        ? 'no score'
        : `${esc(c.teamCode1)} ${c.team1Score === null ? '–' : esc(c.team1Score)} – ${c.team2Score === null ? '–' : esc(c.team2Score)} ${esc(c.teamCode2)}`;
      const mine = s.clear ? 'clear the score' : `${esc(e.teamCode1)} ${esc(s.t1)} – ${esc(s.t2)} ${esc(e.teamCode2)}`;
      bodyEl.innerHTML = `<p class="score-conflict">The sheet changed since you opened this match.</p>
        <p class="score-conflict-row"><span>It now reads:</span> <b>${now}</b></p>
        <p class="score-conflict-row"><span>You entered:</span> <b>${mine}</b></p>`;
      actionsEl.append(button('Keep the sheet’s score', 'score-btn secondary', () => {
        const num = s.num;
        close();
        opts.notify('ok', `Match #${num} left as the sheet has it.`);
      }));
      actionsEl.append(button('Replace with yours', 'score-btn primary', () => {
        s.expected = { ...s.conflict };
        s.conflict = null;
        save();
      }));
    }
  }

  // Where the cursor goes when a step is first shown (never on a redraw of the same step).
  function focusStep(){
    if(!s) return;
    if(s.step === 'enter'){
      const first = bodyEl.querySelector('.score-input');
      if(first){ first.focus(); first.select(); }
    } else {
      const primary = actionsEl.querySelector('.score-btn.primary:not(:disabled)') || actionsEl.querySelector('.score-btn:not(:disabled)');
      if(primary) primary.focus();
    }
  }

  function goStep(step){
    s.step = step;
    s.error = '';
    if(step === 'review') s.reviewShownAt = performance.now();
    render();
    focusStep();
  }

  function goReview(){
    if(!s || s.t1 === '' || s.t2 === '') return;
    s.clear = false;
    goStep('review');
  }

  // ---- saving ----

  async function save(){
    const mine = s;
    const team1Score = s.clear ? null : Number(s.t1);
    const team2Score = s.clear ? null : Number(s.t2);
    mine.sent = { a: team1Score, b: team2Score };
    s.step = 'saving'; s.error = ''; s.slow = false; render();
    clearSlowTimer();
    slowTimer = setTimeout(() => {
      slowTimer = null;
      if(s === mine && s.step === 'saving'){ s.slow = true; renderNote(); }
    }, SCORE_SLOW_MS);
    if(opts.fixture) return fixtureSave(mine, team1Score, team2Score);
    const token = opts.getToken();
    if(!token) return failed(mine, opts.expiredText);
    const url = `${opts.apiBase}/v3/days/${encodeURIComponent(s.day)}/facilities/` +
                `${encodeURIComponent(s.facility)}/matches/${s.num}/score`;
    let res, json = null;
    try {
      res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ team1Score, team2Score, expected: s.expected }),
        signal: AbortSignal.timeout(SCORE_SAVE_TIMEOUT_MS),
      });
      json = await res.json().catch(() => null);
    } catch(err){
      if(s !== mine) return;
      return failed(mine, err && err.name === 'TimeoutError'
        ? 'No answer after 2 minutes. The score may or may not be in the sheet: Save again is safe.'
        : opts.unreachable(err));
    }
    if(s !== mine) return;   // closed meanwhile
    handle(mine, res.status, json);
  }

  // Back to Review with the reason shown; Save is enabled again.
  function failed(st, text){
    if(s !== st) return;
    clearSlowTimer();
    st.step = 'review';
    st.error = text;
    render();
    focusStep();
  }

  function handle(st, status, json){
    if(s !== st) return;
    clearSlowTimer();
    const num = st.num, e = st.expected;
    const a = st.sent.a, b = st.sent.b;
    if(status === 200 && json){
      const sync = json.sync || { ok: false, error: 'no answer from the publisher' };
      if(!sync.ok){
        close();
        opts.notify('warn', `Match #${num} is in the sheet, but publishing failed: ${opts.friendlyError(sync.error)}. ${opts.resyncHint}`);
      } else if(json.unchanged){
        close();
        opts.notify('ok', a === null ? `Match #${num} already had no score in the sheet.` : `Match #${num} already read ${a}–${b} in the sheet.`);
      } else {
        close();
        opts.notify('ok', a === null ? `Match #${num}’s score cleared.` : `Match #${num} saved: ${e.teamCode1} ${a}–${b} ${e.teamCode2}.`);
      }
      return;
    }
    if(status === 409 && json && json.current){
      st.conflict = json.current;
      st.step = 'conflict';
      render();
      focusStep();
      return;
    }
    if(status === 401) return failed(st, opts.expiredText);
    failed(st, opts.friendlyError((json && json.error) || `HTTP ${status}`));
  }

  async function fixtureSave(st, a, b){
    await new Promise(r => setTimeout(r, 700));
    if(s !== st) return;
    if(new URLSearchParams(location.search).get('scoreConflict') === '1' && st.saves === 0){
      st.saves++;
      return handle(st, 409, { error: 'conflict', current: { ...st.expected, team1Score: 11, team2Score: 9 } });
    }
    opts.onFixtureSave(st, a, b);
    close();
    opts.notify('ok', 'Fixture: not sent. The next poll restores the fixture’s scores.');
  }

  // ---- a new snapshot while the dialog is open ----

  function refresh(){
    if(!s || !['enter', 'review'].includes(s.step)) return;
    const now = opts.findMatch(s.facility, s.num);
    const e = s.expected;
    let note = '';
    if(!now) note = 'This match is no longer in the published schedule.';
    else if(now.t1 !== e.teamCode1 || now.t2 !== e.teamCode2) note = `This match number now shows ${now.t1} v ${now.t2}.`;
    else if(now.t1Score !== e.team1Score || now.t2Score !== e.team2Score)
      note = now.played ? `The sheet now reads ${now.t1Score}–${now.t2Score}.` : 'The sheet’s score for this match was cleared.';
    if(note !== s.note){ s.note = note; renderNote(); }   // only the note, never the inputs
  }

  // ---- dialog plumbing ----

  // A second Enter or space landing on Review moments after it appears (a fast
  // double Enter from the last input) must not press Save.
  function guardKey(e){
    if(!s || s.step !== 'review') return;
    if(performance.now() - s.reviewShownAt >= SCORE_KEY_GUARD_MS) return;
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); e.stopPropagation(); }
  }
  dlg.addEventListener('keydown', guardKey, true);
  dlg.addEventListener('keyup', guardKey, true);

  // Esc closes, except while a save is in flight.
  dlg.addEventListener('cancel', (e) => { if(s && s.step === 'saving') e.preventDefault(); });
  // Only when it really is closed: a close() followed at once by an open() leaves
  // this event queued, and it must not wipe the new match.
  dlg.addEventListener('close', () => { if(!dlg.open){ clearSlowTimer(); s = null; } });
  closeBtn.addEventListener('click', () => { if(!s || s.step !== 'saving') close(); });

  return { open, close, refresh, isOpen };
}
