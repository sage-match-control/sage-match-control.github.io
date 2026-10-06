// domain/teams.js, domain/awards.js, domain/attendance.js, domain/schedule-grid.js, domain/model.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV } from '../../../lib/v1/domain/csv.js';
import { rowsToMatches } from '../../../lib/v1/domain/matches.js';
import { rowsToStandings } from '../../../lib/v1/domain/standings.js';
import * as T from '../../../lib/v1/domain/teams.js';
import * as A from '../../../lib/v1/domain/awards.js';
import * as Att from '../../../lib/v1/domain/attendance.js';
import * as G from '../../../lib/v1/domain/schedule-grid.js';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import { loadSnapshot, eventConfig, caseTime, SNAPSHOTS } from '../../helpers/fixtures.mjs';

// A day's data from short rows: [num, time, court, t1, p1, p2, s1, t2, q1, q2, s2]
const MATCH_HEADER = 'matchNumber,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const matchesCsv = rows => [MATCH_HEADER, ...rows.map(([num, t1, a, b, s1, t2, c, d, s2]) => `${num},,9:00 AM,Court 1,${t1},${a},${b},${s1 ?? ''},${t2},${c},${d},${s2 ?? ''}`)].join('\n');
const standingsCsv = rows => ['teamCode,player1,player2,wins,loss,quotient,bracket', ...rows.map(r => r.join(','))].join('\n');
const model = (type, matches, standings, display = {}) => buildDayModel(
  { key: 'e', type, display, days: [], title: 'E' }, { key: 'd', date: '2026-10-03' },
  { isLive: true, facilities: [{ name: 'Main', matchesCsv: matchesCsv(matches), standingsCsv: standingsCsv(standings) }] },
  { now: 0 },
);

// ---- teams -------------------------------------------------------------------------------------------

test('a side code splits into side, pair, stage and slot', () => {
  assert.deepEqual(T.parseSideCode('A_3'), { side: 'A', pair: 3, stage: null, slot: 'A' });
  assert.deepEqual(T.parseSideCode('SF-1_2'), { side: 'SF-1', pair: 2, stage: 'SF', slot: '1' });
  assert.deepEqual(T.parseSideCode('Br-F_4'), { side: 'Br-F', pair: 4, stage: 'Br', slot: 'F' });
  assert.deepEqual(T.parseSideCode('Fi-A'), { side: 'Fi-A', pair: null, stage: 'Fi', slot: 'A' });
  assert.ok(T.isGroupTeamCode('A_1') && !T.isGroupTeamCode('QF-3_1'));
  assert.equal(T.sideOf('QF-3_1'), 'QF-3');
  assert.equal(T.pairOf('QF-3_1'), 1);
});

test('pairs are numbered when a doubles type repeats', () => {
  assert.deepEqual(T.numberRepeatedPairs({ 1: { full: 'A', short: 'a' }, 2: { full: 'B', short: 'a' }, 3: { full: 'C', short: 'c' } }),
    { 1: { full: 'A 1', short: 'a 1' }, 2: { full: 'B 2', short: 'a 2' }, 3: { full: 'C', short: 'c' } });
  assert.equal(T.pairLabel('A_1', true), 'MD');
  assert.equal(T.pairLabel('A_3', true), 'XD 1');
  assert.equal(T.pairLabel('A_4', false), 'Mixed Doubles 2');
  assert.equal(T.pairLabel('A_9', true), 'Pair 9', 'an unknown pair number is never blank');
  assert.equal(T.pairLabel('A', true), '', 'no pair number, no label');
  assert.equal(T.STAGES.Fi.order, 4);
});

test("pairLabel reads the event's own pairs when given them", () => {
  const three = T.numberRepeatedPairs({ 1: { full: "Men's Doubles", short: 'MD' }, 2: { full: "Women's Doubles", short: 'WD' }, 3: { full: 'Mixed Doubles', short: 'XD' } });
  assert.equal(T.pairLabel('A_3', true, three), 'XD');
  assert.equal(T.pairLabel('A_3', false, three), 'Mixed Doubles');
  assert.equal(T.pairLabel('A_4', true, three), 'Pair 4');
  assert.equal(T.pairLabel('A_4', true, undefined), 'XD 2', 'undefined means the default pairs');
  assert.equal(T.pairLabel('A_7', true), 'Pair 7');
});

const TEAM_ROWS = [
  { teamCode: 'A', teamName: 'Aces', bracket: '1', pf: 0, quotient: null },
  { teamCode: 'B', teamName: '', bracket: '2', pf: 0, quotient: null },
  { teamCode: 'C', teamName: 'Cs', bracket: '', pf: 0, quotient: null },
];
const rowByCode = new Map(TEAM_ROWS.map(r => [r.teamCode, r]));

test('names, groups and labels come from the standings; a playoff side borrows its slot’s team', () => {
  assert.equal(T.baseTeamOf('A', rowByCode), 'A');
  assert.equal(T.baseTeamOf('SF-A', rowByCode), 'A');
  assert.equal(T.baseTeamOf('SF-1', rowByCode), null, 'a seed with no team letter yet');
  assert.equal(T.teamNameOf('SF-A', rowByCode), 'Aces');
  assert.equal(T.teamNameOf('B', rowByCode), null, 'no name typed');
  assert.equal(T.sideLabel('SF-1', rowByCode), 'Seed 1 · TBD');
  assert.equal(T.sideLabel('B', rowByCode), 'B');
  assert.equal(T.groupOf('A', rowByCode), 1);
  assert.equal(T.groupOf('C', rowByCode), null);
  assert.equal(T.stageLabel('A', rowByCode), 'Bracket 1');
  assert.equal(T.stageLabel('C', rowByCode), 'Bracket');
  assert.equal(T.stageLabel('SF-A', rowByCode), 'Semifinal');
  assert.equal(T.stageLabel('ZZ-1', rowByCode), 'ZZ');
});

const tm = (t1, s1, t2, s2) => ({ t1, t2, t1Score: s1, t2Score: s2, played: s1 !== null && s2 !== null });

test('a matchup is won on total points; pair wins never decide it', () => {
  const r = T.teamMatchupResult([tm('A_1', 11, 'B_1', 0), tm('A_2', 11, 'B_2', 0), tm('A_3', 0, 'B_3', 11), tm('A_4', 9, 'B_4', 11)]);
  assert.deepEqual([r.pts1, r.pts2, r.pairs1, r.pairs2, r.state, r.winner], [31, 22, 2, 2, 'final', 1]);
  // Team 2 wins three of the four pairs but team 1 scores more points: team 1 wins.
  const lost = T.teamMatchupResult([tm('A_1', 11, 'B_1', 0), tm('A_2', 9, 'B_2', 11), tm('A_3', 9, 'B_3', 11), tm('A_4', 9, 'B_4', 11)]);
  assert.deepEqual([lost.pts1, lost.pts2, lost.pairs1, lost.pairs2, lost.winner], [38, 33, 1, 3, 1]);
  assert.equal(T.teamMatchupResult([tm('A_1', 11, 'B_1', 11), tm('A_2', 5, 'B_2', 5)]).state, 'tie');
  assert.equal(T.teamMatchupResult([tm('A_1', 11, 'B_1', 3), tm('A_2', null, 'B_2', null)]).state, 'in-progress');
  assert.equal(T.teamMatchupResult([tm('A_1', null, 'B_1', null)]).state, 'not-started');
});

test('bracket ranking: points, quotient, then head-to-head points, then pair wins', () => {
  const row = (teamCode, pf, quotient) => ({ teamCode, pf, quotient });
  // A and B level on pf and quotient: head-to-head points decide (B scored more against A).
  const matches = [tm('A_1', 5, 'B_1', 11), tm('A_2', 11, 'B_2', 4), tm('B_3', 7, 'A_3', 3)];
  const out = T.teamRankBracket([row('A', 100, 1.2), row('B', 100, 1.2), row('C', 120, 1.0)], matches);
  assert.deepEqual(out.map(r => r.teamCode), ['C', 'B', 'A']);
  // Level on head-to-head points too: pair wins decide.
  const level = [tm('A_1', 11, 'B_1', 5), tm('A_2', 5, 'B_2', 11), tm('A_3', 11, 'B_3', 5), tm('A_4', 3, 'B_4', 5)];
  assert.deepEqual(T.teamRankBracket([row('A', 1, 1), row('B', 1, 1)], level).map(r => r.teamCode), ['A', 'B']);
  // Playoff matches are not group matches.
  assert.deepEqual(T.teamRankBracket([row('A', 1, 1), row('B', 1, 1)], [tm('SF-A_1', 0, 'SF-B_1', 11)]).map(r => r.teamCode), ['A', 'B']);
});

test('rosters: parse, group by team, order by level then sheet order', () => {
  const rows = parseCSV('teamCode,player,level,gender\nA,Zed,4.0,M\nA,Amy,3.0,F\nA,Bo,,M\nA,Cy,3.0,M\nB,Di,2.5,F\n,Nobody,1,M');
  assert.equal(T.teamRowsToRoster(rows).length, 5);
  const { roster, byCode } = T.buildTeamRoster({ facilities: [{ rosterCsv: 'teamCode,player,level,gender\nA,Zed,4.0,M\nA,Amy,3.0,F\nA,Bo,,M\nA,Cy,3.0,M\nB,Di,2.5,F' }, { name: 'no roster' }] });
  assert.equal(roster.length, 5);
  assert.deepEqual(T.teamRosterOf(byCode, 'A').map(r => r.player), ['Amy', 'Cy', 'Zed', 'Bo']);
  assert.deepEqual(T.teamRosterOf(byCode, 'Q'), []);
  assert.deepEqual(T.teamRowsToRoster(parseCSV('x,y\n1,2')), [], 'no teamCode/player columns');
  assert.equal(T.teamLevelLabel('3.5'), 'Level 3.5');
  assert.equal(T.teamLevelLabel('Beginner'), 'Beginner');
});

test('the team fixture: matchups, advancing teams and podium', () => {
  const ev = 'pickledrive-anniversary-2026';
  const m = buildDayModel(eventConfig(ev), eventConfig(ev).days[0], loadSnapshot(ev), { now: caseTime(ev) });
  assert.ok(m.team.matchups.length > 30);
  for (const mu of m.team.matchups) assert.ok(mu.matches.every(x => x.matchUp === mu.matchUp));
  const finals = m.team.matchups.find(mu => mu.stage === 'Fi');
  assert.ok(finals && m.team.advancing.size >= 4);
  const podium = A.buildTeamPodium(m);
  assert.equal(podium.category, '__team__');
  if (finals.result.state === 'final') assert.ok(podium.gold && podium.silver);
  assert.equal(podium.warning, null);
});

// ---- awards ----------------------------------------------------------------------------------------------

const P = (code, a, b) => [code, a, b];

test('a Final and a Bronze decide the podium; the loser of the Final is silver', () => {
  const m = model('standard', [
    [1, ...P('ND_F_1', 'Ann', 'Bo'), 11, ...P('ND_F_2', 'Cy', 'Di'), 7],
    [2, ...P('ND_B_1', 'Ed', 'Flo'), 5, ...P('ND_B_2', 'Gus', 'Hal'), 11],
  ], []);
  const [podium] = A.buildPodiums(m);
  assert.equal(podium.source, 'bracket');
  assert.deepEqual([podium.gold.p1, podium.silver.p1, podium.bronze.p1], ['Ann', 'Cy', 'Gus']);
  assert.equal(podium.warning, null);
});

test('a tied Final is flagged, not guessed', () => {
  const m = model('standard', [[7, ...P('ND_F_1', 'A', 'B'), 11, ...P('ND_F_2', 'C', 'D'), 11]], []);
  const [podium] = A.buildPodiums(m);
  assert.equal(podium.gold, null);
  assert.equal(podium.warning, 'Check the score for match #7');
});

test('a Bronze won by walkover (BYE in the team code or a player name) awards the real side', () => {
  for (const bye of [['BYE', 'x', 'y'], ['ND_B_2', 'bye', 'y'], ['ND_B_2', 'x', 'BYE']]) {
    const m = model('standard', [
      [1, ...P('ND_F_1', 'Ann', 'Bo'), 11, ...P('ND_F_2', 'Cy', 'Di'), 7],
      [2, ...P('ND_B_1', 'Ed', 'Flo'), null, ...bye, null],
    ], []);
    const [podium] = A.buildPodiums(m);
    assert.equal(podium.bronze.p1, 'Ed', JSON.stringify(bye));
    assert.ok(A.categoryBronzeIsByeDecided(m, 'ND'));
  }
  const plain = model('standard', [[2, ...P('ND_B_1', 'Ed', 'Flo'), 5, ...P('ND_B_2', 'Gus', 'Hal'), 11]], []);
  assert.ok(!A.categoryBronzeIsByeDecided(plain, 'ND'));
});

test('a Bronze decided in the standings alone: a real pair against a BYE slot, no match scheduled', () => {
  const m = model('standard', [[1, ...P('ND_F_1', 'Ann', 'Bo'), 11, ...P('ND_F_2', 'Cy', 'Di'), 7]], [
    ['ND_B_1', 'Ed', 'Flo', 0, 0, '', ''], ['ND_B_2', 'BYE', '', 0, 0, '', ''],
  ]);
  assert.deepEqual(A.standingsBronzeWalkover(m, 'ND').pair && A.standingsBronzeWalkover(m, 'ND').pair.player1, 'Ed');
  assert.ok(A.categoryBronzeIsByeDecided(m, 'ND'));
  assert.equal(A.buildPodiums(m)[0].bronze.p1, 'Ed');
  const pending = model('standard', [[1, ...P('ND_F_1', 'Ann', 'Bo'), 11, ...P('ND_F_2', 'Cy', 'Di'), 7]], [
    ['ND_B_1', '', '', 0, 0, '', ''], ['ND_B_2', 'BYE', '', 0, 0, '', ''],
  ]);
  assert.deepEqual(A.standingsBronzeWalkover(pending, 'ND'), { walkover: true, pair: null });
  assert.equal(A.buildPodiums(pending)[0].bronze, null, 'names not in yet: pending');
  const neither = model('standard', [], [['ND_B_1', 'Ed', '', 0, 0, '', ''], ['ND_B_2', 'Gus', '', 0, 0, '', '']]);
  assert.deepEqual(A.standingsBronzeWalkover(neither, 'ND'), { walkover: false, pair: null });
});

test('a series final: the game where a seat reaches its wins decides, not the last played', () => {
  const rows = [
    [1, ...P('ND_F_1_(1)', 'Ann', 'Bo'), 5, ...P('ND_F_2_(1)', 'Cy', 'Di'), 11],
    [2, ...P('ND_F_1_(2)', 'Ann', 'Bo'), null, ...P('ND_F_2_(2)', 'Cy', 'Di'), null],
  ];
  const m = model('standard', rows, []);
  const res = A.resolveDecisiveMatch(m, 'ND', 'F');
  assert.deepEqual([res.any, res.match, res.error], [true, null, null], 'seat 2 won game 1: game 2 is still to play');
  const decided = model('standard', [rows[0], [2, ...P('ND_F_1_(2)', 'Ann', 'Bo'), 4, ...P('ND_F_2_(2)', 'Cy', 'Di'), 11]], []);
  const dec = A.resolveDecisiveMatch(decided, 'ND', 'F');
  assert.equal(dec.match.num, 2);
  assert.equal(A.winnerOfMatch(dec.match).p1, 'Cy');
  assert.equal(A.loserOfMatch(dec.match).p1, 'Ann');
});

test('resolveDecisiveMatch: nothing, pending, a tie and a double BYE', () => {
  assert.deepEqual(A.resolveDecisiveMatch(model('standard', [], []), 'ND', 'F'), { any: false, match: null, error: null });
  const pending = model('standard', [[1, ...P('ND_F_1', 'A', 'B'), null, ...P('ND_F_2', 'C', 'D'), null]], []);
  assert.deepEqual(A.resolveDecisiveMatch(pending, 'ND', 'F'), { any: true, match: null, error: null });
  const both = model('standard', [[1, ...P('ND_F_1', 'bye', 'B'), null, ...P('BYE', 'C', 'D'), null]], []);
  assert.equal(A.resolveDecisiveMatch(both, 'ND', 'F').error, 'bothBye');
});

test('with no bracket, the top three standings are the podium once every Round Robin match is scored', () => {
  const standings = [['ND_1', 'A', 'a', 3, 0, 3, 1], ['ND_2', 'B', 'b', 2, 1, 2, 1], ['ND_3', 'C', 'c', 1, 2, 1, 1], ['ND_4', 'D', 'd', 0, 3, 0.1, 1], ['ND_5', 'ND_5', '', 0, 0, '', 1]];
  const open = model('standard', [[1, ...P('ND_1', 'A', 'a'), 11, ...P('ND_2', 'B', 'b'), 3], [2, ...P('ND_3', 'C', 'c'), null, ...P('ND_4', 'D', 'd'), null]], standings);
  const [pending] = A.buildPodiums(open);
  assert.deepEqual([pending.source, pending.gold, pending.silver, pending.bronze], ['standings', null, null, null]);
  assert.ok(!A.categoryRoundRobinDone(open, 'ND'));
  const full = model('standard', [[1, ...P('ND_1', 'A', 'a'), 11, ...P('ND_2', 'B', 'b'), 3], [2, ...P('ND_3', 'C', 'c'), 11, ...P('ND_4', 'D', 'd'), 3]], standings);
  const [podium] = A.buildPodiums(full);
  assert.deepEqual([podium.gold.p1, podium.silver.p1, podium.bronze.p1], ['A', 'B', 'C']);
  assert.deepEqual(A.standingsTop3ForCategory(full, 'ND').map(x => x.p1), ['A', 'B', 'C']);
});

test('categories come out in the display order; a dual meet names the medalist’s club', () => {
  const display = { divisions: { LI: 'Low', HI: 'High' }, events: { WD: 'W' }, clubs: { PNF: 'Pickle', BUP: 'Bataan' } };
  const m = model('dual-meet', [
    [1, ...P('PNF_HIWD_F_1', 'A', 'a'), 11, ...P('BUP_HIWD_F_1', 'B', 'b'), 5],
    [2, ...P('PNF_LIWD_F_1', 'C', 'c'), 11, ...P('BUP_LIWD_F_1', 'D', 'd'), 5],
  ], [], display);
  const podiums = A.buildPodiums(m);
  assert.deepEqual(podiums.map(p => p.category), ['LIWD', 'HIWD'], 'LI is listed before HI in display.divisions');
  assert.deepEqual([podiums[1].gold.club, podiums[1].gold.clubLabel, podiums[1].silver.club], ['PNF', 'Pickle', 'BUP']);
});

test('the overall champion of a dual meet is the club with the most Round Robin wins', () => {
  const display = { clubs: { PNF: 'Pickle', BUP: 'Bataan' } };
  const standings = [['PNF_LIWD_1', 'a', 'b', 3, 0, 1, 1], ['PNF_LIWD_F_1', 'c', 'd', 9, 0, 1, 1], ['BUP_LIWD_1', 'e', 'f', 1, 2, 1, 1]];
  const m = model('dual-meet', [], standings, display);
  const oc = A.computeOverallChampion(m);
  assert.deepEqual(oc.rows.map(r => [r.club, r.wins]), [['PNF', 3], ['BUP', 1]], 'playoff rows do not count');
  assert.equal(oc.champion.club, 'PNF');
  assert.equal(oc.tied, false);
  const tie = A.computeOverallChampion(model('dual-meet', [], [['PNF_LIWD_1', 'a', 'b', 2, 0, 1, 1], ['BUP_LIWD_1', 'e', 'f', 2, 1, 1, 1]], display));
  assert.deepEqual([tie.champion, tie.tied], [null, true]);
  assert.equal(A.computeOverallChampion(model('dual-meet', [], [['PNF_LIWD_1', 'a', 'b', 0, 0, 1, 1]], display)).champion, null, '0-0');
  assert.equal(A.computeOverallChampion(model('standard', [], standings, display)), null, 'not a dual meet');
  assert.equal(A.computeOverallChampion(model('dual-meet', [], [], display)), null, 'nothing yet');
});

// ---- attendance ------------------------------------------------------------------------------------------------

const ATT_CSV = '"key","player","teams","categories","present","timeIn","withdrawn","T-Shirt Size"\n' +
  '"ana cruz","Ana Cruz","NMD_1, LIMD_1","NMD, LIMD","TRUE","2026-10-03 08:30","FALSE","M"\n' +
  '"ben lim","","NMD_1","NMD","FALSE","","TRUE",""\n' +
  '"ana cruz","Dup","X","X","FALSE","","FALSE",""\n' +
  '"","blank key","","","","","",""\n';

test('the ATTENDANCE tab: one person per first row of each key', () => {
  const people = Att.parseAttendanceCsv(ATT_CSV);
  assert.equal(people.length, 2);
  assert.deepEqual(people[0], { key: 'ana cruz', player: 'Ana Cruz', teams: ['NMD_1', 'LIMD_1'], categories: ['NMD', 'LIMD'], present: true, timeIn: '2026-10-03 08:30', withdrawn: false, shirt: 'M' });
  assert.equal(people[1].player, 'ben lim', 'a missing name falls back to the key');
  assert.deepEqual(Att.parseAttendanceCsv('no header here'), []);
  assert.deepEqual(Att.parseAttendanceCsv(''), []);
  assert.ok(Att.ATTENDANCE_SHIRT_HEADERS.includes('TShirt Size'));
});

test('the desk groups people by category, or by team for a team event; withdrawn are left out', () => {
  const people = Att.parseAttendanceCsv(ATT_CSV);
  const std = Att.groupForDesk(people, { type: 'standard', categoryLabel: c => `Label ${c}` });
  assert.deepEqual(std.map(s => [s.id, s.label, s.cards.map(c => c.teamCode)]), [['NMD', 'Label NMD', ['NMD_1']], ['LIMD', 'Label LIMD', ['LIMD_1']]]);
  assert.equal(Att.groupForDesk(people, { type: 'standard', showWithdrawn: true })[0].cards[0].players.length, 2);
  const team = Att.groupForDesk([{ key: 'k', player: 'K', teams: ['A'], categories: [], withdrawn: false }], { type: 'team', teamName: c => (c === 'A' ? 'Aces' : null) });
  assert.deepEqual(team.map(s => s.label), ['Aces']);
  assert.deepEqual(Att.groupForDesk([{ key: 'k', player: 'K', teams: ['B'], categories: [], withdrawn: false }], { type: 'team' }).map(s => s.label), ['Team B']);
  assert.deepEqual(Att.groupForDesk(null), []);
});

test('duplicate names: the same letters, or one edit apart for names of five letters or more', () => {
  const p = key => ({ key, withdrawn: false, categories: [] });
  const pairs = Att.possibleDuplicates([p('dela cruz'), p('delacruz'), p('juan'), p('juana'), p('maria santos'), p('maria santoz'), p('sam tan'), { ...p('samtan'), withdrawn: true }]);
  assert.deepEqual(pairs.map(([a, b]) => [a.key, b.key]), [['dela cruz', 'delacruz'], ['maria santos', 'maria santoz']]);
  assert.ok(Att.attOneEditApart('abcde', 'abcdf') && Att.attOneEditApart('abcde', 'abde') && !Att.attOneEditApart('abcde', 'abxyz') && !Att.attOneEditApart('a', 'a'));
  assert.equal(Att.attLettersOnly('Dela-Cruz, Jr.'), 'DelaCruzJr');
  assert.deepEqual(Att.sameNameSameCategory([{ withdrawn: false, categories: ['NMD', 'NMD'] }, { withdrawn: false, categories: ['NMD', 'LIMD'] }, { withdrawn: true, categories: ['A', 'A'] }]).length, 1);
});

test('times and category labels', () => {
  assert.equal(Att.attClockTime('2026-10-03 08:30'), '8:30 AM');
  assert.equal(Att.attClockTime('2026-10-03 13:05'), '1:05 PM');
  assert.equal(Att.attClockTime('12:00 AM'), '12:00 AM');
  assert.equal(Att.attClockTime('12:15 PM'), '12:15 PM');
  assert.equal(Att.attClockTime('whenever'), 'never', 'an unreadable time falls back to its last five characters');
  assert.deepEqual(Att.attSplitList(' a, b ,,c'), ['a', 'b', 'c']);
  assert.equal(Att.defaultCategoryLabel('NMD', { divisions: { N: 'Novice' }, events: { MD: "Men's" } }), "Novice Men's");
  assert.equal(Att.defaultCategoryLabel('QQ', {}), 'QQ');
  assert.deepEqual(Att.attParseCsv('"a ""q""",b\r\n"c,d",e'), [['a "q"', 'b'], ['c,d', 'e']]);
});

// ---- schedule grid -----------------------------------------------------------------------------------------------

test('court assignment: a valid free court, else the first free lane, else unplaced', () => {
  const m = (num, court) => ({ num, court });
  const { courts, unplaced } = G.assignCourts([m(1, 2), m(2, 2), m(3, null), m(4, 9), m(5, 1)], 3, [1, 2, 3]);
  assert.deepEqual(courts.map(x => x && x.num), [5, 1, 2], 'the second claim on court 2 and the blank take the free lanes');
  assert.deepEqual(unplaced.map(x => x.num), [3, 4], 'no lane is left for the blank, nor for court 9, which is not a lane');
  const full = G.assignCourts([m(1, 1), m(2, 1), m(3, 1)], 2, [1, 2]);
  assert.deepEqual(full.unplaced.map(x => x.num), [3]);
});

test('the court filter round-trips through the URL form', () => {
  const list = [1, 2, 3, 4, 5, 6, 7];
  assert.deepEqual([...G.parseCourtsParam('1-3,5,9', list)], [1, 2, 3, 5]);
  assert.equal(G.parseCourtsParam('9', list), null);
  assert.equal(G.parseCourtsParam('', list), null);
  assert.equal(G.parseCourtsParam(null, list), null);
  assert.equal(G.courtsToParam(new Set([1, 2, 3, 5, 7]), list), '1-3,5,7');
  assert.equal(G.courtsToParam(new Set(list), list), null);
  assert.equal(G.courtsToParam(new Set(), list), null);
  assert.equal(G.courtsToParam(null, list), null);
});

test('printed sheets are chunked evenly', () => {
  assert.deepEqual(G.chunkBalanced([1, 2, 3, 4, 5, 6, 7, 8, 9], 4), [[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  assert.deepEqual(G.chunkBalanced([1, 2, 3, 4, 5], 4), [[1, 2, 3], [4, 5]]);
  assert.deepEqual(G.chunkBalanced([], 4), []);
});

test('small helpers: names, scores, courts, colours, clubs', () => {
  assert.deepEqual([G.nameOrNull(' Ann '), G.nameOrNull(''), G.nameOrNull('#REF!'), G.nameOrNull(undefined)], ['Ann', null, null, null]);
  assert.deepEqual([G.scoreOrNull('0'), G.scoreOrNull(' 11'), G.scoreOrNull(''), G.scoreOrNull('x')], [0, 11, null, null]);
  assert.deepEqual([G.parseCourtAssignment('Court 3'), G.parseCourtAssignment('SCORE'), G.parseCourtAssignment('')], [3, null, null]);
  assert.equal(G.readableOn('#741B47'), '#FFFFFF');
  assert.equal(G.readableOn('#F6B26B'), '#14263C');
  assert.equal(G.clubOf('pnf_LIWD_1'), 'PNF');
});

test('the schedule board on each fixture: courts, slots and the venue view', () => {
  for (const event of ['piggleball-2026', 'pickle-for-sight-2026', 'pnf-x-bup-dual-meet']) {
    const type = eventConfig(event).type;
    const snap = loadSnapshot(event);
    const data = G.buildScheduleData(snap, null, type);
    assert.ok(data.matchCount > 20 && data.matchCount === data.dayMatchCount);
    assert.equal(data.venue, null);
    assert.ok(data.rows.length > 5);
    assert.deepEqual(data.courtList, Array.from({ length: data.courts }, (_, i) => i + 1));
    for (const row of data.rows) assert.equal(row.courts.length, data.courts);
    const placed = data.rows.reduce((n, r) => n + r.courts.filter(Boolean).length + r.unplaced.length, 0);
    assert.equal(placed, data.matchCount, 'every match is placed or surfaced');
    assert.equal(G.buildScheduleData(snap, 'No such venue', type).venue, null);
  }
  const two = loadSnapshot('pickle-for-sight-2026');
  const annex = G.buildScheduleData(two, two.facilities[1].name, 'standard');
  assert.equal(annex.venue, two.facilities[1].name);
  assert.ok(annex.matchCount < annex.dayMatchCount);
  assert.ok(annex.courtList[0] > 1, 'a venue view shows only its own span of courts');
});

test('the board reads the category from the right segment of a code', () => {
  const csv = matchesCsv([[1, 'PNF_LIWD_1', 'a', 'b', null, 'BUP_LIWD_1', 'c', 'd', null]]);
  assert.equal(G.parseFacilityCsv(csv, 'dual-meet')[0].cat, 'LIWD');
  assert.equal(G.parseFacilityCsv(csv, 'standard')[0].cat, 'PNF');
  assert.deepEqual(G.parseFacilityCsv('', 'standard'), []);
});

// ---- the day model -----------------------------------------------------------------------------------------------

for (const event of Object.keys(SNAPSHOTS)) {
  test(`${event}: buildDayModel derives everything a view needs`, () => {
    const cfg = eventConfig(event);
    const snap = loadSnapshot(event);
    const m = buildDayModel(cfg, cfg.days[0], snap, { now: caseTime(event) });
    assert.equal(m.event, cfg);
    assert.equal(m.snapshot, snap);
    assert.equal(m.isLive, true, 'auto, 13:00 on the day');
    assert.equal(m.matches.length, snap.facilities.reduce((n, f) => n + rowsToMatches(parseCSV(f.matchesCsv)).length, 0));
    assert.deepEqual(m.matches.map(x => x.num), m.matches.map(x => x.num).slice().sort((a, b) => a - b));
    assert.deepEqual([...m.matchesByFacility.keys()], snap.facilities.map(f => f.name));
    assert.equal(m.standings.length, snap.facilities.reduce((n, f) => n + rowsToStandings(parseCSV(f.standingsCsv)).length, 0));
    assert.ok(m.matches.every(x => m.matchByCode.has(x.t1) && m.matchByCode.has(x.t2)));
    assert.ok(m.matches.every(x => snap.facilities.some(f => f.name === x.facility)));
    assert.equal(!!m.team, cfg.type === 'team');
  });
}

test('buildDayModel: alwaysLive overrides the day’s setting; no snapshot gives an empty model', () => {
  const cfg = eventConfig('piggleball-2026');
  const snap = { ...loadSnapshot('piggleball-2026'), isLive: false };
  assert.equal(buildDayModel(cfg, cfg.days[0], snap, { now: caseTime('piggleball-2026') }).isLive, false);
  assert.equal(buildDayModel(cfg, cfg.days[0], snap, { now: 0, alwaysLive: true }).isLive, true);
  const empty = buildDayModel(cfg, cfg.days[0], null, { now: 0 });
  assert.deepEqual([empty.matches.length, empty.standings.length, empty.isLive, empty.matchesByFacility.size, empty.snapshot], [0, 0, false, 0, null]);
});
