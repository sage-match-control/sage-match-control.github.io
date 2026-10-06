// views/teams.js: the markup builders and the finder's pure steps, on the team fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import { eventConfig, loadSnapshot, caseTime } from '../../helpers/fixtures.mjs';
import {
  teamTimesLabel, teamCourtsLabel, matchupFirstNum, rostersHTML, rosterCardHTML, matchupCardHTML, teamStandingsHTML,
  liveRowHTML, buildTeamIndex, searchKeyFor, entryForSearchKey, autocompleteMatches, autocompleteHTML, resolveEntry,
  teamResultHTML, playerResultHTML, introHTML,
} from '../../../lib/v1/views/teams.js';

const EV = 'pickledrive-anniversary-2026';
const model = buildDayModel(eventConfig(EV), eventConfig(EV).days[0], loadSnapshot(EV), { now: caseTime(EV), alwaysLive: true });
const hooks = { decorateRow: m => ({ className: ' clickable', attrs: ` data-n="${m.num}"`, metaHTML: '<i>hint</i>' }) };

test('times share a meridiem, courts collapse to a range', () => {
  assert.equal(teamTimesLabel(['9:00 AM', '9:25 AM']), '9:00 & 9:25 AM');
  assert.equal(teamTimesLabel(['11:00 AM', '1:00 PM']), '11:00 AM & 1:00 PM');
  assert.equal(teamCourtsLabel(['Court 1', 'Court 2']), 'Courts 1–2');
  assert.equal(teamCourtsLabel(['Court 1', 'Court 3']), 'Courts 1, 3');
  assert.equal(teamCourtsLabel(['Court 2']), 'Court 2');
  assert.equal(teamCourtsLabel([]), '');
});

test('a matchup card shows its sides and, when expanded, one row per match; the row hook applies only when interactive', () => {
  const mu = model.team.matchups.find(x => x.stage === null && x.group !== null);
  const compact = matchupCardHTML(model, mu, { compact: true }, new Set(), hooks);
  assert.match(compact, /Show matches/);
  assert.doesNotMatch(compact, /tm-rows/);
  const open = matchupCardHTML(model, mu, { compact: true }, new Set([mu.matchUp]), hooks);
  assert.match(open, /Hide matches/);
  assert.equal((open.match(/class="tm-row[ "]/g) || []).length, mu.matches.length);
  assert.doesNotMatch(open, /data-n=/);
  const interactive = matchupCardHTML(model, mu, { interactive: true }, new Set(), hooks);
  assert.match(interactive, /clickable" data-n=/);
  assert.match(interactive, /<i>hint<\/i>/);
  const only = matchupCardHTML(model, mu, { onlyMatch: mu.matches[0].num }, new Set(), hooks);
  assert.equal((only.match(/class="tm-row[ "]/g) || []).length, 1);
});

test('the standings carry bracket tables, the playoff rounds and each bracket’s matchups behind a toggle', () => {
  const html = teamStandingsHTML(model, { expanded: new Set(), openGroups: new Set() }, hooks);
  assert.match(html, /<h2 class="section-title">Brackets<\/h2>/);
  assert.match(html, /Playoffs/);
  assert.match(html, /data-tm-group="1" aria-expanded="false"/);
  const open = teamStandingsHTML(model, { expanded: new Set(), openGroups: new Set([1]) }, hooks);
  assert.match(open, /data-tm-group="1" aria-expanded="true"/);
  assert.match(open, /group-body/);
});

test('rosters group by bracket and open on request; none published says so', () => {
  const html = rostersHTML(model, new Set());
  assert.match(html, /data-roster-all="open"/);
  assert.match(html, /roster-toggle/);
  const first = Array.from(model.team.rosterByCode.keys())[0];
  assert.match(rosterCardHTML(model, first, { open: true }), /roster-list/);
  assert.doesNotMatch(rosterCardHTML(model, first, { open: false }), /roster-list/);
  assert.match(rosterCardHTML(model, first, { toggle: false }), /roster-head/);
  const none = { ...model, team: { ...model.team, roster: [], rosterByCode: new Map() } };
  assert.match(rostersHTML(none, new Set()), /aren't published yet/);
});

test('a live row has the court, the team names and the matchup score', () => {
  const m = model.matches.find(x => x.t1p1 !== 'TBD');
  const html = liveRowHTML(model, 'Court 1', m);
  assert.match(html, /live-court-cell/);
  assert.match(html, new RegExp(`#${m.num}`));
  assert.match(html, /live-matchup/);
});

test('the finder index lists teams then players; searches resolve and round-trip through a saved key', () => {
  const index = buildTeamIndex(model);
  const teams = index.filter(e => e.kind === 'team'), players = index.filter(e => e.kind === 'player');
  assert.ok(teams.length > 3 && players.length > 10);
  assert.equal(index.indexOf(teams[teams.length - 1]) < index.indexOf(players[0]), true);
  const t = teams[0], p = players[0];
  assert.equal(entryForSearchKey(index, searchKeyFor(t)), t);
  assert.equal(entryForSearchKey(index, searchKeyFor(p)), p);
  assert.equal(entryForSearchKey(index, 'junk'), null);
  assert.equal(resolveEntry(index, t.label, null).entry, t);
  assert.equal(resolveEntry(index, 'zzzzzz', null).entry, null);
  assert.equal(resolveEntry(index, 'anything', p).entry, p);
  const matches = autocompleteMatches(index, t.labelLower);
  assert.ok(matches.length >= 1 && matches.length <= 8);
  assert.match(autocompleteHTML(matches), /ac-item/);
});

test('a team’s results and a player’s results, and the first screen', () => {
  const index = buildTeamIndex(model);
  const team = index.find(e => e.kind === 'team');
  const html = teamResultHTML(model, team, new Set(), hooks);
  assert.match(html, /matchups? found, in schedule order/);
  assert.match(html, /You/);
  const player = index.find(e => e.kind === 'player' && e.matchNums.length);
  assert.match(playerResultHTML(model, player, new Set(), hooks), /results-head/);
  const intro = introHTML(model, index, 'Search here.', new Set(), hooks);
  assert.match(intro, /<span>Matchups<\/span>/);
  assert.match(intro, /team-chip-btn/);
  assert.match(intro, /All \d+ matchups, by match number\. Search here\./);
  const nums = model.team.matchups.map(matchupFirstNum);
  assert.ok(nums.every(Number.isFinite));
});
