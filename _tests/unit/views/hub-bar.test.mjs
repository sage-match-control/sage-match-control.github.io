// views/hub-bar.js: the pure parts of the bar the Hub's banner folds into (hub-player-experience-spec §5), and
// reveal.js's allowance for it. Browser globals are stubbed or faked; there is no DOM in these tests. What the bar
// does on a page (shows on scroll, the menu, the day picker) is engine/hub-behaviour.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';

const { HUB_BAR_HEIGHT, cleanText, readBarItems, barRowHTML, menuHTML, barShows, tabScrollTop } =
  await import('../../../lib/v1/views/hub-bar.js');

// ---- fake elements -------------------------------------------------------------------------------------------------

const tabEl = (view, label, { active = false, display = '', hidden = false } = {}) => ({
  dataset: { view }, textContent: ` ${label} `, hidden, style: { display },
  classList: { contains: c => c === 'active' && active },
});
const tabsWrap = tabs => ({ querySelectorAll: sel => (sel === '.view-tab' ? tabs : []) });
const picker = (labels, value, { placeholder = true } = {}) => ({
  value,
  options: [
    ...(placeholder ? [{ value: '', textContent: 'Choose a day…', disabled: true }] : []),
    ...labels.map((label, i) => ({ value: String(i), textContent: label, disabled: false })),
  ],
});
const els = (over = {}) => ({
  tabsWrapEl: tabsWrap([tabEl('finder', 'Match Finder', { active: true }), tabEl('live', 'Live Matches'), tabEl('standings', 'Standings')]),
  dayPickerWrapEl: { style: { display: 'none' } },
  dayPickerEl: picker(['Sep 27'], '0'),
  syncStatusEl: { style: { display: '' }, textContent: 'Sep 27 · Live · last synced 7:50:29 PM' },
  ...over,
});

// ---- cleanText -----------------------------------------------------------------------------------------------------

test('cleanText collapses every run of whitespace, a line break included, and trims', () => {
  assert.equal(cleanText('  Sep 27 \n  ·  PCPH   Main\n'), 'Sep 27 · PCPH Main');
  assert.equal(cleanText(''), '');
  assert.equal(cleanText(null), '', 'a missing element reads as an empty line');
  assert.equal(cleanText(undefined), '');
});

// ---- readBarItems --------------------------------------------------------------------------------------------------

test('the items are one tab per tab that is showing, the open one marked', () => {
  const items = readBarItems(els());
  assert.deepEqual(items.tabs, [
    { view: 'finder', label: 'Match Finder', active: true },
    { view: 'live', label: 'Live Matches', active: false },
    { view: 'standings', label: 'Standings', active: false },
  ]);
});

test('a tab hidden by style or by the hidden attribute is left out (Live Matches and Standings before go-live)', () => {
  const items = readBarItems(els({
    tabsWrapEl: tabsWrap([tabEl('finder', 'Match Finder', { active: true }), tabEl('live', 'Live Matches', { display: 'none' }), tabEl('standings', 'Standings', { hidden: true })]),
  }));
  assert.deepEqual(items.tabs.map(t => t.view), ['finder']);
});

test('a team event’s fourth tab is an item too', () => {
  const items = readBarItems(els({
    tabsWrapEl: tabsWrap([tabEl('finder', 'Match Finder', { active: true }), tabEl('live', 'Live'), tabEl('standings', 'Standings'), tabEl('teams', 'Teams')]),
  }));
  assert.equal(items.tabs.length, 4);
});

test('a one-day event has no day item: its picker wrapper is hidden, or missing', () => {
  assert.equal(readBarItems(els()).day, null);
  assert.equal(readBarItems(els({ dayPickerWrapEl: null })).day, null);
  assert.equal(readBarItems(els({ dayPickerEl: null, dayPickerWrapEl: { style: { display: '' } } })).day, null);
});

test('a multi-day event’s day item lists the picker’s options without its disabled placeholder, and its value', () => {
  const items = readBarItems(els({ dayPickerWrapEl: { style: { display: '' } }, dayPickerEl: picker(['Sep 27', 'Sep 28'], '1') }));
  assert.deepEqual(items.day, { value: '1', options: [{ value: '0', label: 'Sep 27' }, { value: '1', label: 'Sep 28' }] });
});

test('before a day is picked the day item has no value', () => {
  const items = readBarItems(els({ dayPickerWrapEl: { style: { display: '' } }, dayPickerEl: picker(['Sep 27', 'Sep 28'], '') }));
  assert.equal(items.day.value, '');
});

test('the sync line is the status element’s text, left out while the element is hidden or empty', () => {
  assert.equal(readBarItems(els()).sync, 'Sep 27 · Live · last synced 7:50:29 PM');
  assert.equal(readBarItems(els({ syncStatusEl: { style: { display: 'none' }, textContent: 'Loading live schedule…' } })).sync, '');
  assert.equal(readBarItems(els({ syncStatusEl: { style: { display: '' }, textContent: '  ' } })).sync, '');
  assert.equal(readBarItems(els({ syncStatusEl: null })).sync, '');
});

// ---- markup --------------------------------------------------------------------------------------------------------

const ITEMS = {
  tabs: [{ view: 'finder', label: 'Match Finder', active: true }, { view: 'standings', label: 'Standings', active: false }],
  day: null,
  sync: 'Sep 27 · Live · last synced 7:50:29 PM',
};

test('the row is the sync line, then the day, then a pill per tab with the open one active', () => {
  const html = barRowHTML(ITEMS);
  assert.match(html, /<span class="hub-bar-sync">Sep 27 · Live · last synced 7:50:29 PM<\/span>/);
  assert.match(html, /<button type="button" class="hub-bar-tab active" data-view="finder">Match Finder<\/button>/);
  assert.match(html, /<button type="button" class="hub-bar-tab" data-view="standings">Standings<\/button>/);
  assert.ok(html.indexOf('hub-bar-sync') < html.indexOf('hub-bar-tab'), 'the sync line comes first');
  assert.doesNotMatch(html, /hub-bar-day/, 'no day at a one-day event');
});

test('the row leaves out an empty sync line', () => {
  assert.doesNotMatch(barRowHTML({ ...ITEMS, sync: '' }), /hub-bar-sync/);
});

test('a day item is a labelled select between the sync line and the tabs, with the chosen day selected', () => {
  const day = { value: '1', options: [{ value: '0', label: 'Sep 27' }, { value: '1', label: 'Sep 28' }] };
  const html = barRowHTML({ ...ITEMS, day });
  assert.match(html, /<label class="hub-bar-day">Day <select[^>]*>/);
  assert.match(html, /<option value="0">Sep 27<\/option>/);
  assert.match(html, /<option value="1" selected>Sep 28<\/option>/);
  assert.ok(html.indexOf('hub-bar-sync') < html.indexOf('hub-bar-day') && html.indexOf('hub-bar-day') < html.indexOf('hub-bar-tab'));
});

test('the menu is a button per tab, then the day row, then the sync line', () => {
  const day = { value: '0', options: [{ value: '0', label: 'Sep 27' }, { value: '1', label: 'Sep 28' }] };
  const html = menuHTML({ ...ITEMS, day });
  assert.match(html, /<button type="button" class="hub-menu-tab active" data-view="finder">Match Finder<\/button>/);
  assert.match(html, /<button type="button" class="hub-menu-tab" data-view="standings">Standings<\/button>/);
  assert.match(html, /<label class="hub-menu-day">Day <select[^>]*>/);
  assert.match(html, /<div class="hub-menu-sync">Sep 27 · Live · last synced 7:50:29 PM<\/div>/);
  assert.ok(html.lastIndexOf('hub-menu-tab') < html.indexOf('hub-menu-day') && html.indexOf('hub-menu-day') < html.indexOf('hub-menu-sync'));
});

test('the menu leaves out a day row and a sync line there is nothing for', () => {
  const html = menuHTML({ ...ITEMS, sync: '' });
  assert.doesNotMatch(html, /hub-menu-day|hub-menu-sync/);
});

test('everything put into the markup is escaped (a sync line can carry a facility name)', () => {
  const html = barRowHTML({
    tabs: [{ view: 'finder', label: '<b>"Finder"</b>', active: true }],
    day: { value: '0', options: [{ value: '0', label: 'A & <i>B</i>' }] },
    sync: 'couldn’t reach: <script>x</script>',
  });
  assert.doesNotMatch(html, /<b>|<i>|<script>/);
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /A &amp; &lt;i&gt;B&lt;\/i&gt;/);
  assert.match(menuHTML({ ...ITEMS, sync: '<img src=x>' }), /&lt;img src=x&gt;/);
});

// ---- when the bar shows, and where a tab scrolls to ------------------------------------------------------------------

test('the bar shows only when the tabs show, the hero is out of view and the stylesheet has loaded', () => {
  const on = { tabsShowing: true, heroOut: true, styled: true };
  assert.equal(barShows(on), true);
  assert.equal(barShows({ ...on, tabsShowing: false }), false, 'a day not picked yet, or being loaded');
  assert.equal(barShows({ ...on, heroOut: false }), false, 'the banner is on screen');
  assert.equal(barShows({ ...on, styled: false }), false, 'a cached old hub.css would show it unstyled');
});

test('a tab scrolls its panel to just under the bar, never above the top of the page', () => {
  assert.equal(HUB_BAR_HEIGHT, 54);
  assert.equal(tabScrollTop(400, 1000), 1000 + 400 - 54 - 8);
  assert.equal(tabScrollTop(10, 0), 0);
});

// ---- reveal.js leaves room for a bar that is about to appear -------------------------------------------------------

const { revealResults, PHONE_QUERY } = await import('../../../lib/v1/views/reveal.js');

/** The globals reveal.js reads, with a document that has (or hasn't) a bar and the body class. */
function page(t, { bar, barOn = false }) {
  const scrolls = [];
  const saved = {};
  const set = (name, value) => { saved[name] = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  set('matchMedia', query => ({ matches: query === PHONE_QUERY }));
  set('getComputedStyle', el => ({ top: el.cssTop }));
  set('window', { scrollY: 100, scrollTo: arg => scrolls.push(arg) });
  set('document', { body: { classList: { contains: c => c === 'hub-bar-on' && barOn } }, querySelector: sel => (sel === '.hub-bar' && bar ? {} : null) });
  t.after(() => { for (const [name, desc] of Object.entries(saved)) { if (desc) Object.defineProperty(globalThis, name, desc); else delete globalThis[name]; } });
  return scrolls;
}
const el = (top, height = 0, cssTop = '') => ({ cssTop, getBoundingClientRect: () => ({ top, height }) });
const reveal = () => revealResults({ resultsEl: el(600), searchPanelEl: el(0, 60, '8px'), input: { blur() {} } });

test('with a bar that is not showing yet, the results leave the bar’s 54 px as well', t => {
  const scrolls = page(t, { bar: true, barOn: false });
  reveal();
  assert.equal(scrolls[0].top, 600 + 100 - (8 + 60 + 8) - 54);
});

test('with the bar already showing (the panel’s offset already counts it) nothing is added', t => {
  const scrolls = page(t, { bar: true, barOn: true });
  reveal();
  assert.equal(scrolls[0].top, 600 + 100 - (8 + 60 + 8));
});

test('with no bar on the page (Control Center, a page with an old shell) nothing is added', t => {
  const scrolls = page(t, { bar: false });
  reveal();
  assert.equal(scrolls[0].top, 600 + 100 - (8 + 60 + 8));
});
