// views/pair-summary.js: Match Finder's pair summary card, on hand-made days covering each playoff stage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import { buildPairIndex, pairResultsHTML } from '../../../lib/v1/views/finder.js';
import { pairSummaryHTML, roundRobinStanding, playoffRounds, pairStatus, matchIdText } from '../../../lib/v1/views/pair-summary.js';

const MATCH_HEADER = 'matchNumber,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const STAND_HEADER = 'teamCode,player1,player2,wins,loss,quotient,bracket,match,from,seat';
const DISPLAY = { divisions: { N: 'Novice' }, events: { OD: 'Open Doubles' } };
const day = ({ matches, standings, type = 'standard', isLive = true }) => buildDayModel(
  { key: 'e', type, title: 'E', display: DISPLAY, days: [] },
  { key: 'd', facilities: ['Main'] },
  { isLive, facilities: [{ name: 'Main', matchesCsv: [MATCH_HEADER, ...matches].join('\n'), standingsCsv: [STAND_HEADER, ...standings].join('\n') }] },
  { now: 0 },
);
const pair = (model, name) => buildPairIndex(model).find(t => t.p1 === name);
const summary = (model, name) => {
  const team = pair(model, name);
  const standing = roundRobinStanding(team, model);
  const rounds = playoffRounds(team, model, standing);
  return { standing, rounds, status: pairStatus(rounds, standing, model), html: pairSummaryHTML(team, model) };
};

// Five pairs, a round robin all played (only the matches each test needs), a Final and a Bronze
const RR = [
  '1,,9:00 AM,Court 1,NOD_1,Ann,Bo,11,NOD_2,Cy,Di,7',
  '2,,9:00 AM,Court 2,NOD_3,Ed,Flo,11,NOD_4,Gus,Hal,9',
  '3,,9:30 AM,Court 1,NOD_5,Ike,Jo,4,NOD_1,Ann,Bo,11',
];
const RR_STAND = [
  'NOD_1,Ann,Bo,4,0,2.1,,,,', 'NOD_2,Cy,Di,3,1,1.5,,,,', 'NOD_3,Ed,Flo,2,2,1.1,,,,',
  'NOD_4,Gus,Hal,1,3,0.8,,,,', 'NOD_5,Ike,Jo,0,4,0.4,,,,',
];
const SEEDED = [
  'NOD_F_1,Ann,Bo,0,0,0,,F,,', 'NOD_F_2,Cy,Di,0,0,0,,F,,', 'NOD_B_1,Ed,Flo,0,0,0,,B,,', 'NOD_B_2,Gus,Hal,0,0,0,,B,,',
];
const finals = (f = ',', b = ',', live = '') => [
  ...RR,
  `8,${live},12:00 PM,Court 1,NOD_F_1,Ann,Bo,${f.split(',')[0]},NOD_F_2,Cy,Di,${f.split(',')[1]}`,
  `9,,12:00 PM,Court 2,NOD_B_1,Ed,Flo,${b.split(',')[0]},NOD_B_2,Gus,Hal,${b.split(',')[1]}`,
];

test('the round robin: category, rank as Standings orders it, W L PF PA Q; no bracket pill with one bracket', () => {
  const m = day({ matches: RR, standings: RR_STAND });
  const s = summary(m, 'Ann');
  assert.equal(s.standing.rank, 1);
  assert.equal(s.standing.of, 5);
  assert.deepEqual([s.standing.pf, s.standing.pa], [22, 11]);
  assert.equal(s.status, null);
  assert.match(s.html, /ps-cat">Novice Open Doubles</);
  assert.doesNotMatch(s.html, /ps-bracket/);
  assert.match(s.html, /<b>#1<\/b><span>of 5 · round robin final<\/span>/);
  assert.match(s.html, /<small>PF<\/small><b>22<\/b>/);
  assert.match(s.html, /<small>Q<\/small><b>2\.1000<\/b>/);
  assert.equal(summary(m, 'Cy').standing.rank, 2);
});

test('several brackets: a bracket pill, and the rank is within the bracket', () => {
  const m = day({
    matches: ['1,,9:00 AM,Court 1,NOD_1,Ann,Bo,11,NOD_2,Cy,Di,7', '2,,9:00 AM,Court 2,NOD_3,Ed,Flo,,NOD_4,Gus,Hal,'],
    standings: ['NOD_1,Ann,Bo,1,0,1.5714,1,,,', 'NOD_2,Cy,Di,0,1,0.6364,1,,,', 'NOD_3,Ed,Flo,0,0,0,2,,,', 'NOD_4,Gus,Hal,0,0,0,2,,,'],
  });
  const s = summary(m, 'Cy');
  assert.match(s.html, /ps-bracket">Bracket 1</);
  assert.match(s.html, /<b>#2<\/b><span>of 2 in Bracket 1<\/span>/);
});

test('before a pair has played, the rank is a dash', () => {
  const m = day({ matches: ['1,,9:00 AM,Court 1,NOD_1,Ann,Bo,,NOD_2,Cy,Di,'], standings: ['NOD_1,Ann,Bo,0,0,0,,,,', 'NOD_2,Cy,Di,0,0,0,,,,'] });
  const s = summary(m, 'Ann');
  assert.match(s.html, /<b>—<\/b><span>of 2<\/span>/);
});

test('in the Finals with a known opponent: the match number, time and court', () => {
  const m = day({ matches: finals(), standings: [...RR_STAND, ...SEEDED] });
  const s = summary(m, 'Ann');
  assert.deepEqual(s.status, { text: 'In the Finals', kind: 'in' });
  assert.equal(s.rounds.length, 1);
  assert.equal(s.rounds[0].opponent, 'Cy / Di');
  assert.equal(s.rounds[0].result, '#8 · 12:00 PM');
  assert.match(s.html, /ps-round-name">Final<\/span><span class="ps-who">vs Cy \/ Di<i>Court 1<\/i><\/span><span class="ps-res ps-res--upcoming">#8 · 12:00 PM</);
});

test('playing now: the live court', () => {
  const m = day({ matches: finals(',', ',', '1'), standings: [...RR_STAND, ...SEEDED] });
  const s = summary(m, 'Cy');
  assert.deepEqual(s.status, { text: 'Playing now', kind: 'live' });
  assert.equal(s.rounds[0].result, 'Live · Court 1');
});

test('the Final and the Bronze played: Champions, Runners-up, Bronze medal, 4th place; the rest did not advance', () => {
  const m = day({ matches: finals('11,7', '9,11'), standings: [...RR_STAND, ...SEEDED] });
  assert.deepEqual(summary(m, 'Ann').status, { text: 'Champions', kind: 'gold' });
  assert.equal(summary(m, 'Ann').rounds[0].result, 'Won 11–7');
  assert.deepEqual(summary(m, 'Cy').status, { text: 'Runners-up', kind: 'silver' });
  assert.equal(summary(m, 'Cy').rounds[0].result, 'Lost 7–11');
  assert.deepEqual(summary(m, 'Gus').status, { text: 'Bronze medal', kind: 'bronze' });
  assert.deepEqual(summary(m, 'Ed').status, { text: '4th place', kind: 'out' });
  const ike = summary(m, 'Ike');
  assert.deepEqual(ike.status, { text: 'Did not advance', kind: 'out' });
  assert.doesNotMatch(ike.html, /ps-playoffs/);
});

test('no "Did not advance" while the playoff seats are still empty', () => {
  const empty = ['NOD_F_1, , ,0,0,0,,F,,', 'NOD_F_2, , ,0,0,0,,F,,'];
  const m = day({ matches: [...RR, '8,,12:00 PM,Court 1,NOD_F_1, , ,,NOD_F_2, , ,'], standings: [...RR_STAND, ...empty] });
  assert.equal(summary(m, 'Ike').status, null);
});

test('an opponent not yet known: "to be decided" and the seat\'s label, or the match it comes from', () => {
  const m = day({
    matches: [...RR, '6,,11:00 AM,Court 1,NOD_SF_1,Ann,Bo,11,NOD_SF_2,Gus,Hal,8', '7,,11:00 AM,Court 2,NOD_SF_3, , ,,NOD_SF_4,Cy,Di,',
      '8,,12:00 PM,Court 1,NOD_F_1,Ann,Bo,,NOD_F_2, , ,'],
    standings: [...RR_STAND, 'NOD_SF_1,Ann,Bo,0,0,0,,SF-1,,', 'NOD_SF_2,Gus,Hal,0,0,0,,SF-1,,',
      'NOD_SF_3, , ,0,0,0,,SF-2,,Bracket 2 · #1', 'NOD_SF_4,Cy,Di,0,0,0,,SF-2,,',
      'NOD_F_1,Ann,Bo,0,0,0,,F,W:SF-1,', 'NOD_F_2, , ,0,0,0,,F,W:SF-2,'],
  });
  const ann = summary(m, 'Ann');
  assert.deepEqual(ann.rounds.map(r => [r.round, r.state, r.result]), [['Semifinal', 'won', 'Won 11–8'], ['Final', 'upcoming', '#8 · 12:00 PM']]);
  assert.equal(ann.rounds[1].openLabel, 'Winner of Semifinal 2');
  assert.deepEqual(ann.status, { text: 'In the Finals', kind: 'in' });
  assert.match(ann.html, /vs to be decided<i>Winner of Semifinal 2 · Court 1<\/i>/);
  const cy = summary(m, 'Cy');
  assert.equal(cy.rounds[0].openLabel, 'Bracket 2 · #1');
  assert.deepEqual(cy.status, { text: 'In the Semifinals', kind: 'in' });
  assert.deepEqual(summary(m, 'Gus').status, { text: 'Out in the Semifinals', kind: 'out' });
});

test('a twice-to-beat Final: one row over its games', () => {
  const series = (g1, g2) => [...RR,
    `8,,12:00 PM,Court 1,NOD_F_1_(1),Ann,Bo,${g1[0]},NOD_F_2_(1),Cy,Di,${g1[1]}`,
    `9,,12:30 PM,Court 1,NOD_F_1_(2),Ann,Bo,${g2[0]},NOD_F_2_(2),Cy,Di,${g2[1]}`];
  const stand = [...RR_STAND, 'NOD_F_1_(1),Ann,Bo,0,0,0,,F (1),,', 'NOD_F_2_(1),Cy,Di,0,0,0,,F (1),,', 'NOD_F_1_(2),Ann,Bo,0,0,0,,F (2),,', 'NOD_F_2_(2),Cy,Di,0,0,0,,F (2),,'];
  // Seat 1 wins game 1: the series is over
  let m = day({ matches: series(['11', '8'], ['', '']), standings: stand });
  assert.equal(summary(m, 'Ann').rounds.length, 1);
  assert.equal(summary(m, 'Ann').rounds[0].result, 'Won 1–0 (11–8)');
  assert.deepEqual(summary(m, 'Ann').status, { text: 'Champions', kind: 'gold' });
  // Seat 2 wins game 1: a game 2 to come
  m = day({ matches: series(['8', '11'], ['', '']), standings: stand });
  const cy = summary(m, 'Cy');
  assert.equal(cy.rounds[0].state, 'upcoming');
  assert.equal(cy.rounds[0].sofar, 'Game 1: won 11–8');
  assert.equal(cy.rounds[0].result, '#9 · 12:30 PM');
  // ...and game 2: seat 2 takes it
  m = day({ matches: series(['8', '11'], ['5', '11']), standings: stand });
  assert.equal(summary(m, 'Cy').rounds[0].result, 'Won 2–0 (11–8, 11–5)');
  assert.equal(summary(m, 'Ann').rounds[0].result, 'Lost 0–2 (8–11, 5–11)');
});

test('a bronze taken without a match: the round robin\'s #3 against a BYE', () => {
  const m = day({ matches: finals('11,7').slice(0, 4), standings: [...RR_STAND, ...SEEDED.slice(0, 2), 'NOD_B_1,Ed,Flo,0,0,0,,B,,', 'NOD_B_2,BYE,BYE,0,0,0,,B,,'] });
  const ed = summary(m, 'Ed');
  assert.deepEqual(ed.status, { text: 'Bronze medal', kind: 'bronze' });
  assert.equal(ed.rounds[0].state, 'walkover');
  assert.match(ed.html, /ps-round-name">Bronze<\/span><span class="ps-who">3rd in the round robin · no match<\/span>/);
});

test('nothing while the day is not live, and nothing for a team event', () => {
  const hidden = day({ matches: RR, standings: RR_STAND, isLive: false });
  assert.equal(hidden.isLive, false);
  assert.equal(pairSummaryHTML(pair(hidden, 'Ann'), hidden), '');
  const team = { ...day({ matches: RR, standings: RR_STAND }) };
  team.event = { ...team.event, type: 'team' };
  assert.equal(pairSummaryHTML(pair(day({ matches: RR, standings: RR_STAND }), 'Ann'), team), '');
});

test('Match Finder shows the card above the tickets, and the category tag moves into it', () => {
  const m = day({ matches: RR, standings: RR_STAND });
  const { html } = pairResultsHTML('Ann Bo', m, buildPairIndex(m), pair(m, 'Ann'));
  assert.ok(html.indexOf('class="pair-summary"') < html.indexOf('matches found'));
  assert.doesNotMatch(html, /division-tag/);
});

test('a match id in words', () => {
  assert.equal(matchIdText('SF-2'), 'Semifinal 2');
  assert.equal(matchIdText('QF-1'), 'Quarterfinal 1');
  assert.equal(matchIdText('F'), 'Final');
  assert.equal(matchIdText('F (2)'), 'Final · Game 2');
  assert.equal(matchIdText('X-9'), 'X-9');
});
