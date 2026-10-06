// domain/matches.js, domain/standings.js, domain/codes.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV } from '../../../lib/v1/domain/csv.js';
import { rowsToMatches, buildMatchByCodeIndex, isUnnamedScheduledPair, pairKey, matchInstanceOf } from '../../../lib/v1/domain/matches.js';
import { rowsToStandings, rankStandings, headToHeadWins, isEmptyStanding, fmtQ } from '../../../lib/v1/domain/standings.js';
import {
  parseCode, splitCategory, categoryLabel, clubLabel, divisionLabel, divisionEventLabel,
  roundKeyword, roundLabel, standingsStageKey, buildCategoryOrderIndex, categorySortKey,
  STAGE_META, STAGE_ORDER, CROSS_CLUB_STAGE_KEYS, BADGE_CLASSES, ROUND_KEYWORD_LABELS,
} from '../../../lib/v1/domain/codes.js';
import { loadSnapshot, eventConfig } from '../../helpers/fixtures.mjs';

const HEADER = 'matchNumber,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const csv = (...rows) => parseCSV([HEADER, ...rows].join('\n'));

// ---- rowsToMatches ----------------------------------------------------------------

test('a match is played only when both scores are present', () => {
  const [a, b, c, d] = rowsToMatches(csv(
    '1,,9:00 AM,Court 1,X_1,A,B,11,X_2,C,D,5',
    '2,,9:00 AM,Court 2,X_3,A,B,11,X_4,C,D,',
    '3,,9:25 AM,Court 1,X_5,A,B,,X_6,C,D,7',
    '4,,9:25 AM,Court 2,X_7,A,B,,X_8,C,D,',
  ));
  assert.deepEqual([a.played, b.played, c.played, d.played], [true, false, false, false]);
  assert.deepEqual([a.t1Score, a.t2Score, b.t2Score, c.t1Score], [11, 5, null, null]);
});

test('a score of 0 is a score; text that is not a number is not', () => {
  const [a, b] = rowsToMatches(csv('1,,9:00 AM,Court 1,X_1,A,B,0,X_2,C,D,11', '2,,9:00 AM,Court 2,X_3,A,B,x,X_4,C,D,11'));
  assert.equal(a.played, true);
  assert.equal(a.t1Score, 0);
  assert.equal(b.played, false);
});

test('rows without a match number are skipped and the rest sort by number', () => {
  const ms = rowsToMatches(csv('3,,9:00 AM,Court 1,X_1,A,B,,X_2,C,D,', ',,,,,,,,,,,', '1,,9:00 AM,Court 2,X_3,A,B,,X_4,C,D,'));
  assert.deepEqual(ms.map(m => m.num), [1, 3]);
});

test('a slot whose names repeat its code, or are blank, reads TBD', () => {
  const [m] = rowsToMatches(csv('1,,9:00 AM,Court 1,ND_SF_1,ND_SF_1,ND_SF_1,,ND_SF_2,,,'));
  assert.deepEqual([m.t1p1, m.t1p2, m.t2p1, m.t2p2], ['TBD', 'TBD', 'TBD', 'TBD']);
});

test('the live court is separate from the scheduled one, and matchUp is team-only', () => {
  const [m] = rowsToMatches(csv('1,2,9:00 AM,Court 1,X_1,A,B,,X_2,C,D,'));
  assert.equal(m.court, 'Court 1');
  assert.equal(m.liveCourt, '2');
  assert.equal(m.matchUp, '');
  const team = rowsToMatches(parseCSV('matchNumber,matchUp,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score\n1,A v B,,2:00 PM,Court 1,A_1,x,y,2,B_1,z,w,11'));
  assert.equal(team[0].matchUp, 'A v B');
});

test('a header-only or empty matches tab has no matches', () => {
  assert.deepEqual(rowsToMatches(csv()), []);
  assert.deepEqual(rowsToMatches([]), []);
});

test('buildMatchByCodeIndex maps both sides of every match', () => {
  const ms = rowsToMatches(csv('1,,9:00 AM,Court 1,X_1,A,B,,X_2,C,D,', '2,,9:25 AM,Court 1,X_1,A,B,,X_3,E,F,'));
  const idx = buildMatchByCodeIndex(ms);
  assert.equal(idx.get('X_2').num, 1);
  assert.equal(idx.get('X_1').num, 2, 'the last match listing a code wins');
  assert.equal(idx.size, 3);
});

test('matchInstanceOf reads a trailing (n)', () => {
  assert.equal(matchInstanceOf('IXD_F_1_(2)'), 2);
  assert.equal(matchInstanceOf('F_1_(1) '), 1);
  assert.equal(matchInstanceOf('IXD_F_1'), null);
});

test('pairKey ignores name order and case, but not club or category', () => {
  assert.equal(pairKey('ND_1', 'Ann ', 'bob', 'standard'), pairKey('ND_9', 'BOB', 'ann', 'standard'));
  assert.notEqual(pairKey('ND_1', 'ann', 'bob', 'standard'), pairKey('NM_1', 'ann', 'bob', 'standard'));
  assert.notEqual(pairKey('PNF_LIWD_1', 'ann', 'bob', 'dual-meet'), pairKey('BUP_LIWD_1', 'ann', 'bob', 'dual-meet'));
});

test('an unnamed pair counts only for a Round Robin code that is on the schedule', () => {
  const ms = rowsToMatches(csv('1,,9:00 AM,Court 1,X_1,X_1,X_1,,X_2,C,D,'));
  const byCode = buildMatchByCodeIndex(ms);
  assert.ok(isUnnamedScheduledPair({ teamCode: 'X_1', player1: 'X_1' }, byCode, 'standard'));
  assert.ok(!isUnnamedScheduledPair({ teamCode: 'X_9', player1: 'X_9' }, byCode, 'standard'), 'not on the schedule');
  assert.ok(!isUnnamedScheduledPair({ teamCode: 'X_SF_1', player1: '' }, buildMatchByCodeIndex(rowsToMatches(csv('1,,9:00 AM,Court 1,X_SF_1,,,,X_SF_2,,,'))), 'standard'), 'a playoff slot');
  assert.ok(!isUnnamedScheduledPair({ teamCode: 'X_2', player1: 'Ana' }, byCode, 'standard'), 'named');
});

// ---- standings --------------------------------------------------------------------------

test('rowsToStandings reads wins, loss, quotient and bracket; quotient is null when absent', () => {
  const rows = rowsToStandings(parseCSV('teamCode,player1,player2,wins,loss,quotient,bracket\nND_1,Ann,Bo,2,1,1.5,1\nND_2,Cy,Di,,,,\n,x,y,1,1,1,1'));
  assert.equal(rows.length, 2, 'a row with no team code is dropped');
  assert.deepEqual([rows[0].wins, rows[0].loss, rows[0].quotient, rows[0].bracket], [2, 1, 1.5, '1']);
  assert.deepEqual([rows[1].wins, rows[1].loss, rows[1].quotient], [0, 0, null]);
  assert.deepEqual([rows[0].teamName, rows[0].pf, rows[0].pa], ['', 0, 0]);
});

test('rowsToStandings reads the team columns when they exist', () => {
  const [r] = rowsToStandings(parseCSV('teamCode,teamName,wins,loss,quotient,bracket,totalPoints,totalOpponentPoints\nA,Aces,1,0,1.2,1,30,25'));
  assert.deepEqual([r.teamName, r.pf, r.pa], ['Aces', 30, 25]);
});

const S = (teamCode, wins, quotient) => ({ teamCode, player1: teamCode, player2: '', wins, loss: 0, quotient, bracket: '1' });
const M = (t1, s1, t2, s2) => ({ t1, t2, t1Score: s1, t2Score: s2, played: s1 !== null && s2 !== null });

test('rankStandings: wins first, then head-to-head among the tied, then quotient', () => {
  const rows = [S('A', 2, 1.0), S('B', 2, 2.0), S('C', 3, 0.5)];
  // A beat B head-to-head, though B's quotient is higher.
  assert.deepEqual(rankStandings(rows, [M('A', 11, 'B', 5)]).map(s => s.teamCode), ['C', 'A', 'B']);
  // No match between them: quotient decides.
  assert.deepEqual(rankStandings(rows, []).map(s => s.teamCode), ['C', 'B', 'A']);
});

test('rankStandings: a three-way cycle falls through to quotient; level rows keep their order', () => {
  const rows = [S('A', 1, 1.0), S('B', 1, 3.0), S('C', 1, 2.0)];
  const cycle = [M('A', 11, 'B', 1), M('B', 11, 'C', 1), M('C', 11, 'A', 1)];
  assert.deepEqual(rankStandings(rows, cycle).map(s => s.teamCode), ['B', 'C', 'A']);
  assert.deepEqual(rankStandings([S('X', 1, 1), S('Y', 1, 1)], []).map(s => s.teamCode), ['X', 'Y']);
});

test('headToHeadWins counts only played, decided matches between the given rows', () => {
  const wins = headToHeadWins([S('A', 1, 1), S('B', 1, 1)], [M('A', 11, 'B', 5), M('A', 11, 'C', 5), M('A', 5, 'B', 5), M('B', null, 'A', null)]);
  assert.deepEqual([...wins], [['A', 1], ['B', 0]]);
  assert.deepEqual([...headToHeadWins([S('A', 1, 1)], [M('A', 11, 'B', 5)])], [['A', 0]]);
});

test('isEmptyStanding: no name, or the slot’s own code, with or without a game suffix', () => {
  assert.ok(isEmptyStanding({ teamCode: 'IXD_F_1_(2)', player1: '' }));
  assert.ok(isEmptyStanding({ teamCode: 'IXD_F_1_(2)', player1: 'IXD_F_1' }));
  assert.ok(isEmptyStanding({ teamCode: 'ND_1', player1: 'ND_1' }));
  assert.ok(!isEmptyStanding({ teamCode: 'ND_1', player1: 'Ann' }));
});

test('fmtQ shows four decimals, and 0.0000 for no quotient', () => {
  assert.equal(fmtQ(null), '0.0000');
  assert.equal(fmtQ(1.069), '1.0690');
});

// ---- codes -------------------------------------------------------------------------------------

test('parseCode is positional and depends on the event type', () => {
  assert.deepEqual(parseCode('ND_SF_1', 'standard'), { club: null, category: 'ND', rest: 'SF_1' });
  assert.deepEqual(parseCode('PNF_LIWD_F_1_(2)', 'dual-meet'), { club: 'PNF', category: 'LIWD', rest: 'F_1_(2)' });
  assert.deepEqual(parseCode('A_3', 'team'), { club: null, category: null, rest: '3' });
  assert.deepEqual(parseCode('BYE', 'standard'), { club: null, category: 'BYE', rest: '' });
  assert.deepEqual(parseCode('', 'standard'), { club: null, category: null, rest: '' });
});

const DISPLAY = { divisions: { N: 'Novice', NW: 'Novice Women', LI: 'Low Intermediate' }, events: { MD: "Men's Doubles", WD: "Women's Doubles", D: 'Open Doubles' }, clubs: { PNF: 'Pickle & Friends' } };

test('splitCategory takes the longest division prefix that has a known event', () => {
  assert.deepEqual(splitCategory('LIMD', DISPLAY), { divCode: 'LI', evCode: 'MD' });
  assert.deepEqual(splitCategory('NWD', DISPLAY), { divCode: 'NW', evCode: 'D' }, 'NW beats N');
  assert.deepEqual(splitCategory('ND', DISPLAY), { divCode: 'N', evCode: 'D' });
  assert.equal(splitCategory('XXMD', DISPLAY), null);
  assert.equal(splitCategory('LIZZ', DISPLAY), null);
  assert.equal(splitCategory('LIMD', {}), null);
  assert.equal(splitCategory(null, DISPLAY), null);
});

test('labels fall back to the raw code, and unresolved categories are collected', () => {
  const unresolved = new Set();
  assert.equal(categoryLabel('LIMD', DISPLAY, unresolved), "Low Intermediate Men's Doubles");
  assert.equal(categoryLabel('ZZ', DISPLAY, unresolved), 'ZZ');
  assert.deepEqual([...unresolved], ['ZZ']);
  assert.equal(categoryLabel('ZZ', {}, unresolved), 'ZZ');
  assert.equal(unresolved.size, 1, 'no display config: nothing to flag');
  assert.equal(categoryLabel(null, DISPLAY), 'Other');
  assert.equal(categoryLabel('__team__', DISPLAY), 'Team Championship');
  assert.equal(clubLabel('PNF', DISPLAY), 'Pickle & Friends');
  assert.equal(clubLabel('BUP', DISPLAY), 'BUP');
  assert.equal(clubLabel('', DISPLAY), '');
});

test('divisionLabel and divisionEventLabel read a whole team code', () => {
  assert.equal(divisionLabel('PNF_LIMD_1', 'dual-meet', DISPLAY), "Pickle & Friends · Low Intermediate Men's Doubles");
  assert.equal(divisionLabel('LIMD_1', 'standard', DISPLAY), "Low Intermediate Men's Doubles");
  assert.equal(divisionLabel('', 'standard', DISPLAY), null);
  assert.equal(divisionEventLabel('PNF_LIMD_1', 'dual-meet', DISPLAY), "Low Intermediate Men's Doubles");
});

test('roundKeyword reads the stage off the rest of a code', () => {
  const table = { '1': null, '12': null, SF_1: 'SF', QF_2: 'QF', R16_3: 'R16', F_1: 'F', 'F_1_(2)': 'F', B_1: 'B', B: 'B', X: null, '': null, SF: 'SF', F1: 'F' };
  for (const [rest, want] of Object.entries(table)) assert.equal(roundKeyword(rest), want, JSON.stringify(rest));
});

test('roundLabel adds the meeting number of a twice-to-beat game', () => {
  assert.equal(roundLabel('SF_1'), 'Semifinal');
  assert.equal(roundLabel('F_1_(2)'), 'Final · Match 2');
  assert.equal(roundLabel('3'), null);
  assert.equal(ROUND_KEYWORD_LABELS.B, 'Bronze Match');
});

test('standingsStageKey buckets a row by stage, Round Robin by default', () => {
  assert.equal(standingsStageKey('ND_3', 'standard'), 'RR');
  assert.equal(standingsStageKey('ND', 'standard'), 'RR');
  assert.equal(standingsStageKey('ND_SF_1', 'standard'), 'SF');
  assert.equal(standingsStageKey('ND_B_1', 'standard'), 'BRONZE');
  assert.equal(standingsStageKey('PNF_ND_F_1_(2)', 'dual-meet'), 'FINAL');
  assert.deepEqual(STAGE_ORDER, ['R16', 'QF', 'SF', 'BRONZE', 'FINAL']);
  assert.deepEqual(CROSS_CLUB_STAGE_KEYS, ['BRONZE', 'FINAL']);
  assert.equal(STAGE_META.FINAL.banner, true);
  assert.equal(BADGE_CLASSES.length, 4);
});

test('category order follows display key order, then first appearance', () => {
  const idx = buildCategoryOrderIndex(['LIWD', 'NMD', 'ZZ', 'NWD'], { divisions: { N: 'n', NW: 'nw', LI: 'li' }, events: { MD: 'md', WD: 'wd', D: 'd' } });
  // N x (MD WD D) -> NMD; NW x -> NWD; LI x -> LIWD; ZZ unresolved, appended
  assert.deepEqual([...idx.keys()], ['NMD', 'NWD', 'LIWD', 'ZZ']);
  assert.deepEqual([...buildCategoryOrderIndex(['B', 'A', 'B'], {}).keys()], ['B', 'A']);
  assert.equal(categorySortKey({ teamCode: 'NMD_1' }, idx, 'standard'), 0);
  assert.equal(categorySortKey({ teamCode: 'QQ_1' }, idx, 'standard'), 999);
});

// ---- on the real fixtures --------------------------------------------------------------------

for (const event of ['piggleball-2026', 'pickle-for-sight-2026', 'pnf-x-bup-dual-meet', 'pickledrive-anniversary-2026']) {
  test(`${event}: every facility parses to matches and standings`, () => {
    const snap = loadSnapshot(event);
    for (const f of snap.facilities) {
      const matches = rowsToMatches(parseCSV(f.matchesCsv));
      const standings = rowsToStandings(parseCSV(f.standingsCsv));
      assert.ok(matches.length > 20, 'matches');
      assert.ok(standings.length > 5, 'standings');
      assert.deepEqual(matches.map(m => m.num), matches.map(m => m.num).slice().sort((a, b) => a - b), 'sorted');
      for (const m of matches) {
        assert.equal(m.played, m.t1Score !== null && m.t2Score !== null);
        const p = parseCode(m.t1, eventConfig(event).type === 'dual-meet' ? 'dual-meet' : 'standard');
        assert.ok(p.category !== undefined);
      }
    }
  });
}
