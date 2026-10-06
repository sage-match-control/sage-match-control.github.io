// Characterization (site-engine-spec §5.2): the domain modules against the page
// code they replace, on every fixture snapshot in every state. Deliberate
// differences are asserted explicitly, not left to the equality check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { oldCode, plain, without } from '../../helpers/old.mjs';
import { SNAPSHOTS, STATES, loadSnapshot, deriveState } from '../../helpers/fixtures.mjs';
import { parseCSV } from '../../../lib/v1/domain/csv.js';
import { rowsToMatches } from '../../../lib/v1/domain/matches.js';
import { rowsToStandings } from '../../../lib/v1/domain/standings.js';
import * as Byes from '../../../lib/v1/domain/byes.js';
import * as Series from '../../../lib/v1/domain/series.js';

const CC = 'tools/control-center.html';
const STD = '_templates/standard-tournament-template/index.html';
const DM = '_templates/dual-meet-template/index.html';
const STD_SCHEDULE = '_templates/standard-tournament-template/schedule.html';
const DM_SCHEDULE = '_templates/dual-meet-template/schedule.html';
const SCORER = '_templates/scorer/scorer.html';

/** Every CSV text in every fixture, in every state, with a label. */
function* csvs() {
  for (const event of Object.keys(SNAPSHOTS)) {
    for (const state of STATES) {
      const snap = deriveState(loadSnapshot(event), state);
      for (const f of snap.facilities) {
        for (const kind of ['matchesCsv', 'standingsCsv', 'rosterCsv']) {
          if (f[kind]) yield { label: `${event}/${state}/${f.name}/${kind}`, kind, text: f[kind], event };
        }
      }
    }
  }
}

const HAND_CSVS = ['', 'a,b', 'a,b\n', '"q ""x""",2\r\n\r\n3,"4\n5"\r\n', 'a\n,\n,,\n"",\n x ,y'];

// ---- parseCSV: six copies, all identical ------------------------------------------------------------------

for (const [label, rel] of [['CC', CC], ['std index', STD], ['dm index', DM], ['std schedule', STD_SCHEDULE], ['dm schedule', DM_SCHEDULE], ['scorer', SCORER]]) {
  test(`parseCSV: ${label}'s copy reads every fixture and hand CSV as the module does`, () => {
    const old = oldCode(rel, { functions: ['parseCSV'] });
    let n = 0;
    for (const { label: l, text } of csvs()) { assert.deepStrictEqual(parseCSV(text), plain(old.parseCSV(text)), l); n++; }
    for (const text of HAND_CSVS) assert.deepStrictEqual(parseCSV(text), plain(old.parseCSV(text)), JSON.stringify(text));
    assert.ok(n >= 30, `${n} fixture CSVs`);
  });
}

// ---- rowsToMatches / rowsToStandings --------------------------------------------------------------------------

test('rowsToMatches: CC’s copy is the module, exactly', () => {
  const old = oldCode(CC, { functions: ['parseCSV', 'rowsToMatches'] });
  for (const { label, kind, text } of csvs()) {
    if (kind !== 'matchesCsv') continue;
    assert.deepStrictEqual(rowsToMatches(parseCSV(text)), plain(old.rowsToMatches(old.parseCSV(text))), label);
  }
});

for (const [label, rel] of [['std index', STD], ['dm index', DM]]) {
  test(`rowsToMatches: ${label}’s copy is the module without matchUp, which the module adds (§12)`, () => {
    const old = oldCode(rel, { functions: ['parseCSV', 'rowsToMatches'] });
    for (const { label: l, kind, text } of csvs()) {
      if (kind !== 'matchesCsv') continue;
      const mine = rowsToMatches(parseCSV(text));
      assert.deepStrictEqual(without(mine, ['matchUp']), plain(old.rowsToMatches(old.parseCSV(text))), l);
    }
  });

  test(`rowsToStandings: ${label}’s copy is the module without teamName, pf and pa, which the module adds`, () => {
    const old = oldCode(rel, { functions: ['parseCSV', 'rowsToStandings'] });
    for (const { label: l, kind, text } of csvs()) {
      if (kind !== 'standingsCsv') continue;
      const mine = rowsToStandings(parseCSV(text));
      assert.deepStrictEqual(without(mine, ['teamName', 'pf', 'pa']), plain(old.rowsToStandings(old.parseCSV(text))), l);
    }
  });
}

test('rowsToStandings: CC’s copy is the module, exactly', () => {
  const old = oldCode(CC, { functions: ['parseCSV', 'rowsToStandings'] });
  for (const { label, kind, text } of csvs()) {
    if (kind !== 'standingsCsv') continue;
    assert.deepStrictEqual(rowsToStandings(parseCSV(text)), plain(old.rowsToStandings(old.parseCSV(text))), label);
  }
});

// ---- byes ------------------------------------------------------------------------------------------------------------

test('byes: CC and the scorer carry the module’s functions; the Hubs’ matchSideIsBye is sideIsBye', () => {
  const values = ['', 'bye', 'BYE', ' Bye ', 'byes', 'b ye', 'ND_1', undefined, null, 'x'];
  for (const rel of [CC, SCORER]) {
    const old = oldCode(rel, { consts: ['BYE_RE'], functions: ['sideIsBye', 'matchByeSide'] });
    for (const a of values) for (const b of values) for (const c of values) {
      assert.equal(Byes.sideIsBye(a, b, c), old.sideIsBye(a, b, c), `${rel} ${[a, b, c]}`);
    }
    for (const t1 of values) for (const t2p1 of values) {
      const m = { t1, t1p1: 'a', t1p2: 'b', t2: 'T2', t2p1, t2p2: 'd' };
      assert.equal(Byes.matchByeSide(m), old.matchByeSide(m), `${rel} ${[t1, t2p1]}`);
    }
  }
  for (const rel of [STD, DM]) {
    const old = oldCode(rel, { consts: ['BYE_RE'], functions: ['matchSideIsBye', 'isByeStandingRow'] });
    for (const a of values) for (const b of values) for (const c of values) {
      assert.equal(Byes.sideIsBye(a, b, c), old.matchSideIsBye(a, b, c), `${rel} ${[a, b, c]}`);
    }
    for (const teamCode of values) for (const player1 of values) {
      assert.equal(Byes.isByeStandingRow({ teamCode, player1 }), old.isByeStandingRow({ teamCode, player1 }));
    }
  }
  const cc = oldCode(CC, { consts: ['BYE_RE'], functions: ['isByeStandingRow'] });
  for (const teamCode of values) for (const player1 of values) {
    assert.equal(Byes.isByeStandingRow({ teamCode, player1 }), cc.isByeStandingRow({ teamCode, player1 }));
  }
});

// ---- series ------------------------------------------------------------------------------------------------------------

/** Every outcome of a series of `games` games: each game won by seat 1, seat 2, tied or unplayed. */
function* seriesScenarios(games) {
  const outcomes = [['11', '5'], ['5', '11'], ['9', '9'], ['', '']];
  const total = outcomes.length ** games;
  for (let i = 0; i < total; i++) {
    const rows = [];
    for (let g = 0; g < games; g++) {
      const [s1, s2] = outcomes[Math.floor(i / outcomes.length ** g) % outcomes.length];
      rows.push({ g: g + 1, s1, s2 });
    }
    yield rows;
  }
}

const toMatches = (series, rows) => rows.map(({ g, s1, s2 }, i) => ({
  num: i + 1, t1: `${series}_1_(${g})`, t2: `${series}_2_(${g})`,
  t1Score: s1 === '' ? null : Number(s1), t2Score: s2 === '' ? null : Number(s2), played: s1 !== '' && s2 !== '',
}));

test('series: CC’s seriesGameOf, seriesGroups, walkSeries and unneededSeriesGames are the module’s, on every outcome of 2- and 3-game series', () => {
  const old = oldCode(CC, { consts: ['SERIES_GAME_RE'], functions: ['seriesGameOf', 'seriesGroups', 'walkSeries', 'unneededSeriesGames'] });
  for (const code of ['IXD_F_1_(2)', 'X_F_2_(1)', 'IXD_F_1', 'IXD_SF_1_(1)', '', undefined, ' A_F_3_(10) ']) {
    assert.deepStrictEqual(Series.seriesGameOf(code), plain(old.seriesGameOf(code)), String(code));
  }
  let n = 0;
  for (const games of [2, 3]) for (const rows of seriesScenarios(games)) {
    const ms = toMatches('IXD_F', rows);
    const noise = { num: 99, t1: 'ND_1', t2: 'ND_2', t1Score: 11, t2Score: 3, played: true };
    const nums = set => [...set].map(m => m.num).sort();
    assert.deepStrictEqual(nums(Series.unneededSeriesGames([...ms, noise])), nums(old.unneededSeriesGames([...ms, noise])), JSON.stringify(rows));
    const mine = Series.walkSeries(Series.seriesGroups(ms).get('IXD_F'));
    const theirs = old.walkSeries(old.seriesGroups(ms).get('IXD_F'));
    assert.deepStrictEqual(plain({ d: mine.decidedBy, t: mine.tie, u: mine.unneeded }), plain({ d: theirs.decidedBy, t: theirs.tie, u: theirs.unneeded }), JSON.stringify(rows));
    n++;
  }
  assert.equal(n, 16 + 64);
});

// The scorer carries CC's three-function form; the Hubs and boards one 25-line function.
for (const [label, rel, extra] of [['std index', STD, []], ['dm index', DM, []], ['std schedule', STD_SCHEDULE, []], ['dm schedule', DM_SCHEDULE, []], ['scorer', SCORER, ['seriesGroups', 'walkSeries']]]) {
  test(`series: ${label}’s unneededSeriesGames agrees with the module on every outcome`, () => {
    const old = oldCode(rel, { consts: ['SERIES_GAME_RE'], functions: ['seriesGameOf', ...extra, 'unneededSeriesGames'] });
    for (const games of [2, 3]) for (const rows of seriesScenarios(games)) {
      const ms = toMatches('IXD_F', rows);
      const nums = set => [...set].map(m => m.num).sort();
      assert.deepStrictEqual(nums(Series.unneededSeriesGames(ms)), nums(old.unneededSeriesGames(ms)), JSON.stringify(rows));
    }
  });
}

test('series: on the fixtures, CC’s unneededSeriesGames marks the same matches as the module', () => {
  const old = oldCode(CC, { consts: ['SERIES_GAME_RE'], functions: ['parseCSV', 'rowsToMatches', 'seriesGameOf', 'seriesGroups', 'walkSeries', 'unneededSeriesGames'] });
  let any = 0;
  for (const event of Object.keys(SNAPSHOTS)) for (const state of STATES) {
    for (const f of deriveState(loadSnapshot(event), state).facilities) {
      const nums = set => [...set].map(m => m.num).sort((a, b) => a - b);
      const mine = Series.unneededSeriesGames(rowsToMatches(parseCSV(f.matchesCsv)));
      const theirs = old.unneededSeriesGames(old.rowsToMatches(old.parseCSV(f.matchesCsv)));
      assert.deepStrictEqual(nums(mine), nums(theirs), `${event}/${state}`);
      any += mine.size;
    }
  }
  assert.ok(any > 0, 'a fixture has a series final with a game that is never played');
});
