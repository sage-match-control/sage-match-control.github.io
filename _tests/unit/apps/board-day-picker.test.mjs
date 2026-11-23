// The schedule board's day picker (sage-docs/docs/specs/.../ultimate-generation-cup-2026-spec.md §4): every
// board template has its container, so a multi-day event made from a template gets the picker; the board fills
// it from events.json and leaves it hidden at a one-day event. A board without the container is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT } from '../../helpers/paths.mjs';

const read = rel => fs.readFileSync(path.join(SITE_ROOT, rel), 'utf8');
const CONTAINER = '<div class="dayfilter" id="dayfilter" hidden></div>';

for (const rel of [
  '_templates/standard-tournament-template/schedule.html',
  '_templates/dual-meet-template/schedule.html',
  '_templates/team-tournament-template/schedule.html',
]) {
  test(`${rel} has the day picker's container, hidden, before the venue filter`, () => {
    const html = read(rel);
    const at = html.indexOf(CONTAINER);
    assert.ok(at > -1, 'the container is there');
    assert.equal(html.indexOf(CONTAINER, at + 1), -1, 'once');
    assert.ok(at < html.indexOf('id="venuefilter"'), 'before the venue filter');
  });
}

test('the board reads the day from domain/board-day.js, only for a page with the container', () => {
  const js = read('lib/v1/apps/schedule-board.js');
  assert.match(js, /import \{ boardDay, localIsoDate \} from '\.\.\/domain\/board-day\.js';/);
  assert.match(js, /const dayFilterEl = byId\("dayfilter"\);/);
  assert.match(js, /if\(teamEvent \|\| dayFilterEl\)\{/);
  // Every read of the day follows the picker's choice, not the page's DAY_KEY.
  assert.doesNotMatch(js, /fetchDaySnapshot\(eventKey, dayKey/);
  assert.doesNotMatch(js, /follow\(eventKey, dayKey\)/);
  assert.doesNotMatch(js, /day: dayKey/);
});

test('the board stylesheet hides an empty day picker and in the compact header', () => {
  const css = read('lib/v1/css/schedule-board.css');
  assert.match(css, /\.dayfilter\[hidden\]\{ display:none; \}/);
  assert.match(css, /\.bezel\.compact \.dayfilter,/);
});
