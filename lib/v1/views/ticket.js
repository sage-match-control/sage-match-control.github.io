// The ticket: one match as Match Finder shows it, a standings row's pair cell,
// and a standings row's win/loss class.
//
// Every function takes the DayModel (domain/model.js) and the options below
// instead of reading page state. The only things that differ between the
// public Hub and Control Center are added through extension points
// (site-engine-spec §4.10), each of which does nothing by default.

import { escapeHtml } from './html.js';
import { parseCode, roundLabel } from '../domain/codes.js';
import { isEmptyStanding } from '../domain/standings.js';
import { isUnnamedScheduledPair } from '../domain/matches.js';

/** 'win' | 'loss' | '' for a standings row: any games played, and more wins than losses. */
export function standingRowClass(s){
  if(s.wins === 0 && s.loss === 0) return '';
  return s.wins > s.loss ? 'win' : 'loss';
}

/**
 * A pair's table cell: its two players, or its code (a Round Robin pair whose
 * names aren't in yet), or "TBD" (a playoff slot not seeded yet). The full
 * names ride along as a title, for tables that cut a long name short.
 * @param {object} s      a standings row
 * @param {import('../domain/model.js').DayModel} model
 */
export function pairCell(s, model){
  if(isUnnamedScheduledPair(s, model.matchByCode, model.event.type)){
    return `<td class="pair tbd"><span>${escapeHtml(s.teamCode)}</span></td>`;
  }
  if(isEmptyStanding(s)){
    return `<td class="pair tbd"><span>TBD</span></td>`;
  }
  const p1 = s.player1 ? escapeHtml(s.player1) : '';
  const p2 = s.player2 ? escapeHtml(s.player2) : '';
  return `<td class="pair" title="${p1} / ${p2}"><span>${p1}</span><span>${p2}</span></td>`;
}

/**
 * One match as a ticket.
 *
 * @param {object} m                                match
 * @param {import('../domain/model.js').DayModel} model
 * @param {object} [options]
 *   teamCode   whose side is "You" (on the left, with the You badge); none: a
 *              neutral ticket (the all-matches list), team 1 on the left
 *   isNext     flag this as the pair's Next Up match
 *   decorate(m) -> { className?, attrs?, metaHTML? }
 *              extension point: a page adds to the ticket without the core
 *              knowing why. className is appended to the ticket's classes
 *              (with its own leading space), attrs go inside its opening tag
 *              (leading space too), metaHTML ends its meta row. Default: nothing.
 *   teamLogoHTML(code) -> html
 *              extension point: a logo shown in front of a side's code (the
 *              dual-meet Hub's club logos). Default: nothing.
 */
export function ticketHTML(m, model, options = {}){
  const { teamCode, isNext = false, decorate, teamLogoHTML } = options;
  const type = model.event.type;
  const dayIsLive = model.isLive;
  // No teamCode: a neutral ticket (the all-matches list), team 1 on the left
  // and no "You" badge.
  const neutral = !teamCode;
  const isT1 = neutral || m.t1 === teamCode;
  const you = isT1 ? {code:m.t1, p1:m.t1p1, p2:m.t1p2} : {code:m.t2, p1:m.t2p1, p2:m.t2p2};
  const opp = isT1 ? {code:m.t2, p1:m.t2p1, p2:m.t2p2} : {code:m.t1, p1:m.t1p1, p2:m.t1p2};
  const youTBD = you.p1 === 'TBD';
  const oppTBD = opp.p1 === 'TBD';
  const oppRound = roundLabel(parseCode(opp.code, type).rest);
  const tag = oppRound
    ? `<span class="tag round">${oppRound}</span>`
    : `<span class="tag pool">Round Robin</span>`;

  const youScore = isT1 ? m.t1Score : m.t2Score;
  const oppScore = isT1 ? m.t2Score : m.t1Score;
  const youWon = m.played && youScore > oppScore;
  const oppWon = m.played && oppScore > youScore;

  const scoreHTML = (dayIsLive && m.played)
    ? `<span class="score-num ${youWon?'win':''}">${escapeHtml(String(youScore))}</span><span class="score-colon">:</span><span class="score-num ${oppWon?'win':''}">${escapeHtml(String(oppScore))}</span>`
    : `<span class="vs-text">VS</span>`;

  const isLive = dayIsLive && !!m.liveCourt;
  const displayCourt = isLive ? m.liveCourt : m.court;
  const displayCourtLabel = isLive ? `Court ${displayCourt}` : displayCourt;
  // A single-facility event has nothing to disambiguate, so naming it on
  // every card would just be noise (see facilityTableHTML's identical check).
  // m.facility is stamped on every match when the day's matches are built
  // (buildDayModel) from whichever facility block of the snapshot it came
  // from — no court-range guessing needed.
  const facility = model.day.facilities.length > 1 ? m.facility : null;
  const courtHTML = displayCourt
    ? `<span class="court-pill">${escapeHtml(displayCourtLabel)}${facility ? ` &middot; ${escapeHtml(facility)}` : ''}</span>`
    : '';
  const livePillHTML = isLive
    ? `<span class="live-pill"><span class="live-dot" aria-hidden="true"></span>Live</span>`
    : '';
  // Only flag as "Next Up" if it isn't already live — a match in progress
  // is covered by the Live pill above, so showing both would be redundant.
  const nextPillHTML = dayIsLive && isNext && !isLive
    ? `<span class="next-pill">Next Up</span>`
    : '';

  // A series final's game that is never played: greyed out, with a title saying so.
  const notNeeded = model.unneededGames.has(m);
  const extra = (decorate && decorate(m)) || {};
  const logo = code => (teamLogoHTML ? teamLogoHTML(code) : '');

  return `
  <div class="ticket${dayIsLive && isNext && !isLive ? ' next' : ''}${notNeeded ? ' not-needed' : ''}${extra.className || ''}"${notNeeded ? ' title="Not needed"' : ''}${extra.attrs || ''}>
    <div class="ticket-body">
      <div class="time-row">
        <span class="center-pill">${escapeHtml(m.time)}</span>
        ${livePillHTML}
        ${nextPillHTML}
        ${courtHTML}
      </div>
      <div class="names-row">
        <div class="team-block ${youTBD ? 'tbd':''}">
          ${logo(you.code)}
          <div class="team-name">${escapeHtml(you.code)}${neutral ? '' : '<span class="you-badge">You</span>'}</div>
          <div class="players">${youTBD ? 'To be determined' : `<span class="p">${escapeHtml(you.p1)}</span><span class="p">${escapeHtml(you.p2)}</span>`}</div>
        </div>
        <div class="score-col">${scoreHTML}</div>
        <div class="team-block right ${oppTBD ? 'tbd':''}">
          ${logo(opp.code)}
          <div class="team-name">${escapeHtml(opp.code)}</div>
          <div class="players">${oppTBD ? 'To be determined' : `<span class="p">${escapeHtml(opp.p1)}</span><span class="p">${escapeHtml(opp.p2)}</span>`}</div>
        </div>
      </div>
      <div class="meta-row">
        <span class="meta-chip">Match #${m.num}</span>
        ${tag}
        ${extra.metaHTML || ''}
      </div>
    </div>
  </div>`;
}
