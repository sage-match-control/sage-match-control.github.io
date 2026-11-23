// views/hub-bar.js: the pure parts of the bar the Hub's banner folds into (hub-player-experience-spec §5), and
// reveal.js's allowance for it. Browser globals are stubbed or faked; there is no DOM in these tests. What the bar
// does on a page (always on a phone, folding on a computer, the menu, the day picker) is engine/hub-behaviour.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';

const { HUB_BAR_HEIGHT, TITLE_MIN_PX, titleFit, shortDay, dayPillLabel, FOLDED_KEY, cleanText, readBarItems, barRowHTML, menuHTML, buttonLabel, barShows, barFolds, tabScrollTop } =
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

test('no tabs while the tab row is hidden (no day loaded yet), so a phone’s menu never offers an empty view', () => {
  const hiddenRow = { ...tabsWrap([tabEl('finder', 'Match Finder', { active: true }), tabEl('live', 'Live Matches')]), style: { display: 'none' } };
  assert.deepEqual(readBarItems(els({ tabsWrapEl: hiddenRow })).tabs, []);
  assert.deepEqual(readBarItems(els({ tabsWrapEl: null })).tabs, []);
});

test('an extra picker (Control Center’s event) is an item with its label, value, options and place in the list', () => {
  const eventPicker = { value: 'b', options: [{ value: 'a', textContent: '2026-09-27 Pickle for Sight', disabled: false }, { value: 'b', textContent: ' 2026-10-03  PickleDrive ', disabled: false }] };
  const items = readBarItems({ ...els(), pickers: [{ el: eventPicker, label: 'Event' }] });
  assert.deepEqual(items.pickers, [{
    index: 0, label: 'Event', value: 'b',
    options: [{ value: 'a', label: '2026-09-27 Pickle for Sight' }, { value: 'b', label: '2026-10-03 PickleDrive' }],
  }]);
});

test('a picker whose wrapper is hidden, or that has no element, is left out, and the others keep their index', () => {
  const sel = value => ({ value, options: [{ value, textContent: value, disabled: false }] });
  const items = readBarItems({ ...els(), pickers: [
    { el: sel('x'), wrapEl: { style: { display: 'none' } }, label: 'Hidden' },
    { el: null, label: 'Missing' },
    { el: sel('y'), wrapEl: { style: { display: '' } }, label: 'Shown' },
  ] });
  assert.deepEqual(items.pickers.map(p => [p.index, p.label]), [[2, 'Shown']]);
});

test('without pickers the item list has none', () => {
  assert.deepEqual(readBarItems(els()).pickers, []);
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

test('an extra picker is a labelled row after the tabs and before the day, naming its index', () => {
  const day = { value: '0', options: [{ value: '0', label: 'Sep 27' }] };
  const pickers = [{ index: 0, label: 'Event', value: 'b', options: [{ value: 'a', label: 'One' }, { value: 'b', label: 'Two' }] }];
  const html = menuHTML({ ...ITEMS, day, pickers });
  assert.match(html, /<label class="hub-menu-day hub-menu-picker" data-picker="0">Event <select>/);
  assert.match(html, /<option value="b" selected>Two<\/option>/);
  assert.ok(html.lastIndexOf('hub-menu-tab') < html.indexOf('hub-menu-picker'), 'after the tabs');
  assert.ok(html.indexOf('hub-menu-picker') < html.indexOf('>Day <select'), 'before the day');
  assert.doesNotMatch(barRowHTML({ ...ITEMS, pickers }), /picker|Event/, 'a computer’s row leaves pickers to the banner');
});

test('the phone’s button names the open tab; before a day is loaded, Choose a day while one waits to be picked, else Menu', () => {
  assert.equal(buttonLabel(ITEMS), 'Match Finder');
  assert.equal(buttonLabel({ tabs: [], day: { value: '', options: [] } }), 'Choose a day');
  assert.equal(buttonLabel({ tabs: [], day: { value: '1', options: [] } }), 'Menu', 'a day picked and still loading');
  assert.equal(buttonLabel({ tabs: [], day: null }), 'Menu');
  assert.equal(buttonLabel({ tabs: [{ view: 'finder', label: 'Match Finder', active: false }], day: null }), 'Menu');
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

test('with the fold rules, the bar shows always on a phone, and on a computer once the banner is folded and a day is loaded', () => {
  assert.equal(barFolds({ phone: true, folded: false, tabsShowing: false }), true, 'a phone, even before a day is loaded');
  assert.equal(barFolds({ phone: true, folded: true, tabsShowing: true }), true);
  assert.equal(barFolds({ phone: false, folded: true, tabsShowing: true }), true, 'a computer, folded');
  assert.equal(barFolds({ phone: false, folded: false, tabsShowing: true }), false, 'a computer shows the banner until it is folded');
  assert.equal(barFolds({ phone: false, folded: true, tabsShowing: false }), false, 'and keeps the banner, with its pickers, until a day is loaded');
  assert.equal(FOLDED_KEY, 'sage.hub.bannerFolded');
});

test('with a stylesheet from before the fold rules, the bar shows only when the tabs show, the hero is out of view and it is styled', () => {
  const on = { tabsShowing: true, heroOut: true, styled: true };
  assert.equal(barShows(on), true);
  assert.equal(barShows({ ...on, tabsShowing: false }), false, 'a day not picked yet, or being loaded');
  assert.equal(barShows({ ...on, heroOut: false }), false, 'the banner is on screen');
  assert.equal(barShows({ ...on, styled: false }), false, 'a cached old hub.css would show it unstyled');
});

test('a tab scrolls its panel to just under the bar, never above the top of the page', () => {
  assert.equal(HUB_BAR_HEIGHT, 54, 'the slim row, until the bar is measured');
  assert.equal(tabScrollTop(400, 1000), 1000 + 400 - 54 - 8);
  assert.equal(tabScrollTop(400, 1000, 98), 1000 + 400 - 98 - 8, 'the measured height when it is given');
  assert.equal(tabScrollTop(10, 0), 0);
});

test('a phone’s day pill reads the day’s label up to its first " · ", or Day before one is picked', () => {
  assert.equal(shortDay('Nov 28 · Next Gen'), 'Nov 28');
  assert.equal(shortDay('  Sep 27 '), 'Sep 27', 'a label without a dot is the whole label');
  const day = { value: '1', options: [{ value: '0', label: 'Nov 28 · Next Gen' }, { value: '1', label: 'Nov 29 · Gen X' }] };
  assert.equal(dayPillLabel(day), 'Nov 29');
  assert.equal(dayPillLabel({ ...day, value: '' }), 'Day');
  assert.equal(dayPillLabel(null), 'Day');
});

test('the title keeps one line: at its own size where it fits, smaller where it does not, wrapped below 13 px', () => {
  assert.equal(TITLE_MIN_PX, 13);
  assert.equal(titleFit({ room: 309, need: 300, base: 15 }), 'fits');
  assert.equal(titleFit({ room: 309, need: 310, base: 15 }), 'fits', 'a pixel of rounding is not an overflow');
  assert.deepEqual(titleFit({ room: 309, need: 326, base: 15 }), { size: 14.2 }, 'The Ultimate Generation Cup 2026 on a phone');
  assert.deepEqual(titleFit({ room: 260, need: 300, base: 15 }), { size: 13 }, 'exactly the smallest size still fits');
  assert.equal(titleFit({ room: 200, need: 300, base: 15 }), 'wrap', 'below 13 px it wraps at its own size instead');
  assert.equal(titleFit({ room: 0, need: 300, base: 15 }), 'fits', 'a bar not laid out yet is left alone');
});

// ---- reveal.js leaves room for a bar that is about to appear -------------------------------------------------------

const { revealResults, PHONE_QUERY } = await import('../../../lib/v1/views/reveal.js');

/** The globals reveal.js reads, with a document that has (or hasn't) a bar and the body class. */
function page(t, { bar, barOn = false, barH }) {
  const scrolls = [];
  const saved = {};
  const set = (name, value) => { saved[name] = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  set('matchMedia', query => ({ matches: query === PHONE_QUERY }));
  const root = { isRoot: true };
  set('getComputedStyle', el => (el === root ? { getPropertyValue: name => (name === '--hub-bar-h' && barH ? barH : '') } : { top: el.cssTop }));
  set('window', { scrollY: 100, scrollTo: arg => scrolls.push(arg) });
  set('document', { body: { classList: { contains: c => c === 'hub-bar-on' && barOn } }, querySelector: sel => (sel === '.hub-bar' && bar ? {} : null), documentElement: root });
  t.after(() => { for (const [name, desc] of Object.entries(saved)) { if (desc) Object.defineProperty(globalThis, name, desc); else delete globalThis[name]; } });
  return scrolls;
}
const el = (top, height = 0, cssTop = '') => ({ cssTop, getBoundingClientRect: () => ({ top, height }) });
const reveal = () => revealResults({ resultsEl: el(600), searchPanelEl: el(0, 60, '8px'), input: { blur() {} } });

test('with a bar that is not showing yet and no measured height (an old stylesheet), the results leave 54 px as well', t => {
  const scrolls = page(t, { bar: true, barOn: false });
  reveal();
  assert.equal(scrolls[0].top, 600 + 100 - (8 + 60 + 8) - 54);
});

test('with a bar that is not showing yet, the results leave its measured height (--hub-bar-h)', t => {
  const scrolls = page(t, { bar: true, barOn: false, barH: '98px' });
  reveal();
  assert.equal(scrolls[0].top, 600 + 100 - (8 + 60 + 8) - 98);
});

test('with the bar already showing (the panel’s offset already counts it) nothing is added', t => {
  const scrolls = page(t, { bar: true, barOn: true });
  reveal();
  assert.equal(scrolls[0].top, 600 + 100 - (8 + 60 + 8));
});

test('with no bar on the page (a page with an old shell) nothing is added', t => {
  const scrolls = page(t, { bar: false });
  reveal();
  assert.equal(scrolls[0].top, 600 + 100 - (8 + 60 + 8));
});
