// A dual meet's club score on Match Finder's first screen (hub-player-experience-spec §9).
//
// clubBarHTML(model, { clubLogoHTML }) is the win-totals bar Standings opens with (views/standings.js
// clubSummaryHTML), in a wrapper that stops it sticking: '' unless the event is a dual meet and its day is live (or
// the bar has fewer than two clubs to show). The clubs are grouped and ordered as dualMeetStandingsHTML does, so the
// two bars always agree: the clubs of the event's `display.clubs` first, in that order, then any other.
//
// Only the Hub passes it to createFinder (as its `introTop`); Control Center's Match Finder draws none.

import { clubSummaryHTML } from './standings.js';
import { parseCode } from '../domain/codes.js';

/**
 * @param {object} model   the DayModel
 * @param {{ clubLogoHTML?: (code: string, name: string) => string }} [options]   a club's logo, as the Standings bar's
 */
export function clubBarHTML(model, { clubLogoHTML } = {}){
  if(model.event.type !== 'dual-meet' || !model.isLive) return '';
  const type = model.event.type, display = model.event.display || {};
  // The same grouping and order as dualMeetStandingsHTML (not shared with it: see rule 2 of the spec's §2.2).
  const byClub = new Map();
  model.standings.forEach(s => {
    const clubCode = parseCode(s.teamCode, type).club || 'OTHER';
    if(!byClub.has(clubCode)) byClub.set(clubCode, []);
    byClub.get(clubCode).push(s);
  });
  const knownClubOrder = display.clubs ? Object.keys(display.clubs) : [];
  const clubOrder = knownClubOrder.filter(c => byClub.has(c))
    .concat(Array.from(byClub.keys()).filter(c => !knownClubOrder.includes(c)));
  const summary = clubSummaryHTML(byClub, clubOrder, model, { clubLogoHTML });
  return summary ? `<div class="finder-club-bar">${summary}</div>` : '';
}
