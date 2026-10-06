// Fixtures (site-engine-spec §6.2): the published snapshots of the finished
// events, and the three states every case runs each one in.
//
//   final  the snapshot as published
//   pre    every score and every live-court cell blanked, completedAt removed
//   mid    scores kept on the lower-numbered half of the matches only; the two
//          lowest-numbered unplayed matches get a live court
//
// standingsCsv is left as published in all three: the harness compares two
// renderings of one input, so the input need not be internally consistent.
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES_DIR } from './paths.mjs';
import { numberRepeatedPairs, PAIRS } from '../../lib/v1/domain/teams.js';

/** The fixture snapshots, by event key. `day` is the day key, `date` its date in config.json. */
export const SNAPSHOTS = {
  'piggleball-2026': { day: 'piggleball-day1', file: 'piggleball-2026/piggleball-day1.json' },
  'pickle-for-sight-2026': { day: 'pickle-for-sight-day1', file: 'pickle-for-sight-2026/pickle-for-sight-day1.json' },
  'pnf-x-bup-dual-meet': { day: 'pnf-x-bup-day1', file: 'pnf-x-bup-dual-meet/pnf-x-bup-day1.json' },
  'pickledrive-anniversary-2026': {
    day: 'pickledrive-anniversary-2026-day1',
    file: 'pickledrive-anniversary-2026/pickledrive-anniversary-2026-day1.json',
  },
  // Fixture only, never in event-data: a team event of another shape (8 teams, 3 pairs, SF-A seeded)
  // so the team pages are checked on more than PickleDrive's day (team-tournament-template-spec §10.2).
  'team-demo-2026': { day: 'team-demo-2026-day1', file: 'team-demo-2026/team-demo-2026-day1.json' },
};

export const STATES = ['final', 'pre', 'mid'];

export function loadRegistry() {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'config.json'), 'utf8'));
}

export function loadSnapshot(eventKey) {
  const entry = SNAPSHOTS[eventKey];
  if (!entry) throw new Error(`no fixture snapshot for ${eventKey}`);
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, entry.file), 'utf8'));
}

// ---- CSV (the harness's own: lib/v1/domain/csv.js does not exist yet) ------

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function toCsv(rows) {
  const cell = v => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map(r => r.map(cell).join(',')).join('\n') + '\n';
}

// ---- states ------------------------------------------------------------------

function deriveMatchesCsv(csv, state) {
  const rows = parseCsv(csv).filter(r => r.length > 1 || (r[0] || '') !== '');
  const header = rows[0].map(h => h.trim());
  const col = name => header.indexOf(name);
  const iNum = col('matchNumber'), iCourt = col('court'), iS1 = col('team1Score'), iS2 = col('team2Score');
  const iAssigned = col('CourtAssignment');
  const body = rows.slice(1);
  const order = body
    .map((r, at) => ({ at, num: parseInt(r[iNum], 10) }))
    .filter(x => x.num)
    .sort((a, b) => a.num - b.num);

  if (state === 'pre') {
    for (const r of body) { r[iS1] = ''; r[iS2] = ''; if (iCourt > -1) r[iCourt] = ''; }
  } else if (state === 'mid') {
    const keep = new Set(order.slice(0, Math.ceil(order.length / 2)).map(x => x.at));
    const unplayed = order.filter(x => !keep.has(x.at)).slice(0, 2);
    body.forEach((r, at) => {
      if (!keep.has(at)) { r[iS1] = ''; r[iS2] = ''; }
      if (iCourt > -1) r[iCourt] = '';
    });
    unplayed.forEach(x => {
      const assigned = iAssigned > -1 ? (body[x.at][iAssigned] || '').trim() : '';
      const n = assigned.match(/\d+/);
      if (iCourt > -1) body[x.at][iCourt] = n ? n[0] : assigned || '1';
    });
  }
  return toCsv([rows[0], ...body]);
}

/** A copy of `snapshot` in `state`. `final` is returned as published, copied. */
export function deriveState(snapshot, state) {
  const copy = JSON.parse(JSON.stringify(snapshot));
  if (state === 'final') return copy;
  if (!STATES.includes(state)) throw new Error(`unknown state ${state}`);
  for (const f of copy.facilities || []) {
    f.matchesCsv = deriveMatchesCsv(f.matchesCsv, state);
    delete f.completedAt;
  }
  return copy;
}

/** The day's date ("YYYY-MM-DD") for a day key, from the fixture registry. */
export function dayDate(registry, eventKey, dayKey) {
  const day = registry.events[eventKey]?.days?.[dayKey];
  if (!day) throw new Error(`no day ${dayKey} in ${eventKey}`);
  return day.date;
}

/** An EventConfig (lib/v1/domain/model.js) for a fixture event, read from the fixture registry. */
export function eventConfig(eventKey) {
  const e = loadRegistry().events[eventKey];
  if (!e) throw new Error(`no fixture event ${eventKey}`);
  return {
    key: eventKey,
    type: e.type,
    title: e.title,
    days: Object.entries(e.days).map(([key, d]) => ({ key, label: d.label, date: d.date, facilities: d.facilities.map(f => f.name) })),
    display: e.display || {},
    pairs: e.display && e.display.pairs ? numberRepeatedPairs(e.display.pairs) : PAIRS,
    scoreEntry: e.scoreEntry,
    attendance: e.attendance,
  };
}

/** The instant the cases run at for a fixture event: the day's date, 13:00 Manila. */
export function caseTime(eventKey) {
  const { days } = eventConfig(eventKey);
  return Date.parse(`${days[0].date}T13:00:00+08:00`);
}
