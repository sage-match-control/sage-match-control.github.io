// Who on a match or a facility's list is not checked in yet (sage-docs/docs/specs/.../mission-control-layout-spec.md §7).
// The roster's keys come from sage-tools-api (src/attendance/domain/personKey.mjs); attendanceKey is
// the same rule, kept in step by _tests/unit/parity-person-key.test.mjs.

/** A person's key: their name with accents, case and spacing ignored. The server's personKey, exactly. */
export function attendanceKey(name){
  return String(name ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * One lookup for the whole day, from every facility's people (Person[] arrays).
 * key -> { present, withdrawn }: present if present at any facility; withdrawn only if withdrawn at every one it is on.
 * @param {object[][]} lists
 * @returns {Map<string, { present: boolean, withdrawn: boolean }>}
 */
export function attendanceIndex(lists){
  const index = new Map();
  for(const people of lists || []){
    for(const p of people || []){
      if(!p || !p.key) continue;
      const was = index.get(p.key);
      index.set(p.key, was
        ? { present: was.present || !!p.present, withdrawn: was.withdrawn && !!p.withdrawn }
        : { present: !!p.present, withdrawn: !!p.withdrawn });
    }
  }
  return index;
}

/** True when the name is on the roster, not withdrawn and not present. A name not on it (TBD, BYE) is false. */
export function isNotIn(index, name){
  const e = index && index.get(attendanceKey(name));
  return !!e && !e.withdrawn && !e.present;
}

/** How many different players on an unplayed match are not in; 0 for a played match. */
export function matchNotInCount(m, index){
  if(!m || m.played || !index) return 0;
  const keys = new Set();
  for(const name of [m.t1p1, m.t1p2, m.t2p1, m.t2p2]){
    if(isNotIn(index, name)) keys.add(attendanceKey(name));
  }
  return keys.size;
}

/** How many different, non-withdrawn people on one facility's list are not present. */
export function facilityNotInCount(people){
  const keys = new Set();
  for(const p of people || []) if(p && p.key && !p.withdrawn && !p.present) keys.add(p.key);
  return keys.size;
}
