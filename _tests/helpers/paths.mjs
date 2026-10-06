// Where things are. Everything in the harness resolves from the site repo root.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const TESTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SITE_ROOT = path.resolve(TESTS_DIR, '..');
export const WORKSPACE_ROOT = path.resolve(SITE_ROOT, '..');
export const EVENT_DATA_ROOT = path.join(WORKSPACE_ROOT, 'event-data');
export const FIXTURES_DIR = path.join(TESTS_DIR, 'fixtures');
export const OUT_DIR = path.join(TESTS_DIR, 'out');

/** The pages the engine spec converts (site-engine-spec §0.3 "live pages"), repo-relative. */
export const LIVE_PAGES = {
  cc: 'tools/control-center.html',
  stdIndex: '_templates/standard-tournament-template/index.html',
  stdSchedule: '_templates/standard-tournament-template/schedule.html',
  dmIndex: '_templates/dual-meet-template/index.html',
  dmSchedule: '_templates/dual-meet-template/schedule.html',
  scorer: '_templates/scorer/scorer.html',
  attendance: '_templates/attendance/attendance.html',
};
