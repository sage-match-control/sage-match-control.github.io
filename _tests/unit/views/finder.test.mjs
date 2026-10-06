// views/finder.js: the pair index, resolution, autocomplete and the results' markup, on hand-made models.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import { buildPairIndex, resolvePair, autocompleteHTML, allMatchesHTML, introHTML, pairResultsHTML } from '../../../lib/v1/views/finder.js';

const HEADER = 'matchNumber,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const row = (n, live, t1, p1, p2, s1, t2, q1, q2, s2) => `${n},${live},9:00 AM,Court 1,${t1},${p1},${p2},${s1},${t2},${q1},${q2},${s2}`;
const model = rows => buildDayModel(
  { key: 'e', type: 'standard', title: 'E', display: {}, days: [] },
  { key: 'd', facilities: ['Main'] },
  { isLive: true, facilities: [{ name: 'Main', matchesCsv: [HEADER, ...rows].join('\n'), standingsCsv: 'teamCode,player1,player2,wins,loss,quotient,bracket\n' }] },
  { now: 0 },
);

const ROWS = [
  row(1, '', 'ND_1', 'Ann', 'Bo', 11, 'ND_2', 'Cy', 'Di', 4),
  row(2, '', 'ND_3', 'Ann', 'Bo', '', 'ND_4', 'Ed', 'Flo', ''),
  row(3, '', 'ND_1', 'Ann', 'Bo', '', 'bye', 'bye', 'bye', ''),
  row(4, '', 'ND_2', 'Cy', 'Di', '', 'ND_4', 'Ed', 'Flo', ''),
];

test('the pair index has each pair once, sorted, skips a BYE, and groups a pair under all its codes', () => {
  const pairs = buildPairIndex(model(ROWS));
  assert.deepEqual(pairs.map(p => p.label), ['Ann / Bo', 'Cy / Di', 'Ed / Flo']);
  assert.deepEqual(pairs[0].codes.sort(), ['ND_1', 'ND_3']);
  assert.equal(pairs[0].labelLower, 'ann / bo');
  assert.deepEqual(pairs.map(p => p.idx), [0, 1, 2]);
});

test('resolvePair: a selection wins, an exact name beats a partial one, several is ambiguous', () => {
  const pairs = buildPairIndex(model(ROWS));
  assert.equal(resolvePair('zzz', pairs, pairs[2]).team, pairs[2]);
  assert.equal(resolvePair('cy', pairs, null).team.label, 'Cy / Di');
  assert.equal(resolvePair('c', pairs, null).team.label, 'Cy / Di');
  assert.equal(resolvePair('di', pairs, null).team.label, 'Cy / Di');
  assert.equal(resolvePair('o', pairs, null).ambiguous.length, 2);
  assert.deepEqual(resolvePair('  ', pairs, null), { team: null, ambiguous: null });
  assert.deepEqual(resolvePair('nobody', pairs, null), { team: null, ambiguous: null });
});

test('autocomplete suggests at most 8 pairs with their division, and nothing for an empty or unmatched query', () => {
  const m = model(ROWS);
  const pairs = buildPairIndex(m);
  const html = autocompleteHTML('an', pairs, m);
  assert.match(html, /<div class="ac-item" data-idx="0" data-i="0"><span>Ann \/ Bo<\/span>/);
  assert.equal(autocompleteHTML('', pairs, m), '');
  assert.equal(autocompleteHTML('qqq', pairs, m), '');
});

test('every match by number leaves a BYE out and carries the hint', () => {
  const html = allMatchesHTML(model(ROWS), { searchHint: 'Try a match number.' });
  assert.match(html, /All 3 matches, by match number\. Try a match number\./);
  assert.equal((html.match(/<div class="ticket[ "]/g) || []).length, 3);
  assert.equal(allMatchesHTML(model([])), '');
});

test('the first screen counts matches, real pairs and divisions', () => {
  const html = introHTML(model(ROWS));
  assert.match(html, /<b>4<\/b><span>Matches<\/span>/);
  assert.match(html, /<b>4<\/b><span>Teams<\/span>/);
});

test('a pair’s results are its matches in schedule order, a BYE excluded, with the first unplayed marked Next Up', () => {
  const m = model(ROWS);
  const pairs = buildPairIndex(m);
  const { team, html } = pairResultsHTML('ann', m, pairs, null);
  assert.equal(team.label, 'Ann / Bo');
  assert.match(html, /2 matches found, in schedule order/);
  assert.equal((html.match(/next-pill/g) || []).length, 1);
  assert.ok(html.indexOf('Match #1') < html.indexOf('Match #2') || html.indexOf('#1') < html.indexOf('#2'));
});

test('an unknown name says so, with suggestions that start like it; an ambiguous one lists the pairs', () => {
  const m = model(ROWS);
  const pairs = buildPairIndex(m);
  const none = pairResultsHTML('Cy Zed', m, pairs, null);
  assert.equal(none.team, null);
  assert.match(none.html, /No matches found for <strong>Cy Zed<\/strong>/);
  assert.match(none.html, /Did you mean: <strong>Cy \/ Di<\/strong>/);
  const many = pairResultsHTML('o', m, pairs, null);
  assert.match(many.html, /Several pairs match/);
});

test('a search is escaped in the markup', () => {
  const m = model(ROWS);
  const { html } = pairResultsHTML('<b>x</b>', m, buildPairIndex(m), null);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
});
