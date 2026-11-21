// Who on a match or a facility's list is not checked in yet (lib/v1/domain/attendance-marks.js,
// sage-docs/docs/specs/.../mission-control-layout-spec.md §7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceKey, attendanceIndex, isNotIn, matchNotInCount, facilityNotInCount } from '../../../lib/v1/domain/attendance-marks.js';

const person = (name, extra = {}) => ({ key: attendanceKey(name), player: name, present: false, withdrawn: false, ...extra });

test('attendanceKey: accents, case and spacing do not matter', () => {
  assert.equal(attendanceKey('Ana Reyes'), 'ana reyes');
  assert.equal(attendanceKey('  Ana   Reyes '), 'ana reyes');
  assert.equal(attendanceKey('ANA reyes'), 'ana reyes');
  assert.equal(attendanceKey('José Niño'), 'jose nino');
  assert.equal(attendanceKey('Ñino'), 'nino');
  assert.equal(attendanceKey('Dan\tEmil\nDizon'), 'dan emil dizon');
  assert.equal(attendanceKey('Zoë Ångström'), 'zoe angstrom');
  assert.equal(attendanceKey("O'Brien"), "o'brien");
});

test('attendanceKey: nothing is an empty key', () => {
  assert.equal(attendanceKey(''), '');
  assert.equal(attendanceKey(null), '');
  assert.equal(attendanceKey(undefined), '');
  assert.equal(attendanceKey('   '), '');
});

test('attendanceIndex: present at any facility is present; withdrawn only if withdrawn everywhere', () => {
  const index = attendanceIndex([
    [person('Ana Reyes'), person('Ben Cruz', { withdrawn: true }), person('Cy Lim', { withdrawn: true })],
    [person('Ana Reyes', { present: true }), person('Ben Cruz'), person('Cy Lim', { withdrawn: true })],
  ]);
  assert.deepEqual(index.get('ana reyes'), { present: true, withdrawn: false });
  assert.deepEqual(index.get('ben cruz'), { present: false, withdrawn: false });
  assert.deepEqual(index.get('cy lim'), { present: false, withdrawn: true });
});

test('attendanceIndex: tolerates missing lists, missing people and people with no key', () => {
  assert.equal(attendanceIndex().size, 0);
  assert.equal(attendanceIndex([null, undefined, [null, { player: 'No Key' }, { key: '' }]]).size, 0);
});

test('isNotIn: on the roster, not withdrawn, not present', () => {
  const index = attendanceIndex([[person('Ana Reyes'), person('Ben Cruz', { present: true }), person('Cy Lim', { withdrawn: true })]]);
  assert.equal(isNotIn(index, 'Ana Reyes'), true);
  assert.equal(isNotIn(index, '  ANA  reyes '), true);
  assert.equal(isNotIn(index, 'Ben Cruz'), false);
  assert.equal(isNotIn(index, 'Cy Lim'), false);
});

test('isNotIn: a name not on the roster (TBD, BYE, a typo) is never marked, and no index marks nothing', () => {
  const index = attendanceIndex([[person('Ana Reyes')]]);
  for (const name of ['TBD', 'BYE', 'Ana Reyez', '', null, undefined]) assert.equal(isNotIn(index, name), false, String(name));
  assert.equal(isNotIn(null, 'Ana Reyes'), false);
  assert.equal(isNotIn(undefined, 'Ana Reyes'), false);
});

const match = (names, extra = {}) => ({ t1p1: names[0], t1p2: names[1], t2p1: names[2], t2p2: names[3], played: false, ...extra });

test('matchNotInCount: counts the different players not in', () => {
  const index = attendanceIndex([[person('Ana Reyes'), person('Ben Cruz', { present: true }), person('Cy Lim'), person('Di Ong', { withdrawn: true })]]);
  assert.equal(matchNotInCount(match(['Ana Reyes', 'Ben Cruz', 'Cy Lim', 'Di Ong']), index), 2);
  assert.equal(matchNotInCount(match(['Ben Cruz', 'Di Ong', 'TBD', 'TBD']), index), 0);
});

test('matchNotInCount: a played match counts 0', () => {
  const index = attendanceIndex([[person('Ana Reyes')]]);
  assert.equal(matchNotInCount(match(['Ana Reyes', 'x', 'y', 'z'], { played: true }), index), 0);
  assert.equal(matchNotInCount(match(['Ana Reyes', 'x', 'y', 'z']), index), 1);
});

test('matchNotInCount: one person on both sides counts once, and no index or match counts 0', () => {
  const index = attendanceIndex([[person('Ana Reyes')]]);
  assert.equal(matchNotInCount(match(['Ana Reyes', 'x', 'ANA  reyes', 'y']), index), 1);
  assert.equal(matchNotInCount(match(['Ana Reyes', 'x', 'y', 'z']), null), 0);
  assert.equal(matchNotInCount(null, index), 0);
});

test('facilityNotInCount: different, non-withdrawn people not present', () => {
  const people = [person('Ana Reyes'), person('Ben Cruz', { present: true }), person('Cy Lim', { withdrawn: true }), person('Di Ong'), person('Di Ong')];
  assert.equal(facilityNotInCount(people), 2);
  assert.equal(facilityNotInCount([]), 0);
  assert.equal(facilityNotInCount(null), 0);
  assert.equal(facilityNotInCount([null, { player: 'No Key' }]), 0);
});
