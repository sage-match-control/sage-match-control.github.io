// views/podium.js: a finished category's podium, and a team event's, on the Hub's Standings (step 6 of the Hub
// player experience, hub-player-experience-spec §8). The rule is Control Center's Awards tab's (domain/awards.js),
// so these tests also pin that the two agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import { buildPodiums, buildTeamPodium } from '../../../lib/v1/domain/awards.js';
import { podiumFor, teamPodiumFor, podiumHTML } from '../../../lib/v1/views/podium.js';
import { eventConfig, loadSnapshot, deriveState, caseTime } from '../../helpers/fixtures.mjs';

const fixtureModel = (ev, state = 'final') => {
  const cfg = eventConfig(ev);
  const snap = state === 'final' ? loadSnapshot(ev) : deriveState(loadSnapshot(ev), state);
  return buildDayModel(cfg, cfg.days[0], snap, { now: caseTime(ev) });
};

// ---- a standard event: Piggleball's finished day -----------------------------------------------------------------

test('Piggleball final: Novice Open Doubles gives the picture’s podium, with its final line', () => {
  const p = podiumFor(fixtureModel('piggleball-2026'), 'ND');
  assert.deepEqual(p, {
    gold: 'Joshua Dizon / Jericho Dizon',
    silver: 'Makeen Fernandez / Noelle Mercado',
    bronze: 'Arlene Gacho / Earl Andreu Acabal',
    // match 37: ND_F_1 7, ND_F_2 11, so the winner's score comes first
    finalLine: 'Beat Makeen Fernandez / Noelle Mercado 11–7 in the final',
  });
});

test('Piggleball final: every category has a podium, and it is the Awards tab’s', () => {
  const m = fixtureModel('piggleball-2026');
  for (const a of buildPodiums(m)) {
    const p = podiumFor(m, a.category);
    assert.ok(p, a.category);
    assert.equal(p.gold, `${a.gold.p1} / ${a.gold.p2}`, `${a.category} gold`);
    assert.equal(p.silver, `${a.silver.p1} / ${a.silver.p2}`, `${a.category} silver`);
    assert.equal(p.bronze, `${a.bronze.p1} / ${a.bronze.p2}`, `${a.category} bronze`);
  }
});

test('Piggleball mid: no category has a podium', () => {
  const m = fixtureModel('piggleball-2026', 'mid');
  for (const a of buildPodiums(m)) assert.equal(podiumFor(m, a.category), null, a.category);
});

test('Piggleball pre: no category has a podium', () => {
  const m = fixtureModel('piggleball-2026', 'pre');
  for (const a of buildPodiums(m)) assert.equal(podiumFor(m, a.category), null, a.category);
});

test('a series final’s line has no score (twice-to-beat game 1 is 11–0, and the line still says nothing of it)', () => {
  const p = podiumFor(fixtureModel('piggleball-2026'), 'IXD');
  assert.equal(p.gold, 'Joshua Austria / Chelsea Fernandez');
  assert.equal(p.finalLine, 'Beat Josh Dycaico / Abigail Dycaico in the final');
  // its bronze is a walkover in the standings alone (no Bronze match), and still shows
  assert.equal(p.bronze, 'Kiel Suarez / Marcial Suarez');
});

test('a category decided by its round robin alone (source standings) has a podium and no final line', () => {
  const m = fixtureModel('pickle-for-sight-2026');
  const a = buildPodiums(m).find(x => x.source === 'standings');
  assert.equal(a.category, 'HIWD', 'the fixture has one');
  const p = podiumFor(m, 'HIWD');
  assert.deepEqual(p, { gold: 'Kianah Vincoy / Ruth David', silver: 'Belinda Yambao / Jek Garbes', bronze: 'Clarize David / Jane Lim', finalLine: null });
  assert.doesNotMatch(podiumHTML(p), /<small>/);
});

test('a category not in the data has no podium', () => {
  assert.equal(podiumFor(fixtureModel('piggleball-2026'), 'ZZZ'), null);
});

// ---- hand-made days: no bronze, a warning ----------------------------------------------------------------------

const MATCH_HEADER = 'matchNumber,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const STAND_HEADER = 'teamCode,player1,player2,wins,loss,quotient,bracket';
const handMade = (matches, standings = []) => buildDayModel(
  { key: 'e', type: 'standard', title: 'E', display: { divisions: { N: 'Novice' }, events: { OD: 'Open Doubles' } }, days: [] },
  { key: 'd', facilities: ['Main'] },
  { isLive: true, facilities: [{ name: 'Main', matchesCsv: [MATCH_HEADER, ...matches].join('\n'), standingsCsv: [STAND_HEADER, ...standings].join('\n') }] },
  { now: 0 },
);
const mrow = (n, a, sa, b, sb) => `${n},,9:00 AM,Court 1,${a},${a}a,${a}b,${sa},${b},${b}a,${b}b,${sb}`;

test('a category with a Final and no Bronze match at all shows two places', () => {
  const m = handMade([mrow(1, 'NOD_F_1', 11, 'NOD_F_2', 4)]);
  assert.equal(buildPodiums(m)[0].bronze, null, 'the Awards tab has none either');
  const p = podiumFor(m, 'NOD');
  assert.equal(p.gold, 'NOD_F_1a / NOD_F_1b');
  assert.equal(p.silver, 'NOD_F_2a / NOD_F_2b');
  assert.equal(p.bronze, null);
  assert.equal(p.finalLine, 'Beat NOD_F_2a / NOD_F_2b 11–4 in the final');
  const html = podiumHTML(p);
  assert.equal((html.match(/<li class="podium-place /g) || []).length, 2);
  assert.doesNotMatch(html, /podium-place--bronze/);
});

test('a Bronze match that has not been played keeps the podium back', () => {
  const m = handMade([mrow(1, 'NOD_F_1', 11, 'NOD_F_2', 4), mrow(2, 'NOD_B_1', '', 'NOD_B_2', '')]);
  assert.equal(podiumFor(m, 'NOD'), null);
});

test('a played Bronze match adds the third place', () => {
  const m = handMade([mrow(1, 'NOD_F_1', 11, 'NOD_F_2', 4), mrow(2, 'NOD_B_1', 5, 'NOD_B_2', 11)]);
  const p = podiumFor(m, 'NOD');
  assert.equal(p.bronze, 'NOD_B_2a / NOD_B_2b');
  assert.equal((podiumHTML(p).match(/<li class="podium-place /g) || []).length, 3);
});

test('a warning gives no podium: a Final tied on points', () => {
  const m = handMade([mrow(1, 'NOD_F_1', 11, 'NOD_F_2', 11)]);
  assert.match(buildPodiums(m)[0].warning, /Check the score for match #1/);
  assert.equal(podiumFor(m, 'NOD'), null);
});

test('a warning gives no podium: a Bronze match tied on points', () => {
  const m = handMade([mrow(1, 'NOD_F_1', 11, 'NOD_F_2', 4), mrow(2, 'NOD_B_1', 7, 'NOD_B_2', 7)]);
  assert.ok(buildPodiums(m)[0].warning);
  assert.equal(podiumFor(m, 'NOD'), null);
});

test('a Final not yet played gives no podium', () => {
  assert.equal(podiumFor(handMade([mrow(1, 'NOD_F_1', '', 'NOD_F_2', '')]), 'NOD'), null);
});

// ---- a dual meet: the club label follows each name ----------------------------------------------------------------

test('PNF × BUP final: each name is followed by its club label', () => {
  const m = fixtureModel('pnf-x-bup-dual-meet');
  const p = podiumFor(m, 'LIWD');
  assert.equal(p.gold, 'Keren Kenizzite / Shaira Tarlit* · Pickle & Friends Community');
  assert.equal(p.silver, 'Karen Pizarro / Trish Mina · 1Bataan United Picklers');
  assert.equal(p.bronze, 'Alex Verzola / Josa Verzola · 1Bataan United Picklers');
  assert.equal(p.finalLine, 'Beat Karen Pizarro / Trish Mina · 1Bataan United Picklers 11–8 in the final');
  assert.match(podiumHTML(p), /Shaira Tarlit\* · Pickle &amp; Friends Community/, 'the label is escaped in the markup');
});

test('PNF × BUP: all seven categories have one on the final day, none on mid', () => {
  const fin = fixtureModel('pnf-x-bup-dual-meet'), mid = fixtureModel('pnf-x-bup-dual-meet', 'mid');
  for (const a of buildPodiums(fin)) {
    assert.ok(podiumFor(fin, a.category), `${a.category} final`);
    assert.equal(podiumFor(mid, a.category), null, `${a.category} mid`);
  }
});

// ---- a team event -------------------------------------------------------------------------------------------------

test('PickleDrive final: the event’s podium, with the Final’s points from the winner’s side', () => {
  const m = fixtureModel('pickledrive-anniversary-2026');
  const t = buildTeamPodium(m);
  assert.equal(t.gold.teamName, 'San Mig Lobbers');
  // Fi-J_1..4 scored 3, 1, 11, 11 and Fi-N_1..4 11, 11, 7, 3: San Mig Lobbers 32 to 26
  assert.deepEqual(teamPodiumFor(m), {
    gold: 'San Mig Lobbers', silver: 'Can i buy you a DINK?', bronze: 'Dink ang Bato',
    finalLine: 'Beat Can i buy you a DINK? 32–26 in the final',
  });
});

test('PickleDrive mid and pre: no podium', () => {
  assert.equal(teamPodiumFor(fixtureModel('pickledrive-anniversary-2026', 'mid')), null);
  assert.equal(teamPodiumFor(fixtureModel('pickledrive-anniversary-2026', 'pre')), null);
});

test('the team demo fixture has no Final played, so no podium in any state', () => {
  for (const s of ['final', 'mid', 'pre']) assert.equal(teamPodiumFor(fixtureModel('team-demo-2026', s)), null, s);
});

// Alpha beats Beta three games to one (35 points to 38) in the Final; there is no Bronze matchup.
const TEAM_HEADER = 'matchNumber,matchUp,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const finalDay = (teamScoring, scores = [[11, 9], [11, 9], [11, 9], [2, 11]]) => buildDayModel(
  { key: 'e', type: 'team', display: {}, days: [], title: 'E', teamScoring },
  { key: 'd', date: '2026-10-24' },
  { isLive: true, facilities: [{ name: 'Main',
    matchesCsv: [TEAM_HEADER, ...scores.map(([a, b], i) =>
      `${i + 1},Fi-A v Fi-B,,5:00 PM,Court ${i + 1},Fi-A_${i + 1},a${i}x,a${i}y,${a},Fi-B_${i + 1},b${i}x,b${i}y,${b}`)].join('\n'),
    standingsCsv: 'teamCode,teamName,totalPoints,totalOpponentPoints,quotient,bracket\nFi-A,Alpha,35,38,0.9211,\nFi-B,Beta,38,35,1.0857,' }] },
  { now: 0, alwaysLive: true },
);

test('team scoring "points": the Final goes to the side with more points, and the line says points', () => {
  const p = teamPodiumFor(finalDay('points'));
  assert.equal(p.gold, 'Beta');
  assert.equal(p.silver, 'Alpha');
  assert.equal(p.bronze, null, 'no Bronze matchup: two places');
  assert.equal(p.finalLine, 'Beat Alpha 38–35 in the final');
});

test('team scoring "games": the Final goes to the side with more games, and the line says games', () => {
  const p = teamPodiumFor(finalDay('games'));
  assert.equal(p.gold, 'Alpha');
  assert.equal(p.silver, 'Beta');
  assert.equal(p.finalLine, 'Beat Beta 3–1 in the final');
});

test('team scoring "games": a Final level on games and won on points says so, not "2–2" (Millennium’s Final)', () => {
  // Alpha 11+9+11+10 = 41 to Beta's 9+11+9+11 = 40; two games each
  const m = finalDay('games', [[11, 9], [9, 11], [11, 9], [10, 11]]);
  const r = m.team.matchups[0].result;
  assert.deepEqual([r.pairs1, r.pairs2, r.pts1, r.pts2, r.winner], [2, 2, 41, 40, 1]);
  assert.equal(teamPodiumFor(m).finalLine, 'Beat Beta 41–40 on points in the final');
});

test('a team Final tied on points gives no podium', () => {
  const m = finalDay('points', [[11, 9], [9, 11]]);
  assert.match(buildTeamPodium(m).warning, /Final is a tie/);
  assert.equal(teamPodiumFor(m), null);
});

test('a team Final that is still in progress gives no podium', () => {
  assert.equal(teamPodiumFor(finalDay('points', [[11, 9], ['', '']])), null);
});

// ---- the markup ---------------------------------------------------------------------------------------------------

test('podiumHTML draws the title, one list item per place and the final line under gold', () => {
  const html = podiumHTML({ gold: 'A / B', silver: 'C / D', bronze: 'E / F', finalLine: 'Beat C / D 11–7 in the final' });
  assert.match(html, /^<div class="podium">\s*<div class="podium-title">Podium<\/div>\s*<ol class="podium-list">/);
  assert.match(html, /<li class="podium-place podium-place--gold"><span class="podium-rank">1<\/span>\s*<span class="podium-names">A \/ B<small>Beat C \/ D 11–7 in the final<\/small><\/span><\/li>/);
  assert.match(html, /<li class="podium-place podium-place--silver"><span class="podium-rank">2<\/span>\s*<span class="podium-names">C \/ D<\/span><\/li>/);
  assert.match(html, /<li class="podium-place podium-place--bronze"><span class="podium-rank">3<\/span>\s*<span class="podium-names">E \/ F<\/span><\/li>/);
});

test('podiumHTML draws nothing for no podium, and escapes every name', () => {
  assert.equal(podiumHTML(null), '');
  const html = podiumHTML({ gold: '<b>x</b>', silver: 'Y & Z', bronze: null, finalLine: 'Beat Y & Z 11–1 in the final' });
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /Y &amp; Z/);
});

test('asking twice for one model gives the same podium (the Awards derivation is kept per model)', () => {
  const m = fixtureModel('piggleball-2026');
  assert.deepEqual(podiumFor(m, 'ND'), podiumFor(m, 'ND'));
  assert.deepEqual(podiumFor(m, 'ND'), podiumFor(fixtureModel('piggleball-2026'), 'ND'));
});
