// The event registry, event-data/config/events.json: which events exist, their
// days and facilities, and (for Control Center and the engine pages) how to
// label them. See event-data/config/README.md for its shape.
//
// Rule (site-engine-spec §4.6): an event stays in events.json for as long as
// any page built on the engine shows it. Removing a finished event's entry
// would blank its Hub.

import { GHPAGES_OWNER, GHPAGES_REPO, FETCH_TIMEOUT_MS, fixtureName } from '../platform.js';
import { numberRepeatedPairs, PAIRS } from '../domain/teams.js';

/** localStorage key of the last registry that loaded, used when a later load fails. */
export const REGISTRY_LAST_GOOD_KEY = 'sage.registry.lastGood';

/**
 * Where the registry is published. Cache-busted, for the same reason as a
 * snapshot (data/snapshot.js). On localhost, a fixture name reads
 * /_fixtures/config.json instead.
 */
export function registryUrl({ fixture = null, now = Date.now() } = {}){
  return fixture
    ? `/_fixtures/config.json?t=${now}`
    : `https://${GHPAGES_OWNER}.github.io/${GHPAGES_REPO}/config/events.json?t=${now}`;
}

function readLastGood(){
  try { return JSON.parse(localStorage.getItem(REGISTRY_LAST_GOOD_KEY) || 'null'); } catch(e){ return null; }
}

/**
 * Fetch the registry. On success the text is kept in localStorage; if a later
 * fetch fails (venue wifi), the kept copy is used instead, and only with none
 * kept does it throw.
 * @param {{ fixture?: string|null, timeoutMs?: number }} [options]
 *   fixture  defaults to the page's ?fixture= (localhost only); a fixture registry is never kept as the last good one
 * @returns {Promise<{ events: object }>} the parsed registry
 */
export async function loadRegistry({ fixture = fixtureName(), timeoutMs = FETCH_TIMEOUT_MS } = {}){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(registryUrl({ fixture }), { cache: 'no-store', signal: controller.signal });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const registry = JSON.parse(text);
    if(!fixture){ try { localStorage.setItem(REGISTRY_LAST_GOOD_KEY, text); } catch(e){ /* storage unavailable */ } }
    return registry;
  } catch(err){
    if(!fixture){
      const kept = readLastGood();
      if(kept) return kept;
    }
    throw err.name === 'AbortError' ? new Error('timed out') : err;
  } finally {
    clearTimeout(timer);
  }
}

function validPairs(p){
  return !!p && typeof p === 'object' && !Array.isArray(p) && Object.entries(p).every(([k, v]) =>
    /^[0-9]+$/.test(k) && !!v && typeof v.full === 'string' && v.full !== '' && typeof v.short === 'string' && v.short !== '');
}
function pairsFrom(raw, eventKey){
  if(raw === undefined) return PAIRS;
  if(validPairs(raw)) return numberRepeatedPairs(raw);
  console.warn(`events.json: display.pairs for ${eventKey} is malformed; using the default pair labels`);
  return PAIRS;
}

/**
 * One event, as every engine page sees it (EventConfig, domain/model.js), read
 * from the registry the way Control Center reads it: `type` is required and
 * never inferred (anything else is null, and the page shows a configuration
 * error), days run in date order (a day with no date last, ties in the order
 * events.json lists them), `display` is the optional code -> label maps.
 * `pairs` is a team event's pair labels: `display.pairs` with repeated types
 * numbered, or the default pairs when it is absent or malformed.
 * @param {{ events?: object }} registry
 * @param {string} eventKey
 * @returns {import('../domain/model.js').EventConfig | null}  null for an event the registry doesn't have
 */
export function eventConfigFrom(registry, eventKey){
  const raw = registry && registry.events && registry.events[eventKey];
  if(!raw) return null;
  const type = raw.type === 'dual-meet' || raw.type === 'standard' || raw.type === 'team' ? raw.type : null;
  const days = Object.entries(raw.days || {})
    .map(([key, d]) => ({
      key,
      label: d.label,
      date: d.date || undefined,
      facilities: (d.facilities || []).map(f => f.name),
    }))
    .sort((a, b) => (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99'));
  return {
    key: eventKey,
    type,
    title: raw.title,
    days,
    display: raw.display || {},
    pairs: pairsFrom(raw.display && raw.display.pairs, eventKey),
    scoreEntry: raw.scoreEntry,
    attendance: raw.attendance,
  };
}
