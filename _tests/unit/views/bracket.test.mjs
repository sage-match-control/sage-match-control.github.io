// views/bracket.js: the bracket chart's and the round strip's markup, on hand-made models
// (sage-docs/docs/specs/.../standings-bracket-chart-spec.md §7.4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import { buildBracket } from '../../../lib/v1/domain/bracket.js';
import { bracketChartHTML, roundStripHTML, startRound, fullTreeButtonHTML, BRACKET_DIMS } from '../../../lib/v1/views/bracket.js';

const MATCH_HEADER = 'matchNumber,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const STAND_HEADER = 'teamCode,player1,player2,wins,loss,quotient,bracket,match,from';

const HIMD = [
  ['HIMD_R16_5', 'R16-3', ''], ['HIMD_R16_6', 'R16-3', ''], ['HIMD_QF_3', 'QF-2', 'W:R16-3'], ['HIMD_QF_4', 'QF-2', ''],
  ['HIMD_SF_1', 'SF-1', ''], ['HIMD_SF_2', 'SF-1', ''], ['HIMD_SF_3', 'SF-2', ''], ['HIMD_SF_4', 'SF-2', 'W:QF-2'],
  ['HIMD_B_1', 'B', 'L:SF-1'], ['HIMD_B_2', 'B', 'L:SF-2'], ['HIMD_F_1', 'F', 'W:SF-1'], ['HIMD_F_2', 'F', 'W:SF-2'],
];
/** Every slot empty (names are the codes), or named from `names` ([code]: [p1, p2]). */
const rowsFor = (names = {}) => HIMD.map(([code, match, from]) => {
  const [p1, p2] = names[code] || [code, ''];
  return `${code},${p1},${p2},0,0,,,${match},${from}`;
});
const NAMES = Object.fromEntries(HIMD.map(([code], i) => [code, [`First${i} Last${i}`, `Other${i} Name${i}`]]));
const RR = ['HIMD_1,Ann Lee,Bo Cruz,2,0,2,1,,', 'HIMD_2,Cy Diaz,Di Eng,0,2,0.5,1,,', 'HIMD_3,Ed Fox,Flo Gil,2,0,1.5,2,,'];
const mt = (num, court, time, t1, s1, t2, s2) => `${num},,${time},${court},${t1},a,b,${s1},${t2},c,d,${s2}`;

const model = (standings, matches = []) => buildDayModel(
  { key: 'e', type: 'standard', title: 'E', display: {}, days: [] },
  { key: 'd', facilities: ['Main'] },
  { isLive: true, facilities: [{ name: 'Main', matchesCsv: [MATCH_HEADER, ...matches].join('\n'), standingsCsv: [STAND_HEADER, ...standings].join('\n') }] },
  { now: 0 },
);
const bracketFor = m => buildBracket(m.standings.filter(s => s.teamCode.startsWith('HIMD_')), m);
const cards = html => html.match(/<div class="bk-card[^"]*"[^>]*>/g) || [];

test('the chart has one card per game, with its match id, and the sheet\'s size', () => {
  const m = model([...RR, ...rowsFor()]);
  const { html, width, height } = bracketChartHTML(bracketFor(m), m);
  assert.equal(width, 4 * BRACKET_DIMS.cardW + 3 * BRACKET_DIMS.colGap);
  assert.ok(height > 0);
  assert.deepEqual(cards(html).map(c => c.match(/data-bk-match="([^"]+)"/)[1]), ['R16-3', 'QF-2', 'SF-1', 'SF-2', 'F', 'B']);
  assert.match(html, new RegExp(`<div class="bk" style="width:${width}px;height:${height}px" data-bk-cat="HIMD">`));
  assert.equal((html.match(/<path /g) || []).length, 4, 'a line per feeder');
  assert.match(html, /<svg class="bk-lines" width="\d+" height="\d+" aria-hidden="true">/);
  assert.deepEqual([...html.matchAll(/<div class="bk-caption"[^>]*>([^<]*)</g)].map(x => x[1]), ['Round of 16', 'Quarterfinals', 'Semifinals', 'Finals', 'Bronze Battle']);
});

test('Full tree\'s button names the category, and the chart Full tree shows has none', () => {
  assert.equal(fullTreeButtonHTML('A&B'), '<button type="button" class="bk-full-open" data-bk-full="A&amp;B">Full tree</button>');
  const m = model([...RR, ...rowsFor()]);
  assert.doesNotMatch(bracketChartHTML(bracketFor(m), m).html, /bk-full-open/);
});

test('an empty seat says where it comes from, and the Final reads as the Final', () => {
  const m = model([...RR, ...rowsFor()]);
  const { html } = bracketChartHTML(bracketFor(m), m);
  assert.match(html, /bk-seat bk-seat--open[^>]*><span class="bk-names">Winner of QF-2</);
  assert.match(html, /<span class="bk-names">Loser of SF-1</);
  assert.match(html, /<span class="bk-names">Winner of R16-3</);
  assert.match(html, /<span class="bk-names">Qualifier</);
  assert.match(html, /<div class="bk-card bk-card--final" data-bk-match="F"><div class="bk-head"><span class="bk-label">Final<\/span>/);
  assert.match(html, /data-bk-match="B"><div class="bk-head"><span class="bk-label">Bronze<\/span>/);
});

test('the event\'s labels fill the round robin seats, and a named seat shows its names and where they came from', () => {
  const m = model([...RR, ...rowsFor({ HIMD_SF_1: ['Ann Lee', 'Bo Cruz'], HIMD_SF_2: ['Ed Fox', 'Flo Gil'] })]);
  m.event.playoffSeats = { HIMD: { QF_4: 'Best runner-up' }, '2x3': { SF_3: 'Bracket winner' } };
  const { html } = bracketChartHTML(bracketFor(m), m);
  assert.match(html, /<span class="bk-names">Best runner-up</);
  assert.match(html, /<span class="bk-names">Bracket winner</);
  assert.match(html, /title="Ann Lee \/ Bo Cruz"><span class="bk-names"><span class="bk-full">Ann Lee \/ Bo Cruz<\/span><span class="bk-short">Lee \/ Cruz<\/span><\/span><span class="bk-tag">Br 1 · #1<\/span>/);
  assert.match(html, /<span class="bk-tag">Br 2 · #1<\/span>/);
});

test('a seat a match fills carries no tag, and a played game shows scores, a winner and Done', () => {
  const names = { HIMD_QF_3: ['Ann Lee', 'Bo Cruz'], HIMD_QF_4: ['Ed Fox', 'Flo Gil'] };
  const m = model([...RR, ...rowsFor(names)], [mt(7, 'Court 3', '9:00 AM', 'HIMD_QF_3', 11, 'HIMD_QF_4', 8)]);
  const { html } = bracketChartHTML(bracketFor(m), m);
  const qf = html.slice(html.indexOf('data-bk-match="QF-2"'), html.indexOf('data-bk-match="SF-1"'));
  assert.match(qf, /<span class="bk-label">QF-2 · Court 3<\/span><span class="bk-status">Done<\/span>/);
  assert.match(qf, /bk-seat win"/);
  assert.match(qf, /bk-seat loss"/);
  assert.match(qf, /<span class="bk-score">11<\/span>/);
  assert.match(qf, /<span class="bk-score">8<\/span>/);
  assert.equal((qf.match(/bk-tag/g) || []).length, 1, 'only QF_4, which the round robin filled, has a tag');
  assert.ok(qf.indexOf('Ed Fox') < qf.indexOf('bk-tag'), 'QF_3 is filled by R16-3\'s winner, so it has none');
  assert.match(html, /<span class="bk-score">–<\/span>/);
});

test('status: Live on court, the scheduled time, and Not needed for a series game', () => {
  const live = model([...RR, ...rowsFor({ HIMD_SF_1: ['A B', 'C D'], HIMD_SF_2: ['E F', 'G H'] })], [
    '5,Court 2,9:00 AM,Court 2,HIMD_SF_1,a,b,,HIMD_SF_2,c,d,',
    mt(6, 'Court 4', '9:30 AM', 'HIMD_SF_3', '', 'HIMD_SF_4', ''),
  ]);
  const { html } = bracketChartHTML(bracketFor(live), live);
  const sf1 = html.slice(html.indexOf('data-bk-match="SF-1"'), html.indexOf('data-bk-match="SF-2"'));
  assert.match(sf1, /<span class="bk-status">Live<\/span>/);
  assert.match(html.match(/<div class="bk-card[^"]*"[^>]*data-bk-match="SF-1"/)[0], /bk-card--live/);
  const sf2 = html.slice(html.indexOf('data-bk-match="SF-2"'), html.indexOf('data-bk-match="F"'));
  assert.match(sf2, /<span class="bk-label">SF-2 · Court 4<\/span><span class="bk-status">9:30 AM<\/span>/);

  const ONE = ['ONE_F_1_(1),Ann,Bo,0,0,,,F (1),', 'ONE_F_2_(1),Cy,Di,0,0,,,F (1),', 'ONE_F_1_(2),Ann,Bo,0,0,,,F (2),', 'ONE_F_2_(2),Cy,Di,0,0,,,F (2),'];
  const series = model(ONE, ['1,,9:00 AM,Court 1,ONE_F_1_(1),Ann,Bo,11,ONE_F_2_(1),Cy,Di,4', '2,,9:30 AM,Court 1,ONE_F_1_(2),Ann,Bo,,ONE_F_2_(2),Cy,Di,']);
  const b = buildBracket(series.standings, series);
  const html2 = bracketChartHTML(b, series).html;
  assert.match(html2, /not-needed[^>]*data-bk-match="F \(2\)"/);
  assert.match(html2, /<span class="bk-label">Final · Match 2 · Court 1<\/span><span class="bk-status">Not needed<\/span>/);
});

test('decorate adds its class and attributes to a card with a scheduled match, and is never called without one', () => {
  const m = model([...RR, ...rowsFor({ HIMD_SF_1: ['A B', 'C D'], HIMD_SF_2: ['E F', 'G H'] })], [mt(9, 'Court 1', '9:00 AM', 'HIMD_SF_1', '', 'HIMD_SF_2', '')]);
  const seen = [];
  const decorate = match => { seen.push(match.num); return { className: ' hot', attrs: ' data-x="9"' }; };
  const { html } = bracketChartHTML(bracketFor(m), m, { decorate });
  assert.deepEqual(seen, [9]);
  assert.match(html, /<div class="bk-card hot" data-bk-match="SF-1" data-x="9">/);
  assert.equal((html.match(/data-x="9"/g) || []).length, 1);
  const strip = roundStripHTML(bracketFor(m), m, { decorate });
  assert.match(strip, /data-bk-match="SF-1" data-x="9"/);
});

test('names are shortened to surnames, and escaped', () => {
  const m = model([...RR, ...rowsFor({ HIMD_SF_1: ['Maria <b>Cruz', "Ana O'Neil"], HIMD_SF_2: ['Solo', ''] })]);
  const { html } = bracketChartHTML(bracketFor(m), m);
  assert.match(html, /<span class="bk-full">Maria &lt;b&gt;Cruz \/ Ana O&#39;Neil<\/span><span class="bk-short">&lt;b&gt;Cruz \/ O&#39;Neil<\/span>/);
  assert.match(html, /<span class="bk-full">Solo<\/span><span class="bk-short">Solo<\/span>/);
  assert.doesNotMatch(html, /<b>Cruz/);
});

test('without links the cards are headed by their round and the empty seats read TBD', () => {
  const PFS = [...[1, 2, 3, 4].map(n => `NMD_QF_${n},NMD_QF_${n},,0,0,,`), 'NMD_SF_1,NMD_SF_1,,0,0,,', 'NMD_SF_2,NMD_SF_2,,0,0,,', 'NMD_F_1,NMD_F_1,,0,0,,', 'NMD_F_2,NMD_F_2,,0,0,,'];
  const m = buildDayModel(
    { key: 'e', type: 'standard', title: 'E', display: {}, days: [] }, { key: 'd', facilities: ['Main'] },
    { isLive: true, facilities: [{ name: 'Main', matchesCsv: MATCH_HEADER, standingsCsv: ['teamCode,player1,player2,wins,loss,quotient,bracket', ...PFS].join('\n') }] }, { now: 0 });
  const html = bracketChartHTML(buildBracket(m.standings, m), m).html;
  assert.equal(cards(html).length, 4, 'two quarterfinals, a semifinal and the Final');
  assert.match(html, /<span class="bk-label">Quarterfinal<\/span>/);
  assert.match(html, /<span class="bk-label">Final<\/span>/);
  assert.match(html, /<span class="bk-names">TBD</);
  assert.doesNotMatch(html, /<path /);
  assert.doesNotMatch(html, /Winner of|Qualifier/);
});

test('the strip is the whole chart, lines and all, in a window that scrolls sideways under a chip per round, with Full tree', () => {
  const m = model([...RR, ...rowsFor()]);
  const html = roundStripHTML(bracketFor(m), m);
  assert.match(html, /^<div class="bk-rounds" data-bk-cat="HIMD" data-bk-start="0" data-bk-start-x="0">/);
  const step = BRACKET_DIMS.cardW + BRACKET_DIMS.colGap;
  assert.deepEqual([...html.matchAll(/<button type="button" class="bk-chip[^"]*" data-bk-round="(\d)" data-bk-x="(\d+)" role="tab" aria-selected="(true|false)">([^<]+)</g)].map(x => x.slice(1)),
    [['0', '0', 'true', 'Round of 16'], ['1', String(step), 'false', 'Quarterfinals'], ['2', String(2 * step), 'false', 'Semifinals'], ['3', String(3 * step), 'false', 'Finals']]);
  assert.match(html, /<div class="bk-track" data-group-key="HIMD"><div class="bk" /);
  assert.equal((html.match(/<path /g) || []).length, 4, 'the lines are drawn');
  assert.deepEqual(cards(html).map(c => c.match(/data-bk-match="([^"]+)"/)[1]), ['R16-3', 'QF-2', 'SF-1', 'SF-2', 'F', 'B']);
  assert.deepEqual([...html.matchAll(/<i class="bk-snap" style="left:(\d+)px"><\/i>/g)].map(x => +x[1]), [0, step, 2 * step, 3 * step], 'a swipe settles on a round');
  assert.match(html, /<button type="button" class="bk-full-open" data-bk-full="HIMD">Full tree<\/button>/);
  assert.equal((html.match(/class="bk-chip active"/g) || []).length, 1);
});

test('the strip opens on the round in play: the first with two named pairs still to play, else the last played, else the first', () => {
  const start = (names, matches) => { const m = model([...RR, ...rowsFor(names)], matches); return startRound(bracketFor(m), m); };
  assert.equal(start({}, []), 0, 'before the playoffs');
  const R16 = { HIMD_R16_5: ['A B', 'C D'], HIMD_R16_6: ['E F', 'G H'] };
  assert.equal(start(R16, []), 0, 'the first round is ready to play');
  const mid = { ...R16, HIMD_QF_3: ['A B', 'C D'], HIMD_QF_4: ['I J', 'K L'] };
  assert.equal(start(mid, [mt(1, 'Court 1', '9:00 AM', 'HIMD_R16_5', 11, 'HIMD_R16_6', 4)]), 1, 'R16 is played and QF-2 is next');
  const all = Object.fromEntries(HIMD.map(([code], i) => [code, [`P${i} A`, `P${i} B`]]));
  const played = [['HIMD_R16_5', 'HIMD_R16_6'], ['HIMD_QF_3', 'HIMD_QF_4'], ['HIMD_SF_1', 'HIMD_SF_2'], ['HIMD_SF_3', 'HIMD_SF_4'], ['HIMD_B_1', 'HIMD_B_2'], ['HIMD_F_1', 'HIMD_F_2']]
    .map(([a, b], i) => mt(i + 1, 'Court 1', '9:00 AM', a, 11, b, 5));
  assert.equal(start(all, played), 3, 'everything played: the Final');
  const html = (() => { const m = model([...RR, ...rowsFor(mid)], [mt(1, 'Court 1', '9:00 AM', 'HIMD_R16_5', 11, 'HIMD_R16_6', 4)]); return roundStripHTML(bracketFor(m), m); })();
  assert.match(html, /data-bk-start="1" data-bk-start-x="208"/);
  assert.match(html, /class="bk-chip active" data-bk-round="0"/, 'the first chip is active on render; the page moves it');
});
