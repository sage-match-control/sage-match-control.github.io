// The prize draw's rules (sage-docs/docs/specs/.../prize-draw-spec.md §4): entries, prizes, the winners of each
// spin, and the replay check. The pinned winners below are the rule's own output: if one changes, every recorded
// draw stops checking out, so a change here is a change to the rule, never a test to update.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  SEED_ALPHABET, MAX_ENTRIES, MAX_ENTRY_LENGTH, MAX_PRIZES, seedFromBytes, cleanEntry, uniqueEntries, parseEntries,
  entryProblems, numberEntries, ticketOf, isNumberList, playersFromSnapshot, checkedInFromPeople, listText,
  prizeProblems, prizeSlots, entrantsFor, nextSpin, drawWinners, drawFinished, verifyDraw, drawText,
} from '../../../lib/v1/domain/prize-draw.js';

const sha256Hex = async s => createHash('sha256').update(s, 'utf8').digest('hex');
const NAMES = ['Ana Reyes', 'Ben Cruz', 'Carla Santos', 'Dante Lim', 'Ella Tan', 'Francis Go'];
const row = (id, name, quantity = 1, together = false) => ({ id, name, quantity, together });

test('a seed uses only the read-aloud alphabet', () => {
  assert.equal(seedFromBytes([0, 1, 29, 30, 255]), '23Z2H');
  assert.ok(!/[ILOU01]/.test(SEED_ALPHABET));
});

test('entries: spaces collapsed, blank lines dropped, the same person once (accents, case and spacing ignored)', () => {
  assert.equal(cleanEntry('  Ana   Reyes \t'), 'Ana Reyes');
  assert.deepEqual(parseEntries('Ana Reyes\r\n\n  ana  reyes \nJosé Cruz\nJose cruz\nBen'), {
    entries: ['Ana Reyes', 'José Cruz', 'Ben'], merged: ['ana reyes', 'Jose cruz'],
  });
  assert.deepEqual(uniqueEntries(['', ' ', 'X']), { entries: ['X'], merged: [] });
});

test('a list that cannot be locked says why', () => {
  assert.deepEqual(entryProblems(['Ana']), ['A draw needs at least 2 entries.']);
  assert.deepEqual(entryProblems(Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => `P${i}`)),
    [`A draw takes at most ${MAX_ENTRIES} entries; this list has ${MAX_ENTRIES + 1}.`]);
  const long = 'x'.repeat(MAX_ENTRY_LENGTH + 1);
  assert.deepEqual(entryProblems(['Ana', long]), [`Shorten this entry to 40 characters or fewer: ${long}.`]);
  assert.deepEqual(entryProblems(['Ana', 'B|C']), ['An entry can\'t contain "|": B|C.']);
  assert.deepEqual(entryProblems(NAMES), []);
});

test('numbers and tickets: at least three digits, wider when the list is longer', () => {
  assert.deepEqual(numberEntries(3), ['001', '002', '003']);
  assert.equal(numberEntries(1000)[999], '1000');
  assert.deepEqual(numberEntries('x'), []);
  assert.equal(ticketOf(NAMES, 'Carla Santos'), '003');
  assert.equal(ticketOf(NAMES, 'Nobody'), '');
  assert.equal(ticketOf(numberEntries(1200), '0047'), '0047');
  assert.equal(isNumberList(numberEntries(5)), true);
  assert.equal(isNumberList(NAMES), false);
  assert.equal(isNumberList([]), false);
});

test('players on a day: standings pairs without BYEs; a team event\'s rosters', () => {
  const standard = { facilities: [
    { name: 'A', standingsCsv: 'teamCode,player1,player2,wins\r\nMD_1,Ana Reyes ,Ben Cruz ,0\r\nMD_2,bye,,0\r\nBYE,X,Y,0\r\nWD_1,Carla Santos,ana reyes,0\r\n' },
    { name: 'B', standingsCsv: '' },
    { name: 'C', standingsCsv: 'teamCode,player1,player2\nXD_1,Dante Lim,Ella Tan\n' },
  ] };
  assert.deepEqual(playersFromSnapshot(standard, 'standard'), ['Ana Reyes', 'Ben Cruz', 'Carla Santos', 'Dante Lim', 'Ella Tan']);
  const team = { facilities: [{ name: 'A', standingsCsv: 'teamCode,teamName\nT1,Aces\n',
    rosterCsv: 'teamCode,player,level,gender\nT1,Ana Reyes,3.5,F\nT2,Ben Cruz,3.0,M\nT2,,3.0,M\n' }] };
  assert.deepEqual(playersFromSnapshot(team, 'team'), ['Ana Reyes', 'Ben Cruz']);
  assert.deepEqual(playersFromSnapshot(null, 'standard'), []);
});

test('checked in: present and not withdrawn, once each, in roster order', () => {
  const lists = [
    [{ key: 'ana reyes', player: 'Ana Reyes', present: true, withdrawn: false },
     { key: 'ben cruz', player: 'Ben Cruz', present: false, withdrawn: false },
     { key: 'carla santos', player: 'Carla Santos', present: true, withdrawn: true }],
    [{ key: 'dante lim', player: '', present: true, withdrawn: false },
     { key: 'ana reyes', player: 'Ana Reyes', present: true, withdrawn: false }],
  ];
  assert.deepEqual(checkedInFromPeople(lists), ['Ana Reyes', 'dante lim']);
});

test('the fingerprint text is the entries one per line, no trailing line break', async () => {
  assert.equal(listText(['A', 'B']), 'A\nB');
  assert.equal(await sha256Hex(listText(NAMES)), '3de62d1c8a16989807f68efa2a5e74faa684df68d92339114f81480aa6867c74');
});

test('prize rows: named, 1 to 50 each, 200 in all', () => {
  assert.deepEqual(prizeProblems([row('a', 'Paddle', 1), row('b', 'Ball pack', 3)]), []);
  assert.deepEqual(prizeProblems([row('a', ' ', 1)]), ['Give every prize a name, or remove its row.']);
  assert.deepEqual(prizeProblems([row('a', 'x'.repeat(61), 1)]), [`Shorten this prize to 60 characters or fewer: ${'x'.repeat(61)}.`]);
  assert.deepEqual(prizeProblems([row('a', 'Cap', 0)]), ['Each quantity is a whole number from 1 to 50.']);
  assert.deepEqual(prizeProblems([row('a', 'Cap', 2.5)]), ['Each quantity is a whole number from 1 to 50.']);
  const many = Array.from({ length: 5 }, (_, i) => row(`r${i}`, `P${i}`, 50));
  assert.deepEqual(prizeProblems(many), [`At most ${MAX_PRIZES} prizes in all; these rows add up to 250.`]);
  assert.deepEqual(prizeProblems(Array.from({ length: 51 }, (_, i) => row(`r${i}`, `P${i}`))), ['List at most 50 prizes; this list has 51.']);
});

test('prize slots: one per unit, numbered within a quantity, keeping their row id', () => {
  assert.deepEqual(prizeSlots([row('a', ' Paddle '), row('b', 'Ball pack', 3, true)]), [
    { id: 'a:1', rowId: 'a', label: 'Paddle', together: false },
    { id: 'b:1', rowId: 'b', label: 'Ball pack (1 of 3)', together: true },
    { id: 'b:2', rowId: 'b', label: 'Ball pack (2 of 3)', together: true },
    { id: 'b:3', rowId: 'b', label: 'Ball pack (3 of 3)', together: true },
  ]);
});

test('the next spin: one slot at a time, a whole row drawn all at once, a reorder obeyed, a redrawn prize again', () => {
  const rows = [row('a', 'Paddle'), row('b', 'Ball pack', 3, true), row('c', 'Cap', 2)];
  const slots = prizeSlots(rows);
  assert.deepEqual(nextSpin([], []), { count: 1, slots: [] });
  assert.deepEqual(nextSpin(slots, []).slots.map(s => s.id), ['a:1']);
  const afterPaddle = [{ slotId: 'a:1', result: 'won' }];
  assert.deepEqual(nextSpin(slots, afterPaddle).slots.map(s => s.id), ['b:1', 'b:2', 'b:3']);
  // Caps first: the rows reordered, so the slots are made again in the new order.
  const reordered = prizeSlots([rows[2], rows[0], rows[1]]);
  assert.deepEqual(nextSpin(reordered, afterPaddle).slots.map(s => s.id), ['c:1']);
  // One of the three ball-pack winners drawn again: only that one unit is drawn next.
  const packs = [...afterPaddle, { slotId: 'b:1', result: 'won' }, { slotId: 'b:2', result: 'redrawn' }, { slotId: 'b:3', result: 'won' }];
  assert.deepEqual(nextSpin(slots, packs).slots.map(s => s.id), ['b:2']);
  const all = ['a:1', 'b:1', 'b:2', 'b:3', 'c:1', 'c:2'].map(slotId => ({ slotId, result: 'won' }));
  assert.deepEqual(nextSpin(slots, all), { count: 0, slots: [] });
});

test('who is still in: drawn-again winners always out; prize winners out only under remove-winners', () => {
  const earlier = [{ winner: 'Ana Reyes', result: 'won' }, { winner: 'Ben Cruz', result: 'redrawn' }];
  assert.deepEqual(entrantsFor(NAMES, earlier, 'remove-winners'), ['Carla Santos', 'Dante Lim', 'Ella Tan', 'Francis Go']);
  assert.deepEqual(entrantsFor(NAMES, earlier, 'keep-winners'), ['Ana Reyes', 'Carla Santos', 'Dante Lim', 'Ella Tan', 'Francis Go']);
});

test('a spin\'s winners are the smallest SHA-256(seed|spin|entry), smallest first, whatever the list order', async () => {
  const [w] = await drawWinners({ seed: 'HXTE7Q4M', spin: 1, entrants: NAMES, count: 1, sha256Hex });
  assert.deepEqual(w, { winner: 'Ben Cruz', key: await sha256Hex('HXTE7Q4M|1|Ben Cruz') });
  const three = await drawWinners({ seed: 'HXTE7Q4M', spin: 1, entrants: NAMES, count: 3, sha256Hex });
  assert.deepEqual(three.map(x => x.winner), PINNED_THREE);
  const reversed = await drawWinners({ seed: 'HXTE7Q4M', spin: 1, entrants: [...NAMES].reverse(), count: 3, sha256Hex });
  assert.deepEqual(reversed.map(x => x.winner), PINNED_THREE);
  for(const e of NAMES.filter(n => !PINNED_THREE.includes(n))) assert.ok(await sha256Hex(`HXTE7Q4M|1|${e}`) > three[2].key);
  assert.equal((await drawWinners({ seed: 'HXTE7Q4M', spin: 1, entrants: ['A', 'B'], count: 5, sha256Hex })).length, 2);
  assert.deepEqual(await drawWinners({ seed: 'X', spin: 1, entrants: [], count: 1, sha256Hex }), []);
});

test('a whole draw, pinned: HXTE7Q4M over six names, remove-winners, spin 2 drawn again', async () => {
  const picks = [];
  for(let n = 1; n <= 4; n++){
    const [{ winner }] = await drawWinners({ seed: 'HXTE7Q4M', spin: n, entrants: entrantsFor(NAMES, picks, 'remove-winners'), count: 1, sha256Hex });
    picks.push({ spin: n, place: 1, winner, result: n === 2 ? 'redrawn' : 'won' });
  }
  assert.deepEqual(picks.map(s => s.winner), PINNED_DRAW);
});

test('a draw is finished when every prize is won, or nobody is left', () => {
  const slots = prizeSlots([row('p', 'Paddle')]);
  const won = [{ slotId: 'p:1', winner: 'A', result: 'won' }];
  assert.equal(drawFinished({ entries: ['A', 'B'], slots, picks: won, rule: 'keep-winners' }), true);
  assert.equal(drawFinished({ entries: ['A', 'B'], slots: [], picks: won, rule: 'remove-winners' }), false);
  assert.equal(drawFinished({ entries: ['A', 'B'], slots: [], picks: [...won, { winner: 'B', result: 'redrawn' }], rule: 'remove-winners' }), true);
  // A continued draw: its own picks decide who is left, every pick so far decides which prizes are won.
  assert.equal(drawFinished({ entries: ['C', 'D'], slots, picks: [], allPicks: won, rule: 'remove-winners' }), true);
});

test('the replay check: a true record checks out; a changed winner, seed, place or spin number does not', async () => {
  const picks = PINNED_DRAW.map((winner, i) => ({ spin: i + 1, place: 1, winner, result: i === 1 ? 'redrawn' : 'won' }));
  const ok = await verifyDraw({ entries: NAMES, seed: 'HXTE7Q4M', rule: 'remove-winners', picks, sha256Hex });
  assert.deepEqual(ok.map(r => r.ok), [true, true, true, true]);
  const swapped = picks.map((p, i) => i === 2 ? { ...p, winner: 'Ben Cruz' } : p);
  const bad = await verifyDraw({ entries: NAMES, seed: 'HXTE7Q4M', rule: 'remove-winners', picks: swapped, sha256Hex });
  assert.deepEqual(bad.slice(0, 3).map(r => r.ok), [true, true, false]);
  assert.equal(bad[2].expected, PINNED_DRAW[2]);
  const otherSeed = await verifyDraw({ entries: NAMES, seed: 'HXTE7Q4N', rule: 'remove-winners', picks, sha256Hex });
  assert.ok(otherSeed.some(r => !r.ok));
  const gap = await verifyDraw({ entries: NAMES, seed: 'HXTE7Q4M', rule: 'remove-winners', picks: [{ ...picks[0], spin: 2 }], sha256Hex });
  assert.equal(gap[0].ok, false);
});

test('the replay check on a spin that drew three at once', async () => {
  const picks = PINNED_THREE.map((winner, i) => ({ spin: 1, place: i + 1, winner, result: 'won' }));
  const ok = await verifyDraw({ entries: NAMES, seed: 'HXTE7Q4M', rule: 'remove-winners', picks, sha256Hex });
  assert.deepEqual(ok.map(r => [r.place, r.ok]), [[1, true], [2, true], [3, true]]);
  const outOfOrder = [picks[1], picks[0], picks[2]].map((p, i) => ({ ...p, place: i + 1 }));
  const bad = await verifyDraw({ entries: NAMES, seed: 'HXTE7Q4M', rule: 'remove-winners', picks: outOfOrder, sha256Hex });
  assert.deepEqual(bad.map(r => r.ok), [false, false, true]);
});

test('the plain-text record', () => {
  const text = drawText({ title: 'Door prizes', eventLine: 'UPAP 3rd Annual · Nov 22', seed: 'HXTE7Q4M',
    fingerprint: 'a41f09c2ffff', rule: 'remove-winners', entries: NAMES,
    picks: [{ spin: 2, place: 1, prize: 'Paddle', winner: 'Ben Cruz', result: 'won' },
            { spin: 1, place: 1, prize: 'Paddle', winner: 'Ana Reyes', result: 'redrawn' }] });
  assert.equal(text, [
    'S.A.G.E. LUCKY DINK', 'Door prizes · UPAP 3rd Annual · Nov 22', 'Draw code: HXTE7Q4M',
    'List: 6 entries · fingerprint a41f09c2', 'Each winner leaves the draw.', '',
    'Spin 1 · Paddle: Ana Reyes (drawn again)', 'Spin 2 · Paddle: Ben Cruz', '',
    'Check it at sage-match-control.github.io/tools/prize-draw',
  ].join('\n'));
  const numbers = drawText({ title: '', eventLine: '', seed: 'AB', fingerprint: '0123456789', rule: 'keep-winners',
    entries: numberEntries(3), picks: [{ spin: 1, place: 1, prize: '', winner: '002', result: 'won' }] });
  assert.equal(numbers.split('\n').slice(0, 7).join('\n'), [
    'S.A.G.E. LUCKY DINK', 'Prize draw', 'Draw code: AB', 'List: 3 entries · fingerprint 01234567',
    'Winners stay in the draw.', '', 'Spin 1 · #002'].join('\n'));
  const empty = drawText({ title: 'T', eventLine: '', seed: 'S', fingerprint: 'f', rule: 'keep-winners', entries: ['A', 'B'], picks: [] });
  assert.ok(empty.includes('\nNo spins yet.\n'));
});

const PINNED_DRAW = ['Ben Cruz', 'Ella Tan', 'Francis Go', 'Carla Santos'];
const PINNED_THREE = ['Ben Cruz', 'Carla Santos', 'Francis Go'];
