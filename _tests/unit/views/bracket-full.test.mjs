// views/bracket-full.js: the arithmetic of Full tree's zoom and pan (the gestures themselves are checked in
// a browser, standings-bracket-chart-spec §8.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitScale, clampScale, clampPan, zoomAbout, centredAt, isCompact, doubleTapScale, MAX_SCALE, COMPACT_BELOW, MIN_VISIBLE } from '../../../lib/v1/views/bracket-full.js';

test('fit: the chart and its 16px margin on every side fill the stage, scaled up to 2.5x on a big screen', () => {
  assert.equal(fitScale(375, 600, 796 - 32, 317), 375 / 796);
  assert.equal(fitScale(1000, 100, 200, 100), 100 / 132, 'the height limits it');
  assert.equal(fitScale(1915, 900, 588, 500), 900 / 532, 'a desktop fills with a three-round chart');
  assert.equal(fitScale(2000, 2000, 200, 100), MAX_SCALE, 'never past the most a reader can zoom');
});

test('a double-tap at fit zooms in (to full size at least, twice fit at most 2.5x); anywhere else, back to fit', () => {
  assert.equal(doubleTapScale(0.4, 0.4), 1, 'a phone: full size');
  assert.equal(doubleTapScale(1.2, 1.2), 2.4, 'a desktop already past full size: closer still');
  assert.equal(doubleTapScale(1.7, 1.7), MAX_SCALE);
  assert.equal(doubleTapScale(1.5, 0.4), 0.4);
  assert.equal(doubleTapScale(2.5, 1.7), 1.7);
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
