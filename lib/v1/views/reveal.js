// Showing a search's results on a phone (hub-player-experience-spec §3).
//
// On a phone the banner and the search box fill the first screen, so a search changes nothing the person can see:
// its results start below it. After a search, revealResults closes the keyboard and scrolls the page so the results
// start just under the search box, which is pinned to the top of the screen on a phone (css/finder.css). On a
// computer it does nothing: the results are already on screen. Where the Hub's bar is about to appear (the banner
// scrolling away brings it in, and moves the pinned search box down by the bar's height), that height is counted too.

/** The Hub bar's height: views/hub-bar.js's HUB_BAR_HEIGHT, repeated so the two modules stay independent. */
const BAR_HEIGHT = 54;

/** The Hub has a bar that is not showing yet. */
const barPending = () => typeof document !== 'undefined' && !!document.querySelector('.hub-bar') && !document.body.classList.contains('hub-bar-on');

/** A phone: below 900 px wide, the width at which css/finder.css pins the search box. */
export const PHONE_QUERY = '(max-width: 899px)';

/**
 * @param {object} els
 *   resultsEl       the panel the results are drawn in
 *   searchPanelEl   the search box's panel (`position: sticky` on a phone)
 *   input           the search box, blurred so the keyboard closes
 * @returns {boolean} true when it scrolled, false when it did nothing (a computer)
 */
export function revealResults({ resultsEl, searchPanelEl, input }){
  if(!matchMedia(PHONE_QUERY).matches) return false;
  input.blur();
  // The space the panel takes once it is pinned: its offset from the top of the screen, its height, a small gap.
  // A bar that is about to appear as the page scrolls (views/hub-bar.js) moves the pinned panel down by its height.
  const stuck = (parseFloat(getComputedStyle(searchPanelEl).top) || 0) + searchPanelEl.getBoundingClientRect().height + 8 + (barPending() ? BAR_HEIGHT : 0);
  const top = resultsEl.getBoundingClientRect().top + window.scrollY - stuck;
  window.scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  return true;
}
