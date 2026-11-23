// views/reveal.js: scrolling to a search's results on a phone, and createFinder's onSearched hook that calls it
// (hub-player-experience-spec §3). Browser globals are stubbed; there is no DOM in these tests.
import test from 'node:test';
import assert from 'node:assert/strict';

const { revealResults, PHONE_QUERY } = await import('../../../lib/v1/views/reveal.js');

/** Install the browser globals reveal.js reads for one test, and put things back afterwards. */
function browser(t, { phone = true, reduced = false, scrollY = 100 } = {}) {
  const scrolls = [];
  const queries = [];
  const saved = {};
  const set = (name, value) => { saved[name] = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  set('matchMedia', query => { queries.push(query); return { matches: query === PHONE_QUERY ? phone : reduced }; });
  set('getComputedStyle', el => ({ top: el.cssTop }));
  set('window', { scrollY, scrollTo: arg => scrolls.push(arg) });
  t.after(() => { for (const [name, desc] of Object.entries(saved)) { if (desc) Object.defineProperty(globalThis, name, desc); else delete globalThis[name]; } });
  return { scrolls, queries };
}

const el = (top, height = 0, cssTop = '') => ({ cssTop, getBoundingClientRect: () => ({ top, height }) });
const inputEl = () => ({ blurred: 0, blur() { this.blurred++; } });

test('a phone is below 900 px, the width at which finder.css pins the search box', () => {
  assert.equal(PHONE_QUERY, '(max-width: 899px)');
});

test('on a computer revealResults does nothing and says so', t => {
  const { scrolls } = browser(t, { phone: false });
  const input = inputEl();
  assert.equal(revealResults({ resultsEl: el(600), searchPanelEl: el(0, 60, '8px'), input }), false);
  assert.equal(input.blurred, 0, 'the keyboard is left alone');
  assert.deepEqual(scrolls, []);
});

test('on a phone it closes the keyboard and scrolls the results to just under the pinned search box', t => {
  const { scrolls } = browser(t, { scrollY: 100 });
  const input = inputEl();
  // Pinned panel: top 8 px + 60 px tall + 8 px gap = 76 px. Results 600 px below the viewport top, page at 100.
  assert.equal(revealResults({ resultsEl: el(600), searchPanelEl: el(0, 60, '8px'), input }), true);
  assert.equal(input.blurred, 1);
  assert.deepEqual(scrolls, [{ top: 600 + 100 - 76, behavior: 'smooth' }]);
});

test('reduced motion scrolls instantly', t => {
  const { scrolls } = browser(t, { reduced: true });
  revealResults({ resultsEl: el(600), searchPanelEl: el(0, 60, '8px'), input: inputEl() });
  assert.equal(scrolls[0].behavior, 'auto');
});

test('it never scrolls above the top of the page, and a panel with no top offset counts 0', t => {
  const { scrolls } = browser(t, { scrollY: 0 });
  revealResults({ resultsEl: el(20), searchPanelEl: el(0, 60, 'auto'), input: inputEl() });
  assert.deepEqual(scrolls, [{ top: 0, behavior: 'smooth' }]);
});

// ---- createFinder's onSearched ----------------------------------------------------------------

const { createFinder } = await import('../../../lib/v1/views/finder.js');
const { buildDayModel } = await import('../../../lib/v1/domain/model.js');

const HEADER = 'matchNumber,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const model = buildDayModel(
  { key: 'e', type: 'standard', title: 'E', display: {}, days: [] },
  { key: 'd', facilities: ['Main'] },
  { isLive: true, facilities: [{ name: 'Main', matchesCsv: [HEADER, '1,,9:00 AM,Court 1,ND_1,Ann,Bo,11,ND_2,Cy,Di,4'].join('\n'), standingsCsv: 'teamCode,player1,player2,wins,loss,quotient,bracket\n' }] },
  { now: 0 },
);

/** A fake element that records its listeners, with the bits of the DOM createFinder touches. */
function fake(extra = {}) {
  const listeners = {};
  const classes = new Set();
  return {
    value: '', innerHTML: '',
    classList: { add: c => classes.add(c), remove: c => classes.delete(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: c => classes.has(c) },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    fire: (type, e = {}) => listeners[type](e),
    querySelectorAll: () => [],
    focus() {},
    ...extra,
  };
}

function wire(t, { withHook = true } = {}) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const docListeners = {};
  Object.defineProperty(globalThis, 'document', { value: { addEventListener: (type, fn) => { docListeners[type] = fn; } }, configurable: true, writable: true });
  t.after(() => { if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document; });
  const log = [];
  const input = fake(), acList = fake(), resultsEl = fake(), clearBtn = fake(), searchBtn = fake();
  const finder = createFinder({
    input, acList, resultsEl, clearBtn, searchBtn, getModel: () => model,
    ...(withHook ? { onSearched: () => log.push(`searched with ${resultsEl.innerHTML.includes('Ann') ? 'results' : 'no results'}`) } : {}),
  });
  finder.rebuildIndex();
  return { finder, input, acList, resultsEl, clearBtn, searchBtn, log };
}

test('Find matches closes the suggestions, runs the search, then calls onSearched', t => {
  const { input, acList, searchBtn, log } = wire(t);
  input.value = 'Ann';
  acList.classList.add('show');
  searchBtn.fire('click');
  assert.equal(acList.classList.contains('show'), false, 'the suggestions are closed (this fix reaches Control Center too)');
  assert.deepEqual(log, ['searched with results'], 'once, after the results are drawn');
});

test('Enter in the box and a click on a suggestion each call onSearched once', t => {
  const { input, acList, log } = wire(t);
  input.value = 'Ann';
  input.fire('keydown', { key: 'Enter' });
  assert.equal(log.length, 1);
  const item = { dataset: { idx: '0' }, closest: sel => (sel === '.ac-item' ? item : null) };
  acList.fire('click', { target: item });
  assert.equal(log.length, 2);
});

test('nothing else calls it: typing, refresh, rebuildIndex, setQuery, reset, the clear button, Escape, an arrow key', t => {
  const { finder, input, acList, clearBtn, log } = wire(t);
  input.value = 'Ann';
  input.fire('input');
  input.fire('keydown', { key: 'Escape' });
  input.fire('keydown', { key: 'ArrowDown', preventDefault() {} });
  finder.setQuery('Ann');
  finder.refresh();
  finder.rebuildIndex();
  clearBtn.fire('click');
  finder.reset();
  assert.deepEqual(log, []);
  assert.equal(acList.classList.contains('show'), false);
});

test('a finder built without onSearched still searches', t => {
  const { input, searchBtn, resultsEl } = wire(t, { withHook: false });
  input.value = 'Ann';
  searchBtn.fire('click');
  assert.match(resultsEl.innerHTML, /Ann/);
});
