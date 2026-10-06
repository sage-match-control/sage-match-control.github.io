// Staff attendance: reading a workbook's ATTENDANCE tab and shaping it for the
// check-in desk (sage-docs/docs/specs/.../multi-event-attendance-spec.md §6.1).
//
// Person = { key, player, teams: string[], categories: string[], present,
//            timeIn, withdrawn, shirt }

export const ATTENDANCE_SHIRT_HEADERS = ['TShirt Size', 'T-Shirt Size', 'Shirt Size', 'tshirtSize', 'shirtSize'];

/** gviz quotes every cell and doubles an internal quote to escape it. */
export function attParseCsv(text){
  const rows = []; let row = [], cell = '', q = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(q){
      if(c === '"'){ if(text[i + 1] === '"'){ cell += '"'; i++; } else q = false; }
      else cell += c;
    }else if(c === '"') q = true;
    else if(c === ','){ row.push(cell); cell = ''; }
    else if(c === '\n'){ row.push(cell); rows.push(row); row = []; cell = ''; }
    else if(c !== '\r') cell += c;
  }
  if(cell || row.length){ row.push(cell); rows.push(row); }
  return rows;
}

/**
 * The tab stamps timeIn as "yyyy-MM-dd HH:mm" (Manila), but take the clock
 * part off the end and show it the way a marshal reads a wall clock, so any
 * other shape still reads sensibly. Anything unexpected falls back to the raw tail.
 */
export function attClockTime(raw){
  const t = String(raw || '');
  const m = t.match(/([0-9]{1,2}):([0-9]{2})(?::[0-9]{2})?[ ]*([AaPp])?[.]?[Mm]?[.]?[ ]*$/);
  if(!m) return t.slice(-5);
  let h = Number(m[1]);
  const half = m[3] && m[3].toUpperCase();
  if(half){
    if(h === 12) h = half === 'A' ? 0 : 12;
    else if(half === 'P') h += 12;
  }
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

export function attSplitList(v){
  return String(v || '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * gviz CSV -> people[], one per FIRST row of each non-blank key. A text with
 * no header row (no ATTENDANCE tab yet) gives [].
 */
export function parseAttendanceCsv(text){
  const rows = attParseCsv(String(text || ''));
  const head = (rows[0] || []).map(h => String(h).trim());
  const col = name => head.indexOf(name);
  const iKey = col('key');
  if(iKey === -1) return [];
  const iShirt = ATTENDANCE_SHIRT_HEADERS.map(col).find(i => i !== -1);
  const seen = new Set();
  const people = [];
  rows.slice(1).forEach(r => {
    const key = String(r[iKey] || '').trim();
    if(!key || seen.has(key)) return;
    seen.add(key);
    people.push({
      key,
      player: String(r[col('player')] || '').trim() || key,
      teams: attSplitList(r[col('teams')]),
      categories: attSplitList(r[col('categories')]),
      present: r[col('present')] === 'TRUE',
      timeIn: String(r[col('timeIn')] || '').trim(),
      withdrawn: r[col('withdrawn')] === 'TRUE',
      shirt: iShirt === undefined ? '' : String(r[iShirt] || '').trim(),
    });
  });
  return people;
}

/**
 * "<division label> <event label>" for a code like NMD (division N + event MD),
 * from an event's display block; otherwise the code itself.
 */
export function defaultCategoryLabel(code, display){
  const divisions = (display && display.divisions) || {};
  const events = (display && display.events) || {};
  const keys = Object.keys(divisions).sort((a, b) => b.length - a.length);
  for(const d of keys){
    const rest = String(code).slice(d.length);
    if(String(code).startsWith(d) && Object.prototype.hasOwnProperty.call(events, rest)){
      return `${divisions[d]} ${events[rest]}`.trim();
    }
  }
  return code;
}

/**
 * What to list on the desk, grouped. Standard and dual meet: sections by
 * category (first-seen order), each holding a card per team code listing its
 * players; a person in two categories appears in both. Team events: a
 * section per team, one card each. Withdrawn people are left out unless
 * showWithdrawn. -> [{ id, label, cards: [{ teamCode, players: [person] }] }]
 */
export function groupForDesk(people, { type, teamName, categoryLabel, showWithdrawn } = {}){
  const sections = new Map();
  const section = (id, label) => {
    if(!sections.has(id)) sections.set(id, { id, label, cards: new Map() });
    return sections.get(id);
  };
  const addTo = (sec, teamCode, person) => {
    if(!sec.cards.has(teamCode)) sec.cards.set(teamCode, { teamCode, players: [] });
    const card = sec.cards.get(teamCode);
    if(!card.players.includes(person)) card.players.push(person);
  };
  (people || []).forEach(person => {
    if(person.withdrawn && !showWithdrawn) return;
    person.teams.forEach((teamCode, i) => {
      if(type === 'team'){
        addTo(section(teamCode, (teamName && teamName(teamCode)) || `Team ${teamCode}`), teamCode, person);
      }else{
        const code = person.categories[i] || String(teamCode).split('_')[0];
        addTo(section(code, categoryLabel ? categoryLabel(code) : code), teamCode, person);
      }
    });
  });
  return [...sections.values()].map(s => ({ id: s.id, label: s.label, cards: [...s.cards.values()] }));
}

export function attLettersOnly(s){ return String(s).replace(/[^\p{L}\p{N}]/gu, ''); }

/** True when a and b are exactly one insertion, deletion or substitution apart. */
export function attOneEditApart(a, b){
  if(a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while(i < a.length && i < b.length && a[i] === b[i]) i++;
  if(a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

/**
 * Pairs of people whose keys read as one name written two ways: equal once
 * spacing and punctuation go (dela cruz / delacruz), or both 5+ characters
 * and one edit apart. Listed for a person to judge; never merged.
 */
export function possibleDuplicates(people){
  const live = (people || []).filter(p => !p.withdrawn);
  const pairs = [];
  for(let i = 0; i < live.length; i++){
    for(let j = i + 1; j < live.length; j++){
      const a = live[i].key, b = live[j].key;
      const sameLetters = attLettersOnly(a) === attLettersOnly(b);
      const oneEdit = a.length >= 5 && b.length >= 5 && attOneEditApart(a, b);
      if(sameLetters || oneEdit) pairs.push([live[i], live[j]]);
    }
  }
  return pairs;
}

/**
 * People with two team codes that share a category: one row, but the same
 * name twice in one category is worth a look.
 */
export function sameNameSameCategory(people){
  return (people || []).filter(p => !p.withdrawn && new Set(p.categories).size !== p.categories.length);
}
