// The two shapes every view uses (site-engine-spec §4.4), and the function that
// derives the second from a snapshot.
//
// Today the pages keep this state in mutable globals (MATCHES, MATCH_BY_CODE,
// UNNEEDED_GAMES, STANDINGS, dayIsLive, and in Control Center CURRENT_TYPE and
// DISPLAY). Shared code receives a DayModel (or an EventConfig) as a
// parameter instead.

import { parseCSV } from './csv.js';
import { rowsToMatches, buildMatchByCodeIndex } from './matches.js';
import { rowsToStandings } from './standings.js';
import { unneededSeriesGames } from './series.js';
import { computeDayIsLive } from './golive.js';
import { buildTeamData, buildTeamRoster } from './teams.js';

/**
 * One event, as every engine page sees it. Built by data/registry.js's
 * eventConfigFrom(registry, eventKey) from event-data/config/events.json.
 * @typedef {object} EventConfig
 * @property {string} key                       the event key, e.g. "piggleball-2026"
 * @property {"standard"|"dual-meet"|"team"} type
 * @property {string} title
 * @property {DayConfig[]} days                 in the order events.json lists them
 * @property {{ divisions?: Record<string,string>, events?: Record<string,string>,
 *              clubs?: Record<string,string> }} display
 * @property {"links"|"console"|undefined} scoreEntry
 * @property {string|undefined} attendance
 *
 * @typedef {object} DayConfig
 * @property {string} key                       e.g. "piggleball-day1"
 * @property {string} label                     e.g. "Oct 3"
 * @property {string|undefined} date            "YYYY-MM-DD", Asia/Manila
 * @property {string[]} facilities              facility names, in order
 */

/**
 * Match = { num, time, court, liveCourt, matchUp, t1, t1p1, t1p2, t2, t2p1,
 *           t2p2, t1Score, t2Score, played } (see matches.js), with `facility`
 * added to the day's combined list.
 *
 * One day's data, derived once per snapshot and handed to every view.
 * Built by buildDayModel(event, day, snapshot, { now, alwaysLive }).
 * @typedef {object} DayModel
 * @property {EventConfig} event
 * @property {DayConfig} day
 * @property {object|null} snapshot             the raw snapshot, null before the first load
 * @property {boolean} isLive                   computeDayIsLive, or true when alwaysLive (CC)
 * @property {object[]} matches                 every facility's matches, sorted by number
 * @property {Map<string, object[]>} matchesByFacility
 * @property {Map<string, object>} matchByCode
 * @property {Set<object>} unneededGames        series games after the decider
 * @property {object[]} standings
 * @property {object|undefined} team            team-type data, team events only:
 *   { rowByCode, matchups, advancing, roster, rosterByCode } (teams.js)
 */

/**
 * @param {EventConfig} event
 * @param {DayConfig} day
 * @param {object|null} snapshot  the day's published snapshot, null before the first load
 * @param {{ now?: number, alwaysLive?: boolean }} [options]
 *   now         ms since the epoch: the clock's reading, passed in (a domain function never reads the clock);
 *               needed unless alwaysLive
 *   alwaysLive  true: the page always shows scores (Control Center); the day's own go-live setting is ignored
 * @returns {DayModel}
 */
export function buildDayModel(event, day, snapshot, { now, alwaysLive = false } = {}){
  const facilities = (snapshot && snapshot.facilities) || [];
  // Each facility's own matches stay separate (matchesByFacility) so the Live
  // Matches board can group courts per facility straight from the data. Match
  // numbers and team codes are unique across a day's facilities, so the
  // combined list is just a concatenation.
  const perFacility = facilities.map(f => ({ name: f.name, matches: rowsToMatches(parseCSV(f.matchesCsv)) }));
  const matches = perFacility
    .flatMap(f => f.matches.map(m => ({ ...m, facility: f.name })))
    .sort((a, b) => a.num - b.num);
  const standings = facilities.flatMap(f => rowsToStandings(parseCSV(f.standingsCsv)));

  const model = {
    event, day, snapshot,
    isLive: alwaysLive || computeDayIsLive(day, snapshot, now),
    matches,
    matchesByFacility: new Map(perFacility.map(f => [f.name, f.matches])),
    matchByCode: buildMatchByCodeIndex(matches),
    unneededGames: unneededSeriesGames(matches),
    standings,
  };
  if(event.type === 'team'){
    const { roster, byCode } = buildTeamRoster(snapshot);
    model.team = { ...buildTeamData(matches, standings), roster, rosterByCode: byCode };
  }
  return model;
}
