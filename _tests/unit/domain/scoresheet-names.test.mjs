// domain/scoresheet-names.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV } from '../../../lib/v1/domain/csv.js';
import { withTeamNames } from '../../../lib/v1/domain/scoresheet-names.js';
import { loadSnapshot } from '../../helpers/fixtures.mjs';

const MATCHES = 'matchNumber,teamCode1,team1Player1,team1Score,teamCode2,team2Player1,team2Score\r\n';
const STANDINGS = 'teamCode,teamName,totalPoints,totalOpponentPoints,quotient,bracket\r\n'
  + 'A,Spice Girls,0,0,-,1\r\nB,Wok Stars,0,0,-,1\r\nC,"Dink, ""Inc""",0,0,-,1\r\n'
  + 'QF-1,,0,0,-,\r\nSF-A,,0,0,-,\r\nFi-Green,Green Team,0,0,-,\r\n';
const names = csv => {
  const [header, ...rows] = parseCSV(csv);
  const i1 = header.indexOf('teamName1'), i2 = header.indexOf('teamName2');
  return rows.map(r => [r[i1], r[i2]]);
};

test('a group side gets its name from its team, and the other cells are kept', () => {
  const csv = withTeamNames(`${MATCHES}1,A_1,"Cruz, Ann",11,B_1,Bob,9\r\n`, STANDINGS);
  const rows = parseCSV(csv);
  assert.deepEqual(rows[0].slice(-2), ['teamName1', 'teamName2']);
  assert.deepEqual(rows[1], ['1', 'A_1', 'Cruz, Ann', '11', 'B_1', 'Bob', '9', 'Spice Girls', 'Wok Stars']);
});

test('a seated playoff side gets the name on its own row', () => {
  assert.deepEqual(names(withTeamNames(`${MATCHES}1,Fi-Green_3,x,,QF-1_1,y,\r\n`, STANDINGS))[0], ['Green Team', '']);
});

test('a lettered playoff slot falls back to that team, and an unseated side is empty', () => {
  assert.deepEqual(names(withTeamNames(`${MATCHES}1,SF-A_1,x,,QF-1_1,y,\r\n`, STANDINGS))[0], ['Spice Girls', '']);
});

test('a comma and a quote in a name survive being written and read back', () => {
  assert.deepEqual(names(withTeamNames(`${MATCHES}1,C_1,x,,A_1,y,\r\n`, STANDINGS))[0], ['Dink, "Inc"', 'Spice Girls']);
});

test('the input comes back unchanged with no code columns or no names', () => {
  const noCodes = 'matchNumber,court\r\n1,2\r\n';
  assert.equal(withTeamNames(noCodes, STANDINGS), noCodes);
  const plain = `${MATCHES}1,A_1,x,,B_1,y,\r\n`;
  assert.equal(withTeamNames(plain, 'teamCode,player1,player2,wins,loss,quotient,bracket\r\nA_1,x,y,0,0,0,1\r\n'), plain);
  assert.equal(withTeamNames(plain, ''), plain);
  assert.equal(withTeamNames('', STANDINGS), '');
});

test('every match of a real team snapshot keeps its row and gains names', () => {
  const { matchesCsv, standingsCsv } = loadSnapshot('pickledrive-anniversary-2026').facilities[0];
  const before = parseCSV(matchesCsv), after = parseCSV(withTeamNames(matchesCsv, standingsCsv));
  assert.equal(after.length, before.length);
  after.slice(1).forEach((row, i) => {
    assert.deepEqual(row.slice(0, before[0].length), before[i + 1]);
    assert.ok(row.at(-2) && row.at(-1), `match ${row[0]} has both names`);
  });
});
