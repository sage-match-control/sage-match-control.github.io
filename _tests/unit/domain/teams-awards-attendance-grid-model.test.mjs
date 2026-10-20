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

// ---- the board on a team day (team-tournament-template-spec §4.2) ------------------------------------------------

test('ladderStageForTeam maps a team code’s side to the board’s stage', () => {
  for (const [code, stage] of [['A_1', 'RR'], ['QF-3_1', 'QF'], ['SF-A_2', 'SF'], ['Br-1_1', 'B'], ['Fi-J_4', 'F'], ['ZZ-1_1', 'RR']]) {
    assert.equal(G.ladderStageForTeam(code), stage, code);
  }
});

test('buildScheduleData for a team day: team names, pair, stage and category per match', () => {
  const snap = loadSnapshot('team-demo-2026');
  const pairs = eventConfig('team-demo-2026').pairs;
  const data = G.buildScheduleData(snap, null, 'team', { pairs });
  const all = data.rows.flatMap(r => [...r.courts.filter(Boolean), ...r.unplaced]).sort((a, b) => a.num - b.num);
  assert.equal(all.length, 48);
  const at = n => all.find(m => m.num === n);
  assert.deepEqual(
    ['matchUp', 'team1', 'team2', 'pair', 'stage', 'cat'].map(k => at(1)[k]),
    ['A v B', 'Aces', 'Bandits', 'MD', 'RR', 'G1']);
  assert.equal(at(2).pair, 'WD');
  assert.equal(at(3).pair, 'XD', 'the demo has one mixed pair, so it is not numbered');
  assert.equal(at(19).cat, 'G2');
  assert.equal(at(19).team1, 'Eagles');
  assert.deepEqual(['matchUp', 'team1', 'team2', 'stage', 'cat'].map(k => at(37)[k]), ['SF-A v SF-4', 'Aces', 'Seed 4 · TBD', 'SF', 'PO']);
  assert.deepEqual([at(40).team1, at(43).stage, at(46).stage, at(46).cat], ['Seed 2 · TBD', 'B', 'F', 'PO']);
  assert.equal(at(11).p2a, 'D_2', 'the lineup is left as the sheet has it; the view decides "Lineup TBD"');
  assert.equal(at(1).p1a, 'Abel Tan');
  // the fields the standard and dual-meet boards read are still on a team row
  assert.deepEqual([at(1).slot, at(1).c1, at(1).c2, at(1).court, at(1).liveCourt], ['9:00 AM', 'A_1', 'B_1', 1, '']);
  assert.equal(data.courts, 4);
});

test('a team day carries each side’s group-stage team: a playoff side once its team is typed in, else null', () => {
  const all = G.buildScheduleData(loadSnapshot('team-demo-2026'), null, 'team').rows.flatMap(r => [...r.courts.filter(Boolean), ...r.unplaced]);
  const at = n => all.find(m => m.num === n);
  assert.deepEqual([at(1).base1, at(1).base2], ['A', 'B'], 'A v B');
  assert.deepEqual([at(37).base1, at(37).base2], ['A', null], 'SF-A is Aces; SF-4 has no team yet');
});

test('a team day with no pairs argument uses the default pair labels, and a pair the event lacks is "Pair n"', () => {
  const snap = loadSnapshot('team-demo-2026');
  const rows = data => data.rows.flatMap(r => r.courts.filter(Boolean));
  const dflt = rows(G.buildScheduleData(snap, null, 'team'));
  assert.equal(dflt.find(m => m.num === 3).pair, 'XD 1');
  const two = { 1: { full: 'A', short: 'A' }, 2: { full: 'B', short: 'B' } };
  assert.equal(rows(G.buildScheduleData(snap, null, 'team', { pairs: two })).find(m => m.num === 3).pair, 'Pair 3');
});

test('the standard and dual-meet boards carry no team fields', () => {
  for (const event of ['piggleball-2026', 'pnf-x-bup-dual-meet']) {
    const type = eventConfig(event).type;
    const data = G.buildScheduleData(loadSnapshot(event), null, type, { pairs: eventConfig(event).pairs });
    const sample = data.rows.flatMap(r => r.courts.filter(Boolean))[0];
    for (const k of ['matchUp', 'team1', 'team2', 'pair', 'stage']) assert.equal(k in sample, false, k);
  }
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

// ---- teamScoring "games" (sage-docs/docs/specs/.../millennium-invitational-spec.md §4) ------------------------------

test('teamScoring "games": a matchup is won on matches won, then total points', () => {
  // Side 1 wins three matches but scores fewer points: it wins on games, and would lose on points.
  const ms = [tm('A_1', 11, 'B_1', 9), tm('A_2', 11, 'B_2', 9), tm('A_3', 11, 'B_3', 9), tm('A_4', 2, 'B_4', 11)];
  const g = T.teamMatchupResult(ms, 'games');
  assert.deepEqual([g.pts1, g.pts2, g.pairs1, g.pairs2, g.state, g.winner, g.scoring], [35, 38, 3, 1, 'final', 1, 'games']);
  const p = T.teamMatchupResult(ms);
  assert.deepEqual([p.winner, p.scoring], [2, 'points'], 'the default still decides on points');
  // 2–2 on games: more total points wins.
  const split = T.teamMatchupResult([tm('A_1', 11, 'B_1', 0), tm('A_2', 11, 'B_2', 0), tm('A_3', 9, 'B_3', 11), tm('A_4', 9, 'B_4', 11)], 'games');
  assert.deepEqual([split.pairs1, split.pairs2, split.pts1, split.pts2, split.state, split.winner], [2, 2, 40, 22, 'final', 1]);
  // Level on games and on points: a tie.
  assert.equal(T.teamMatchupResult([tm('A_1', 11, 'B_1', 5), tm('A_2', 5, 'B_2', 11)], 'games').state, 'tie');
  assert.equal(T.teamMatchupResult([tm('A_1', 11, 'B_1', 3), tm('A_2', null, 'B_2', null)], 'games').state, 'in-progress');
  assert.equal(T.teamMatchupResult([tm('A_1', null, 'B_1', null)], 'games').state, 'not-started');
});

test('teamGameRecords: W, L, PF and PA from played group matches only', () => {
  const recs = T.teamGameRecords([
    tm('A_1', 11, 'B_1', 7), tm('A_2', 4, 'B_2', 11),
    tm('A_3', 9, 'B_3', 9),                         // equal scores: points count, no W or L
    tm('A_4', null, 'B_4', null),                   // not played
    tm('Fi-A_1', 11, 'Fi-B_1', 0),                  // a playoff match
  ]);
  assert.deepEqual(recs.get('A'), { won: 1, lost: 1, pf: 24, pa: 27 });
  assert.deepEqual(recs.get('B'), { won: 1, lost: 1, pf: 27, pa: 24 });
  assert.equal(recs.has('Fi-A'), false);
});

test('teamScoring "games": bracket ranking by wins, then the organiser two-team and three-team tiebreakers', () => {
  const rows = (...codes) => codes.map(teamCode => ({ teamCode, pf: 0, quotient: null }));
  const ranked = (codes, matches) => T.teamRankBracket(rows(...codes), matches, 'games');
  const rank = (codes, matches) => ranked(codes, matches).map(r => r.teamCode);
  // Two level on wins: head-to-head wins first, though B has more points and the better quotient.
  assert.deepEqual(rank(['B', 'A', 'C'], [
    tm('A_1', 11, 'B_1', 9), tm('A_2', 11, 'C_1', 10), tm('B_2', 11, 'C_2', 0), tm('B_3', 11, 'C_3', 0),
  ]), ['A', 'B', 'C']);
  // Two level on wins and head-to-head wins (1–1): head-to-head quotient (A 20–13 over B), not the overall one.
  assert.deepEqual(rank(['B', 'A', 'C'], [
    tm('A_1', 11, 'B_1', 2), tm('B_2', 11, 'A_2', 9), tm('B_3', 11, 'C_3', 0), tm('A_3', 11, 'C_4', 10),
  ]), ['A', 'B', 'C']);
  // Three level on wins (a cycle): the overall quotient, C 24–15, B 24–24, A 11–20, though B and C have equal points.
  assert.deepEqual(rank(['A', 'B', 'C'], [
    tm('A_1', 11, 'B_1', 9), tm('B_2', 15, 'C_2', 13), tm('C_3', 11, 'A_3', 0),
  ]), ['C', 'B', 'A']);
  // Three level on wins, two of them on the quotient too (B and C, 27–16): those two go to head-to-head, B beat C.
  const fourth = [
    tm('A_1', 11, 'B_1', 5), tm('B_2', 11, 'C_2', 5), tm('C_3', 11, 'A_3', 5),
    tm('A_4', 11, 'D_1', 4), tm('B_4', 11, 'D_2', 0), tm('C_4', 11, 'D_3', 0),
  ];
  assert.deepEqual(rank(['C', 'A', 'B', 'D'], fourth), ['B', 'C', 'A', 'D']);
  assert.deepEqual(ranked(['C', 'A', 'B', 'D'], fourth).ties, [], 'every tie settled');
  // Three level on everything, the round robin over: the sheet's order, flagged for a round-robin playoff.
  const cycle = [tm('A_1', 11, 'B_1', 0), tm('B_2', 11, 'C_2', 0), tm('C_3', 11, 'A_3', 0)];
  assert.deepEqual(rank(['B', 'C', 'A'], cycle), ['B', 'C', 'A']);
  assert.deepEqual(ranked(['B', 'C', 'A'], cycle).ties, [{ codes: ['B', 'C', 'A'], playoff: 'round-robin' }]);
  // Two level on everything: flagged for a one-game playoff, but only once all their group matches are played.
  const split = [tm('A_1', 11, 'B_1', 5), tm('B_2', 11, 'A_2', 5)];
  assert.deepEqual(ranked(['B', 'A'], split).ties, [{ codes: ['B', 'A'], playoff: 'game' }]);
  assert.deepEqual(ranked(['B', 'A'], [...split, tm('A_3', null, 'B_3', null)]).ties, [], 'mid-bracket: no flag');
  // Nothing played: the sheet's order. A playoff match counts for nothing.
  assert.deepEqual(rank(['B', 'A'], []), ['B', 'A']);
  assert.deepEqual(rank(['A', 'B'], [tm('Fi-A_1', 0, 'Fi-B_1', 11)]), ['A', 'B']);
  // The default ranking is unchanged by the new parameter.
  assert.deepEqual(T.teamRankBracket([{ teamCode: 'A', pf: 1, quotient: 1 }, { teamCode: 'B', pf: 2, quotient: 1 }], []).map(r => r.teamCode), ['B', 'A']);
});

// A team day with one Final: Alpha wins three games on fewer points (35 to 38).
const TEAM_MATCH_HEADER = 'matchNumber,matchUp,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const finalDay = teamScoring => buildDayModel(
  { key: 'e', type: 'team', display: {}, days: [], title: 'E', teamScoring },
  { key: 'd', date: '2026-10-24' },
  { isLive: true, facilities: [{ name: 'Main',
    matchesCsv: [TEAM_MATCH_HEADER,
      '1,Fi-A v Fi-B,,8:30 PM,Court 1,Fi-A_1,a1,a2,11,Fi-B_1,b1,b2,9',
      '2,Fi-A v Fi-B,,8:30 PM,Court 2,Fi-A_2,a3,a4,11,Fi-B_2,b3,b4,9',
      '3,Fi-A v Fi-B,,8:30 PM,Court 3,Fi-A_3,a5,a6,11,Fi-B_3,b5,b6,9',
      '4,Fi-A v Fi-B,,8:30 PM,Court 4,Fi-A_4,a7,a8,2,Fi-B_4,b7,b8,11'].join('\n'),
    standingsCsv: 'teamCode,teamName,totalPoints,totalOpponentPoints,quotient,bracket\nA,Alpha,0,0,-,1\nB,Beta,0,0,-,1\nFi-1,,0,0,-,\nFi-2,,0,0,-,' }] },
  { now: 0, alwaysLive: true },
);

test('teamScoring reaches the day model and decides the podium', () => {
  const games = finalDay('games');
  assert.equal(games.team.scoring, 'games');
  assert.deepEqual([A.buildTeamPodium(games).gold.teamName, A.buildTeamPodium(games).silver.teamName], ['Alpha', 'Beta']);
  const points = finalDay('points');
  assert.equal(points.team.scoring, 'points');
  assert.equal(A.buildTeamPodium(points).gold.teamName, 'Beta');
});

test('a playoff side with no team yet reads its event’s own placeholder when it has one, else "Seed n"', () => {
  const rows = new Map([['Red', { teamCode: 'Red', teamName: 'Red' }]]);
  const labels = { 'Fi-1': 'Rank 1', 'Br-1': 'Rank 3' };
  assert.equal(T.sideLabel('Fi-1', rows, labels), 'Rank 1 · TBD');
  assert.equal(T.sideLabel('Br-1', rows, labels), 'Rank 3 · TBD');
  assert.equal(T.sideLabel('Br-2', rows, labels), 'Seed 2 · TBD', 'a slot the map lacks keeps "Seed n"');
  assert.equal(T.sideLabel('Fi-1', rows), 'Seed 1 · TBD', 'no map, as before');
  assert.equal(T.sideLabel('Red', rows, labels), 'Red');
  // Once the organiser types a team into the slot, its name wins.
  const seeded = new Map([...rows, ['Fi-1', { teamCode: 'Fi-1', teamName: 'Red' }]]);
  assert.equal(T.sideLabel('Fi-1', seeded, labels), 'Red');
  // The board carries the same placeholders.
  const snap = loadSnapshot('team-demo-2026');
  const all = G.buildScheduleData(snap, null, 'team', { seedLabels: { 'SF-4': 'Rank 4' } }).rows.flatMap(r => [...r.courts.filter(Boolean), ...r.unplaced]);
  assert.equal(all.find(m => m.num === 37).team2, 'Rank 4 · TBD');
});

// ---- lineupReveal: a public page shows a lineup only once its row is ticked (lineupShown) ----
const REVEAL_CSV = [
  'matchNumber,matchUp,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score,lineupShown',
  '1,Red v Orange,,1:00 PM,Court 1,Red_1,JR,Donn,,Orange_1,Bato,Bruce,,TRUE',
  '2,Red v Orange,,1:00 PM,Court 2,Red_2,Mac,Tey,,Orange_2,Martin,Tina,,FALSE',
  '3,Red v Orange,,1:30 PM,Court 1,Red_3,Anj,Kookee,,Orange_3,Inday,Angelika,,',
].join('\n');
const revealSnap = { isLive: true, facilities: [{ name: 'Main', matchesCsv: REVEAL_CSV, standingsCsv: 'teamCode,teamName,bracket\nRed,Red,1\nOrange,Orange,1' }] };
const revealEvent = { key: 'e', type: 'team', title: 'E', display: {}, days: [], lineupReveal: true };

test('lineupShown: read from the matches tab, true only for a ticked box; null without the column', () => {
  const ms = rowsToMatches(parseCSV(REVEAL_CSV));
  assert.deepEqual(ms.map(m => m.lineupShown), [true, false, false]);
  for (const v of ['TRUE', 'true', 'Yes', 'y', '1', 'x', '✓']) assert.equal(rowsToMatches(parseCSV(REVEAL_CSV.replace(',TRUE', ',' + v))).find(m => m.num === 1).lineupShown, true, v);
  const noColumn = 'matchNumber,teamCode1,team1Player1,team1Player2,teamCode2,team2Player1,team2Player2\n1,Red_1,JR,Donn,Orange_1,Bato,Bruce';
  assert.equal(rowsToMatches(parseCSV(noColumn))[0].lineupShown, null);
});

test('hideUnshownLineups: the model hides each unticked lineup, in every list; without it, nothing changes', () => {
  const pub = buildDayModel(revealEvent, { key: 'd' }, revealSnap, { alwaysLive: true, hideUnshownLineups: true });
  const at = (list, n) => list.find(m => m.num === n);
  assert.deepEqual([at(pub.matches, 1).t1p1, at(pub.matches, 1).t2p2], ['JR', 'Bruce'], 'ticked: shown');
  for (const n of [2, 3]) assert.deepEqual(['t1p1', 't1p2', 't2p1', 't2p2'].map(k => at(pub.matches, n)[k]), ['TBD', 'TBD', 'TBD', 'TBD'], `#${n}`);
  assert.equal(at(pub.matchesByFacility.get('Main'), 2).t1p1, 'TBD', 'Live Matches reads the same');
  const cc = buildDayModel(revealEvent, { key: 'd' }, revealSnap, { alwaysLive: true });
  assert.equal(at(cc.matches, 2).t1p1, 'Mac', 'Control Center sees every lineup');
  assert.equal(at(cc.matches, 2).lineupShown, false);
});

test('hideUnshownLineups: the board hides each unticked lineup too', () => {
  const rows = data => data.rows.flatMap(r => [...r.courts.filter(Boolean), ...r.unplaced]);
  const shown = rows(G.buildScheduleData(revealSnap, null, 'team', { hideUnshownLineups: true }));
  assert.equal(shown.find(m => m.num === 1).p1a, 'JR');
  assert.deepEqual(['p1a', 'p1b', 'p2a', 'p2b'].map(k => shown.find(m => m.num === 2)[k]), [null, null, null, null]);
  assert.equal(rows(G.buildScheduleData(revealSnap, null, 'team')).find(m => m.num === 2).p1a, 'Mac', 'off: as before');
});
