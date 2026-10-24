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

// ---- teamScoring "games" (sage-docs/docs/specs/.../millennium-invitational-spec.md §4) ------------------------------

// Alpha beats Beta three games to one on fewer points (35 to 38); Gamma hasn't played.
const GAMES_HEADER = 'matchNumber,matchUp,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const gamesModel = teamScoring => buildDayModel(
  { key: 'e', type: 'team', display: {}, days: [], title: 'E', teamScoring },
  { key: 'd', date: '2026-10-24' },
  { isLive: true, facilities: [{ name: 'Main',
    matchesCsv: [GAMES_HEADER,
      '1,A v B,Court 1,1:00 PM,Court 1,A_1,a1,a2,11,B_1,b1,b2,9',
      '2,A v B,,1:00 PM,Court 2,A_2,a3,a4,11,B_2,b3,b4,9',
      '3,A v B,,1:00 PM,Court 3,A_3,a5,a6,11,B_3,b5,b6,9',
      '4,A v B,,1:00 PM,Court 4,A_4,a7,a8,2,B_4,b7,b8,11'].join('\n'),
    standingsCsv: 'teamCode,teamName,totalPoints,totalOpponentPoints,quotient,bracket\nG,Gamma,0,0,-,1\nB,Beta,38,35,1.0857,1\nA,Alpha,35,38,0.9211,1' }] },
  { now: 0, alwaysLive: true },
);

test('teamScoring "games": the bracket table shows W, L, PF, PA and the quotient, ranked on games', () => {
  const m = gamesModel('games');
  const html = groupTableHTML(m, '1', m.standings);
  assert.match(html, /<th class="num">W<\/th><th class="num">L<\/th><th class="num">PF<\/th><th class="num">PA<\/th><th class="num">Quotient<\/th>/);
  const names = [...html.matchAll(/<td class="tm">([A-Za-z]+)/g)].map(x => x[1]);
  assert.deepEqual(names, ['Alpha', 'Beta', 'Gamma']);
  assert.match(html, /<td class="rk">1<\/td>\s*<td class="tm">Alpha[\s\S]*?<td class="num">3<\/td>\s*<td class="num">1<\/td>\s*<td class="num">35<\/td>\s*<td class="num">38<\/td>\s*<td class="q">0\.9211<\/td>/);
  assert.match(html, /<td class="tm">Gamma[\s\S]*?<td class="num">0<\/td>\s*<td class="num">0<\/td>\s*<td class="q">—<\/td>/, 'no games yet: no quotient');
  // Before any game, no rank numbers and the sheet's order.
  const fresh = buildDayModel(m.event, m.day, { isLive: true, facilities: [{ name: 'Main', matchesCsv: GAMES_HEADER, standingsCsv: 'teamCode,teamName,bracket\nG,Gamma,1\nA,Alpha,1' }] }, { now: 0, alwaysLive: true });
  const freshHtml = groupTableHTML(fresh, '1', fresh.standings);
  assert.doesNotMatch(freshHtml, /<td class="rk">1<\/td>/);
  assert.deepEqual([...freshHtml.matchAll(/<td class="tm">([A-Za-z]+)/g)].map(x => x[1]), ['Gamma', 'Alpha']);
});

test('teamScoring "games": a tie no tiebreaker settles shares its rank and reads Tied', () => {
  const day = matchesCsv => buildDayModel(
    { key: 'e', type: 'team', display: {}, days: [], title: 'E', teamScoring: 'games' },
    { key: 'd', date: '2026-10-24' },
    { isLive: true, facilities: [{ name: 'Main', matchesCsv,
      standingsCsv: 'teamCode,teamName,bracket\nA,Alpha,1\nB,Beta,1\nC,Gamma,1' }] },
    { now: 0, alwaysLive: true },
  );
  // A beats B, B beats C, C beats A, each 11–0: level on wins and on the quotient.
  const cycle = [GAMES_HEADER,
    '1,A v B,,1:00 PM,Court 1,A_1,a1,a2,11,B_1,b1,b2,0',
    '2,B v C,,1:20 PM,Court 1,B_1,b1,b2,11,C_1,c1,c2,0',
    '3,A v C,,1:40 PM,Court 1,C_1,c1,c2,11,A_1,a1,a2,0'];
  const ranks = html => [...html.matchAll(/<td class="rk">(\d+)<\/td>/g)].map(x => x[1]);
  const m = day(cycle.join('\n'));
  const html = groupTableHTML(m, '1', m.standings);
  assert.deepEqual(ranks(html), ['1', '1', '1']);
  assert.equal((html.match(/<span class="tie-pill"[^>]*>Tied · playoff round robin<\/span>/g) || []).length, 3);
  // Before the last game the same standings carry no flag, and the ranks run on.
  const mid = day([...cycle.slice(0, 3), '3,A v C,,1:40 PM,Court 1,C_1,c1,c2,,A_1,a1,a2,'].join('\n'));
  const midHtml = groupTableHTML(mid, '1', mid.standings);
  assert.doesNotMatch(midHtml, /tie-pill/);
  assert.deepEqual(ranks(midHtml), ['1', '2', '3']);
});

test('teamScoring "games": the matchup card and the Live row lead with games', () => {
  const m = gamesModel('games');
  const card = matchupCardHTML(m, m.team.matchups[0]);
  assert.match(card, /<div class="tm-score">3 – 1<\/div><div class="tm-pairs">points 35–38<\/div>/);
  // Each side's points for, points against and quotient in the matchup, under its name.
  assert.match(card, /Alpha[\s\S]*?<div class="tm-stats">PF&nbsp;35 · PA&nbsp;38 · Q&nbsp;0\.9211<\/div>[\s\S]*?Beta[\s\S]*?<div class="tm-stats">PF&nbsp;38 · PA&nbsp;35 · Q&nbsp;1\.0857<\/div>/);
  assert.match(liveRowHTML(m, 'Court 1', m.matches[0]), /Matchup 3 – 1/);
  // The default leads with points, as before, and its card carries no per-side line.
  const p = gamesModel(undefined);
  assert.match(matchupCardHTML(p, p.team.matchups[0]), /<div class="tm-score">35 – 38<\/div><div class="tm-pairs">pairs 3–1<\/div>/);
  assert.doesNotMatch(matchupCardHTML(p, p.team.matchups[0]), /tm-stats/);
  assert.match(liveRowHTML(p, 'Court 1', p.matches[0]), /Matchup 35 – 38/);
});

test('teamColors: every team name has its mark and a matchup card is tinted between the two; none without them', () => {
  const demo = 'team-demo-2026';
  const cm = buildDayModel(eventConfig(demo), eventConfig(demo).days[0], loadSnapshot(demo), { now: caseTime(demo), alwaysLive: true });
  // A is the first team in the demo's teamColors: a circle, in its colour.
  const ACES = /<svg class="team-mark team-mark-circle" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="[^"]+" fill="#D55E00"\/><\/svg>Aces/;
  const index = buildTeamIndex(cm);
  const aces = index.find(e => e.kind === 'team' && e.base === 'A');
  const mu = cm.team.matchups.find(x => x.stage === null && x.group !== null && x.side1 === 'A' && x.side2 === 'B');
  const live = cm.matches.find(x => x.t1p1 !== 'TBD' && x.t1.startsWith('A_'));
  for (const [what, html] of [
    ['matchup card', matchupCardHTML(cm, mu, {}, new Set(), {})],
    ['bracket table', teamStandingsHTML(cm, {}, {})],
    ['live row', liveRowHTML(cm, 'Court 1', live)],
    ['team result', teamResultHTML(cm, aces, new Set(), {})],
    ['autocomplete', autocompleteHTML([aces])],
    ['intro', introHTML(cm, index, 'x', new Set(), {})],
    ['roster card', rosterCardHTML(cm, 'A', {})],
  ]) assert.match(html, ACES, what);
  assert.deepEqual(aces.mark, { color: '#D55E00', shape: 'circle' });
  assert.deepEqual(index.find(e => e.kind === 'team' && e.base === 'B').mark, { color: '#E69F00', shape: 'square' });
  assert.match(matchupCardHTML(cm, mu, {}, new Set(), {}), /<div class="tm-headline team-tint" style="--team-a:#D55E00;--team-b:#E69F00">/);
  // Focused on B, B moves to the left and so does its colour.
  assert.match(matchupCardHTML(cm, mu, { focusBase: 'B' }, new Set(), {}), /style="--team-a:#E69F00;--team-b:#D55E00"/);
  // A playoff side takes its team's mark once the organiser has typed the team in, and none before.
  const sf = cm.team.matchups.find(x => x.side1 === 'SF-A' && x.side2 === 'SF-4');
  const sfHTML = matchupCardHTML(cm, sf, {}, new Set(), {});
  assert.equal((sfHTML.match(/class="team-mark /g) || []).length, 1, 'SF-A is Aces; SF-4 is still TBD');
  assert.match(sfHTML, /class="tm-headline team-tint" style="--team-a:#D55E00">/, 'the TBD side fades to white');
  // No teamColors: nothing drawn, anywhere.
  for (const event of [{ ...cm.event, teamColors: {} }, { ...cm.event, teamColors: undefined }]) {
    const plainModel = { ...cm, event };
    const html = [teamStandingsHTML(plainModel, {}, {}), introHTML(plainModel, buildTeamIndex(plainModel), 'x', new Set(), {}),
      rosterCardHTML(plainModel, 'A', {}), matchupCardHTML(plainModel, mu, {}, new Set(), {})].join('');
    assert.doesNotMatch(html, /team-mark|team-tint/, String(event.teamColors));
  }
  assert.doesNotMatch(teamStandingsHTML(model, {}, {}), /team-mark/, 'PickleDrive lists no colours');
});

test('cardBadges: a page’s badges go in each matchup card’s header, in every view', () => {
  const mu = model.team.matchups.find(x => x.stage === null && x.group !== null);
  const badge = { cardBadges: m => `<span class="b">${m.matchUp}</span>` };
  assert.match(matchupCardHTML(model, mu, {}, new Set(), badge), new RegExp(`<div class="tm-badges"><span class="b">${mu.matchUp}</span>`));
  assert.match(teamStandingsHTML(model, { openGroups: new Set([mu.group]) }, badge), /<span class="b">/);
  assert.doesNotMatch(matchupCardHTML(model, mu, {}, new Set(), {}), /class="b"/);
});

test('rowNotes: a page’s note goes on every match line, the Standings tab’s read-only cards included', () => {
  const mu = model.team.matchups.find(x => x.stage === null && x.group !== null);
  const notes = { rowNotes: m => `<span class="n">#${m.num}</span>` };
  const count = html => (html.match(/<span class="n">/g) || []).length;
  // A bracket matchup in Standings, expanded: one note per match.
  const standings = teamStandingsHTML(model, { openGroups: new Set([mu.group]), expanded: new Set([mu.matchUp]) }, notes);
  assert.match(standings, new RegExp(`<span class="n">#${mu.matches[0].num}</span>`));
  // Read-only and interactive cards alike, beside decorateRow's own meta in the interactive one.
  assert.equal(count(matchupCardHTML(model, mu, {}, new Set(), notes)), mu.matches.length);
  const both = matchupCardHTML(model, mu, { interactive: true }, new Set(), { ...notes, decorateRow: () => ({ metaHTML: '<i>hint</i>' }) });
  assert.equal(count(both), mu.matches.length);
  assert.match(both, /<i>hint<\/i><span class="n">/);
  assert.doesNotMatch(matchupCardHTML(model, mu, {}, new Set(), {}), /class="n"/);
});

test('a matchup with a game on court reads "In progress" before any game has a score', () => {
  const base = model.team.matchups.find(x => x.stage === null && x.group !== null);
  // The same matchup with no game scored yet.
  const mu = { ...base, result: { ...base.result, state: 'not-started', played: 0, winner: null } };
  const onCourt = { ...mu, matches: mu.matches.map((m, i) => i === 0 ? { ...m, liveCourt: 'Court 1' } : { ...m, liveCourt: null }) };
  const offCourt = { ...mu, matches: mu.matches.map(m => ({ ...m, liveCourt: null })) };
  const pill = /<span class="tm-pill progress">In progress<\/span>/;
  assert.match(matchupCardHTML(model, onCourt), pill);
  assert.match(matchupCardHTML(model, onCourt), /<div class="tm-card is-progress/);
  assert.doesNotMatch(matchupCardHTML(model, offCourt), pill);
  // Before the day is live nothing is on court, whatever the sheet says.
  assert.doesNotMatch(matchupCardHTML({ ...model, isLive: false }, onCourt), pill);
});
