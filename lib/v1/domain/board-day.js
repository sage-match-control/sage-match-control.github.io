// Which day a schedule board shows, when its page offers a day picker and its event has more than one day
// (sage-docs/docs/specs/.../ultimate-generation-cup-2026-spec.md §4). In order:
//
//   1. the page's ?day=, when it is one of the event's day keys (the picker writes it);
//   2. the event's day whose date is today, so a wall display left on overnight shows the next day's board;
//   3. the page's own DAY_KEY.
//
// With no days read (events.json failed to load), always the page's own DAY_KEY.

/**
 * @param {{ days: { key: string, date?: string }[], dayKey: string, requested?: string|null, today: string }} args
 *   days       the event's days, from events.json (registry.js's eventConfigFrom)
 *   dayKey     the page's own DAY_KEY
 *   requested  the page's ?day=, or null
 *   today      the local date, YYYY-MM-DD (localIsoDate)
 * @returns {string} a day key
 */
export function boardDay({ days, dayKey, requested = null, today }){
  if(!Array.isArray(days) || days.length === 0) return dayKey;
  if(requested && days.some(d => d.key === requested)) return requested;
  const dated = days.find(d => d.date && d.date === today);
  return dated ? dated.key : dayKey;
}

/**
 * A date's local calendar day as YYYY-MM-DD, the form events.json writes a day's `date` in.
 * @param {Date} date
 * @returns {string}
 */
export function localIsoDate(date){
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
