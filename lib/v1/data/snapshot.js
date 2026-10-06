// A day's published snapshot: where it lives, how to fetch it, and the poll
// that keeps a page current when the live channel isn't (or isn't enough).
//
// Every page used to carry its own four slightly different copies of these.

import { GHPAGES_OWNER, GHPAGES_REPO, FETCH_TIMEOUT_MS, POLL_INTERVAL_MS } from '../platform.js';

/**
 * Where a day's snapshot is published: event-data on GitHub Pages, one folder
 * per event. Cache-busted: the snapshot is regenerated behind the same
 * filename, and GitHub Pages caches responses for ~10 minutes — without this a
 * stale copy renders silently and looks correct.
 *
 * On localhost, a fixture name (?fixture=) reads /_fixtures/<event>/<name>.json instead.
 * @param {string} eventKey @param {string} dayKey
 * @param {{ fixture?: string|null, now?: number }} [options]
 */
export function snapshotUrlFor(eventKey, dayKey, { fixture = null, now = Date.now() } = {}){
  return fixture
    ? `/_fixtures/${eventKey}/${encodeURIComponent(fixture)}.json?t=${now}`
    : `https://${GHPAGES_OWNER}.github.io/${GHPAGES_REPO}/${eventKey}/data/${dayKey}.json?t=${now}`;
}

/**
 * GitHub/jsDelivr can hang on a bad connection (likely at a live event on venue
 * wifi) rather than failing outright — cap every request so a stalled fetch
 * degrades into the normal retry UI instead of leaving "Loading…" on screen
 * forever.
 *
 * A snapshot Cloud Run hasn't published yet at all shows up as a plain 404:
 * the error carries `status` so the caller can tell "not published yet" apart
 * from a real failure.
 * @returns {Promise<object>} the snapshot
 */
export async function fetchDaySnapshotFromPages(eventKey, dayKey, { fixture = null, timeoutMs = FETCH_TIMEOUT_MS } = {}){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(snapshotUrlFor(eventKey, dayKey, { fixture }), { cache: 'no-store', signal: controller.signal });
    if(!res.ok){
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } catch(err){
    if(err.name === 'AbortError') throw new Error('timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Prefers the pushed snapshot while the live channel is connected; otherwise
 * (or when it is time for the periodic GitHub check) fetches from GitHub Pages
 * and keeps whichever of the two copies is newer.
 * @param {{ liveChannel: object, fixture?: string|null }} options  liveChannel: data/live-channel.js
 */
export async function fetchDaySnapshot(eventKey, dayKey, { liveChannel, fixture = null }){
  const pushed = liveChannel.cached(eventKey, dayKey);
  if(pushed) return pushed;
  let fetched;
  try {
    fetched = await fetchDaySnapshotFromPages(eventKey, dayKey, { fixture });
  } catch(err){
    // GitHub has nothing yet (404 before the day's first archive) or can't be
    // reached, but a pushed copy may exist.
    const pushedAnyway = liveChannel.newer(eventKey, dayKey, null);
    if(pushedAnyway) return pushedAnyway;
    throw err;
  }
  return liveChannel.newer(eventKey, dayKey, fetched);
}

/**
 * The poll: `onTick` every `intervalMs` while the page is visible. When the tab
 * or app is backgrounded the poll (and the live channel, if there is one) stops
 * — no point spending battery and mobile data re-fetching data nobody's looking
 * at — and catches up with an immediate tick as soon as it is visible again.
 * @param {{ intervalMs?: number, onTick: () => void, liveChannel?: object }} options
 * @returns {{ start(): void, stop(): void }}
 */
export function createPoller({ intervalMs = POLL_INTERVAL_MS, onTick, liveChannel }){
  let timer = null, listening = false;
  const onVisibility = () => {
    if(document.hidden){
      clearInterval(timer);
      if(liveChannel) liveChannel.pause();
    } else {
      if(liveChannel) liveChannel.resume();
      onTick();
      clearInterval(timer);
      timer = setInterval(onTick, intervalMs);
    }
  };
  return {
    start(){
      clearInterval(timer);
      timer = setInterval(onTick, intervalMs);
      if(!listening){ document.addEventListener('visibilitychange', onVisibility); listening = true; }
    },
    stop(){
      clearInterval(timer);
      if(listening){ document.removeEventListener('visibilitychange', onVisibility); listening = false; }
    },
  };
}
