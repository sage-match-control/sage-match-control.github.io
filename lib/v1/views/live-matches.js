// Live Matches: one table per facility, one row (two lines) per court, showing
// the match on court right now or "No match playing". Functions of the DayModel.
//
// What differs between the public Hub and Control Center is added through
// extension points that do nothing by default (site-engine-spec §4.10):
//   options.teamLogoHTML(code)        a logo beside each team's code and players (the dual-meet Hub's club logos);
//                                      its presence also gives an idle row a blank logo slot, so heights match
//   options.liveRow(court, m, model)  a whole row of its own for a match, or null for the standard one (team events)
//   options.emptyMatchupHTML          a blank line under an idle row's "VS", the height a team event's matchup line takes
//   options.facilityExtras(name, model) → html   one card per facility, put in options.extrasEl (the progress cards)
//   options.courtCell(facility, court, match|null) → { className, attrs, html } | null
//                                      decorates each court's cell, whichever builder drew it (Control Center's
//                                      Set match, control-center-court-control-spec.md §5.1); see withCourtCell
//   options.markPlayer(name, match) → className   a class added to one player's name, or '' (a page's own mark)
//   options.matchNote(match) → html    html added after a row's category and round (a page's own count)
//   options.countDone                  count a done court apart from the courts in play, in the count line and each
//                                      facility's title (Control Center)
//
// A match still on its court once both its scores are in is done: its court cell shows a check mark in place of
// the pulsing dot, its strip says so, and its rows carry live-done. Every row's match number is a tab in the
// top-left corner of its details (live-num).

import { escapeHtml } from './html.js';
import { captureScrollPositions, restoreScrollPositions } from './scroll.js';
import { divisionEventLabel, parseCode, roundLabel } from '../domain/codes.js';
import { courtNumberFrom } from '../domain/progress.js';
import { matchByeSide } from '../domain/byes.js';

export { courtNumberFrom };

/** The number in a court's name, to order courts by; a court with none sorts last. */
export function courtSortKey(court){
  const m = String(court).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/**
 * Every court of each facility, in court order, mapped to the match on it now or null. Every
 * scheduled court gets a row even when idle, deliberately: a table whose row count changes on
 * every refresh jumps around the page and scrolls the reader's view out from under them.
 * Court sets come from each facility's own matches (its CourtAssignment values), not from a
 * configured range. A BYE is never played or given a court. The last match (by number) with a
 * live court wins that court; a live court outside the scheduled set (a mid-event reassignment)
 * still shows up rather than being dropped.
 * @returns {Map<string, Array<[string, object|null]>>} facility name -> [court, match|null][]
 */
export function buildFacilityCourtGroups(model){
  const groups = new Map();
  model.matchesByFacility.forEach((matches, name) => {
    const realMatches = matches.filter(m => matchByeSide(m) === null);
    const byCourt = new Map();
    realMatches.forEach(m => {
      const n = courtNumberFrom(m.court);
      if(n !== null && !byCourt.has(n)) byCourt.set(n, null);
    });
    realMatches.forEach(m => { if(m.liveCourt) byCourt.set(m.liveCourt, m); });
    const sortedCourts = Array.from(byCourt.keys()).sort((a, b) => courtSortKey(a) - courtSortKey(b));
    groups.set(name, sortedCourts.map(c => [c, byCourt.get(c)]));
  });
  return groups;
}

/**
 * Placeholder row for a court with nothing live on it. Mirrors liveTableRowsHTML's real-match
 * row exactly (same cells, rowspans, lines of text, a blank logo slot when logos are in use) so
 * the row's height doesn't change the instant a match starts on this court.
 */
export function liveEmptyRowHTML(court, { teamLogoHTML, emptyMatchupHTML = '' } = {}){
  const blankTeamCell = `<div class="live-team-cell-inner">${teamLogoHTML ? `
    <span class="live-team-logo live-team-logo-placeholder" aria-hidden="true"></span>` : ''}
    <div class="live-team-text">
      <div class="live-team-code">&nbsp;</div>
      <div class="live-team-players"><span class="p">&nbsp;</span><span class="p">&nbsp;</span></div>
    </div>
  </div>`;
  return `<tr>
    <td class="live-court-cell idle" rowspan="2">${escapeHtml(court)}</td>
    <td class="live-cat-cell" colspan="3"><span class="live-empty-label">No match playing</span></td>
  </tr>
  <tr class="live-match-row">
    <td class="live-team-cell">${blankTeamCell}</td>
    <td class="live-vs-cell"><div class="live-vs-score">&nbsp;</div>${emptyMatchupHTML}</td>
    <td class="live-team-cell right">${blankTeamCell}</td>
  </tr>`;
}

/** The two table lines of one court: its match, or the idle placeholder. */
export function liveTableRowsHTML(court, m, model, options = {}){
  if(!m) return liveEmptyRowHTML(court, options);
  if(options.liveRow){
    const own = options.liveRow(court, m, model);
    if(own !== null && own !== undefined) return own;
  }
  const type = model.event.type, display = model.event.display || {};
  // divisionEventLabel (not divisionLabel): this cell already shows both teams' clubs through
  // their logos, so prefixing one team's club name would be redundant and favour whichever
  // team parses first.
  const t1Cat = divisionEventLabel(m.t1, type, display);
  const t2Cat = divisionEventLabel(m.t2, type, display);
  const cat = t1Cat !== 'Other' ? t1Cat : (t2Cat !== 'Other' ? t2Cat : '');
  const t1TBD = m.t1p1 === 'TBD';
  const t2TBD = m.t2p1 === 'TBD';
  const oppRound = roundLabel(parseCode(m.t2, type).rest) || roundLabel(parseCode(m.t1, type).rest);
  const roundText = oppRound || 'Round Robin';
  const scoreHTML = m.played
    ? `${escapeHtml(String(m.t1Score))}&ndash;${escapeHtml(String(m.t2Score))}`
    : 'VS';

  // logoRight: the logo renders after the text instead of before, so both logos sit toward the
  // table's outer edges. It sits beside the code and players, not inside the code line.
  const pClass = name => { const c = options.markPlayer ? options.markPlayer(name, m) : ''; return c ? 'p ' + c : 'p'; };
  const teamCellHTML = (code, tbd, p1, p2, logoRight) => {
    const logo = options.teamLogoHTML ? options.teamLogoHTML(code) : '';
    const text = `<div class="live-team-text">
      <div class="live-team-code${tbd ? ' tbd':''}">${escapeHtml(code)}</div>
      <div class="live-team-players">${tbd ? 'To be determined' : `<span class="${pClass(p1)}">${escapeHtml(p1)}</span><span class="${pClass(p2)}">${escapeHtml(p2)}</span>`}</div>
    </div>`;
    return `<div class="live-team-cell-inner">${logoRight ? text + logo : logo + text}</div>`;
  };

  const done = liveMatchDone(m, model);
  return `<tr${done ? ' class="live-done"' : ''}>
    ${liveCourtCellHTML(court, done)}
    <td class="live-cat-cell" colspan="3">${liveNumHTML(m)}${cat ? escapeHtml(cat) + ' &middot; ' : ''}<span class="live-round">${escapeHtml(roundText)}</span>${done ? LIVE_DONE_NOTE_HTML : ''}${options.matchNote ? options.matchNote(m) || '' : ''}</td>
  </tr>
  <tr class="live-match-row${done ? ' live-done' : ''}">
    <td class="live-team-cell">${teamCellHTML(m.t1, t1TBD, m.t1p1, m.t1p2, false)}</td>
    <td class="live-vs-cell"><div class="live-vs-score">${scoreHTML}</div></td>
    <td class="live-team-cell right">${teamCellHTML(m.t2, t2TBD, m.t2p1, m.t2p2, true)}</td>
  </tr>`;
}

/**
 * Whether the match on a court is over though it is still on the court: both scores are in (or it is a
 * series game that will never be played). The court stays the match's until someone sets the next one.
 */
function liveMatchDone(m, model){
  return !!m.played || !!(model.unneededGames && model.unneededGames.has(m));
}

/** The court cell of a court with a match on it: the pulsing dot while it is played, a check mark once done. */
function liveCourtCellHTML(court, done){
  return done
    ? `<td class="live-court-cell done" rowspan="2"><span class="live-done-mark" aria-hidden="true">✓</span>${escapeHtml(court)}</td>`
    : `<td class="live-court-cell" rowspan="2"><span class="live-dot" aria-hidden="true"></span>${escapeHtml(court)}</td>`;
}

/** The match number, a tab in the top-left corner of the match's details. */
function liveNumHTML(m){
  return `<span class="live-num" title="Match ${m.num}">#${m.num}</span>`;
}

/** After the category and round of a done match. */
const LIVE_DONE_NOTE_HTML = ' &middot; <span class="live-done-note">Done</span>';

/**
 * A court's row HTML with its court cell decorated: `className` added to the cell's class,
 * `attrs` (a string starting with a space) added to its tag, `html` appended inside it. The
 * first <td class="live-court-cell…"> only; the row unchanged when deco is null.
 * @param {string} rowHTML
 * @param {{ className?: string, attrs?: string, html?: string } | null} deco
 */
export function withCourtCell(rowHTML, deco){
  if(!deco) return rowHTML;
  return rowHTML.replace(/<td class="live-court-cell([^"]*)"([^>]*)>([\s\S]*?)<\/td>/, (all, cls, rest, inner) =>
    `<td class="live-court-cell${cls}${deco.className ? ' ' + deco.className : ''}"${rest}${deco.attrs || ''}>${inner}${deco.html || ''}</td>`);
}

/**
 * "N courts in play" for these [court, match|null] rows; with `isDone`, a done court is counted apart
 * ("1 court in play · 1 done") instead of as in play.
 */
function courtsInPlayText(rows, isDone){
  const taken = rows.filter(([, m]) => m);
  const doneCount = isDone ? taken.filter(([, m]) => isDone(m)).length : 0;
  const inPlay = taken.length - doneCount;
  return `${inPlay} court${inPlay===1?'':'s'} in play${doneCount ? ` &middot; ${doneCount} done` : ''}`;
}

/**
 * One facility's table, with its name and courts-in-play count above it unless the day has only one facility.
 * options.countDone: count a done court apart from the courts in play (Control Center).
 */
export function facilityTableHTML(facility, rows, model, options = {}){
  const isDone = options.countDone ? m => liveMatchDone(m, model) : undefined;
  const titleHTML = model.day.facilities.length === 1 ? '' : `<div class="facility-title">${escapeHtml(facility)} <span class="facility-count">${courtsInPlayText(rows, isDone)}</span></div>`;
  return `
  ${titleHTML}
  <div class="live-table-wrap" data-facility-key="${escapeHtml(facility)}">
    <table class="live-table">
      <thead><tr>
        <th>Court</th><th colspan="3">Match Details</th>
      </tr></thead>
      <tbody>${rows.map(([c, m]) => withCourtCell(liveTableRowsHTML(c, m, model, options),
        options.courtCell ? options.courtCell(facility, c, m) : null)).join('')}</tbody>
    </table>
  </div>`;
}

/**
 * The "N courts in play" line above the board. With `isDone(match)`, a done court is counted apart
 * ("1 court in play · 1 done") instead of as in play.
 */
export function liveMetaHTML(groups, isDone){
  const taken = Array.from(groups.values()).flat().filter(([, m]) => m);
  const doneCount = isDone ? taken.filter(([, m]) => isDone(m)).length : 0;
  const total = taken.length - doneCount;
  const doneText = doneCount ? ` &middot; ${doneCount} done` : '';
  return total > 0
    ? `<span class="live-dot" aria-hidden="true"></span><div class="stat"><b>${total}</b><span>court${total===1?'':'s'} in play${doneText}</span></div>`
    : `<div class="stat"><b>0</b><span>courts in play${doneText}</span></div>`;
}

/**
 * Draws the board into `boardEl` (and the count into `metaEl`, the facility cards into `extrasEl`).
 * A full rebuild on every refresh; the scroll position of a scrolled-right facility table (phones)
 * is kept so it doesn't snap back to the left edge each time.
 * @param {object} model the DayModel
 * @param {{ boardEl: Element, metaEl?: Element, extrasEl?: Element, facilityExtras?: Function, teamLogoHTML?: Function, liveRow?: Function, emptyMatchupHTML?: string, courtCell?: (facility: string, court: string, match: object|null) => ({ className?: string, attrs?: string, html?: string } | null) }} options
 */
export function renderLiveMatches(model, options){
  const { boardEl, metaEl, extrasEl, facilityExtras } = options;
  if(!boardEl) return;
  const groups = buildFacilityCourtGroups(model);
  if(metaEl) metaEl.innerHTML = liveMetaHTML(groups, options.countDone ? m => liveMatchDone(m, model) : undefined);
  const scrollPositions = captureScrollPositions(boardEl);
  boardEl.innerHTML = Array.from(groups.entries()).map(([facility, rows]) => facilityTableHTML(facility, rows, model, options)).join('');
  restoreScrollPositions(boardEl, scrollPositions);
  if(extrasEl && facilityExtras) extrasEl.innerHTML = Array.from(groups.keys()).map(name => facilityExtras(name, model)).join('');
}
