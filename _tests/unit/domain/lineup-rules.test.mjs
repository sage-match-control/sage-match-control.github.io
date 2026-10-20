// domain/lineup-rules.js: the Millennium Invitational's lineup rules, on a small made-up round.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LINEUP_RULE_KINDS, lineupRulesFrom, lineupIssues } from '../../../lib/v1/domain/lineup-rules.js';

const RULES = lineupRulesFrom({
  pairs: { 1: 'mens-high', 2: 'mixed', 3: 'womens', 4: 'open' },
  advancedLevels: ['HA', 'HI'],
  captainNotMixed: true,
});

// Red's roster: its captain first, then seven more. Orange has no roster published.
const p = (player, gender, level) => ({ teamCode: 'Red', player, gender, level });
const RED = [p('Cap Tan', 'M', 'HA'), p('Ben Uy', 'M', 'LI'), p('Carl Go', 'M', 'HI'), p('Dan Ko', 'M', 'LI'),
  p('Ana Cruz', 'F', 'LI'), p('Bea Ong', 'F', 'HI'), p('Cora Ang', 'F', 'LI'), p('Dina Lao', 'F', 'LI')];
const ROSTER = new Map([['Red', RED]]);
const ROWS = new Map([['Red', { teamCode: 'Red', teamName: '' }], ['Orange', { teamCode: 'Orange' }]]);

const match = (num, pair, a, b) => ({ num, matchUp: 'Red v Orange', t1: `Red_${pair}`, t1p1: a, t1p2: b, t2: `Orange_${pair}`, t2p1: 'TBD', t2p2: 'TBD' });
// A round that follows every rule.
const GOOD = [
  match(1, 1, 'Cap Tan', 'Ben Uy'),     // Men's High: two men, Cap is advanced
  match(2, 2, 'Dan Ko', 'Ana Cruz'),    // Mixed: a man and a woman, not the captain
  match(9, 3, 'Bea Ong', 'Cora Ang'),   // Women's
  match(10, 4, 'Carl Go', 'Dina Lao'),  // Genderless
];
const texts = (issues, num) => (issues.get(num) || []).map(i => i.text);

test('the rule kinds, and lineupRulesFrom keeps only what it understands', () => {
  assert.deepEqual(LINEUP_RULE_KINDS, ['mens-high', 'mixed', 'womens', 'open']);
  assert.equal(lineupRulesFrom(undefined), null);
  assert.equal(lineupRulesFrom([]), null);
  assert.deepEqual(lineupRulesFrom({ pairs: { 1: 'mixed', 2: 'doubles', x: 'open' }, advancedLevels: [' HA ', 3, ''], captainNotMixed: 'yes',
    allowed: { ' GIAN ': ['womens', 'doubles'], Nobody: [], Odd: 'womens' } }),
    { pairs: { 1: 'mixed' }, advancedLevels: ['ha'], captainNotMixed: false, allowed: { gian: ['womens'] } });
  assert.deepEqual(lineupRulesFrom({}).allowed, {});
});

test('a round that follows the rules has no issues; no rules, no checks', () => {
  assert.equal(lineupIssues(GOOD, ROSTER, ROWS, RULES).size, 0);
  const bad = [match(1, 3, 'Cap Tan', 'Ben Uy')];
  assert.equal(lineupIssues(bad, ROSTER, ROWS, null).size, 0);
});

test('each pair kind’s gender rule, by the roster’s gender', () => {
  const issues = lineupIssues([
    match(1, 1, 'Cap Tan', 'Ana Cruz'),
    match(2, 2, 'Ben Uy', 'Dan Ko'),
    match(9, 3, 'Bea Ong', 'Carl Go'),
    match(10, 4, 'Cora Ang', 'Dina Lao'),
  ], ROSTER, ROWS, RULES);
  assert.deepEqual(texts(issues, 1), ["Men's High is two men: Ana Cruz isn't a man"]);
  assert.deepEqual(texts(issues, 2), ['Mixed is one man and one woman: Ben Uy and Dan Ko are both men']);
  assert.deepEqual(texts(issues, 9), ["Women's is two women: Carl Go isn't a woman"]);
  assert.deepEqual(texts(issues, 10), [], 'Genderless has no restriction');
});

test('Men’s High needs an advanced player, by the configured levels; none configured, no level check', () => {
  const round = [match(1, 1, 'Ben Uy', 'Dan Ko')];
  assert.deepEqual(texts(lineupIssues(round, ROSTER, ROWS, RULES), 1), ["Men's High needs an advanced player: neither Ben Uy nor Dan Ko is"]);
  assert.deepEqual(texts(lineupIssues([match(1, 1, 'Carl Go', 'Dan Ko')], ROSTER, ROWS, RULES), 1), [], 'HI counts');
  const noLevels = lineupRulesFrom({ pairs: { 1: 'mens-high' } });
  assert.equal(lineupIssues(round, ROSTER, ROWS, noLevels).size, 0);
});

test('the captain, the first player in the roster, doesn’t play Mixed', () => {
  const issues = lineupIssues([match(2, 2, 'Cap Tan', 'Ana Cruz')], ROSTER, ROWS, RULES);
  assert.deepEqual(texts(issues, 2), ["Cap Tan is Red's captain, and a captain doesn't play Mixed"]);
  const named = new Map([...ROWS, ['Red', { teamCode: 'Red', teamName: 'Red Dragons' }]]);
  assert.deepEqual(texts(lineupIssues([match(2, 2, 'Cap Tan', 'Ana Cruz')], ROSTER, named, RULES), 2), ["Cap Tan is Red Dragons's captain, and a captain doesn't play Mixed"], 'the team’s name when it has one');
  const allowed = lineupRulesFrom({ pairs: { 2: 'mixed' } });
  assert.equal(lineupIssues([match(2, 2, 'Cap Tan', 'Ana Cruz')], ROSTER, ROWS, allowed).size, 0);
});

test('a player allowed into a pair kind is let off its gender rule there, and only there', () => {
  const roster = new Map([['Red', [...RED.slice(0, 3), p('Gian', 'M', 'LB'), ...RED.slice(4)]]]);
  const rules = lineupRulesFrom({ pairs: { 2: 'mixed', 3: 'womens' }, allowed: { gian: ['womens'] } });
  assert.equal(lineupIssues([match(9, 3, 'Gian', 'Ana Cruz')], roster, ROWS, rules).size, 0, 'Gian may play Women’s');
  assert.deepEqual(texts(lineupIssues([match(2, 2, 'Gian', 'Ben Uy')], roster, ROWS, rules), 2),
    ['Mixed is one man and one woman: Gian and Ben Uy are both men'], 'but not be the woman in Mixed');
  const strict = lineupRulesFrom({ pairs: { 3: 'womens' } });
  assert.deepEqual(texts(lineupIssues([match(9, 3, 'Gian', 'Ana Cruz')], roster, ROWS, strict), 9), ["Women's is two women: Gian isn't a woman"]);
});

test('one game per player per round: twice in a round, and left out of a full round', () => {
  const round = [...GOOD.slice(0, 3), match(10, 4, 'Ben Uy', 'Dina Lao')];
  const issues = lineupIssues(round, ROSTER, ROWS, RULES);
  assert.deepEqual(texts(issues, 1), ['Ben Uy plays twice this round (#1 and #10)', "Carl Go doesn't play this round"]);
  assert.deepEqual(texts(issues, 10), ['Ben Uy plays twice this round (#1 and #10)']);
  const thrice = lineupIssues([match(1, 1, 'Cap Tan', 'Ben Uy'), match(2, 2, 'Ben Uy', 'Ana Cruz'), match(9, 3, 'Bea Ong', 'Cora Ang'), match(10, 4, 'Ben Uy', 'Dina Lao')], ROSTER, ROWS, RULES);
  assert.equal(texts(thrice, 2)[0], 'Ben Uy plays 3 times this round (#1, #2 and #10)');
  // Another matchup is another round.
  const other = { ...match(17, 4, 'Ben Uy', 'Dina Lao'), matchUp: 'Red v Yellow' };
  assert.equal(lineupIssues([...GOOD.slice(0, 1), other], ROSTER, ROWS, RULES).size, 0);
});

test('names match the roster ignoring case and spaces; a player not on it is named; no roster, no roster checks', () => {
  const issues = lineupIssues([match(1, 1, '  cap   TAN ', 'Zed Lim')], ROSTER, ROWS, RULES);
  assert.deepEqual(texts(issues, 1), ["Zed Lim isn't on Red's roster"]);
  const orange = { num: 3, matchUp: 'Red v Orange', t1: 'Orange_3', t1p1: 'Al Sy', t1p2: 'Bo Lu', t2: 'Red_3', t2p1: 'TBD', t2p2: 'TBD' };
  assert.equal(lineupIssues([orange], ROSTER, ROWS, RULES).size, 0, 'Orange has no roster: no gender to check');
});

test('an unset lineup, or a playoff slot with no team yet, is skipped', () => {
  const unset = [{ num: 1, matchUp: 'Red v Orange', t1: 'Red_1', t1p1: 'Red_1', t1p2: 'Red_1', t2: 'Orange_1', t2p1: '', t2p2: '' }];
  assert.equal(lineupIssues(unset, ROSTER, ROWS, RULES).size, 0);
  const playoff = [{ num: 113, matchUp: 'Br-1 v Br-2', t1: 'Br-1_1', t1p1: 'Ana Cruz', t1p2: 'Bea Ong', t2: 'Br-2_1', t2p1: 'TBD', t2p2: 'TBD' }];
  assert.equal(lineupIssues(playoff, ROSTER, ROWS, RULES).size, 0, 'no team in the slot: nothing to check against');
});
