// domain/bracket.js: the playoff bracket chart's grouping, seat text and geometry
// (sage-docs/docs/specs/.../standings-bracket-chart-spec.md §7.3), on hand-made models.
// The playoff rows are the spec's §5.2 worked examples.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import {
  parseFrom, matchDisplayLabel, rankByWinsThenQuotient, buildBracket, bracketShapeKey, seatText, sourceTag,
  layoutBracket, seatContext, pairPlayoffRows,
} from '../../../lib/v1/domain/bracket.js';

const MATCH_HEADER = 'matchNumber,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const STAND_HEADER = 'teamCode,player1,player2,wins,loss,quotient,bracket,match,from';
const PLAIN_HEADER = 'teamCode,player1,player2,wins,loss,quotient,bracket';
const DIMS = { cardW: 172, colGap: 36, headH: 20, seatH: 30, rowGap: 16, captionH: 22, bronzeGap: 34, seriesGap: 8 };

/** A playoff slot whose names are not in yet: the sheet fills the name cell with the slot's own code. */
const slot = ([code, match, from]) => `${code},${code},,0,0,,,${match},${from}`;
const named = (code, p1, p2, match = '', from = '') => `${code},${p1},${p2},0,0,,,${match},${from}`;
const rr = (code, p1, p2, w, l, q, br) => `${code},${p1},${p2},${w},${l},${q},${br},,`;

const model = ({ standings, matches = [], header = STAND_HEADER, display = {} }) => buildDayModel(
  { key: 'e', type: 'standard', title: 'E', display, days: [] },
  { key: 'd', facilities: ['Main'] },
  { isLive: true, facilities: [{ name: 'Main', matchesCsv: [MATCH_HEADER, ...matches].join('\n'), standingsCsv: [header, ...standings].join('\n') }] },
  { now: 0 },
);

// §5.2's ladders: [code, match, from]
const HIMD = [
  ['HIMD_R16_5', 'R16-3', ''], ['HIMD_R16_6', 'R16-3', ''], ['HIMD_QF_3', 'QF-2', 'W:R16-3'], ['HIMD_QF_4', 'QF-2', ''],
  ['HIMD_SF_1', 'SF-1', ''], ['HIMD_SF_2', 'SF-1', ''], ['HIMD_SF_3', 'SF-2', ''], ['HIMD_SF_4', 'SF-2', 'W:QF-2'],
  ['HIMD_B_1', 'B', 'L:SF-1'], ['HIMD_B_2', 'B', 'L:SF-2'], ['HIMD_F_1', 'F', 'W:SF-1'], ['HIMD_F_2', 'F', 'W:SF-2'],
];
const XD = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => [`XD_QF_${n}`, `QF-${Math.ceil(n / 2)}`, '']),
  ['XD_SF_1', 'SF-1', 'W:QF-1'], ['XD_SF_2', 'SF-1', 'W:QF-2'], ['XD_SF_3', 'SF-2', 'W:QF-3'], ['XD_SF_4', 'SF-2', 'W:QF-4'],
  ['XD_B_1', 'B', 'L:SF-1'], ['XD_B_2', 'B', 'L:SF-2'], ['XD_F_1', 'F', 'W:SF-1'], ['XD_F_2', 'F', 'W:SF-2'],
];
const MD = [
  ['MD_SF_1', 'SF-1', ''], ['MD_SF_2', 'SF-1', ''], ['MD_SF_3', 'SF-2', ''], ['MD_SF_4', 'SF-2', ''],
  ['MD_B_1', 'B', 'L:SF-1'], ['MD_B_2', 'B', 'L:SF-2'], ['MD_F_1', 'F', 'W:SF-1'], ['MD_F_2', 'F', 'W:SF-2'],
];
const T3 = [['T3_SF_2', 'SF-1', ''], ['T3_SF_3', 'SF-1', ''], ['T3_F_1', 'F', ''], ['T3_F_2', 'F', 'W:SF-1']];
const ONE = [
  ['ONE_F_1_(1)', 'F (1)', ''], ['ONE_F_2_(1)', 'F (1)', ''], ['ONE_F_1_(2)', 'F (2)', ''], ['ONE_F_2_(2)', 'F (2)', ''],
  ['ONE_B_1', 'B', ''], ['ONE_B_2', 'B', ''],
];
/** Two named round robin rows in each of `n` brackets, so the shape key can count the groups. */
const rrBrackets = (key, n) => Array.from({ length: n }, (_, b) => [
  rr(`${key}_${2 * b + 1}`, `A${b}`, `B${b}`, 2, 0, 2, String(b + 1)),
  rr(`${key}_${2 * b + 2}`, `C${b}`, `D${b}`, 0, 2, 0.5, String(b + 1)),
]).flat();
const ladder = (links, brackets, key) => model({ standings: [...rrBrackets(key, brackets), ...links.map(slot)] });
const bracketOf = (m, key) => buildBracket(m.standings.filter(s => s.teamCode.startsWith(key + '_')), m);
const ids = r => r.matches.map(n => n.id);

test('parseFrom reads W: and L: links, and nothing else', () => {
  assert.deepEqual(parseFrom('W:QF-2'), { kind: 'W', match: 'QF-2' });
  assert.deepEqual(parseFrom(' L:SF-1 '), { kind: 'L', match: 'SF-1' });
  assert.deepEqual(parseFrom('W:F (1)'), { kind: 'W', match: 'F (1)' });
  for (const bad of ['', null, undefined, 'X:QF-2', 'W:', 'QF-2', 'w:QF-2']) assert.equal(parseFrom(bad), null, String(bad));
});

test('matchDisplayLabel: the Final, the Bronze, a series game, or the id as is', () => {
  assert.equal(matchDisplayLabel('F'), 'Final');
  assert.equal(matchDisplayLabel('B'), 'Bronze');
  assert.equal(matchDisplayLabel('F (2)'), 'Final · Match 2');
  assert.equal(matchDisplayLabel('QF-2'), 'QF-2');
});

test('rankByWinsThenQuotient: wins, then quotient, null quotients last, stable, and a copy', () => {
  const rows = [
    { teamCode: 'a', wins: 1, quotient: 1.5 }, { teamCode: 'b', wins: 2, quotient: null }, { teamCode: 'c', wins: 2, quotient: 0.5 },
    { teamCode: 'd', wins: 1, quotient: 1.5 }, { teamCode: 'e', wins: 2, quotient: 0.5 },
  ];
  assert.deepEqual(rankByWinsThenQuotient(rows).map(r => r.teamCode), ['c', 'e', 'b', 'a', 'd']);
  assert.deepEqual(rows.map(r => r.teamCode), ['a', 'b', 'c', 'd', 'e'], 'the input is not reordered');
});

test('buildBracket: HIMD is R16, QF, SF and the Final, with a bronze', () => {
  const b = bracketOf(ladder(HIMD, 3, 'HIMD'), 'HIMD');
  assert.equal(b.linked, true);
  assert.equal(b.category, 'HIMD');
  assert.deepEqual(b.rounds.map(r => r.key), ['R16', 'QF', 'SF', 'FINAL']);
  assert.deepEqual(b.rounds.map(r => r.label), ['Round of 16', 'Quarterfinals', 'Semifinals', 'Finals']);
  assert.deepEqual(b.rounds.map(ids), [['R16-3'], ['QF-2'], ['SF-1', 'SF-2'], ['F']]);
  assert.equal(b.bronze.id, 'B');
  assert.equal(b.eligible, true);
  const qf = b.rounds[1].matches[0].games[0];
  assert.deepEqual(qf.seats.map(s => [s.code, s.rest, s.from]), [['HIMD_QF_3', 'QF_3', { kind: 'W', match: 'R16-3' }], ['HIMD_QF_4', 'QF_4', null]]);
  assert.deepEqual(b.bronze.games[0].seats.map(s => s.from), [{ kind: 'L', match: 'SF-1' }, { kind: 'L', match: 'SF-2' }]);
});

test('buildBracket: XD, MD and T3 take their rounds from the match column', () => {
  const xd = bracketOf(ladder(XD, 4, 'XD'), 'XD');
  assert.deepEqual(xd.rounds.map(ids), [['QF-1', 'QF-2', 'QF-3', 'QF-4'], ['SF-1', 'SF-2'], ['F']]);
  const md = bracketOf(ladder(MD, 2, 'MD'), 'MD');
  assert.deepEqual(md.rounds.map(ids), [['SF-1', 'SF-2'], ['F']]);
  assert.equal(md.eligible, true);
});

test('buildBracket: T3 pairs seats 2 and 3 in the semifinal, in seat order, never by arithmetic', () => {
  const b = bracketOf(ladder(T3, 3, 'T3'), 'T3');
  assert.deepEqual(b.rounds.map(ids), [['SF-1'], ['F']]);
  assert.deepEqual(b.rounds[0].matches[0].games[0].seats.map(s => s.code), ['T3_SF_2', 'T3_SF_3']);
  assert.equal(b.bronze, null, 'fewer than four qualifiers, no bronze');
});

test('buildBracket: a series final is one node of two games, and a lone round is not eligible', () => {
  const b = bracketOf(ladder(ONE, 1, 'ONE'), 'ONE');
  assert.equal(b.rounds.length, 1);
  assert.equal(b.rounds[0].key, 'FINAL');
  assert.equal(b.rounds[0].matches.length, 1);
  assert.deepEqual(b.rounds[0].matches[0].games.map(g => g.id), ['F (1)', 'F (2)']);
  assert.equal(b.eligible, false);
});

test('buildBracket: a series game after the decider is flagged not needed', () => {
  const m = model({
    standings: ONE.map(slot),
    matches: ['1,,9:00 AM,Court 1,ONE_F_1_(1),Ann,Bo,11,ONE_F_2_(1),Cy,Di,4', '2,,9:30 AM,Court 1,ONE_F_1_(2),Ann,Bo,,ONE_F_2_(2),Cy,Di,'],
  });
  const games = bracketOf(m, 'ONE').rounds[0].matches[0].games;
  assert.deepEqual(games.map(g => g.notNeeded), [false, true]);
});

test('buildBracket: rows without the match and from columns fall back to pairing, in order', () => {
  const pfs = [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => `NMD_QF_${n},NMD_QF_${n},,0,0,,`),
    ...[1, 2, 3, 4].map(n => `NMD_SF_${n},NMD_SF_${n},,0,0,,`),
    'NMD_B_1,NMD_B_1,,0,0,,', 'NMD_B_2,NMD_B_2,,0,0,,', 'NMD_F_1,NMD_F_1,,0,0,,', 'NMD_F_2,NMD_F_2,,0,0,,',
  ];
  const m = model({ standings: pfs, header: PLAIN_HEADER });
  const b = buildBracket(m.standings, m);
  assert.equal(b.linked, false);
  assert.deepEqual(b.rounds.map(r => r.matches.length), [4, 2, 1]);
  assert.deepEqual(b.rounds.map(r => r.key), ['QF', 'SF', 'FINAL']);
  assert.equal(b.eligible, true);
  assert.equal(b.bronze.games.length, 1);
  assert.deepEqual(b.rounds[0].matches[0].games[0].seats.map(s => s.code), ['NMD_QF_1', 'NMD_QF_2']);
  assert.equal(b.rounds[0].matches[0].games[0].id, 'QF-1');
  assert.equal(bracketShapeKey(b, m.standings), null);
});

test('buildBracket: a bronze decided by a BYE is dropped, and a BYE row never makes a seat', () => {
  const m = model({ standings: [...rrBrackets('MD', 2),
    ...MD.filter(r => !r[0].includes('_B_')).map(slot),
    named('MD_B_1', 'Ann', 'Bo', 'B', 'L:SF-1'), named('MD_B_2', 'BYE', 'BYE', 'B', 'L:SF-2')] });
  const b = bracketOf(m, 'MD');
  assert.equal(b.bronze, null);
  assert.deepEqual(b.rounds.map(ids), [['SF-1', 'SF-2'], ['F']]);
});

test('buildBracket: a single row in a group leaves the second seat empty', () => {
  const m = model({ standings: [slot(['MD_SF_1', 'SF-1', '']), slot(['MD_F_1', 'F', '']), slot(['MD_F_2', 'F', 'W:SF-1'])] });
  const seats = bracketOf(m, 'MD').rounds[0].matches[0].games[0].seats;
  assert.equal(seats.length, 2);
  assert.deepEqual([seats[0].empty, seats[1].empty, seats[1].row], [true, true, undefined]);
});

test('buildBracket: the score and result of a played game come from the scheduled match', () => {
  const m = model({
    standings: [...rrBrackets('MD', 2), ...MD.map(slot)],
    matches: ['5,,9:00 AM,Court 2,MD_SF_1,Ann,Bo,11,MD_SF_2,Cy,Di,8', '6,,9:30 AM,Court 2,MD_SF_3,Ed,Flo,,MD_SF_4,Gus,Hal,'],
  });
  const [sf1, sf2] = bracketOf(m, 'MD').rounds[0].matches.map(n => n.games[0]);
  assert.deepEqual(sf1.seats.map(s => [s.score, s.result]), [[11, 'win'], [8, 'loss']]);
  assert.equal(sf1.m.num, 5);
  assert.deepEqual(sf2.seats.map(s => [s.score, s.result]), [[null, ''], [null, '']]);
  assert.equal(sf2.m.num, 6);
});

test('bracketShapeKey: groups x fresh seats per group', () => {
  const key = (links, n, k) => { const m = ladder(links, n, k); const b = bracketOf(m, k); return bracketShapeKey(b, m.standings.filter(s => s.teamCode.startsWith(k + '_'))); };
  assert.equal(key(HIMD, 3, 'HIMD'), '3x2');
  assert.equal(key(XD, 4, 'XD'), '4x2');
  assert.equal(key(MD, 2, 'MD'), '2x2');
  assert.equal(key(T3, 3, 'T3'), '3x1');
});

test('seatText: a pair, a winner or loser link, a label, a qualifier, or TBD', () => {
  const row = { teamCode: 'X_SF_1', player1: 'Ann', player2: 'Bo' };
  const ctx = { playoffSeats: {}, category: 'X', shapeKey: '3x2', rrRows: [], linked: true };
  const seat = over => ({ row, code: 'X_SF_1', rest: 'SF_1', from: null, empty: false, ...over });
  assert.deepEqual(seatText(seat(), ctx), { kind: 'pair', names: ['Ann', 'Bo'], label: '', tag: '' });
  assert.deepEqual(seatText(seat({ empty: true, from: { kind: 'W', match: 'QF-2' } }), ctx), { kind: 'winner', names: [], label: 'Winner of QF-2', tag: '' });
  assert.equal(seatText(seat({ empty: true, from: { kind: 'L', match: 'SF-1' } }), ctx).label, 'Loser of SF-1');
  assert.equal(seatText(seat({ empty: true, from: { kind: 'W', match: 'F (1)' } }), ctx).label, 'Winner of Final · Match 1');
  assert.deepEqual(seatText(seat({ empty: true }), { ...ctx, playoffSeats: { X: { SF_1: 'Bracket winner' } } }),
    { kind: 'label', names: [], label: 'Bracket winner', tag: '' });
  assert.equal(seatText(seat({ empty: true }), ctx).kind, 'qualifier');
  assert.equal(seatText(seat({ empty: true }), ctx).label, 'Qualifier');
  assert.deepEqual(seatText(seat({ empty: true }), { ...ctx, linked: false }), { kind: 'tbd', names: [], label: 'TBD', tag: '' });
});

test('seatText: a category label beats its shape key, and no label is used on a seat a match fills', () => {
  const ctx = { playoffSeats: { X: { SF_1: 'Category label' }, '3x2': { SF_1: 'Shape label', SF_2: 'Shape only' } }, category: 'X', shapeKey: '3x2', rrRows: [], linked: true };
  const seat = (rest, over) => ({ row: undefined, code: `X_${rest}`, rest, from: null, empty: true, ...over });
  assert.equal(seatText(seat('SF_1'), ctx).label, 'Category label');
  assert.equal(seatText(seat('SF_2'), ctx).label, 'Shape only');
  assert.equal(seatText(seat('SF_3'), ctx).label, 'Qualifier');
  assert.equal(seatText(seat('SF_1', { from: { kind: 'W', match: 'QF-1' } }), ctx).label, 'Winner of QF-1');
  assert.equal(seatText(seat('SF_2'), { ...ctx, shapeKey: null }).label, 'Qualifier');
});

test('seatText: a named seat filled from the round robin carries its source tag, a seat a match filled does not', () => {
  const rrRows = [
    { teamCode: 'X_1', player1: 'Ann', player2: 'Bo', wins: 2, quotient: 2, bracket: '2' },
    { teamCode: 'X_2', player1: 'Cy', player2: 'Di', wins: 1, quotient: 1, bracket: '2' },
  ];
  const ctx = { playoffSeats: {}, category: 'X', shapeKey: null, rrRows, linked: true };
  const row = { teamCode: 'X_SF_1', player1: 'di', player2: ' CY ' };
  assert.equal(seatText({ row, code: 'X_SF_1', rest: 'SF_1', from: null, empty: false }, ctx).tag, 'Br 2 · #2');
  assert.equal(seatText({ row, code: 'X_SF_1', rest: 'SF_1', from: { kind: 'W', match: 'QF-1' }, empty: false }, ctx).tag, '');
});

test('sourceTag: matches a pair whatever the name order, case and spacing', () => {
  const rrRows = [
    { player1: 'Ann  Lee', player2: 'Bo Cruz', wins: 3, quotient: 3, bracket: '1' },
    { player1: 'Cy', player2: 'Di', wins: 2, quotient: 1, bracket: '1' },
    { player1: 'Ed', player2: 'Flo', wins: 3, quotient: 2, bracket: '2' },
  ];
  assert.equal(sourceTag({ player1: 'bo cruz', player2: 'ANN LEE' }, rrRows), 'Br 1 · #1');
  assert.equal(sourceTag({ player1: 'Cy', player2: 'Di' }, rrRows), 'Br 1 · #2');
  assert.equal(sourceTag({ player1: 'Flo', player2: 'Ed' }, rrRows), 'Br 2 · #1');
});

test('sourceTag: empty on no match and on two, and #n when the round robin has no brackets', () => {
  const rrRows = [
    { player1: 'Ann', player2: 'Bo', wins: 1, quotient: 1, bracket: '' }, { player1: 'Ann', player2: 'Bo', wins: 0, quotient: 0, bracket: '' },
    { player1: 'Cy', player2: 'Di', wins: 2, quotient: 2, bracket: '' },
  ];
  assert.equal(sourceTag({ player1: 'Zed', player2: 'Yan' }, rrRows), '');
  assert.equal(sourceTag({ player1: 'Ann', player2: 'Bo' }, rrRows), '', 'two rows with the pair is ambiguous');
  assert.equal(sourceTag({ player1: 'Cy', player2: 'Di' }, rrRows), '#1');
});

test('sourceTag: ranks by wins then quotient within the pair\'s own bracket, ignoring head-to-head', () => {
  const rrRows = [
    { player1: 'a', player2: 'a2', wins: 2, quotient: 1.1, bracket: '1' },
    { player1: 'b', player2: 'b2', wins: 2, quotient: 1.9, bracket: '1' },
    { player1: 'c', player2: 'c2', wins: 9, quotient: 9, bracket: '2' },
  ];
  assert.equal(sourceTag({ player1: 'a', player2: 'a2' }, rrRows), 'Br 1 · #2');
  assert.equal(sourceTag({ player1: 'b', player2: 'b2' }, rrRows), 'Br 1 · #1');
});

test('seatContext reads the category, its shape and its named round robin rows from the model', () => {
  const m = model({ standings: [...rrBrackets('MD', 2), rr('MD_5', 'bye', 'bye', 0, 0, 0, '1'), rr('MD_6', 'MD_6', '', 0, 0, '', '2'), ...MD.map(slot)], display: {} });
  m.event.playoffSeats = { MD: { SF_1: 'x' } };
  const rows = m.standings.filter(s => s.teamCode.startsWith('MD_'));
  const ctx = seatContext(buildBracket(rows, m), m);
  assert.deepEqual([ctx.category, ctx.shapeKey, ctx.linked, ctx.playoffSeats], ['MD', '2x2', true, { MD: { SF_1: 'x' } }]);
  assert.equal(ctx.rrRows.length, 4, 'a BYE row and an unnamed row are left out');
});

// ---- geometry -----------------------------------------------------------------------------------

const layoutOf = (links, groups, key) => {
  const b = bracketOf(ladder(links, groups, key), key);
  const lay = layoutBracket(b, DIMS);
  const at = id => lay.nodes.find(n => n.node.games.some(g => g.id === id) || n.node.id === id);
  return { b, lay, at };
};
const cardH = DIMS.headH + 2 * DIMS.seatH;
const middle = n => n.y + n.h / 2;
const seatMiddle = (n, k) => n.y + DIMS.headH + k * DIMS.seatH + DIMS.seatH / 2;
const endsOf = d => { const [, x1, y1, xm, y2, x2] = d.match(/^M(-?\d+) (-?\d+) H(-?\d+) V(-?\d+) H(-?\d+)$/); return { x1: +x1, y1: +y1, xm: +xm, y2: +y2, x2: +x2 }; };

test('layoutBracket: HIMD lines up each feeder with the seat it fills', () => {
  const { b, lay, at } = layoutOf(HIMD, 3, 'HIMD');
  assert.equal(lay.width, 4 * DIMS.cardW + 3 * DIMS.colGap);
  assert.equal(lay.nodes.find(n => n.node === at('R16-3').node).h, cardH);
  const lines = lay.lines.map(l => endsOf(l.d));
  assert.equal(lines.length, 4, 'R16-3 to QF-2, QF-2 to SF-2, SF-1 and SF-2 to the Final');
  const r16qf = lines.find(l => l.x1 === at('R16-3').x + DIMS.cardW && l.x2 === at('QF-2').x);
  assert.equal(r16qf.y1, middle(at('R16-3')), 'leaves the middle of R16-3');
  assert.equal(r16qf.y2, seatMiddle(at('QF-2'), 0), 'enters QF-2\'s first seat');
  const qfsf = lines.find(l => l.x1 === at('QF-2').x + DIMS.cardW && l.x2 === at('SF-2').x);
  assert.equal(qfsf.y2, seatMiddle(at('SF-2'), 1), 'QF-2 enters SF-2\'s second seat');
  assert.equal(qfsf.xm, qfsf.x1 + DIMS.colGap / 2);
  assert.deepEqual(layoutBracket(b, DIMS), lay, 'a pure function of its input');
});

test('layoutBracket: no two cards in a round overlap, the bronze sits below every card, and nothing starts above the captions', () => {
  const { lay } = layoutOf(HIMD, 3, 'HIMD');
  const byX = new Map();
  lay.nodes.forEach(n => byX.set(n.x, [...(byX.get(n.x) || []), n]));
  for (const col of byX.values()) {
    col.sort((a, b) => a.y - b.y);
    col.slice(1).forEach((n, i) => assert.ok(n.y >= col[i].y + col[i].h + DIMS.rowGap || n.node === col[i].node, 'cards keep their row gap'));
  }
  const bronze = lay.nodes.find(n => n.node.id === 'B');
  const others = lay.nodes.filter(n => n !== bronze);
  assert.ok(bronze.y >= Math.max(...others.map(n => n.y + n.h)) + DIMS.bronzeGap);
  assert.equal(bronze.x, 3 * (DIMS.cardW + DIMS.colGap), 'under the Final');
  assert.ok(Math.min(...others.map(n => n.y)) >= DIMS.captionH);
  assert.equal(lay.height, bronze.y + bronze.h);
  assert.deepEqual(lay.captions.filter(c => c.y === 0).map(c => c.text), ['Round of 16', 'Quarterfinals', 'Semifinals', 'Finals']);
  const bronzeCaption = lay.captions.find(c => c.text === 'Bronze Battle');
  assert.equal(bronzeCaption.y, bronze.y - DIMS.captionH + 4);
});

test('layoutBracket: XD puts a semifinal at the mean of its two quarterfinals, and the Final at the mean of the semifinals', () => {
  const { lay, at } = layoutOf(XD, 4, 'XD');
  assert.equal(middle(at('SF-1')), (middle(at('QF-1')) + middle(at('QF-2'))) / 2);
  assert.equal(middle(at('SF-2')), (middle(at('QF-3')) + middle(at('QF-4'))) / 2);
  assert.equal(middle(at('F')), (middle(at('SF-1')) + middle(at('SF-2'))) / 2);
  assert.equal(lay.lines.length, 6);
});

test('layoutBracket: a one-feeder round aligns the feeder with the seat it fills', () => {
  const { at, lay } = layoutOf(T3, 3, 'T3');
  assert.equal(middle(at('SF-1')), seatMiddle(at('F'), 1));
  assert.equal(lay.lines.length, 1);
});

test('layoutBracket: a series node stacks its games, and a long series does not collide with the bronze', () => {
  const { lay } = layoutOf(ONE, 1, 'ONE');
  const final = lay.nodes.find(n => n.node.id === 'F');
  assert.equal(final.h, 2 * cardH + DIMS.seriesGap);
  assert.equal(lay.lines.length, 0);
});

test('layoutBracket: without links the columns are stacked and centred, with no lines', () => {
  const pfs = [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => `NMD_QF_${n},NMD_QF_${n},,0,0,,`),
    ...[1, 2, 3, 4].map(n => `NMD_SF_${n},NMD_SF_${n},,0,0,,`),
    'NMD_F_1,NMD_F_1,,0,0,,', 'NMD_F_2,NMD_F_2,,0,0,,',
  ];
  const m = model({ standings: pfs, header: PLAIN_HEADER });
  const lay = layoutBracket(buildBracket(m.standings, m), DIMS);
  assert.equal(lay.lines.length, 0);
  const column = x => lay.nodes.filter(n => n.x === x);
  const first = column(0), last = column(2 * (DIMS.cardW + DIMS.colGap));
  assert.equal(first.length, 4);
  assert.equal(first[0].y, DIMS.captionH, 'the tallest column starts under the captions');
  assert.equal(first[1].y - first[0].y, cardH + DIMS.rowGap);
  const tallest = first.at(-1).y + first.at(-1).h;
  assert.equal(last[0].y + last[0].h / 2, (DIMS.captionH + tallest) / 2, 'the Final is centred on the tallest column');
});

test('pairPlayoffRows pairs by match instance, then bracket column, then in order', () => {
  const rows = [{ teamCode: 'NOD_QF_1_(1)' }, { teamCode: 'NOD_QF_2_(1)' }, { teamCode: 'NOD_QF_1_(2)' }, { teamCode: 'NOD_QF_2_(2)' }];
  assert.equal(pairPlayoffRows(rows).length, 2);
  assert.deepEqual(pairPlayoffRows([{ teamCode: 'A' }, { teamCode: 'B' }, { teamCode: 'C' }]).map(p => p.length), [2, 1]);
});
