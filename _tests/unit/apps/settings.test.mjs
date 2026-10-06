// apps/*.js: each mount function rejects an unknown or missing setting with a console error that names it
// (site-engine-spec §4.5), before it touches the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountHub } from '../../../lib/v1/apps/hub.js';
import { mountScheduleBoard } from '../../../lib/v1/apps/schedule-board.js';
import { mountScorer } from '../../../lib/v1/apps/scorer.js';
import { mountAttendanceDesk } from '../../../lib/v1/apps/attendance-desk.js';

async function errorsFrom(fn){
  const seen = [];
  const original = console.error;
  console.error = (...args) => seen.push(args.join(' '));
  try { await fn(); } finally { console.error = original; }
  return seen;
}

const MOUNTS = [
  ['mountHub', mountHub, { eventKey: 'e' }, 'eventKey'],
  ['mountScheduleBoard', mountScheduleBoard, { eventKey: 'e', dayKey: 'd' }, 'dayKey'],
  ['mountScorer', mountScorer, { eventKey: 'e' }, 'eventKey'],
  ['mountAttendanceDesk', mountAttendanceDesk, { eventKey: 'e' }, 'eventKey'],
];

for (const [name, mount, valid, required] of MOUNTS) {
  test(`${name} names an unknown setting`, async () => {
    const errors = await errorsFrom(() => mount({ ...valid, colour: 'red' }));
    assert.equal(errors.length, 1);
    assert.match(errors[0], new RegExp(`${name}: unknown setting "colour"`));
  });

  test(`${name} names a missing required setting`, async () => {
    const { [required]: _gone, ...without } = valid;
    const errors = await errorsFrom(() => mount(without));
    assert.equal(errors.length, 1);
    assert.match(errors[0], new RegExp(`${name}: .*"${required}"`));
  });
}

test('mountScheduleBoard knows "type", and names a type it does not know', async () => {
  const errors = await errorsFrom(() => mountScheduleBoard({ eventKey: 'e', dayKey: 'd', type: 'nope' }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /mountScheduleBoard: unknown type "nope" \(known: standard, dual-meet, team\)/);
  assert.doesNotMatch(errors[0], /unknown setting/, '"type" is a known setting');
});
