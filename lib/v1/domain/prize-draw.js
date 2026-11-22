// The prize draw's rules (sage-docs/docs/specs/.../prize-draw-spec.md §4): the entry list, the prizes, who wins
// each spin, and the check that replays a recorded draw. Pure: the SHA-256 function is passed in (the page passes
// one over crypto.subtle; the tests pass Node's), so nothing here touches the browser.
//
// The rule, stated once: for spin n, every entrant still in the draw gets the key
// SHA-256(seed + "|" + n + "|" + entry), as lowercase hex. A spin that draws k winners takes the k smallest keys,
// smallest first. The prize a spin is for never enters the hash, so prizes can be reordered at any time.
import { attendanceKey } from './attendance-marks.js';
import { BYE_RE } from './byes.js';
import { parseCSV } from './csv.js';
import { buildTeamRoster } from './teams.js';

/** The seed's characters: no I, L, O, U, 0 or 1, so a draw code reads aloud safely (the Bracket Generator's). */
export const SEED_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const SEED_LENGTH = 8;
/** The most entries a draw takes, and the longest entry: together they fit the workbook's one-cell list (§7). */
export const MAX_ENTRIES = 1000;
export const MAX_ENTRY_LENGTH = 40;
/** Prize rows: at most 50, each name at most 60 characters, each quantity 1 to 50, 200 prizes in all. */
export const MAX_PRIZE_ROWS = 50;
export const MAX_PRIZE_LENGTH = 60;
export const MAX_QUANTITY = 50;
export const MAX_PRIZES = 200;
/** The Pickle Jar holds one ball per entrant: at most this many, and labelled ones only up to JAR_LABEL_MAX. */
export const JAR_MAX_ENTRIES = 300;
export const JAR_LABEL_MAX = 40;

/** A seed from random bytes (the page passes crypto.getRandomValues(new Uint8Array(SEED_LENGTH))). Also a draw id. */
export function seedFromBytes(bytes){
  return [...bytes].map(b => SEED_ALPHABET[b % SEED_ALPHABET.length]).join('');
}

/** One entry, or a prize name, as the draw uses it: every run of white space one space, trimmed. */
export function cleanEntry(s){ return String(s ?? '').replace(/\s+/g, ' ').trim(); }

/**
 * Names in order. A name already in the list (the same person by attendanceKey: accents, case and spacing ignored)
 * is dropped and reported in `merged`, so a person is never in the draw twice.
 * @param {string[]} names
 * @returns {{ entries: string[], merged: string[] }}
 */
export function uniqueEntries(names){
  const seen = new Set(), entries = [], merged = [];
  for(const raw of names){
    const e = cleanEntry(raw);
    if(!e) continue;
    const k = attendanceKey(e);
    if(seen.has(k)){ merged.push(e); continue; }
    seen.add(k);
    entries.push(e);
  }
  return { entries, merged };
}

/** The Names box's text as entries: one per line, blank lines ignored. */
export function parseEntries(text){ return uniqueEntries(String(text ?? '').split(/\r?\n/)); }

/** Why this list can't be locked, as sentences, or [] when it can. */
export function entryProblems(entries){
  const out = [];
  if(entries.length < 2) out.push('A draw needs at least 2 entries.');
  if(entries.length > MAX_ENTRIES) out.push(`A draw takes at most ${MAX_ENTRIES} entries; this list has ${entries.length}.`);
  const long = entries.filter(e => e.length > MAX_ENTRY_LENGTH);
  if(long.length) out.push(`Shorten ${long.length === 1 ? 'this entry' : 'these entries'} to ${MAX_ENTRY_LENGTH} characters or fewer: ${long.join(', ')}.`);
  const bars = entries.filter(e => e.includes('|'));
  if(bars.length) out.push(`An entry can't contain "|": ${bars.join(', ')}.`);
  return out;
}

/** "001" to "<count>", for a raffle of numbered stubs. At least three digits. */
export function numberEntries(count){
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const width = Math.max(3, String(n).length);
  return Array.from({ length: n }, (_, i) => String(i + 1).padStart(width, '0'));
}

/** An entry's ticket number: its place in the locked list, at least three digits ("007"). */
export function ticketOf(entries, entry){
  const i = entries.indexOf(entry);
  if(i < 0) return '';
  return String(i + 1).padStart(Math.max(3, String(entries.length).length), '0');
}

/** True when every entry is a ticket number already (a Numbers list), so nothing shows "#047" twice. */
export function isNumberList(entries){ return entries.length > 0 && entries.every(e => /^\d+$/.test(e)); }

/**
 * Every player on a day, from its published snapshot: a team event's rosters (rosterCsv), otherwise each pair's two
 * players from standingsCsv (player1, player2), BYE rows left out. Facility order, then sheet order; one entry per
 * person.
 * @param {{ facilities?: object[] }|null} snapshot
 * @param {'standard'|'dual-meet'|'team'|null} type
 * @returns {string[]}
 */
export function playersFromSnapshot(snapshot, type){
  if(type === 'team') return uniqueEntries(buildTeamRoster(snapshot).roster.map(r => r.player)).entries;
  const names = [];
  for(const f of (snapshot && snapshot.facilities) || []){
    const rows = parseCSV(f.standingsCsv || '');
    if(rows.length < 2) continue;
    const head = rows[0].map(h => h.trim());
    const iCode = head.indexOf('teamCode'), i1 = head.indexOf('player1'), i2 = head.indexOf('player2');
    if(i1 < 0) continue;
    for(const r of rows.slice(1)){
      const code = (r[iCode] || '').trim(), p1 = (r[i1] || '').trim(), p2 = i2 < 0 ? '' : (r[i2] || '').trim();
      if(BYE_RE.test(code) || BYE_RE.test(p1) || BYE_RE.test(p2)) continue;
      names.push(p1, p2);
    }
  }
  return uniqueEntries(names).entries;
}

/**
 * Everyone checked in, from each facility's people (GET .../people): present and not withdrawn, in roster order.
 * @param {object[][]} lists  one array of people per facility
 * @returns {string[]}
 */
export function checkedInFromPeople(lists){
  return uniqueEntries(lists.flat().filter(p => p && p.present === true && p.withdrawn !== true)
    .map(p => p.player || p.key)).entries;
}

/** The text the list's fingerprint is taken over: the entries in order, one per line, no line break at the end. */
export function listText(entries){ return entries.join('\n'); }

/**
 * Why these prize rows can't be used, as sentences, or [] when they can. A row is { id, name, quantity, together }.
 * @param {{ name: string, quantity: number }[]} rows
 */
export function prizeProblems(rows){
  const out = [];
  if(rows.length > MAX_PRIZE_ROWS) out.push(`List at most ${MAX_PRIZE_ROWS} prizes; this list has ${rows.length}.`);
  if(rows.some(r => !cleanEntry(r.name))) out.push('Give every prize a name, or remove its row.');
  const long = rows.filter(r => cleanEntry(r.name).length > MAX_PRIZE_LENGTH);
  if(long.length) out.push(`Shorten ${long.length === 1 ? 'this prize' : 'these prizes'} to ${MAX_PRIZE_LENGTH} characters or fewer: ${long.map(r => cleanEntry(r.name)).join(', ')}.`);
  if(rows.some(r => !Number.isInteger(r.quantity) || r.quantity < 1 || r.quantity > MAX_QUANTITY)) out.push(`Each quantity is a whole number from 1 to ${MAX_QUANTITY}.`);
  const total = rows.reduce((n, r) => n + (Number.isInteger(r.quantity) ? r.quantity : 0), 0);
  if(total > MAX_PRIZES) out.push(`At most ${MAX_PRIZES} prizes in all; these rows add up to ${total}.`);
  return out;
}

/**
 * The prizes to draw, one slot per unit, in row order: "Ball pack (1 of 3)", "Ball pack (2 of 3)" … and a plain name
 * for a quantity of 1. A slot's id is "<row id>:<unit>", so a slot keeps its identity when the rows are reordered.
 * @param {{ id: string, name: string, quantity: number, together: boolean }[]} rows
 * @returns {{ id: string, rowId: string, label: string, together: boolean }[]}
 */
export function prizeSlots(rows){
  return rows.flatMap(r => Array.from({ length: r.quantity }, (_, i) => ({
    id: `${r.id}:${i + 1}`,
    rowId: r.id,
    label: r.quantity > 1 ? `${cleanEntry(r.name)} (${i + 1} of ${r.quantity})` : cleanEntry(r.name),
    together: r.together === true,
  })));
}

/**
 * Who is still in the draw. `earlier` is every pick before the spin, as { winner, result: 'won' | 'redrawn' }. A
 * redrawn winner is always out; a winner who took a prize is out under 'remove-winners' and stays in under
 * 'keep-winners'. Also the list a continued draw starts from (§5.9).
 * @param {string[]} entries @param {{ winner: string, result: string }[]} earlier
 * @param {'remove-winners'|'keep-winners'} rule
 */
export function entrantsFor(entries, earlier, rule){
  const out = new Set(earlier.filter(s => s.result === 'redrawn' || rule === 'remove-winners').map(s => s.winner));
  return entries.filter(e => !out.has(e));
}

/**
 * What the next spin draws for, from the prize slots in their current order and every pick so far (a continued
 * draw's included). A slot is used once a pick with its slotId won it. The next slot is the first unused one; a
 * spin draws it alone, or, when its row is drawn all at once, every unused slot of that row.
 *   no prize list           -> { count: 1, slots: [] }   (spin as often as you like)
 *   every prize won         -> { count: 0, slots: [] }
 * @param {{ id: string, rowId: string, together: boolean }[]} slots
 * @param {{ slotId?: string, result: string }[]} picks
 */
export function nextSpin(slots, picks){
  if(!slots.length) return { count: 1, slots: [] };
  const used = new Set(picks.filter(p => p.result === 'won').map(p => p.slotId));
  const open = slots.filter(s => !used.has(s.id));
  if(!open.length) return { count: 0, slots: [] };
  const take = open[0].together ? open.filter(s => s.rowId === open[0].rowId) : [open[0]];
  return { count: take.length, slots: take };
}

/**
 * Spin n's winners: the `count` entrants with the smallest SHA-256(seed|n|entry), smallest first. Fewer when fewer
 * are left; [] when nobody is.
 * @param {{ seed: string, spin: number, entrants: string[], count: number, sha256Hex: (s: string) => Promise<string> }} a
 * @returns {Promise<{ winner: string, key: string }[]>}
 */
export async function drawWinners({ seed, spin, entrants, count, sha256Hex }){
  const keys = await Promise.all(entrants.map(e => sha256Hex(`${seed}|${spin}|${e}`)));
  return entrants.map((winner, i) => ({ winner, key: keys[i] }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, Math.max(0, count));
}

/** True when a prize list is set and every prize is won, or nobody is left to draw. */
export function drawFinished({ entries, slots, picks, allPicks = picks, rule }){
  if(nextSpin(slots, allPicks).count === 0) return true;
  return entrantsFor(entries, picks, rule).length === 0;
}

/**
 * Replays a recorded draw. Picks are grouped by spin; each spin's winners must be the k smallest keys among who was
 * still in, where k is how many winners it recorded, in place order (1, 2 …). Spins must run 1, 2, 3 ….
 * @param {{ entries: string[], seed: string, rule: string, picks: { spin: number, place: number, winner: string, result: string }[],
 *           sha256Hex: (s: string) => Promise<string> }} a
 * @returns {Promise<{ spin: number, place: number, expected: string|null, recorded: string, ok: boolean }[]>}
 */
export async function verifyDraw({ entries, seed, rule, picks, sha256Hex }){
  const spins = [...new Set(picks.map(p => p.spin))].sort((a, b) => a - b);
  const out = [];
  const earlier = [];
  for(let i = 0; i < spins.length; i++){
    const these = picks.filter(p => p.spin === spins[i]).sort((a, b) => a.place - b.place);
    const got = await drawWinners({ seed, spin: spins[i], entrants: entrantsFor(entries, earlier, rule), count: these.length, sha256Hex });
    these.forEach((p, j) => {
      const expected = got[j] ? got[j].winner : null;
      out.push({ spin: p.spin, place: p.place, expected, recorded: p.winner, ok: spins[i] === i + 1 && p.place === j + 1 && expected === p.winner });
    });
    earlier.push(...these);
  }
  return out;
}

/**
 * The draw as plain text, for Copy results and the text download (§5.13).
 * @param {{ title: string, eventLine: string, seed: string, fingerprint: string, rule: string, entries: string[],
 *           picks: { spin: number, place: number, prize: string, winner: string, result: string }[] }} d
 */
export function drawText(d){
  const numbers = isNumberList(d.entries);
  const who = w => numbers ? `#${w}` : w;
  const lines = ['S.A.G.E. LUCKY DINK'];
  lines.push([d.title, d.eventLine].filter(Boolean).join(' · ') || 'Prize draw');
  lines.push(`Draw code: ${d.seed}`);
  lines.push(`List: ${d.entries.length} entries · fingerprint ${d.fingerprint.slice(0, 8)}`);
  lines.push(d.rule === 'remove-winners' ? 'Each winner leaves the draw.' : 'Winners stay in the draw.');
  lines.push('');
  const picks = [...d.picks].sort((a, b) => a.spin - b.spin || a.place - b.place);
  for(const p of picks){
    const prize = p.prize ? `${p.prize}: ` : '';
    lines.push(`Spin ${p.spin} · ${prize}${who(p.winner)}${p.result === 'redrawn' ? ' (drawn again)' : ''}`);
  }
  if(!picks.length) lines.push('No spins yet.');
  lines.push('', 'Check it at sage-match-control.github.io/tools/prize-draw');
  return lines.join('\n');
}
