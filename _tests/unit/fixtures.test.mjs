// The states every case runs in (site-engine-spec §6.2) are derived, so the
// derivation is tested: a harness that blanked the wrong cells would still
// pass, and prove nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SNAPSHOTS, STATES, loadSnapshot, deriveState, parseCsv, toCsv } from '../helpers/fixtures.mjs';

const columns = csv => {
  const rows = parseCsv(csv).filter(r => r.length > 1);
  const header = rows[0];
  const at = n => header.indexOf(n);
  // A match is a row with a match number.
  return rows.slice(1).filter(r => parseInt(r[at('matchNumber')], 10)).map(r => ({
    num: parseInt(r[at('matchNumber')], 10), s1: r[at('team1Score')], s2: r[at('team2Score')], court: r[at('court')], assigned: r[at('CourtAssignment')],
  }));
};

test('parseCsv and toCsv round-trip quoted fields', () => {
  const rows = [['a', 'b,c', 'd"e', 'f\ng'], ['', '1', '2', '3']];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

for (const event of Object.keys(SNAPSHOTS)) {
  test(`${event}: final is the published snapshot`, () => {
    assert.deepEqual(deriveState(loadSnapshot(event), 'final'), loadSnapshot(event));
  });

  test(`${event}: pre blanks every score and live court and drops completedAt`, () => {
    const snap = deriveState(loadSnapshot(event), 'pre');
    for (const f of snap.facilities) {
      assert.equal(f.completedAt, undefined);
      const rows = columns(f.matchesCsv);
      assert.ok(rows.length > 10);
      assert.ok(rows.every(r => r.s1 === '' && r.s2 === '' && r.court === ''));
    }
  });

  test(`${event}: mid keeps the lower-numbered half's scores and puts two unplayed matches on court`, () => {
    const published = loadSnapshot(event);
    const snap = deriveState(published, 'mid');
    snap.facilities.forEach((f, i) => {
      assert.equal(f.completedAt, undefined);
      const rows = columns(f.matchesCsv).sort((a, b) => a.num - b.num);
      const original = new Map(columns(published.facilities[i].matchesCsv).map(r => [r.num, r]));
      const half = Math.ceil(rows.length / 2);
      rows.slice(0, half).forEach(r => { assert.equal(r.s1, original.get(r.num).s1); assert.equal(r.s2, original.get(r.num).s2); });
      rows.slice(half).forEach(r => { assert.equal(r.s1, ''); assert.equal(r.s2, ''); });
      const live = rows.filter(r => r.court !== '');
      assert.equal(live.length, 2);
      assert.deepEqual(live.map(r => r.num), rows.slice(half, half + 2).map(r => r.num));
    });
  });

  test(`${event}: standingsCsv is left as published in every state`, () => {
    for (const state of STATES) {
      const snap = deriveState(loadSnapshot(event), state);
      snap.facilities.forEach((f, i) => assert.equal(f.standingsCsv, loadSnapshot(event).facilities[i].standingsCsv));
    }
  });
}
