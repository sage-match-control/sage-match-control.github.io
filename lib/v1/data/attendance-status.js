// The day's attendance lists, kept current for pages that only show who is not in yet
// (sage-docs/docs/specs/.../mission-control-layout-spec.md §8): Control Center's marks and the
// schedule board's staff view. Read through sage-tools-api with the operator's token; re-read on
// an attendance nudge, when the page comes back into view, and when the socket reconnects.
// Nothing polls. A failed read keeps that facility's last list and says nothing.
import { parseAttendanceCsv } from '../domain/attendance.js';
import { attendanceIndex } from '../domain/attendance-marks.js';
import { createAttendanceSignal } from './attendance-signal.js';

// GET one facility's people. A copy of views/attendance-view.js's fetchPeople: data/ may not import views/.
async function readPeople({ apiBase, token, day, facility }){
  const url = `${apiBase}/v3/days/${encodeURIComponent(day)}/facilities/${encodeURIComponent(facility)}/people`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` }, cache: 'no-store' });
  if(!res.ok){ const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
  return res.json();
}

async function readFixture(event, facility, fixture){
  const slug = facility.toLowerCase().replace(/\s+/g, '-');
  const res = await fetch(`/_fixtures/${encodeURIComponent(event)}/attendance-${encodeURIComponent(slug)}-${encodeURIComponent(fixture)}.csv`, { cache: 'no-store' });
  if(res.status === 400 || res.status === 404) return [];
  if(!res.ok){ const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
  return parseAttendanceCsv(await res.text());
}

/**
 * @param {{ apiBase: string, getToken: () => (string|null), event: string, day: string,
 *           facilities: string[], liveBaseUrl?: string, fixture?: string|null,
 *           onChange: () => void }} options
 *   getToken    the operator's token now, or null: nothing is read (a fixture reads without one)
 *   onChange    called after any facility's list changed what index() returns
 * @returns {{ index(): Map|null, people(facility): object[]|null, reload(): void, close(): void }}
 *   index()     attendanceIndex of every list read so far, or null before the first one arrives
 *   people(f)   that facility's last list, or null before it arrives
 */
export function createAttendanceStatus(options){
  const { apiBase, getToken, event, day, facilities, liveBaseUrl = '', fixture = null, onChange } = options;
  const lists = new Map();      // facility -> Person[]
  let index = null, closed = false, wasOpen = null;

  async function load(facility){
    const token = getToken();
    if(closed || (!token && !fixture)) return;
    try{
      const people = fixture ? await readFixture(event, facility, fixture) : await readPeople({ apiBase, token, day, facility });
      if(closed || !Array.isArray(people)) return;
      lists.set(facility, people);
      index = attendanceIndex([...lists.values()]);
      onChange();
    }catch(e){ /* keep the last list (D21) */ }
  }
  const loadAll = () => { facilities.forEach(f => { load(f); }); };

  const signal = createAttendanceSignal({
    baseUrl: liveBaseUrl, enabled: !!liveBaseUrl && !fixture, event, day,
    onChange: f => { if(facilities.includes(f)) load(f); },
    onStatus: open => { if(open && wasOpen === false) loadAll(); wasOpen = open; },
  });
  const onVisible = () => { if(document.visibilityState === 'visible') loadAll(); };
  document.addEventListener('visibilitychange', onVisible);
  loadAll();

  return {
    index: () => index,
    people: facility => lists.get(facility) || null,
    reload: loadAll,
    close(){ closed = true; signal.close(); document.removeEventListener('visibilitychange', onVisible); },
  };
}
