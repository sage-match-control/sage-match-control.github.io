// The bar the Tournament Hub's banner folds into (hub-player-experience-spec §5).
//
// At the top of the page the banner is unchanged. Once it has scrolled out of view, a slim navy bar is pinned to the
// top of the screen: the event's logo, its date and venue line and its title on the left, and on the right the open
// tab, the day and the sync line. On a phone (below 900 px) the right side is a button naming the open tab that opens
// a menu of those three; on a computer it is a row, right-aligned, with no menu. The CSS (css/hub.css) shows one
// of the two per width; both are always in the markup.
//
//   const bar = createHubBar({ heroEl, tabsWrapEl, dayPickerEl, dayPickerWrapEl, syncStatusEl, panelFor });
//   bar.update();    // after anything the bar shows has changed: the open tab, the tabs showing, the day, the sync line
//
//     heroEl           the banner (`header.hero`): when it is out of view the bar shows; the bar's text comes from its
//                      `.eyebrow` and `.title`, its logo from the first image in `.hero-logos`
//     tabsWrapEl       the banner's tab row (`#viewTabsWrap`); its `.view-tab` buttons are the bar's tabs
//     dayPickerEl      the banner's day `<select>`; dayPickerWrapEl its wrapper, hidden at a one-day event
//     syncStatusEl     the banner's sync line
//     panelFor(view)   the element a tab scrolls to, just under the bar, once the view has switched
//
// The pure parts (reading the items, the markup, when the bar shows) are exported for the unit tests; everything
// that touches the page is inside createHubBar.

import { escapeHtml } from './html.js';
import { PHONE_QUERY } from './reveal.js';

/** The bar's height in px. css/hub.css and views/reveal.js carry the same number. */
export const HUB_BAR_HEIGHT = 54;

/** Collapses every run of whitespace (a line break too) to one space and trims; a missing text is ''. */
export const cleanText = text => String(text ?? '').replace(/\s+/g, ' ').trim();

const showing = el => !!el && el.style.display !== 'none' && !el.hidden;

/**
 * What the bar shows, read from the banner's elements.
 * @returns {{ tabs: {view: string, label: string, active: boolean}[],
 *             day: ({ value: string, options: {value: string, label: string}[] }|null), sync: string }}
 */
export function readBarItems({ tabsWrapEl, dayPickerEl, dayPickerWrapEl, syncStatusEl }) {
  const tabs = [...(tabsWrapEl ? tabsWrapEl.querySelectorAll('.view-tab') : [])]
    .filter(showing)
    .map(el => ({ view: el.dataset.view, label: cleanText(el.textContent), active: el.classList.contains('active') }));
  const day = dayPickerEl && dayPickerWrapEl && dayPickerWrapEl.style.display !== 'none'
    ? {
      value: dayPickerEl.value,
      options: [...dayPickerEl.options].filter(o => !o.disabled).map(o => ({ value: o.value, label: cleanText(o.textContent) })),
    }
    : null;
  const sync = showing(syncStatusEl) ? cleanText(syncStatusEl.textContent) : '';
  return { tabs, day, sync };
}

const selectHTML = day =>
  `<select>${day.options.map(o => `<option value="${escapeHtml(o.value)}"${o.value === day.value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;

/** A computer's row: the sync line, the day picker at a multi-day event, then a pill per tab. */
export function barRowHTML({ tabs, day, sync }) {
  return (sync ? `<span class="hub-bar-sync">${escapeHtml(sync)}</span>` : '')
    + (day ? `<label class="hub-bar-day">Day ${selectHTML(day)}</label>` : '')
    + tabs.map(t => `<button type="button" class="hub-bar-tab${t.active ? ' active' : ''}" data-view="${escapeHtml(t.view)}">${escapeHtml(t.label)}</button>`).join('');
}

/** A phone's menu: a button per tab, the day picker at a multi-day event, then the sync line. */
export function menuHTML({ tabs, day, sync }) {
  return tabs.map(t => `<button type="button" class="hub-menu-tab${t.active ? ' active' : ''}" data-view="${escapeHtml(t.view)}">${escapeHtml(t.label)}</button>`).join('')
    + (day ? `<label class="hub-menu-day">Day ${selectHTML(day)}</label>` : '')
    + (sync ? `<div class="hub-menu-sync">${escapeHtml(sync)}</div>` : '');
}

/** The bar shows when the tabs show, the banner is out of view and the stylesheet has loaded. */
export const barShows = ({ tabsShowing, heroOut, styled }) => !!(tabsShowing && heroOut && styled);

/** Where to scroll the page so a panel starts just under the bar. */
export const tabScrollTop = (panelTop, scrollY) => Math.max(0, panelTop + scrollY - HUB_BAR_HEIGHT - 8);

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollPage = top => window.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });

export function createHubBar({ heroEl, tabsWrapEl, dayPickerEl, dayPickerWrapEl, syncStatusEl, panelFor }) {
  const text = selector => cleanText(heroEl.querySelector(selector)?.innerText);
  const logo = heroEl.querySelector('.hero-logos img')?.getAttribute('src');

  const root = document.createElement('div');
  root.innerHTML =
    '<div class="hub-bar" hidden>'
    + (logo ? `<img class="hub-bar-logo" src="${escapeHtml(logo)}" alt="">` : '')
    + '<div class="hub-bar-text">'
    + `<small class="hub-bar-meta">${escapeHtml(text('.eyebrow'))}</small>`
    + `<span class="hub-bar-title">${escapeHtml(text('.title'))}</span>`
    + '</div>'
    + '<div class="hub-bar-row"></div>'
    + '<button type="button" class="hub-bar-btn" aria-expanded="false" aria-controls="hubMenu">'
    + '<span class="hub-bar-btn-label"></span><span class="hub-bar-burger" aria-hidden="true"></span></button>'
    + '</div>'
    + '<div class="hub-menu-scrim" hidden></div>'
    + '<nav class="hub-menu" id="hubMenu" aria-label="Tournament Hub" hidden></nav>';
  const [bar, scrim, menu] = [...root.children];
  document.body.append(bar, scrim, menu);
  const rowEl = bar.querySelector('.hub-bar-row');
  const btn = bar.querySelector('.hub-bar-btn');
  const btnLabel = bar.querySelector('.hub-bar-btn-label');

  const items = () => readBarItems({ tabsWrapEl, dayPickerEl, dayPickerWrapEl, syncStatusEl });

  // ---- the menu (a phone) ----
  const menuOpen = () => !menu.hidden;
  function openMenu() {
    menu.innerHTML = menuHTML(items());
    scrim.hidden = false;
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    menu.querySelector('.hub-menu-tab')?.focus();
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
  matchMedia(PHONE_QUERY).addEventListener('change', e => { if (!e.matches) closeMenu(); });

  // ---- a tab, a day ----
  // The banner's own tab does the switching (and remembers the choice); the bar then scrolls to the panel.
  function chooseTab(view) {
    closeMenu();
    const tab = [...tabsWrapEl.querySelectorAll('.view-tab')].find(el => el.dataset.view === view);
    if (tab) tab.click();
    const panel = panelFor(view);
    if (panel) scrollPage(tabScrollTop(panel.getBoundingClientRect().top, window.scrollY));
  }
  function chooseDay(value) {
    closeMenu();
    if (!value) return;
    dayPickerEl.value = value;
    dayPickerEl.dispatchEvent(new Event('change', { bubbles: true }));
    scrollPage(0);
  }
  for (const [el, tabClass] of [[bar, '.hub-bar-tab'], [menu, '.hub-menu-tab']]) {
    el.addEventListener('click', e => {
      const tab = e.target.closest(tabClass);
      if (tab) chooseTab(tab.dataset.view);
    });
    el.addEventListener('change', e => { if (e.target.matches('select')) chooseDay(e.target.value); });
  }

  // ---- when it shows ----
  let heroOut = false;
  function check() {
    const show = barShows({
      tabsShowing: !!tabsWrapEl && tabsWrapEl.style.display !== 'none',
      heroOut,
      // A cached old hub.css has no rules for the bar: never show it unstyled.
      styled: getComputedStyle(bar).position === 'fixed',
    });
    bar.hidden = !show;
    document.body.classList.toggle('hub-bar-on', show);
    if (!show) closeMenu();
  }
  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver(entries => {
      heroOut = !entries[entries.length - 1].isIntersecting;
      check();
    }, { threshold: 0 }).observe(heroEl);
  }

  // ---- redrawing ----
  // The row is only replaced when it changed, so a poll that finds the same sync line leaves an open day picker alone.
  let lastRow = '';
  function update() {
    const now = items();
    const row = barRowHTML(now);
    if (row !== lastRow) { rowEl.innerHTML = row; lastRow = row; }
    btnLabel.textContent = now.tabs.find(t => t.active)?.label ?? '';
    check();
  }
  update();
  return { update };
}
