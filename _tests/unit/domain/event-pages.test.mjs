import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventPagesPath, archivedPagePath } from '../../../lib/v1/domain/event-pages.js';

test("an event's pages are in events/<key>/ unless its entry says they were archived", () => {
  assert.equal(eventPagesPath('acso-sportsfest-2026', { type: 'standard' }), '/events/acso-sportsfest-2026/');
  assert.equal(eventPagesPath('acso-sportsfest-2026', undefined), '/events/acso-sportsfest-2026/');
  assert.equal(eventPagesPath('ladies-dink-2026', { pagesArchived: true }), '/events/archives/ladies-dink-2026/');
});

test('only pagesArchived: true moves them', () => {
  assert.equal(eventPagesPath('e', { pagesArchived: false }), '/events/e/');
  assert.equal(eventPagesPath('e', { pagesArchived: 'true' }), '/events/e/');
  assert.equal(eventPagesPath('e', { archived: true }), '/events/e/', '`archived` only hides an event from the console');
});

test('the key is encoded for the URL', () => {
  assert.equal(eventPagesPath('a b', {}), '/events/a%20b/');
});

test('a missing page under events/ maps to the same page under events/archives/', () => {
  assert.equal(archivedPagePath('/events/ladies-dink-2026/'), '/events/archives/ladies-dink-2026/');
  assert.equal(archivedPagePath('/events/ladies-dink-2026'), '/events/archives/ladies-dink-2026/');
  assert.equal(archivedPagePath('/events/ladies-dink-2026/schedule'), '/events/archives/ladies-dink-2026/schedule');
  assert.equal(archivedPagePath('/events/piggleball-2026/assets/qr.png'), '/events/archives/piggleball-2026/assets/qr.png');
});

test("anything else has no archived copy to try, so a miss can't redirect forever", () => {
  assert.equal(archivedPagePath('/events/archives/ladies-dink-2026/'), null);
  assert.equal(archivedPagePath('/events/archives/'), null);
  assert.equal(archivedPagePath('/events/archives'), null);
  assert.equal(archivedPagePath('/events/'), null);
  assert.equal(archivedPagePath('/tools/nothing'), null);
  assert.equal(archivedPagePath('/'), null);
});
