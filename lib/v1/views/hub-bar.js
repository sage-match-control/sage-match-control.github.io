// The slim bar the Tournament Hub's banner folds into (hub-player-experience-spec §5), which Control Center uses too.
//
// A navy bar pinned to the top of the screen: the event's logo, a small line (the Hub's date and venue) and the title,
// and the open tab, the day and the sync line. On a phone (below 900 px) it is two rows: the title, then a button as
// wide as the screen naming the open tab, which opens a menu of those three. On a computer it is one slim row, the
// title on the left and a row of the three on the right, with no menu; or, with computerRows: 2 (Control Center), two
// rows, the whole title over the row. The CSS (css/hub-bar.css) lays out each; the markup is the same for all.
//
// In the two-row layouts (the stylesheet's --hub-bar-fit on the bar is 1) the title keeps one line, made smaller to fit
// down to TITLE_MIN_PX, and wraps where even that is too wide (titleFit).
//
// A phone's second row at a multi-day event is the day picker (a quarter of the row, showing the day's date: shortDay)
// beside the menu button (the rest). Its <select> is the bar's own, laid over the pill; a choice sets the banner's. The bar's height therefore changes with the
// title and the width: it is measured, and set on <html> as --hub-bar-h for everything under the bar.
//
// When it shows:
//   a phone      always. The banner never shows on a phone (css/hub-bar.css hides it), so the bar is the page's top,
//                and its menu carries everything the banner did: the tabs, any extra pickers (Control Center's
//                event), the day and the sync line.
//   a computer   when the reader has folded the banner, with the chevron the bar adds to its corner, and a day is
//                loaded (the tabs show). The bar then stands in the banner's place, pinned, until its own chevron
//                brings the banner back. The choice is kept in this browser (localStorage, `storageKey`).
// A page whose cached stylesheet predates the fold rules keeps the earlier behaviour: the bar shows once the banner
// has scrolled out of view (barShows).
//
//   const bar = createHubBar({ heroEl, tabsWrapEl, dayPickerEl, dayPickerWrapEl, syncStatusEl, panelFor });
//   bar.update();    // after anything the bar shows has changed: the open tab, the tabs showing, the day, the sync line
//
//     heroEl           the banner (`header.hero`); by default the bar's text comes from its `.eyebrow` and `.title`,
//                      its logo from the first image in `.hero-logos`
//     tabsWrapEl       the banner's tab row (`#viewTabsWrap`); its `.view-tab` buttons are the bar's tabs
//     dayPickerEl      the banner's day `<select>`; dayPickerWrapEl its wrapper, hidden at a one-day event
//     syncStatusEl     the banner's sync line
//     panelFor(view)   the element a tab scrolls to, just under the bar, once the view has switched
//   Optional:
//     text()           { meta, title }: the bar's two lines, read on every update() (Control Center: the event)
//     logoSrc          the bar's logo, in place of the banner's first logo
//     pickers          [{ el, wrapEl?, label }]: more `<select>`s from the banner for the phone's menu, before the day
//                      (Control Center's event picker); a choice sets the select and fires its `change`
//     storageKey       where the folded choice is kept (default 'sage.hub.bannerFolded')
//     menuLabel        the menu's accessible name (default 'Tournament Hub')
//     computerRows     2 for the two-row bar on a computer too (Control Center); default 1, the slim row
//
// The pure parts (reading the items, the markup, when the bar shows) are exported for the unit tests; everything
// that touches the page is inside createHubBar.

import { escapeHtml } from './html.js';
import { PHONE_QUERY } from './reveal.js';

/** The slim bar's height in px: a computer's one row, until the bar is measured. */
export const HUB_BAR_HEIGHT = 54;

/** The smallest the title is made to keep it on one line; below it, it wraps instead. */
export const TITLE_MIN_PX = 13;

/**
 * How the title fits its room: 'fits' at its own size, { size } in px to keep one line, or 'wrap'.
 * @param {{ room: number, need: number, base: number, min?: number }} sizes  the room's width, the title's width on
 *   one line and its font size, all at its own size
 */
export function titleFit({ room, need, base, min = TITLE_MIN_PX }) {
  if (!(room > 0) || need <= room + 1) return 'fits';
  const size = Math.floor((base * room / need) * 10) / 10;
  return size >= min ? { size } : 'wrap';
}

/** The bar's height as css/hub-bar.css and createHubBar left it on <html>: --hub-bar-h, or 54 (the slim row). */
export function barHeight() {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hub-bar-h'));
  return value > 0 ? value : 54;
}

/** Where the Hub keeps the reader's folded choice by default. */
export const FOLDED_KEY = 'sage.hub.bannerFolded';

/** Collapses every run of whitespace (a line break too) to one space and trims; a missing text is ''. */
export const cleanText = text => String(text ?? '').replace(/\s+/g, ' ').trim();

const showing = el => !!el && el.style.display !== 'none' && !el.hidden;

const selectItem = el => ({
  value: el.value,
  options: [...el.options].filter(o => !o.disabled).map(o => ({ value: o.value, label: cleanText(o.textContent) })),
});

/**
 * What the bar shows, read from the banner's elements.
 * @returns {{ tabs: {view: string, label: string, active: boolean}[],
 *             day: ({ value: string, options: {value: string, label: string}[] }|null), sync: string,
 *             pickers: { index: number, label: string, value: string, options: {value: string, label: string}[] }[] }}
 */
export function readBarItems({ tabsWrapEl, dayPickerEl, dayPickerWrapEl, syncStatusEl, pickers = [] }) {
  // No tabs while the row is hidden (no day loaded yet): they would switch to views with nothing in them.
  const rowShowing = !!tabsWrapEl && tabsWrapEl.style?.display !== 'none';
  const tabs = [...(rowShowing ? tabsWrapEl.querySelectorAll('.view-tab') : [])]
    .filter(showing)
    .map(el => ({ view: el.dataset.view, label: cleanText(el.textContent), active: el.classList.contains('active') }));
  const day = dayPickerEl && dayPickerWrapEl && dayPickerWrapEl.style.display !== 'none' ? selectItem(dayPickerEl) : null;
  const sync = showing(syncStatusEl) ? cleanText(syncStatusEl.textContent) : '';
  const extra = pickers
    .map((p, index) => ({ p, index }))
    .filter(({ p }) => p && p.el && (!p.wrapEl || p.wrapEl.style.display !== 'none'))
    .map(({ p, index }) => ({ index, label: p.label || '', ...selectItem(p.el) }));
  return { tabs, day, sync, pickers: extra };
}

const optionsHTML = day =>
  day.options.map(o => `<option value="${escapeHtml(o.value)}"${o.value === day.value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('');

const selectHTML = day => `<select>${optionsHTML(day)}</select>`;

/** A computer's row: the sync line, the day picker at a multi-day event, then a pill per tab. */
export function barRowHTML({ tabs, day, sync }) {
  return (sync ? `<span class="hub-bar-sync">${escapeHtml(sync)}</span>` : '')
    + (day ? `<label class="hub-bar-day">Day ${selectHTML(day)}</label>` : '')
    + tabs.map(t => `<button type="button" class="hub-bar-tab${t.active ? ' active' : ''}" data-view="${escapeHtml(t.view)}">${escapeHtml(t.label)}</button>`).join('');
}

/** A phone's menu: a button per tab, any extra pickers, the day picker at a multi-day event, then the sync line. */
export function menuHTML({ tabs, day, sync, pickers = [] }) {
  return tabs.map(t => `<button type="button" class="hub-menu-tab${t.active ? ' active' : ''}" data-view="${escapeHtml(t.view)}">${escapeHtml(t.label)}</button>`).join('')
    + pickers.map(p => `<label class="hub-menu-day hub-menu-picker" data-picker="${p.index}">${escapeHtml(p.label)} ${selectHTML(p)}</label>`).join('')
    + (day ? `<label class="hub-menu-day">Day ${selectHTML(day)}</label>` : '')
    + (sync ? `<div class="hub-menu-sync">${escapeHtml(sync)}</div>` : '');
}

/** The phone's button: the open tab; before a day is loaded, "Choose a day" while one is waiting to be picked, else "Menu". */
export function buttonLabel({ tabs, day }) {
  const open = tabs.find(t => t.active);
  if (open) return open.label;
  return day && !day.value ? 'Choose a day' : 'Menu';
}

/** A phone's day pill shows the day's label up to its first " · ": "Nov 28 · Next Gen" reads "Nov 28". */
export const shortDay = label => cleanText(label).split(' · ')[0];

/** The phone's day pill: the open day's short label, or "Day" before one is picked. */
export function dayPillLabel(day) {
  const open = day && day.options.find(o => o.value === day.value);
  return open && day.value ? shortDay(open.label) : 'Day';
}

/** With a stylesheet that predates the fold rules: the bar shows when the tabs show and the banner is out of view. */
export const barShows = ({ tabsShowing, heroOut, styled }) => !!(tabsShowing && heroOut && styled);

/** With the fold rules: always on a phone; on a computer, once the banner is folded and a day is loaded. */
export const barFolds = ({ phone, folded, tabsShowing }) => !!(phone || (folded && tabsShowing));

/** Where to scroll the page so a panel starts just under the bar. */
export const tabScrollTop = (panelTop, scrollY, height = HUB_BAR_HEIGHT) => Math.max(0, panelTop + scrollY - height - 8);

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollPage = top => window.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });

// The board's chevron (lib/v1/css/schedule-board.css .bezel-toggle): up on the banner, turned down on the bar.
const CHEVRON = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 10l5-5 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function readFolded(key) {
  try { return localStorage.getItem(key) === '1'; } catch (e) { return false; }
}
function storeFolded(key, folded) {
  try { localStorage.setItem(key, folded ? '1' : '0'); } catch (e) { /* a nice-to-have */ }
}

export function createHubBar({
  heroEl, tabsWrapEl, dayPickerEl, dayPickerWrapEl, syncStatusEl, panelFor,
  text, logoSrc, pickers = [], storageKey = FOLDED_KEY, menuLabel = 'Tournament Hub', computerRows = 1,
}) {
  // The banner's text with each <br> read as a space. Not innerText: on a phone the banner is hidden, and a hidden
  // element's innerText is its bare text, with a <br>'s two lines run together.
  const heroText = selector => {
    const el = heroEl.querySelector(selector);
    if (!el) return '';
    const copy = el.cloneNode(true);
    copy.querySelectorAll('br').forEach(br => br.replaceWith(' '));
    return cleanText(copy.textContent);
  };
  const readText = () => (text ? text() : { meta: heroText('.eyebrow'), title: heroText('.title') });
  const logo = logoSrc || heroEl.querySelector('.hero-logos img')?.getAttribute('src');

  const root = document.createElement('div');
  root.innerHTML =
    `<div class="hub-bar${computerRows === 2 ? ' hub-bar-two' : ''}" hidden>`
    + (logo ? `<img class="hub-bar-logo" src="${escapeHtml(logo)}" alt="">` : '')
    + '<div class="hub-bar-text"><small class="hub-bar-meta"></small><span class="hub-bar-title"></span></div>'
    + '<div class="hub-bar-row"></div>'
    + `<button type="button" class="hub-bar-fold" aria-label="Show the banner" title="Show the banner">${CHEVRON}</button>`
    + '<label class="hub-bar-pday" hidden><span class="hub-bar-pday-text"></span><span class="hub-bar-pday-caret" aria-hidden="true"></span>'
    + '<select aria-label="Day"></select></label>'
    + '<button type="button" class="hub-bar-btn" aria-expanded="false" aria-controls="hubMenu">'
    + '<span class="hub-bar-btn-label"></span><span class="hub-bar-burger" aria-hidden="true"></span></button>'
    + '</div>'
    + '<div class="hub-menu-scrim" hidden></div>'
    + `<nav class="hub-menu" id="hubMenu" aria-label="${escapeHtml(menuLabel)}" hidden></nav>`;
  const [bar, scrim, menu] = [...root.children];
  document.body.append(bar, scrim, menu);
  const metaEl = bar.querySelector('.hub-bar-meta');
  const titleEl = bar.querySelector('.hub-bar-title');
  const rowEl = bar.querySelector('.hub-bar-row');
  const btn = bar.querySelector('.hub-bar-btn');
  const btnLabel = bar.querySelector('.hub-bar-btn-label');
  const unfoldBtn = bar.querySelector('.hub-bar-fold');
  const pdayEl = bar.querySelector('.hub-bar-pday');
  const pdayText = bar.querySelector('.hub-bar-pday-text');
  const pdaySelect = pdayEl.querySelector('select');

  // The banner's own chevron, in its top-left corner; shown only on a computer once a day is loaded (check()).
  const foldBtn = document.createElement('button');
  foldBtn.type = 'button';
  foldBtn.className = 'hub-fold-btn';
  foldBtn.hidden = true;
  foldBtn.setAttribute('aria-label', 'Fold the banner');
  foldBtn.title = 'Fold the banner';
  foldBtn.innerHTML = CHEVRON;
  heroEl.append(foldBtn);

  const items = () => readBarItems({ tabsWrapEl, dayPickerEl, dayPickerWrapEl, syncStatusEl, pickers });

  // ---- the menu (a phone) ----
  const menuOpen = () => !menu.hidden;
  function openMenu() {
    menu.innerHTML = menuHTML(items());
    scrim.hidden = false;
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    menu.querySelector('.hub-menu-tab, select')?.focus();
  }
  function closeMenu({ restoreFocus = false } = {}) {
    if (!menuOpen()) return;
    scrim.hidden = true;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (restoreFocus) btn.focus();
  }
  btn.addEventListener('click', () => (menuOpen() ? closeMenu({ restoreFocus: true }) : openMenu()));
  scrim.addEventListener('click', () => closeMenu({ restoreFocus: true }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && menuOpen()) closeMenu({ restoreFocus: true }); });
  matchMedia(PHONE_QUERY).addEventListener('change', e => {
    if (!e.matches) closeMenu();
    check();
  });

  // ---- a tab, a day, a picker ----
  // The banner's own tab does the switching (and remembers the choice); the bar then scrolls to the panel.
  function chooseTab(view) {
    closeMenu();
    const tab = [...tabsWrapEl.querySelectorAll('.view-tab')].find(el => el.dataset.view === view);
    if (tab) tab.click();
    const panel = panelFor(view);
    if (panel) scrollPage(tabScrollTop(panel.getBoundingClientRect().top, window.scrollY, barHeight()));
  }
  function choose(selectEl, value) {
    closeMenu();
    if (!value || !selectEl) return;
    selectEl.value = value;
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    scrollPage(0);
  }
  for (const [el, tabClass] of [[bar, '.hub-bar-tab'], [menu, '.hub-menu-tab']]) {
    el.addEventListener('click', e => {
      const tab = e.target.closest(tabClass);
      if (tab) chooseTab(tab.dataset.view);
    });
    el.addEventListener('change', e => {
      if (!e.target.matches('select')) return;
      const picker = e.target.closest('[data-picker]');
      choose(picker ? pickers[Number(picker.dataset.picker)]?.el : dayPickerEl, e.target.value);
    });
  }

  // ---- folding the banner (a computer) ----
  let folded = readFolded(storageKey);
  function setFolded(value) {
    folded = value;
    storeFolded(storageKey, value);
    check();
    window.scrollTo({ top: 0 });
    (value ? unfoldBtn : foldBtn).focus();
  }
  foldBtn.addEventListener('click', () => setFolded(true));
  unfoldBtn.addEventListener('click', () => setFolded(false));

  // ---- when it shows ----
  let heroOut = false;
  function check() {
    const style = getComputedStyle(bar);
    // A cached old stylesheet has no rules for the bar: never show it unstyled.
    const styled = style.position === 'fixed';
    // One from before the fold rules: the bar keeps showing only once the banner has scrolled away.
    const foldRules = styled && style.getPropertyValue('--hub-bar-fold').trim() === '1';
    const tabsShowing = !!tabsWrapEl && tabsWrapEl.style.display !== 'none';
    const phone = matchMedia(PHONE_QUERY).matches;
    const show = foldRules ? barFolds({ phone, folded, tabsShowing }) : barShows({ tabsShowing, heroOut, styled });
    bar.hidden = !show;
    document.body.classList.toggle('hub-bar-on', show);
    document.body.classList.toggle('hub-bar-folded', foldRules && show);
    // Written only when it changes: the button is inside the banner, and a page may watch the banner for changes
    // to redraw the bar (Control Center does), which an unchanged write would set off again.
    const foldHidden = !(foldRules && !phone && tabsShowing);
    if (foldBtn.hidden !== foldHidden) foldBtn.hidden = foldHidden;
    if (!show) closeMenu();
    fit();
  }

  // A computer's row that is wider than its room (css/hub-bar.css lets it shrink and scroll): the sync line goes
  // first, and the open tab is scrolled into view. A row that fits is left as it is.
  const overflows = () => rowEl.scrollWidth > rowEl.clientWidth + 1;
  function fit() {
    if (bar.hidden) return;
    fitTitle();
    measure();
    if (!rowEl.clientWidth) return;
    bar.classList.remove('hub-bar-tight');
    if (!overflows()) return;
    bar.classList.add('hub-bar-tight');
    const active = rowEl.querySelector('.hub-bar-tab.active');
    if (!active || !overflows()) return;
    const box = rowEl.getBoundingClientRect();
    const r = active.getBoundingClientRect();
    if (r.right > box.right) rowEl.scrollLeft += r.right - box.right + 8;
    else if (r.left < box.left) rowEl.scrollLeft -= box.left - r.left + 8;
  }
  window.addEventListener('resize', fit);
  // The title's width changes once its font has loaded.
  document.fonts?.ready?.then(fit);

  // The title on one line, smaller where it must be (titleFit); measured at its own size each time. Only where the
  // stylesheet asks for it (--hub-bar-fit): the slim row cuts the title short instead.
  function fitTitle() {
    titleEl.style.fontSize = '';
    titleEl.classList.remove('hub-bar-title-wrap');
    if (getComputedStyle(bar).getPropertyValue('--hub-bar-fit').trim() !== '1') return;
    const fitted = titleFit({
      room: titleEl.clientWidth,
      need: titleEl.scrollWidth,
      base: parseFloat(getComputedStyle(titleEl).fontSize),
    });
    if (fitted === 'wrap') titleEl.classList.add('hub-bar-title-wrap');
    else if (fitted !== 'fits') titleEl.style.fontSize = fitted.size + 'px';
  }

  // The bar's height, for everything under it (css/hub-bar.css --hub-bar-h).
  function measure() {
    const height = Math.round(bar.getBoundingClientRect().height);
    if (!height) return;
    const value = height + 'px';
    if (document.documentElement.style.getPropertyValue('--hub-bar-h') !== value) {
      document.documentElement.style.setProperty('--hub-bar-h', value);
    }
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (!bar.hidden) measure(); }).observe(bar);
  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver(entries => {
      heroOut = !entries[entries.length - 1].isIntersecting;
      check();
    }, { threshold: 0 }).observe(heroEl);
  }

  // ---- redrawing ----
  // The row is only replaced when it changed, so a poll that finds the same sync line leaves an open day picker alone.
  let lastRow = '';
  let lastPday = '';
  function update() {
    const now = items();
    const row = barRowHTML(now);
    if (row !== lastRow) { rowEl.innerHTML = row; lastRow = row; }
    const { meta, title } = readText();
    if (metaEl.textContent !== meta) metaEl.textContent = meta;
    if (titleEl.textContent !== title) titleEl.textContent = title;
    btnLabel.textContent = buttonLabel(now);
    // The phone's day pill: only with a stylesheet that lays it out (one that refits the title knows it), and only at a
    // multi-day event. Its options are rewritten only when they changed, so an open picker is left alone.
    const pday = !!now.day && getComputedStyle(bar).getPropertyValue('--hub-bar-fit').trim() !== '';
    if (pdayEl.hidden === pday) pdayEl.hidden = !pday;
    if (pday) {
      // Before a day is picked, a placeholder holds the empty value, so picking the first day is a change.
      const options = (now.day.value ? '' : '<option value="" disabled>Choose a day</option>')
        + optionsHTML(now.day);
      if (options !== lastPday) { pdaySelect.innerHTML = options; lastPday = options; }
      pdaySelect.value = now.day.value;
      pdayText.textContent = dayPillLabel(now.day);
    }
    check();
  }
  update();
  return { update };
}
