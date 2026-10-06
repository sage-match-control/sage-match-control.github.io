// Site-wide constants: the same on every page, for every event. A value that
// differs per event is a setting of that event's shell, not a constant here.
//
// Imports nothing (site-engine-spec §4.2).

// event-data's GitHub Pages address, https://<owner>.github.io/<repo>/: every
// event's snapshots, and config/events.json.
export const GHPAGES_OWNER = 'sage-match-control';
export const GHPAGES_REPO = 'event-data';

// sage-tools-api on Cloud Run: scores, attendance marks, sign-in.
export const CLOUD_RUN_BASE_URL = 'https://sage-tools-api-811926984834.us-central1.run.app';

// How long to wait on a fetch before giving up (venue wifi at a live event can
// hang rather than fail outright).
export const FETCH_TIMEOUT_MS = 8000;
// How often to re-check GitHub Pages while a tab is open and visible. Paused
// automatically while the tab/app is backgrounded. Apps Script syncs within a
// few seconds of an edit and the live channel pushes it; while its socket is
// open this poll re-renders from the pushed snapshot and only checks GitHub
// every LIVE_SAFETY_POLL_MS (data/live-channel.js).
export const POLL_INTERVAL_MS = 10000;
// The same for a staff attendance list.
export const ATTENDANCE_POLL_MS = 10000;

/**
 * Local testing only: on localhost, ?fixture=<name> loads /_fixtures/config.json
 * as the registry and /_fixtures/<event>/<name>.json as each snapshot.
 * _fixtures/ is never published (Jekyll skips "_" folders), and the hostname
 * check keeps this inert on the live site.
 * @returns {string|null}
 */
export function fixtureName(){
  return ['localhost', '127.0.0.1'].includes(location.hostname)
    ? new URLSearchParams(location.search).get('fixture')
    : null;
}
