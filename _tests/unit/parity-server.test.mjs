// The one remaining hand-kept copy of the rules (root CLAUDE.md, "Things that
// must be kept in sync by hand"): sage-tools-api's facilityCompletion.mjs, which
// stamps a facility's completedAt, and lib/v1/domain, which decides when the
// facility card reads "All matches done". If they disagree, the recorded
// end-of-day time and the card that announces it disagree.
//
// Runs when the sibling sage-tools-api checkout exists, and skips with a message
// when it does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WORKSPACE_ROOT } from '../helpers/paths.mjs';
import { SNAPSHOTS, STATES, loadSnapshot, deriveState } from '../helpers/fixtures.mjs';
import { parseCSV } from '../../lib/v1/domain/csv.js';
import { rowsToMatches } from '../../lib/v1/domain/matches.js';
import { computeFacilityProgress } from '../../lib/v1/domain/progress.js';
import { unneededSeriesGames, seriesGameOf, unneededMeetingGames } from '../../lib/v1/domain/series.js';

const SERVER = path.join(WORKSPACE_ROOT, 'sage-tools-api', 'src', 'sync', 'domain', 'facilityCompletion.mjs');
const present = fs.existsSync(SERVER);
const server = present ? await import(pathToFileURL(SERVER).href) : null;
const options = { skip: present ? false : `no ${SERVER}: the sage-tools-api checkout is not beside this repo` };

const siteSaysComplete = csv => {
  const p = computeFacilityProgress(rowsToMatches(parseCSV(csv)), false, null);
  return p.total > 0 && p.left === 0;
};

const HEADER = 'matchNumber,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const csvOf = (...rows) => [HEADER, ...rows].join('\n');
const row = (num, t1, a, b, s1, t2, c, d, s2) => `${num},,9:00 AM,Court 1,${t1},${a},${b},${s1},${t2},${c},${d},${s2}`;

// The rules, one row each: played, BYE by each cell, series, empty.
const CASES = {
  'both scores in': csvOf(row(1, 'A_1', 'a', 'b', 11, 'A_2', 'c', 'd', 5)),
  'one score missing': csvOf(row(1, 'A_1', 'a', 'b', 11, 'A_2', 'c', 'd', '')),
  'the other one': csvOf(row(1, 'A_1', 'a', 'b', '', 'A_2', 'c', 'd', 5)),
  'neither': csvOf(row(1, 'A_1', 'a', 'b', '', 'A_2', 'c', 'd', '')),
  'a zero is a score': csvOf(row(1, 'A_1', 'a', 'b', 0, 'A_2', 'c', 'd', 11)),
  'a score that is not a number': csvOf(row(1, 'A_1', 'a', 'b', 'x', 'A_2', 'c', 'd', 11)),
  'scores with spaces': csvOf(row(1, 'A_1', 'a', 'b', ' 11 ', 'A_2', 'c', 'd', ' 5')),
  'a BYE by team code': csvOf(row(1, 'A_1', 'a', 'b', 11, 'A_2', 'c', 'd', 5), row(2, 'A_3', 'e', 'f', '', 'BYE', 'x', 'y', '')),
  'a BYE by player one': csvOf(row(1, 'A_1', 'a', 'b', 11, 'A_2', 'c', 'd', 5), row(2, 'A_3', 'e', 'f', '', 'A_4', 'bye', 'y', '')),
  'a BYE by player two': csvOf(row(1, 'A_1', 'a', 'b', 11, 'A_2', 'c', 'd', 5), row(2, 'A_3', 'e', 'f', '', 'A_4', 'x', 'Bye', '')),
  'a BYE on the first side, any case': csvOf(row(1, 'A_1', 'a', 'b', 11, 'A_2', 'c', 'd', 5), row(2, 'bYe', 'e', 'f', '', 'A_4', 'x', 'y', '')),
  'only BYEs': csvOf(row(1, 'BYE', 'a', 'b', '', 'A_2', 'c', 'd', '')),
  'a row with no match number': csvOf(row(1, 'A_1', 'a', 'b', 11, 'A_2', 'c', 'd', 5), ',,,,A_3,e,f,,A_4,g,h,'),
  'header only': csvOf(),
  'empty': '',
  // A double round robin: two matches with the same two codes (double-round-robin-and-finals-spec.md §6.0).
  'a double round robin, one meeting played': csvOf(
    row(1, 'A_1', 'a', 'b', 11, 'A_2', 'c', 'd', 5),
    row(2, 'A_2', 'c', 'd', '', 'A_1', 'a', 'b', '')),
  'a double round robin, both meetings played': csvOf(
    row(1, 'A_1', 'a', 'b', 11, 'A_2', 'c', 'd', 5),
    row(2, 'A_2', 'c', 'd', 9, 'A_1', 'a', 'b', 11)),
  'a one-game final and bronze': csvOf(
    row(1, 'A_F_1', 'a', 'b', 11, 'A_F_2', 'c', 'd', 7),
    row(2, 'A_B_1', 'e', 'f', 5, 'A_B_2', 'g', 'h', 11)),
  'a decimal score in a series final': csvOf(
    row(1, 'X_F_1_(1)', 'a', 'b', '11.5', 'X_F_2_(1)', 'c', 'd', '11'),
    row(2, 'X_F_1_(2)', 'a', 'b', '', 'X_F_2_(2)', 'c', 'd', '')),
};

// A team playoff matchup's tiebreaker game (sage-docs/docs/specs/.../ladies-dink-club-tournament-spec.md §4):
// game 1, game 2 and the tiebreaker of one quarterfinal, with the scores given ('' unplayed).
const TEAM_HEADER = 'matchNumber,matchUp,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const qfCsv = ([a1, a2], [b1, b2], [c1, c2], mu = 'QF-1 v QF-2') => [TEAM_HEADER,
  `1,${mu},,6:45 PM,Court 1,QF-1_1,a,b,${a1},QF-2_1,c,d,${a2}`,
  `2,${mu},,7:10 PM,Court 1,QF-1_2,e,f,${b1},QF-2_2,g,h,${b2}`,
  `3,${mu},,7:35 PM,Court 1,QF-1_TB,,,${c1},QF-2_TB,,,${c2}`].join('\n');
const DECIDER_CASES = {
  'nothing played': [qfCsv(['', ''], ['', ''], ['', '']), false],
  'one game played': [qfCsv([11, 5], ['', ''], ['', '']), false],
  '2-0, tiebreaker blank': [qfCsv([11, 5], [11, 9], ['', '']), true],
  '0-2, tiebreaker blank': [qfCsv([5, 11], [9, 11], ['', '']), true],
  '1-1, tiebreaker blank': [qfCsv([11, 5], [9, 11], ['', '']), false],
  '1-1, tiebreaker played': [qfCsv([11, 5], [9, 11], [7, 4]), true],
  '1-0 and a level game, tiebreaker blank': [qfCsv([11, 5], [9, 9], ['', '']), true],
  '2-0, no matchUp: the tiebreaker still counts': [qfCsv([11, 5], [11, 9], ['', ''], ''), false],
  '2-0, decimal scores': [qfCsv(['11.5', 5], [11, '9.0'], ['', '']), true],
  '2-0, with a spare row': [`${qfCsv([11, 5], [11, 9], ['', ''])}\n102,#N/A,,Not found,Not found,-,,#REF!,-,-,,#REF!,-`, true],
  '1-1, with a spare row': [`${qfCsv([11, 5], [9, 11], ['', ''])}\n102,#N/A,,Not found,Not found,-,,#REF!,-,-,,#REF!,-`, false],
};

test('a playoff tiebreaker: the card and completedAt agree on every case', options, () => {
  for (const [label, [csv, complete]] of Object.entries(DECIDER_CASES)) {
    assert.equal(siteSaysComplete(csv), complete, `site: ${label}`);
    assert.equal(server.facilityIsComplete(csv), complete, `server: ${label}`);
  }
});

test('the played and BYE rules: the card and completedAt agree on every case', options, () => {
  for (const [label, csv] of Object.entries(CASES)) {
    assert.equal(siteSaysComplete(csv), server.facilityIsComplete(csv), label);
  }
});

test('the played and BYE rules: they agree on every fixture facility in every state', options, () => {
  let n = 0;
  for (const event of Object.keys(SNAPSHOTS)) for (const state of STATES) {
    for (const f of deriveState(loadSnapshot(event), state).facilities) {
      assert.equal(siteSaysComplete(f.matchesCsv), server.facilityIsComplete(f.matchesCsv), `${event}/${state}/${f.name}`);
      n++;
    }
  }
  assert.ok(n >= 15);
});

test('the played and BYE rules: they agree when one score is blanked at a time, on every fixture facility', options, () => {
  // From a finished facility, blank each match's score in turn: complete flips to not-complete
  // exactly when a needed, real match loses a score, in both.
  for (const event of Object.keys(SNAPSHOTS)) {
    for (const f of loadSnapshot(event).facilities) {
      const rows = parseCSV(f.matchesCsv);
      const iS2 = rows[0].indexOf('team2Score');
      for (let r = 1; r < rows.length; r++) {
        const copy = rows.map(x => x.slice());
        copy[r][iS2] = '';
        const csv = copy.map(x => x.map(c => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
        assert.equal(siteSaysComplete(csv), server.facilityIsComplete(csv), `${event}/${f.name} row ${r}`);
      }
    }
  }
});

// Every outcome of a 2- and 3-game series: each game won by seat 1, seat 2, tied or unplayed.
function* scenarios(games) {
  const outcomes = [['11', '5'], ['5', '11'], ['9', '9'], ['', '']];
  for (let i = 0; i < outcomes.length ** games; i++) {
    yield Array.from({ length: games }, (_, g) => outcomes[Math.floor(i / outcomes.length ** g) % outcomes.length]);
  }
}

test('series finals: the games that are never played are the same, on every outcome', options, () => {
  assert.deepEqual(seriesGameOf('IXD_F_1_(2)'), server.seriesGameOf('IXD_F_1_(2)'));
  let n = 0;
  for (const games of [2, 3]) for (const outcome of scenarios(games)) {
    const siteGames = outcome.map(([s1, s2], g) => ({
      num: g + 1, t1: `IXD_F_1_(${g + 1})`, t2: `IXD_F_2_(${g + 1})`,
      t1Score: s1 === '' ? null : Number(s1), t2Score: s2 === '' ? null : Number(s2), played: s1 !== '' && s2 !== '',
    }));
    const serverGames = outcome.map(([s1, s2], g) => ({ key: g + 1, code1: `IXD_F_1_(${g + 1})`, score1: s1, code2: `IXD_F_2_(${g + 1})`, score2: s2 }));
    const site = [...unneededSeriesGames(siteGames)].map(m => m.num).sort();
    const theirs = [...server.unneededSeriesGames(serverGames)].sort();
    assert.deepEqual(site, theirs, JSON.stringify(outcome));
    n++;
  }
  assert.equal(n, 16 + 64);
});

test('series finals: a facility is complete or not on every outcome, in both', options, () => {
  for (const games of [2, 3]) for (const outcome of scenarios(games)) {
    const rows = outcome.map(([s1, s2], g) => row(g + 1, `IXD_F_1_(${g + 1})`, 'a', 'b', s1, `IXD_F_2_(${g + 1})`, 'c', 'd', s2));
    const csv = csvOf(row(100, 'IXD_1', 'a', 'b', 11, 'IXD_2', 'c', 'd', 5), ...rows);
    assert.equal(siteSaysComplete(csv), server.facilityIsComplete(csv), JSON.stringify(outcome));
  }
});

// A best-of-3 round-robin meeting (sage-docs/docs/specs/.../double-round-robin-and-finals-spec.md §5.2, §6.1): the
// rows flagged bestOf 3 with the same two codes, in match-number order, are games 1-3.
const BO3_HEADER = `${HEADER},bestOf`;
const bo3 = (...args) => `${row(...args)},3`;
const bo3Csv = (...rows) => [BO3_HEADER, ...rows].join('\n');
const A12 = (n, s1, s2, flag = 3) => `${row(n, 'A_1', 'a', 'b', s1, 'A_2', 'c', 'd', s2)},${flag}`;
const A34 = (n, s1, s2) => bo3(n, 'A_3', 'e', 'f', s1, 'A_4', 'g', 'h', s2);
const BO3_CASES = {
  'a meeting won 2-0': [bo3Csv(A12(1, 11, 5), A12(2, 11, 7), A12(3, '', '')), true],
  'a meeting at 1-1': [bo3Csv(A12(1, 11, 5), A12(2, 5, 11), A12(3, '', '')), false],
  'a meeting won 2-1': [bo3Csv(A12(1, 11, 5), A12(2, 5, 11), A12(3, 11, 9)), true],
  'rows out of order': [bo3Csv(A12(3, '', ''), A12(1, 11, 7), A12(2, 11, 5)), true],
  'no bestOf column': [csvOf(row(1, 'A_1', 'a', 'b', 11, 'A_2', 'c', 'd', 5), row(2, 'A_1', 'a', 'b', 11, 'A_2', 'c', 'd', 7), row(3, 'A_1', 'a', 'b', '', 'A_2', 'c', 'd', '')), false],
  'bestOf blank': [bo3Csv(A12(1, 11, 5, ''), A12(2, 11, 7, ''), A12(3, '', '', '')), false],
  'two meetings, one at 1-1': [bo3Csv(A12(1, 11, 5), A12(2, 11, 7), A12(3, '', ''), A34(4, 11, 5), A34(5, 5, 11), A34(6, '', '')), false],
  'two meetings, both decided': [bo3Csv(A12(1, 11, 5), A12(2, 11, 7), A12(3, '', ''), A34(4, 5, 11), A34(5, 7, 11), A34(6, '', '')), true],
  'a tied game 1': [bo3Csv(A12(1, 11, 11), A12(2, 11, 7), A12(3, '', '')), false],
  'a fourth row is an ordinary match': [bo3Csv(A12(1, 11, 5), A12(2, 5, 11), A12(3, 11, 9), A12(4, '', '')), false],
  'a playoff match with no flag': [bo3Csv(A12(1, 11, 5), A12(2, 11, 7), A12(3, '', ''), A12(4, '', '', '')), false],
};

test('best-of-3 meetings: the card and completedAt agree, and say what they should, on every case', options, () => {
  for (const [label, [csv, complete]] of Object.entries(BO3_CASES)) {
    assert.equal(siteSaysComplete(csv), complete, `site: ${label}`);
    assert.equal(server.facilityIsComplete(csv), complete, `server: ${label}`);
  }
});

test('best-of-3 meetings: the games never played are the same, on every outcome', options, () => {
  let n = 0;
  for (const outcome of scenarios(3)) {
    const siteGames = outcome.map(([s1, s2], g) => ({
      num: g + 1, bestOf: 3, t1: 'A_1', t2: 'A_2',
      t1Score: s1 === '' ? null : Number(s1), t2Score: s2 === '' ? null : Number(s2), played: s1 !== '' && s2 !== '',
    }));
    const serverGames = outcome.map(([s1, s2], g) => ({ key: g + 1, num: g + 1, bestOf: 3, code1: 'A_1', score1: s1, code2: 'A_2', score2: s2 }));
    const site = [...unneededMeetingGames(siteGames)].map(m => m.num).sort();
    const theirs = [...server.unneededMeetingGames(serverGames)].sort();
    assert.deepEqual(site, theirs, JSON.stringify(outcome));
    n++;
  }
  assert.equal(n, 64);
});
