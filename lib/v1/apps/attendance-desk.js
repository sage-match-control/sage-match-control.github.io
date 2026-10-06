// The attendance desk page: staff check-in with a desk link. One link per event day, scoped to marking
// attendance and nothing else, expiring at the end of that day. Linked from nowhere public; Control Center's
// Issue desk link produces the link. See sage-docs/docs/specs/.../multi-event-attendance-spec.md §6.4.
//
// The page is a shell (site-engine-spec §4.5): its markup, its theme and one call to mountAttendanceDesk.
//
//   mountAttendanceDesk({ eventKey })
//     eventKey  required. The event's key in events.json; also the namespace of the stored desk link

import { attParseCsv, defaultCategoryLabel } from '../domain/attendance.js';
import { CLOUD_RUN_BASE_URL, ATTENDANCE_POLL_MS, fixtureName } from '../platform.js';
import { loadRegistry } from '../data/registry.js';
import { fetchDaySnapshotFromPages } from '../data/snapshot.js';
import { deskDecode, deskLoadToken } from '../data/tokens.js';
import { createAttendanceView } from '../views/attendance-view.js';

const KNOWN_SETTINGS = ['eventKey'];

export async function mountAttendanceDesk(settings = {}){
  for(const name of Object.keys(settings)){
    if(!KNOWN_SETTINGS.includes(name)){
      console.error(`mountAttendanceDesk: unknown setting "${name}" (known: ${KNOWN_SETTINGS.join(', ')})`);
      return;
    }
  }
  const EVENT_KEY = settings.eventKey;
  if(!EVENT_KEY){
    console.error('mountAttendanceDesk: the setting "eventKey" is required');
    return;
  }

  // Local testing only: on localhost, ?fixture=<name> reads /_fixtures/ instead of the published data and marks in
  // memory (lib/v1/platform.js). Inert on the live site.
  const FIXTURE = fixtureName();

  const deskMessageEl = document.getElementById('deskMessage');
  const deskRootEl = document.getElementById('deskRoot');
  function deskSay(text){ deskMessageEl.textContent = text; }

  const token = deskLoadToken(EVENT_KEY);
  const info = token ? deskDecode(token) : null;
  if(!info || Date.now() >= info.exp){
    deskSay('Ask the operator for a desk link.');
    return;
  }

  let entry;
  try{
    const config = await loadRegistry({ fixture: FIXTURE });
    entry = config.events && config.events[EVENT_KEY];
  }catch(err){
    deskSay(`Could not load this event (${err.message.replace(/^HTTP (\d+)$/, 'replied $1')}). Check this device's connection and reload.`);
    return;
  }
  if(!entry || entry.attendance !== 'desks'){
    deskSay('Check-in for this event is handled by staff.');
    return;
  }
  const dayEntry = entry.days && entry.days[info.day];
  if(!dayEntry){
    deskSay('This desk link does not match a day of this event. Ask the operator for a new one.');
    return;
  }
  document.getElementById('dayLabel').textContent = ` · ${dayEntry.label || info.day}`;

  // Team events name their teams in the published standings (teamCode,teamName,…). Read once; if it cannot be
  // read the page shows "Team <code>" instead.
  const teamNames = {};
  if(entry.type === 'team'){
    try{
      const snapshot = await fetchDaySnapshotFromPages(EVENT_KEY, info.day, { fixture: FIXTURE });
      (snapshot.facilities || []).forEach(f => {
        const rows = attParseCsv(f.standingsCsv || '');
        const head = (rows[0] || []).map(h => h.trim());
        const iCode = head.indexOf('teamCode'), iName = head.indexOf('teamName');
        if(iCode === -1 || iName === -1) return;
        rows.slice(1).forEach(r => { if(r[iCode] && r[iName] && r[iName].trim()) teamNames[r[iCode].trim()] = r[iName].trim(); });
      });
    }catch(err){ /* team codes stand in for names */ }
  }

  createAttendanceView({
    root: deskRootEl,
    mode: 'desk',
    apiBase: CLOUD_RUN_BASE_URL,
    pollMs: ATTENDANCE_POLL_MS,
    getToken: () => token,
    event: EVENT_KEY,
    day: info.day,
    facilities: dayEntry.facilities || [],
    type: entry.type,
    teamName: code => teamNames[code] || null,
    categoryLabel: code => defaultCategoryLabel(code, entry.display || {}),
    fixture: FIXTURE,
  });
}
