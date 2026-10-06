// Team codes, categories and the labels shown for them.
//
// A match's team code is positional, never a regex built from known
// club/division/event codes (spec §2.2: club and category sets are derived
// from the data, never configured):
//   dual-meet  <CLUB>_<CATEGORY>_<REST>      e.g. PNF_LIWD_1
//   standard   <CATEGORY>_<REST>             e.g. ND_2, NWD_SF_1
// and a CATEGORY token ("LIWD") is a division code followed by an event code.
//
// Parsing never fails structurally: grouping and rendering work with zero
// `display` config (spec §2.3). Only labels ever need it. Each function takes
// the event's `type` and/or its `display` ({ divisions, events, clubs }, code
// -> label, from events.json) as a parameter; none reads page state.

// ---- Playoff stage display --------------------------------------------------
// Fixed, universal stage metadata: the regexes that read it (roundKeyword,
// standingsStageKey, …) don't depend on any per-event config, so this never
// needed to move into events.json. Round Robin rows aren't listed here: they
// are always "RR" and rendered separately.
export const STAGE_META = {
  R16:    { label: 'Round of 16',   banner:false },
  QF:     { label: 'Quarterfinals', banner:false },
  SF:     { label: 'Semifinals',    banner:false },
  BRONZE: { label: 'Bronze Battle', banner:true },
  FINAL:  { label: 'Finals',        banner:true }
};
// Bronze/Final are cross-club matches (dual-meet type only): the two clubs'
// bracket winners (or runners-up) face each other directly, unlike Round
// Robin/R16/QF/SF, which stay within one club's own bracket.
export const CROSS_CLUB_STAGE_KEYS = ['BRONZE', 'FINAL'];
export const STAGE_ORDER = ['R16','QF','SF','BRONZE','FINAL'];
export const BADGE_CLASSES = ['badge-0','badge-1','badge-2','badge-3'];

// ---- Parsing ------------------------------------------------------------------

const parseCodeCache = new Map();

/**
 * @param {string} code
 * @param {'standard'|'dual-meet'|'team'|null} type  the event's type
 * @returns {{ club: string|null, category: string|null, rest: string }}
 */
export function parseCode(code, type){
  const cacheKey = `${type}::${code}`;
  let cached = parseCodeCache.get(cacheKey);
  if(cached) return cached;
  const parts = String(code).split('_');
  let result;
  if(type === 'dual-meet'){
    const [club, category, ...rest] = parts;
    result = { club: club || null, category: category || null, rest: rest.join('_') };
  } else if(type === 'team'){
    // Team views use the helpers in teams.js, not this — this
    // only keeps any shared caller from breaking.
    const [, ...rest] = parts;
    result = { club: null, category: null, rest: rest.join('_') };
  } else {
    const [category, ...rest] = parts;
    result = { club: null, category: category || null, rest: rest.join('_') };
  }
  parseCodeCache.set(cacheKey, result);
  return result;
}

/**
 * Splits a category token ("LIWD") into its division/event codes by
 * longest-prefix match against display.divisions' keys (spec §2.4) — the
 * only place display config is actually required for anything. Returns
 * null if it can't be split (no display config, or no matching prefix);
 * callers fall back to showing the raw token untranslated.
 * @param {string|null} category
 * @param {{ divisions?: object, events?: object }} display
 * @returns {{ divCode: string, evCode: string } | null}
 */
export function splitCategory(category, display){
  if(!category || !display.divisions) return null;
  const divKeys = Object.keys(display.divisions).sort((a, b) => b.length - a.length);
  for(const divCode of divKeys){
    if(category.startsWith(divCode)){
      const evCode = category.slice(divCode.length);
      if(display.events && Object.prototype.hasOwnProperty.call(display.events, evCode)){
        return { divCode, evCode };
      }
    }
  }
  return null;
}

// ---- Labels -------------------------------------------------------------------

/**
 * @param {string|null} category
 * @param {object} display
 * @param {Set<string>} [unresolved]  collects every category token display
 *   config couldn't resolve, so a view can show one visible warning instead of
 *   a silent "Other" bucket (spec §2.4)
 */
export function categoryLabel(category, display, unresolved){
  if(category === '__team__') return 'Team Championship';
  if(!category) return 'Other';
  const split = splitCategory(category, display);
  if(!split){
    if(display.divisions && unresolved) unresolved.add(category);
    return category;
  }
  const divLabel = display.divisions[split.divCode] || split.divCode;
  const evLabel = (display.events && display.events[split.evCode]) || split.evCode;
  return `${divLabel} ${evLabel}`.trim();
}

export function clubLabel(clubCode, display){
  if(!clubCode) return clubCode;
  return (display.clubs && display.clubs[clubCode]) || clubCode;
}

/** "<club> · <category>" for a team code, or null when it has no category. */
export function divisionLabel(code, type, display, unresolved){
  const p = parseCode(code, type);
  if(!p.category) return null;
  const clubPart = p.club ? `${clubLabel(p.club, display)} · ` : '';
  return `${clubPart}${categoryLabel(p.category, display, unresolved)}`;
}

export function divisionEventLabel(code, type, display, unresolved){
  const p = parseCode(code, type);
  return categoryLabel(p.category, display, unresolved);
}

// ---- Round / stage ----------------------------------------------------------------

/**
 * Twice-to-beat playoff slots encode which meeting they belong to as a
 * trailing "(1)"/"(2)" on the team code — e.g. B35XD_F_1_(1) vs
 * B35XD_F_2_(1) for the first Final, with B35XD_F_1_(2)/B35XD_F_2_(2) as
 * the decider if the challenger forces a second match. Works the same on
 * either a full team code or just its "rest" portion, since the
 * parenthesized part is always at the very end either way. Returns null
 * for any code without one (i.e. every normal, non-twice-to-beat match).
 * @param {string} str
 * @returns {number|null}
 */
export function matchInstanceOf(str){
  const m = str.match(/\((\d+)\)\s*$/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Raw stage keyword only — no display text, no twice-to-beat "Match N"
 * suffix. standingsStageKey() (and anything else that needs to bucket a
 * row by stage) should use this rather than string-matching roundLabel()'s
 * output, since that carries a suffix that breaks exact-equality checks.
 * @param {string} rest  the part of a team code after its category
 * @returns {'R16'|'QF'|'SF'|'F'|'B'|null}
 */
export function roundKeyword(rest){
  if(/^\d+$/.test(rest)) return null; // plain pool team number -> no special tag
  if(/(^|_)R16(_|\d|$)/.test(rest)) return 'R16';
  if(/(^|_)QF(_|\d|$)/.test(rest)) return 'QF';
  if(/(^|_)SF(_|\d|$)/.test(rest)) return 'SF';
  if(/(^|_)F(_|\d|$)/.test(rest)) return 'F';
  if(/(^|_)B(_|\d|$)/.test(rest)) return 'B';
  return null;
}

export const ROUND_KEYWORD_LABELS = { R16: 'Round of 16', QF: 'Quarterfinal', SF: 'Semifinal', F: 'Final', B: 'Bronze Match' };

export function roundLabel(rest){
  const keyword = roundKeyword(rest);
  if(!keyword) return null;
  const instance = matchInstanceOf(rest);
  const suffix = instance ? ` · Match ${instance}` : '';
  return ROUND_KEYWORD_LABELS[keyword] + suffix;
}

export const STANDINGS_STAGE_KEY_BY_ROUND_KEYWORD = { R16: 'R16', QF: 'QF', SF: 'SF', B: 'BRONZE', F: 'FINAL' };

/** 'RR' | 'R16' | 'QF' | 'SF' | 'BRONZE' | 'FINAL' */
export function standingsStageKey(teamCode, type){
  const { rest } = parseCode(teamCode, type);
  if(!rest) return 'RR';
  return STANDINGS_STAGE_KEY_BY_ROUND_KEYWORD[roundKeyword(rest)] || 'RR';
}

// ---- Category order ------------------------------------------------------------------

/**
 * Category display order, built once per render pass from whichever category
 * tokens are actually present: ordered by display.divisions x display.events
 * key order when display config exists, else first-appearance order in the
 * data (spec §2.1/§2.3 — DIVISION_ORDER/EVENT_ORDER disappear entirely; JSON
 * key order does this job instead).
 * @param {string[]} categoryTokens
 * @param {object} display
 * @returns {Map<string, number>}
 */
export function buildCategoryOrderIndex(categoryTokens, display){
  const index = new Map();
  if(display.divisions){
    const divKeys = Object.keys(display.divisions);
    const evKeys = Object.keys(display.events || {});
    divKeys.forEach(divCode => {
      evKeys.forEach(evCode => {
        const token = divCode + evCode;
        if(categoryTokens.includes(token) && !index.has(token)) index.set(token, index.size);
      });
    });
  }
  // Anything not already placed above (no display config at all, or a
  // token display couldn't resolve) — appended in first-appearance order
  // rather than dropped or bucketed together.
  categoryTokens.forEach(token => { if(!index.has(token)) index.set(token, index.size); });
  return index;
}

/**
 * @param {{ teamCode: string }} sampleRow  any standings row of the category
 * @param {Map<string, number>} orderIndex  buildCategoryOrderIndex(...)
 * @param {string} type
 */
export function categorySortKey(sampleRow, orderIndex, type){
  const p = parseCode(sampleRow.teamCode, type);
  const idx = orderIndex.get(p.category);
  return idx === undefined ? 999 : idx;
}
