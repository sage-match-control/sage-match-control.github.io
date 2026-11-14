// The court dialog: Pick -> Review -> Save, conflicts, and the save request. Control Center's Live Matches
// opens it from a court's cell ("✎ Set match" / "✎ Change"). It is the score dialog's sibling (views/score-dialog.js):
// the same structure, slow timer, key guard and plumbing, with everything that differs between pages passed
// in (the options below). The markup it drives is the <dialog> tools/control-center.html carries
// (control-center-court-control-spec.md §5.4 and §6.1). The rules it shows are domain/courts.js's.

import { escapeHtml } from './html.js';
import { matchOnCourt, courtSuggestions, courtPickError, courtWarnings, clearWarnings } from '../domain/courts.js';

const COURT_SAVE_TIMEOUT_MS = 120000;
const COURT_KEY_GUARD_MS = 400;
const COURT_SLOW_MS = 5000;

/**
 * opts:
 *   dialog              the <dialog> element
 *   apiBase             Cloud Run base URL
 *   getToken()          bearer token, or null
 *   fixture             string | null: when set, saves are simulated (onFixtureSave)
 *   matchesFor(facility) -> that facility's matches now (objects with .facility)
 *   dayMatches()        -> every match of the day now
 *   eventType()         -> 'standard' | 'dual-meet' | 'team'
 *   describe(m)         -> { sub, sides: [{ name, code, players }, …] }   (the score dialog's describe)
 *   multiFacility()     -> boolean
 *   notify(kind, text)  kind: 'ok' | 'warn' | 'error'
 *   friendlyError(raw) -> string
 *   unreachable(err)    -> string
 *   expiredText         shown on a 401
 *   resyncHint          appended to the "publishing failed" message
 *   onFixtureSave(state, matchNumber|null)   page patches its data and redraws
 * -> { open(day, facility, court), close(), refresh(), isOpen() }
 */
export function createCourtDialog(opts){
  const dlg = opts.dialog;
  const part = id => dlg.querySelector('#' + id);
  const titleEl = part('courtDialogTitle');
  const subEl = part('courtDialogSub');
  const bodyEl = part('courtDialogBody');
  const noteEl = part('courtDialogNote');
  const errorEl = part('courtDialogError');
  const actionsEl = part('courtDialogActions');
  const closeBtn = part('courtDialogClose');
  const esc = escapeHtml;
  const SLOW_TEXT = 'Still waiting on the workbook. Large workbooks can take up to a minute.';

  let s = null;          // the open court's state; null when closed
  let slowTimer = null;

  function open(day, facility, court){
    clearSlowTimer();
    court = String(court);
    const current = matchOnCourt(opts.matchesFor(facility), court);
    s = {
      day, facility, court, current,
      expected: current ? current.num : null,
      step: 'pick', choice: null, typed: '', clear: false,
      note: '', error: '', conflict: null, reviewShownAt: 0, saves: 0,
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

  // ---- how a match reads ----

  // A pair is led by its players ("Ann / Bo"), a team by its name; a pair with no players yet is undecided.
  function sideText(side){
    if(side.name === side.code) return side.players ? side.players.join(' / ') : 'To be decided';
    return side.name;
  }
  const matchText = m => { const [a, b] = opts.describe(m).sides; return `${sideText(a)} v ${sideText(b)}`; };
  const metaText = m => `#${m.num} · ${m.time || 'no time'} · ${m.court || 'no court'}`;
  const matchByNum = n => opts.matchesFor(s.facility).find(x => x.num === n) || null;

  // ---- drawing ----

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

  function putLabel(){ return s.clear ? `Clear Court ${s.court}` : `Put #${s.choice} on Court ${s.court}`; }

  function render(){
    if(!s) return;
    titleEl.textContent = `Court ${s.court}` + (opts.multiFacility() ? ` · ${s.facility}` : '');
    subEl.textContent = s.current ? `Now: #${s.current.num} · ${matchText(s.current)}` : 'Now: no match';
    subEl.hidden = false;
    errorEl.textContent = s.error;
    errorEl.hidden = !s.error;
    renderNote();
    closeBtn.disabled = s.step === 'saving';
    actionsEl.textContent = '';

    if(s.step === 'pick') return renderPick();

    if(s.step === 'review' || s.step === 'saving'){
      const saving = s.step === 'saving';
      const m = s.clear ? null : matchByNum(s.choice);
      let html;
      if(s.clear){
        html = `<div class="score-winner">Clear Court ${esc(s.court)}</div>
          <div class="score-was">Now #${esc(s.current.num)} · ${esc(matchText(s.current))}</div>`;
        const warnings = clearWarnings(s.current);
        if(warnings.length) html += `<ul class="score-warn">${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`;
      } else if(m){
        const sub = opts.describe(m).sub;
        const warnings = courtWarnings({ m, court: s.court, current: s.current, dayMatches: opts.dayMatches(), type: opts.eventType() });
        html = `<div class="score-winner">Put #${esc(m.num)} on Court ${esc(s.court)}</div>
          <div class="score-was">${esc(metaText(m))}${sub ? '<br>' + esc(sub) : ''}</div>
          <div class="court-review-match">${esc(matchText(m))}</div>
          ${s.current ? `<div class="score-was">Replaces #${esc(s.current.num)}</div>` : ''}
          ${warnings.length ? `<ul class="score-warn">${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`;
      } else {
        html = `<p class="score-conflict">Match #${esc(s.choice)} is no longer in the published schedule. Go back and pick again.</p>`;
      }
      bodyEl.innerHTML = html;
      const canSave = s.clear || !!m;
      if(saving){
        const msg = document.createElement('span');
        msg.className = 'score-saving';
        msg.textContent = 'Saving to the sheet…';
        actionsEl.append(msg);
        actionsEl.append(button('← Back', 'score-btn secondary', () => {}, { disabled: true }));
        actionsEl.append(button(putLabel(), 'score-btn primary', () => {}, { disabled: true }));
        return;
      }
      actionsEl.append(button('← Back', 'score-btn secondary', () => goStep('pick')));
      actionsEl.append(button(putLabel(), 'score-btn primary', save, { disabled: !canSave }));
      return;
    }

    if(s.step === 'conflict'){
      const c = s.conflict.matchNumber;
      const mine = s.clear ? 'clear the court' : `#${s.choice}`;
      bodyEl.innerHTML = `<p class="score-conflict">The sheet changed since you opened this court.</p>
        <p class="score-conflict-row"><span>It now reads:</span> <b>${c === null ? 'no match' : '#' + esc(c)}</b></p>
        <p class="score-conflict-row"><span>You chose:</span> <b>${esc(mine)}</b></p>`;
      actionsEl.append(button('Keep the sheet’s', 'score-btn secondary', () => {
        const court = s.court;
        close();
        opts.notify('ok', `Court ${court} left as the sheet has it.`);
      }));
      actionsEl.append(button('Replace with yours', 'score-btn primary', () => {
        s.expected = s.conflict.matchNumber;
        s.conflict = null;
        save();
      }));
    }
  }

  // The pick step. Typing and choosing change this step's parts in place, never redraw it, so the
  // input keeps its cursor while the options, the error and the Review button follow.
  function renderPick(){
    const suggestions = courtSuggestions(opts.matchesFor(s.facility), s.court);
    const optionHTML = m => `<button type="button" class="court-option" data-court-pick="${esc(m.num)}" aria-pressed="${s.choice === m.num && s.typed === '' ? 'true' : 'false'}">
        <span class="court-option-meta">${esc(metaText(m))}</span>
        <span class="court-option-sub">${esc(opts.describe(m).sub || '')}</span>
        <span class="court-option-text">${esc(matchText(m))}</span>
      </button>`;
    bodyEl.innerHTML = `<div class="court-suggest-label">Next up</div>
      ${suggestions.length ? suggestions.map(optionHTML).join('') : '<p class="score-note">No unplayed match is waiting at this venue.</p>'}
      <label class="court-type-label" for="courtTypeInput">Or type a match number</label>
      <input id="courtTypeInput" class="court-type-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" autocomplete="off" value="${esc(s.typed)}">`;
    const input = bodyEl.querySelector('#courtTypeInput');
    const options = Array.from(bodyEl.querySelectorAll('.court-option'));

    actionsEl.append(button('Cancel', 'score-btn secondary', close));
    if(s.current) actionsEl.append(button('Clear court', 'score-btn secondary', () => { s.clear = true; goStep('review'); }));
    const reviewBtn = button('Review →', 'score-btn primary', () => goReview(), { disabled: true });
    actionsEl.append(reviewBtn);

    const sync = () => {
      const err = s.choice === null ? null : courtPickError(s.choice, opts.matchesFor(s.facility), s.court);
      s.error = err || '';
      errorEl.textContent = s.error;
      errorEl.hidden = !s.error;
      reviewBtn.disabled = s.choice === null || !!err;
      options.forEach(o => o.setAttribute('aria-pressed', s.typed === '' && s.choice === Number(o.dataset.courtPick) ? 'true' : 'false'));
    };
    options.forEach(o => o.addEventListener('click', () => {
      s.choice = Number(o.dataset.courtPick);
      s.typed = '';
      input.value = '';
      sync();
    }));
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '').slice(0, 5);
      if(input.value !== digits) input.value = digits;
      s.typed = digits;
      s.choice = digits === '' ? null : Number(digits);
      sync();
    });
    input.addEventListener('keydown', (e) => {
      if(e.key !== 'Enter') return;
      e.preventDefault();
      if(!reviewBtn.disabled) goReview();
    });
    sync();
  }

  // Where the cursor goes when a step is first shown (never on a redraw of the same step).
  function focusStep(){
    if(!s) return;
    if(s.step === 'pick'){
      const first = bodyEl.querySelector('.court-option') || bodyEl.querySelector('.court-type-input');
      if(first) first.focus();
    } else {
      const primary = actionsEl.querySelector('.score-btn.primary:not(:disabled)') || actionsEl.querySelector('.score-btn:not(:disabled)');
      if(primary) primary.focus();
    }
  }

  function goStep(step){
    s.step = step;
    s.error = '';
    if(step === 'pick') s.clear = false;
    if(step === 'review') s.reviewShownAt = performance.now();
    render();
    focusStep();
  }

  function goReview(){
    if(!s || s.choice === null) return;
    s.clear = false;
    goStep('review');
  }

  // ---- saving ----

  async function save(){
    const mine = s;
    const matchNumber = s.clear ? null : s.choice;
    mine.sent = matchNumber;
    s.step = 'saving'; s.error = ''; s.slow = false; render();
    clearSlowTimer();
    slowTimer = setTimeout(() => {
      slowTimer = null;
      if(s === mine && s.step === 'saving'){ s.slow = true; renderNote(); }
    }, COURT_SLOW_MS);
    if(opts.fixture) return fixtureSave(mine, matchNumber);
    const token = opts.getToken();
    if(!token) return failed(mine, opts.expiredText);
    const url = `${opts.apiBase}/v3/days/${encodeURIComponent(s.day)}/facilities/` +
                `${encodeURIComponent(s.facility)}/courts/${encodeURIComponent(s.court)}/match`;
    let res, json = null;
    try {
      res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ matchNumber, expected: { matchNumber: s.expected } }),
        signal: AbortSignal.timeout(COURT_SAVE_TIMEOUT_MS),
      });
      json = await res.json().catch(() => null);
    } catch(err){
      if(s !== mine) return;
      return failed(mine, err && err.name === 'TimeoutError'
        ? 'No answer after 2 minutes. The court may or may not be set in the sheet: Save again is safe.'
        : opts.unreachable(err));
    }
    if(s !== mine) return;   // closed meanwhile
    handle(mine, res.status, json);
  }

  // Back to Review with the reason shown; the button is enabled again.
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
    const court = st.court, n = st.sent;
    if(status === 200 && json){
      const sync = json.sync || { ok: false, error: 'no answer from the publisher' };
      close();
      if(!sync.ok) opts.notify('warn', `Court ${court} is set in the sheet, but publishing failed: ${opts.friendlyError(sync.error)}. ${opts.resyncHint}`);
      else if(json.unchanged) opts.notify('ok', n === null ? `Court ${court} was already clear.` : `Court ${court} already had #${n}.`);
      else opts.notify('ok', n === null ? `Court ${court} cleared.` : `#${n} is on Court ${court}.`);
      return;
    }
    if(status === 409 && json && json.code === 'court_conflict' && json.current){
      st.conflict = json.current;
      st.step = 'conflict';
      render();
      focusStep();
      return;
    }
    if(status === 401) return failed(st, opts.expiredText);
    failed(st, opts.friendlyError((json && json.error) || `HTTP ${status}`));
  }

  async function fixtureSave(st, matchNumber){
    await new Promise(r => setTimeout(r, 700));
    if(s !== st) return;
    if(new URLSearchParams(location.search).get('courtConflict') === '1' && st.saves === 0){
      st.saves++;
      return handle(st, 409, { error: 'conflict', code: 'court_conflict', current: { matchNumber: 99 } });
    }
    opts.onFixtureSave(st, matchNumber);
    close();
    opts.notify('ok', 'Fixture: not sent. The next poll restores the fixture’s courts.');
  }

  // ---- a new snapshot while the dialog is open ----

  function refresh(){
    if(!s || !['pick', 'review'].includes(s.step)) return;
    const now = matchOnCourt(opts.matchesFor(s.facility), s.court);
    const n = now ? now.num : null;
    let note = '';
    if(n !== s.expected) note = n === null ? 'The published data now shows no match on this court.' : `The published data now shows #${n} on this court.`;
    if(note !== s.note){ s.note = note; renderNote(); }   // only the note, never the choice
  }

  // ---- dialog plumbing ----

  // A second Enter or space landing on Review moments after it appears must not press Save.
  function guardKey(e){
    if(!s || s.step !== 'review') return;
    if(performance.now() - s.reviewShownAt >= COURT_KEY_GUARD_MS) return;
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); e.stopPropagation(); }
  }
  dlg.addEventListener('keydown', guardKey, true);
  dlg.addEventListener('keyup', guardKey, true);

  // Esc closes, except while a save is in flight.
  dlg.addEventListener('cancel', (e) => { if(s && s.step === 'saving') e.preventDefault(); });
  // Only when it really is closed: a close() followed at once by an open() leaves this event queued,
  // and it must not wipe the new court.
  dlg.addEventListener('close', () => { if(!dlg.open){ clearSlowTimer(); s = null; } });
  closeBtn.addEventListener('click', () => { if(!s || s.step !== 'saving') close(); });

  return { open, close, refresh, isOpen };
}
