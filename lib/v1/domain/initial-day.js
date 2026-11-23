// Which day a multi-day event's page loads on opening, when no address names one (the Tournament Hub and Control
// Center). In order:
//
//   1. the day this browser last picked for the event, when it is still one of the event's days;
//   2. the event's day whose date is today;
//   3. the day nearest today by date (before the event, its first day; after it, its last), a later day winning a tie;
//   4. with no dated days, the first day.
//
// A one-day event is its one day. An event with no days has none (null).

/**
 * @param {{ days: { key: string, date?: string|null }[], savedKey?: string|null, today: string }} args
 *   days      the event's days, in order (events.json; registry.js's eventConfigFrom)
 *   savedKey  the day key this browser last picked for the event, or null
 *   today     today's date, YYYY-MM-DD (the form events.json writes a day's `date` in)
 * @returns {number|null} the index into `days` to load
 */
export function initialDayIndex({ days, savedKey = null, today }){
  if(!Array.isArray(days) || days.length === 0) return null;
  if(savedKey){
    const saved = days.findIndex(d => d.key === savedKey);
    if(saved !== -1) return saved;
  }
  let best = null;
  days.forEach((d, i) => {
    const distance = dayDistance(d.date, today);
    if(distance === null) return;
    if(best === null || distance <= best.distance) best = { i, distance };
  });
  return best ? best.i : 0;
}

/** Whole days between two YYYY-MM-DD dates, either way round; null when either is missing or malformed. */
function dayDistance(a, b){
  const t = s => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00Z`) : NaN);
  const diff = t(a) - t(b);
  return Number.isNaN(diff) ? null : Math.abs(Math.round(diff / 86400e3));
}

/**
 * Today's date in the Philippines (the events' own time zone), YYYY-MM-DD.
 * @param {Date} now  the caller reads the clock; the domain never does
 * @returns {string}
 */
export function manilaIsoDate(now){
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(now);
}
