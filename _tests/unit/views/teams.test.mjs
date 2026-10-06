// views/teams.js: the markup builders and the finder's pure steps, on the team fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import { teamLevelLabel } from '../../../lib/v1/domain/teams.js';
import { eventConfig, loadSnapshot, caseTime } from '../../helpers/fixtures.mjs';
import {
  teamTimesLabel, teamCourtsLabel, matchupFirstNum, rostersHTML, rosterCardHTML, matchupCardHTML, teamStandingsHTML,
  liveRowHTML, buildTeamIndex, searchKeyFor, entryForSearchKey, autocompleteMatches, autocompleteHTML, resolveEntry,
  teamResultHTML, playerResultHTML, introHTML, groupTableHTML, createTeams,
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

// ---- §2.2 options: teamLetters, searchHint, player tags, the event's pairs ----

const plain = { teamLetters: false };
const CHIP = /class="chip"/;
const firstTeam = buildTeamIndex(model).find(e => e.kind === 'team');
const liveMatch = model.matches.find(x => x.t1p1 !== 'TBD');
const firstCode = Array.from(model.team.rosterByCode.keys())[0];
const fakeEl = () => ({ innerHTML: '', addEventListener() {}, classList: { add() {}, remove() {} } });

test('by default every place that can draw an organiser’s team letter draws it', () => {
  const index = buildTeamIndex(model);
  const mu = model.team.matchups.find(x => x.stage === null && x.group !== null);
  assert.match(matchupCardHTML(model, mu, {}, new Set(), {}), CHIP, 'matchup card');
  assert.match(teamStandingsHTML(model, {}, {}), CHIP, 'bracket table');
  assert.match(liveRowHTML(model, 'Court 1', liveMatch), CHIP, 'live row');
  assert.match(teamResultHTML(model, firstTeam, new Set(), {}), /<h2>[^<]*<span class="chip">/, 'team result heading');
  assert.match(autocompleteHTML([firstTeam]), CHIP, 'autocomplete');
  assert.match(introHTML(model, index, 'x', new Set(), {}), /team-chip-btn[^>]*>[^<]*<span class="chip">/, 'intro team chip');
  assert.match(rosterCardHTML(model, firstCode, {}), new RegExp(`Team ${firstCode} · \\d+ players?`), 'roster card meta');
});

test('teamLetters: false draws no organiser’s team letter anywhere', () => {
  const index = buildTeamIndex(model);
  const mu = model.team.matchups.find(x => x.stage === null && x.group !== null);
  const bracket1 = model.standings.filter(s => s.bracket === '1' && !s.teamCode.includes('-'));
  for (const [what, html] of [
    ['matchup card', matchupCardHTML(model, mu, {}, new Set(), plain)],
    ['bracket table', groupTableHTML(model, '1', bracket1, plain)],
    ['standings', teamStandingsHTML(model, { openGroups: new Set([1]) }, plain)],
    ['live row', liveRowHTML(model, 'Court 1', liveMatch, plain)],
    ['team result', teamResultHTML(model, firstTeam, new Set(), plain)],
    ['autocomplete', autocompleteHTML([firstTeam], plain)],
    ['intro', introHTML(model, index, 'x', new Set(), plain)],
    ['teams tab', rostersHTML(model, new Set([firstCode]), { teamLetters: false })],
    ['player result', playerResultHTML(model, index.find(e => e.kind === 'player' && e.rosterTeam && e.matchNums.length), new Set(), plain)],
  ]) assert.doesNotMatch(html, CHIP, what);
  assert.doesNotMatch(rosterCardHTML(model, firstCode, { teamLetters: false }), /Team [A-Z] ·/);
  assert.match(rosterCardHTML(model, firstCode, { teamLetters: false }), /\d+ players?<\/small>/);
  assert.doesNotMatch(rostersHTML(model, new Set(), { teamLetters: false }), /Team [A-Z] ·/);
});

test('a team with no name in the workbook still reads "Team <letter>" when letters are hidden', () => {
  const unnamed = { ...model, team: { ...model.team, rowByCode: new Map(Array.from(model.team.rowByCode, ([k, v]) => [k, { ...v, teamName: '' }])) } };
  assert.match(rosterCardHTML(unnamed, firstCode, { teamLetters: false }), new RegExp(`Team ${firstCode}`));
});

test('createTeams: searchHint and teamLetters reach the finder’s first screen', () => {
  for (const [options, hint, letters] of [
    [{}, 'Search a team, a player or a match number above.', true],
    [{ searchHint: 'Search a team or a player above.', teamLetters: false }, 'Search a team or a player above.', false],
  ]) {
    const resultsEl = fakeEl();
    const finder = { selection: null, refresh() {}, acIndex: -1, updateClear() {} };
    const teams = createTeams({ getModel: () => model, getFinder: () => finder, input: fakeEl(), acList: fakeEl(), resultsEl, saveSearch() {}, ...options });
    teams.delegate.rebuildIndex();
    teams.delegate.renderIntro();
    assert.ok(resultsEl.innerHTML.includes(hint), hint);
    assert.equal(CHIP.test(resultsEl.innerHTML), letters);
  }
});

test('a player result carries the player’s level and gender', () => {
  const index = buildTeamIndex(model);
  const player = index.find(e => e.kind === 'player' && e.rosterTeam && e.level && e.gender && e.matchNums.length);
  assert.ok(player, 'the fixture has a rostered player with a level and gender');
  const row = model.team.roster.find(r => r.player === player.name);
  assert.deepEqual([player.level, player.gender], [row.level, row.gender]);
  assert.equal(teamLevelLabel('3.5'), 'Level 3.5');
  const html = playerResultHTML(model, player, new Set(), {});
  assert.match(html, /<span class="player-head"><h2>/);
  assert.ok(html.includes(`<span class="roster-tags"><span class="roster-tag">${teamLevelLabel(row.level)}</span><span class="roster-tag">${row.gender}</span></span></span>`));
  const bare = playerResultHTML(model, { ...player, level: '', gender: '' }, new Set(), {});
  assert.doesNotMatch(bare.slice(0, bare.indexOf('results-meta')), /roster-tag/);
});

test('pair labels follow the event’s own pairs, and a model without them uses the defaults', () => {
  const mu = model.team.matchups.find(x => x.stage === null && x.group !== null);
  const withPairs = pairs => ({ ...model, event: { ...model.event, pairs } });
  const custom = { 1: { full: 'Singles', short: 'SG' }, 2: { full: 'Singles', short: 'SG' } };
  const html = matchupCardHTML(withPairs(custom), mu, {}, new Set([mu.matchUp]), {});
  assert.match(html, /tm-plabel">SG</);
  assert.match(html, /tm-plabel">Pair 3</);
  assert.doesNotMatch(html, /tm-plabel">XD/);
  const live = liveRowHTML(withPairs(custom), 'Court 1', model.matches.find(x => x.t1.endsWith('_1') && x.t1p1 !== 'TBD'));
  assert.match(live, /Singles/);
  const noPairs = matchupCardHTML(withPairs(undefined), mu, {}, new Set([mu.matchUp]), {});
  assert.match(noPairs, /tm-plabel">MD</);
  assert.match(noPairs, /tm-plabel">XD 2</);
});
