// views/bracket-full.js: the arithmetic of Full tree's zoom and pan (the gestures themselves are checked in
// a browser, standings-bracket-chart-spec §8.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitScale, clampScale, clampPan, zoomAbout, centredAt, isCompact, MAX_SCALE, COMPACT_BELOW, MIN_VISIBLE } from '../../../lib/v1/views/bracket-full.js';

test('fit: the chart and its 16px margin on every side fill the stage, never scaled up', () => {
  assert.equal(fitScale(375, 600, 796 - 32, 317), 375 / 796);
  assert.equal(fitScale(1000, 100, 200, 100), 100 / 132, 'the height limits it');
  assert.equal(fitScale(2000, 2000, 200, 100), 1, 'a small chart stays full size');
});

test('the scale stays between fit and 2.5', () => {
  assert.equal(clampScale(0.1, 0.47), 0.47);
  assert.equal(clampScale(1.3, 0.47), 1.3);
  assert.equal(clampScale(9, 0.47), MAX_SCALE);
  assert.equal(MAX_SCALE, 2.5);
});

test('the cards switch to surnames in larger type below 0.6x', () => {
  assert.equal(COMPACT_BELOW, 0.6);
  assert.equal(isCompact(0.59), true);
  assert.equal(isCompact(0.6), false);
});

test('pan keeps at least 80px of the canvas on screen on each axis', () => {
  const stage = { w: 375, h: 600 }, canvas = { w: 828, h: 349 };
  assert.equal(MIN_VISIBLE, 80);
  assert.deepEqual(clampPan(10, 20, 1, stage, canvas), { tx: 10, ty: 20 });
  assert.deepEqual(clampPan(9999, 9999, 1, stage, canvas), { tx: 375 - 80, ty: 600 - 80 });
  assert.deepEqual(clampPan(-9999, -9999, 1, stage, canvas), { tx: 80 - 828, ty: 80 - 349 });
  assert.deepEqual(clampPan(-9999, 0, 0.5, stage, canvas), { tx: 80 - 414, ty: 0 }, 'the scaled canvas is what counts');
});

test('centred: the canvas in the middle of the stage at a scale', () => {
  assert.deepEqual(centredAt(0.5, { w: 400, h: 600 }, { w: 800, h: 400 }), { s: 0.5, tx: 0, ty: 200 });
});

test('zoom about a point keeps the content under that point where it is', () => {
  const before = { s: 0.5, tx: 40, ty: 100 };
  const stage = { w: 375, h: 600 }, canvas = { w: 828, h: 349 };
  const after = zoomAbout(before, 1, 200, 300, 0.4, stage, canvas);
  assert.equal(after.s, 1);
  assert.equal((200 - after.tx) / after.s, (200 - before.tx) / before.s);
  assert.equal((300 - after.ty) / after.s, (300 - before.ty) / before.s);
  assert.equal(zoomAbout(before, 99, 200, 300, 0.4, stage, canvas).s, MAX_SCALE);
  assert.equal(zoomAbout(before, 0.01, 200, 300, 0.4, stage, canvas).s, 0.4);
});
