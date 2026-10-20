// A team event's lineup rules (events.json lineupRules; sage-docs/docs/specs/.../millennium-invitational-spec.md):
// what each pair of a matchup may be, checked against the roster's gender and level, and that every player plays
// once a round. Pure: Control Center draws what it finds, as warnings an operator can act on. Nothing here blocks
// a lineup; an emergency (an injured player replaced) may break a rule on purpose.
//
// lineupRules = {
//   pairs:           { "<pair number>": "mens-high" | "mixed" | "womens" | "open" },
//   advancedLevels:  ["HA", "HI"]   the roster levels that count as advanced for "mens-high", compared
//                                   case-insensitively; empty or absent, the level isn't checked
//   captainNotMixed: true           a team's captain, the first player in its roster, may not play "mixed"
//   allowed:         { "<player>": ["womens"] }   a player the organiser lets into a pair kind whatever its gender
//                                   rule says (the Millennium Invitational's Gian, a man who may play Women's)
// }
//
// A round is a matchup (its four games, in two time slots). A player is matched to the roster by name, ignoring
// case and extra spaces. A check needs what it reads: with no roster for the team, or no gender or level for a
// player, that check is skipped rather than guessed.

import { parseSideCode, baseTeamOf } from './teams.js';

export const LINEUP_RULE_KINDS = ['mens-high', 'mixed', 'womens', 'open'];

const KIND_LABEL = { 'mens-high': "Men's High", 'mixed': 'Mixed', 'womens': "Women's", 'open': 'Genderless' };

/**
 * events.json's lineupRules, checked: { pairs, advancedLevels, captainNotMixed, allowed }, or null when the event
 * has none or they aren't an object. A pair whose kind isn't one of LINEUP_RULE_KINDS is left out, and so is an
 * allowed kind; `allowed` is keyed by the player's name as the roster matches it (case and spaces ignored).
 */
export function lineupRulesFrom(raw){
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const pairs = {};
  if(raw.pairs && typeof raw.pairs === 'object'){
    for(const [n, kind] of Object.entries(raw.pairs)){
      if(/^[0-9]+$/.test(n) && LINEUP_RULE_KINDS.includes(kind)) pairs[n] = kind;
    }
  }
  const advancedLevels = Array.isArray(raw.advancedLevels)
    ? raw.advancedLevels.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim().toLowerCase())
    : [];
  const allowed = {};
  if(raw.allowed && typeof raw.allowed === 'object' && !Array.isArray(raw.allowed)){
    for(const [name, kinds] of Object.entries(raw.allowed)){
      const list = Array.isArray(kinds) ? kinds.filter(k => LINEUP_RULE_KINDS.includes(k)) : [];
      if(nameKey(name) && list.length) allowed[nameKey(name)] = list;
    }
  }
  return { pairs, advancedLevels, captainNotMixed: raw.captainNotMixed === true, allowed };
}

const nameKey = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const genderOf = g => /^(m|male|man|men)$/i.test(String(g || '').trim()) ? 'M'
  : /^(f|female|w|woman|women)$/i.test(String(g || '').trim()) ? 'F' : null;
const times = n => n === 2 ? 'twice' : `${n} times`;
const listNames = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/**
 * Every lineup issue on the day, by match number: Map<num, { side: 1|2, team, text }[]>. `team` is the
 * group-stage team code (null for a playoff slot whose team isn't typed in yet).
 *
 * @param {object[]} matches       the DayModel's matches (t1, t1p1, t1p2, t2, t2p1, t2p2, matchUp, num)
 * @param {Map<string, object[]>} rosterByCode   team code -> roster rows in sheet order ({ player, level, gender })
 * @param {Map<string, object>} rowByCode        the day's standings rows by code, to resolve a playoff side
 * @param {object|null} rules      lineupRulesFrom's result
 */
export function lineupIssues(matches, rosterByCode, rowByCode, rules){
  const out = new Map();
  if(!rules) return out;
  const add = (num, side, team, text) => {
    if(!out.has(num)) out.set(num, []);
    const list = out.get(num);
    if(!list.some(x => x.side === side && x.text === text)) list.push({ side, team, text });
  };

  // Each side of each match that has a lineup: who plays, for which team, in which pair.
  const entries = [];
  for(const m of matches){
    [[1, m.t1, m.t1p1, m.t1p2], [2, m.t2, m.t2p1, m.t2p2]].forEach(([side, code, p1, p2]) => {
      if(!code) return;
      const parsed = parseSideCode(code);
      const unset = v => !v || v === 'TBD' || nameKey(v) === nameKey(code);
      if(unset(p1) && unset(p2)) return;
      const players = [p1, p2].filter(v => !unset(v)).map(v => String(v).trim().replace(/\s+/g, ' '));
      entries.push({ m, side, sideCode: parsed.side, pair: parsed.pair, team: baseTeamOf(parsed.side, rowByCode), players });
    });
  }

  // A team as a message names it: its name in the workbook, else its code (the Millennium Invitational's colours).
  const teamName = team => (team && rowByCode.get(team) && rowByCode.get(team).teamName) || team;
  const rosterIndex = team => {
    const list = (team && rosterByCode.get(team)) || [];
    const map = new Map();
    list.forEach((r, i) => { if(!map.has(nameKey(r.player))) map.set(nameKey(r.player), { ...r, index: i }); });
    return { list, map };
  };

  for(const e of entries){
    const { m, side, team, players } = e;
    const kind = e.pair !== null ? rules.pairs[String(e.pair)] : undefined;
    const { list, map } = rosterIndex(team);
    const found = players.map(p => ({ name: p, row: map.get(nameKey(p)) || null }));

    if(list.length) found.filter(f => !f.row).forEach(f => add(m.num, side, team, `${f.name} isn't on ${teamName(team)}'s roster`));
    if(players.length === 2 && nameKey(players[0]) === nameKey(players[1])) add(m.num, side, team, `${players[0]} is in this pair twice`);
    if(!kind || kind === 'open') continue;

    const label = KIND_LABEL[kind];
    // A player the organiser allows into this kind of pair is let off its gender rule.
    const exempt = f => (rules.allowed[nameKey(f.name)] || []).includes(kind);
    const known = found.filter(f => f.row && genderOf(f.row.gender) && !exempt(f));
    const g = f => genderOf(f.row.gender);
    if(kind === 'mens-high' || kind === 'womens'){
      const want = kind === 'mens-high' ? 'M' : 'F';
      const [one, many] = want === 'M' ? ['man', 'men'] : ['woman', 'women'];
      const wrong = known.filter(f => g(f) !== want).map(f => f.name);
      if(wrong.length) add(m.num, side, team, `${label} is two ${many}: ${listNames(wrong)} ${wrong.length === 1 ? `isn't a ${one}` : `aren't ${many}`}`);
    }
    if(kind === 'mens-high' && rules.advancedLevels.length && found.length === 2 && found.every(f => f.row && f.row.level)){
      if(!found.some(f => rules.advancedLevels.includes(String(f.row.level).trim().toLowerCase()))){
        add(m.num, side, team, `${label} needs an advanced player: neither ${found[0].name} nor ${found[1].name} is`);
      }
    }
    if(kind === 'mixed'){
      if(known.length === 2 && g(known[0]) === g(known[1])) add(m.num, side, team, `${label} is one man and one woman: ${known[0].name} and ${known[1].name} are both ${g(known[0]) === 'M' ? 'men' : 'women'}`);
      if(rules.captainNotMixed){
        found.filter(f => f.row && f.row.index === 0).forEach(f => add(m.num, side, team, `${f.name} is ${teamName(team)}'s captain, and a captain doesn't play ${label}`));
      }
    }
  }

  // One game per player per round: a player twice in a team's round, and, once every pair of the round is in, a
  // rostered player left out of it.
  const rounds = new Map();
  for(const e of entries){
    if(!e.m.matchUp) continue;
    const key = `${e.m.matchUp}\u0000${e.sideCode}`;
    if(!rounds.has(key)) rounds.set(key, []);
    rounds.get(key).push(e);
  }
  const pairCount = Object.keys(rules.pairs).length;
  for(const list of rounds.values()){
    const seen = new Map();
    list.forEach(e => e.players.forEach(p => {
      const k = nameKey(p);
      if(!seen.has(k)) seen.set(k, { name: p, nums: [] });
      seen.get(k).nums.push(e.m.num);
    }));
    for(const { name, nums } of seen.values()){
      if(nums.length < 2) continue;
      const team = list[0].team;
      nums.forEach(num => add(num, list.find(e => e.m.num === num).side, team,
        `${name} plays ${times(nums.length)} this round (#${listNames(nums.map(String)).replace(/, /g, ', #').replace(' and ', ' and #')})`));
    }
    const team = list[0].team;
    const roster = (team && rosterByCode.get(team)) || [];
    const full = list.length === pairCount && list.every(e => e.players.length === 2);
    if(full && roster.length === pairCount * 2){
      const missing = roster.filter(r => !seen.has(nameKey(r.player))).map(r => r.player);
      const first = list.slice().sort((a, b) => a.m.num - b.m.num)[0];
      if(missing.length) add(first.m.num, first.side, team, `${listNames(missing)} ${missing.length === 1 ? "doesn't" : "don't"} play this round`);
    }
  }
  return out;
}
