// A team's bracket (STANDINGSCSV's `bracket`), as the team views key and sort it
// (sage-docs/docs/specs/.../ladies-dink-club-tournament-spec.md §5): a number ("1", as PickleDrive and
// Millennium publish) or a single letter ("A", as the Ladies' Dink workbook does). Anything else is no bracket.

/**
 * @param {string|null|undefined} raw
 * @returns {number|string|null}  1 for "1", "A" for "a", null for "", "#N/A", "AB"
 */
export function bracketKeyOf(raw){
  const s = (raw === null || raw === undefined ? '' : String(raw)).trim();
  if(/^\d+$/.test(s)) return parseInt(s, 10);
  if(/^[A-Za-z]$/.test(s)) return s.toUpperCase();
  return null;
}

/**
 * Sort order for bracket keys: no bracket (null) first, then numbers by value, then letters A-Z.
 * @param {number|string|null} a
 * @param {number|string|null} b
 */
export function compareBrackets(a, b){
  const rank = k => k === null ? 0 : typeof k === 'number' ? 1 : 2;
  return (rank(a) - rank(b)) || (typeof a === 'number' ? a - b : String(a).localeCompare(String(b)));
}
