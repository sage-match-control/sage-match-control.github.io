// An event's scoring rule (lib/v1/domain/scoring.js): events.json's `scoring`, which rule a match plays to, and the
// warnings a score gets under it. UPAP's rules are the worked example: to 11, win by 1 in the eliminations, win by 2
// with no cap in the podium matches (the final and the bronze match).
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { scoringFrom, isPodiumMatch, scoringRuleFor, scoreRuleWarnings } from '../../../lib/v1/domain/scoring.js';

const UPAP = { to: 11, winBy: 1, podiumWinBy: 2 };

test('scoringFrom: no setting is no rule', () => {
  assert.equal(scoringFrom(undefined, 'e'), null);
  assert.equal(scoringFrom(null, 'e'), null);
});

test('scoringFrom: reads to, winBy and podiumWinBy; to defaults to 11, podiumWinBy to winBy', () => {
  assert.deepEqual(scoringFrom({ to: 11, winBy: 1, podiumWinBy: 2 }, 'e'), UPAP);
  assert.deepEqual(scoringFrom({ winBy: 2 }, 'e'), { to: 11, winBy: 2, podiumWinBy: 2 });
  assert.deepEqual(scoringFrom({ to: 15, winBy: 1 }, 'e'), { to: 15, winBy: 1, podiumWinBy: 1 });
});

test('scoringFrom: a malformed setting warns and is ignored', t => {
  const warn = mock.method(console, 'warn', () => {});
  t.after(() => warn.mock.restore());
  const bad = [
    ['nope', 'must be an object'],
    [[1], 'must be an object'],
    [{}, '"winBy" must be 1 or 2'],
    [{ winBy: 3 }, '"winBy" must be 1 or 2'],
    [{ winBy: 1, to: 0 }, '"to" must be a whole number from 1 to 99'],
    [{ winBy: 1, to: 10.5 }, '"to" must be a whole number from 1 to 99'],
    [{ winBy: 1, podiumWinBy: '2' }, '"podiumWinBy" must be 1 or 2'],
  ];
  bad.forEach(([raw]) => assert.equal(scoringFrom(raw, 'e'), null));
  assert.deepEqual(warn.mock.calls.map(c => c.arguments[0]), bad.map(([, why]) => `events.json: scoring for e ${why}; ignoring it`));
});

test('isPodiumMatch: a final or a bronze match, read from the code after its category', () => {
  assert.equal(isPodiumMatch({ t1: 'B45LXD_F_1', t2: 'B45LXD_F_2' }, 'standard'), true);
  assert.equal(isPodiumMatch({ t1: 'B45HMD_B_1', t2: 'B45HMD_B_2' }, 'standard'), true);
  assert.equal(isPodiumMatch({ t1: 'OWD_F_1_(2)', t2: 'OWD_F_2_(2)' }, 'standard'), true);
  assert.equal(isPodiumMatch({ t1: 'PNF_LIWD_F_1', t2: 'BUP_LIWD_F_1' }, 'dual-meet'), true);
});

test('isPodiumMatch: a round-robin, quarterfinal or semifinal match is not, whatever its category starts with', () => {
  assert.equal(isPodiumMatch({ t1: 'B45HMD_1', t2: 'B45HMD_2' }, 'standard'), false);
  assert.equal(isPodiumMatch({ t1: 'B45LXD_SF_1', t2: 'B45LXD_SF_2' }, 'standard'), false);
  assert.equal(isPodiumMatch({ t1: 'FWD_QF_1', t2: 'FWD_QF_2' }, 'standard'), false);
  assert.equal(isPodiumMatch({ t1: 'B45HMD_3', t2: 'B45HMD_1' }, undefined), false);
});

test('scoringRuleFor: no setting, no rule; otherwise the podium rule on a final or bronze match', () => {
  const rr = { t1: 'B45HMD_1', t2: 'B45HMD_2' };
  const final = { t1: 'B45HMD_F_1', t2: 'B45HMD_F_2' };
  assert.equal(scoringRuleFor(rr, null, 'standard'), null);
  assert.deepEqual(scoringRuleFor(rr, UPAP, 'standard'), { to: 11, winBy: 1 });
  assert.deepEqual(scoringRuleFor(final, UPAP, 'standard'), { to: 11, winBy: 2 });
});

test('win by 1: the winner has exactly the target', () => {
  const rule = { to: 11, winBy: 1 };
  assert.deepEqual(scoreRuleWarnings(11, 10, rule), []);
  assert.deepEqual(scoreRuleWarnings(3, 11, rule), []);
  assert.deepEqual(scoreRuleWarnings(9, 7, rule), ['Neither side reached 11.']);
  assert.deepEqual(scoreRuleWarnings(8, 8, rule), ['Tied: neither side wins this match.']);
  assert.deepEqual(scoreRuleWarnings(12, 10, rule), ['Past 11: this game ends as soon as a side reaches 11.']);
});

test('win by 2, no cap: 11 to 9 or less, or a 2-point lead past 11', () => {
  const rule = { to: 11, winBy: 2 };
  assert.deepEqual(scoreRuleWarnings(11, 9, rule), []);
  assert.deepEqual(scoreRuleWarnings(0, 11, rule), []);
  assert.deepEqual(scoreRuleWarnings(12, 10, rule), []);
  assert.deepEqual(scoreRuleWarnings(13, 15, rule), []);
  assert.deepEqual(scoreRuleWarnings(11, 10, rule), ['Won by 1 point: this game is win by 2.']);
  assert.deepEqual(scoreRuleWarnings(13, 12, rule), ['Won by 1 point: this game is win by 2.']);
  assert.deepEqual(scoreRuleWarnings(15, 9, rule), ['Past 11 a win-by-2 game ends at a 2-point lead, so 15–9 can’t happen.']);
  assert.deepEqual(scoreRuleWarnings(10, 8, rule), ['Neither side reached 11.']);
  assert.deepEqual(scoreRuleWarnings(10, 10, rule), ['Tied: neither side wins this match.']);
});
