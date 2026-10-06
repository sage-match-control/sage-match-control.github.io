// Every page × fixture × state × view × viewport the harness compares
// (site-engine-spec §6.4). `buildCases()` generates them from the tables
// below; compare.test.mjs runs each one on the baseline tree and the branch
// tree and compares what they show.
//
// A case is:
//   { id, page, path, event, day, state, viewport, time, root,
//     instantiate, registry, snapshots, fixtureFiles, external, cloudRun,
//     allowErrors, storage, steps }
// `instantiate` ({ tokens, settings }) is for pages under _templates/, which
// the server fills in as it serves them (helpers/server.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT } from '../helpers/paths.mjs';
import { constValue } from '../helpers/extract.mjs';
import { loadRegistry, loadSnapshot, deriveState, parseCsv, toCsv, SNAPSHOTS, STATES } from '../helpers/fixtures.mjs';
import { click, clickNth, choose, enterScores, ifPresent, ifVisible, printMedia, saveScores, tab, type } from './steps.mjs';

export const VIEWPORTS = {
  phone: { width: 375, height: 812 },
  desktop: { width: 1280, height: 800 },
};

const SITE_FIXTURES = path.join(SITE_ROOT, '_fixtures');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

/** The clock a case starts at: the fixture day's date, 13:00 in Manila. */
const timeFor = (registry, event, day) => `${registry.events[event].days[day].date}T13:00:00+08:00`;

const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- the settings of each fixture event, read once from its own pages (§6.3) --

const FINISHED_PAGES = {
  'piggleball-2026': 'events/piggleball-2026',
  'pickle-for-sight-2026': 'events/pickle-for-sight-2026',
  'pnf-x-bup-dual-meet': 'events/pnf-x-bup-dual-meet',
};

// A fixture-only event has no finished pages to read its settings from.
const FIXED_SETTINGS = {
  'team-demo-2026': {
    DAY_KEY: 'team-demo-2026-day1',
    CAT_META: {
      G1: { short: 'BR 1', color: '#1155CC' },
      G2: { short: 'BR 2', color: '#B45F06' },
      G3: { short: 'BR 3', color: '#741B47' },
      G4: { short: 'BR 4', color: '#38761D' },
      PO: { short: 'PLAYOFFS', color: '#14263C' },
    },
  },
};

const settingsCache = new Map();

/** `{ DAYS, FACILITIES, DIVISIONS, EVENTS, CLUBS?, CAT_META, DAY_KEY }` from the finished event's index.html and schedule.html. */
function eventSettings(event) {
  if (settingsCache.has(event)) return settingsCache.get(event);
  if (FIXED_SETTINGS[event]) return FIXED_SETTINGS[event];
  const dir = FINISHED_PAGES[event];
  const index = read(SITE_ROOT, dir, 'index.html');
  const schedule = read(SITE_ROOT, dir, 'schedule.html');
  const clubs = constValue(index, 'CLUBS');
  if (clubs) {
    // Logo paths are relative to the event's own folder; the template is served from elsewhere.
    for (const club of Object.values(clubs)) if (club.logo && !club.logo.startsWith('/')) club.logo = `/${dir}/${club.logo}`;
  }
  const out = {
    DAYS: constValue(index, 'DAYS'),
    FACILITIES: constValue(index, 'FACILITIES'),
    DIVISIONS: constValue(index, 'DIVISIONS'),
    EVENTS: constValue(index, 'EVENTS'),
    CAT_META: constValue(schedule, 'CAT_META'),
    DAY_KEY: constValue(schedule, 'DAY_KEY'),
  };
  if (clubs) out.CLUBS = clubs;
  settingsCache.set(event, out);
  return out;
}

/** The `{{TOKEN}}` table for a template page of an event. HTML-escaped: tokens only land in markup. */
function tokensFor(event, registry) {
  const entry = registry.events[event];
  const [dayKey] = Object.keys(entry.days);
  const day = entry.days[dayKey];
  const settings = eventSettings(event);
  const clubs = settings.CLUBS ? Object.values(settings.CLUBS) : [];
  const [a, b] = clubs.length ? clubs : [{ name: 'AAA', full: 'Club A', logo: '/assets/logo.png' }, { name: 'BBB', full: 'Club B', logo: '/assets/logo.png' }];
  return {
    EVENT_KEY: event,
    EVENT_TITLE: escapeHtml(entry.title),
    EVENT_TAGLINE: 'Match schedule and live standings',
    EVENT_HEADLINE: '',
    EVENT_DATE_RANGE: escapeHtml(day.label),
    VENUE: escapeHtml(day.facilities[0].name),
    QR_IMAGE: '/assets/logo.png',
    QR_URL: 'tinyurl.com/<wbr>SAGExFixture',
    EVENT_LOGO: '/assets/logo.png',
    SCHEDULE_DAY_KEY: dayKey,
    CLUB_A_CODE: a.name,
    CLUB_B_CODE: b.name,
    CLUB_A_NAME: escapeHtml(a.full),
    CLUB_B_NAME: escapeHtml(b.full),
    CLUB_A_LOGO: a.logo,
    CLUB_B_LOGO: b.logo,
  };
}

const templateInstance = (event, registry) => ({ tokens: tokensFor(event, registry), settings: { EVENT_KEY: event, ...eventSettings(event) } });

// ---- data for a case --------------------------------------------------------------

const snapshotsFor = (events, state) => Object.fromEntries(
  events.map(event => [event, { [SNAPSHOTS[event].day]: deriveState(loadSnapshot(event), state) }]),
);

/** The first word (3+ letters) of the first listed player: what the search cases type. */
function firstPlayerWord(event) {
  const snap = loadSnapshot(event);
  const rows = parseCsv(snap.facilities[0].matchesCsv);
  const iPlayer = rows[0].indexOf('team1Player1');
  for (const row of rows.slice(1)) {
    const word = (row[iPlayer] || '').trim().split(/\s+/)[0];
    if (word && word.length >= 3) return word;
  }
  throw new Error(`no player to search for in ${event}`);
}

// ---- Cloud Run answers ------------------------------------------------------------

const scoreOk = { method: 'PUT', path: /\/v3\/days\/[^/]+\/facilities\/[^/]+\/matches\/\d+\/score$/, reply: () => ({ status: 200, body: { ok: true, unchanged: false, sync: { ok: true } } }) };
const scoreConflict = {
  method: 'PUT',
  path: scoreOk.path,
  reply: request => {
    const expected = JSON.parse(request.body).expected;
    return { status: 409, body: { error: 'The sheet changed since you opened this match.', code: 'score-conflict', current: { ...expected, team1Score: 11, team2Score: 9 } } };
  },
};
const attendanceOk = { method: 'PUT', path: /\/v3\/days\/[^/]+\/facilities\/[^/]+\/people\/[^/]+\/attendance$/, reply: () => ({ status: 200, body: { ok: true } }) };

// Control Center's signed-in Mission Control asks the API for these.
const signedInApi = [
  { method: 'GET', path: /\/v3\/diagnostics\/sync$/, reply: () => ({ status: 200, body: { live: { enabled: true, baseUrl: '', switch: null, active: true } } }) },
];

const token = (scope, day, expMs) =>
  Buffer.from(JSON.stringify({ scope, day, exp: expMs })).toString('base64url') + '.x';

// ---- page tables --------------------------------------------------------------------

const CONSOLE_409 = 'Failed to load resource: the server responded with a status of 409';
const CONSOLE_404 = 'Failed to load resource: the server responded with a status of 404';

const common = (c, extra) => ({ root: 'body', external: [], cloudRun: [], allowErrors: [], storage: {}, fixtureFiles: {}, ...c, ...extra });

function* hubCases(registry) {
  const pages = [
    { label: 'std-index', path: '/_templates/standard-tournament-template/index.html', events: ['piggleball-2026', 'pickle-for-sight-2026'] },
    { label: 'dm-index', path: '/_templates/dual-meet-template/index.html', events: ['pnf-x-bup-dual-meet'] },
  ];
  for (const p of pages) {
    for (const event of p.events) {
      const day = SNAPSHOTS[event].day;
      const word = firstPlayerWord(event);
      const views = [
        ['finder', []],
        ['finder-search', [type('#teamInput', word), click('#acList .ac-item')]],
        ['live', [tab('Live Matches')]],
        ['standings', [tab('Standings')]],
        ['standings-category-2', [tab('Standings'), ifVisible('#catFilterInput', click('#catFilterInput')), ifVisible('#catAcList .ac-item', clickNth('#catAcList .ac-item', 1))]],
      ];
      for (const state of STATES) for (const [vname, steps] of views) for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
        yield common({
          id: `${p.label}/${event}/${vname}/${state}/${vp}`, page: p.label, path: p.path, event, day, state, viewport,
          time: timeFor(registry, event, day), instantiate: templateInstance(event, registry), registry,
          snapshots: snapshotsFor([event], state), steps,
        });
      }
    }
  }
}

function* scheduleCases(registry) {
  const pages = [
    { label: 'std-schedule', path: '/_templates/standard-tournament-template/schedule.html', events: ['piggleball-2026', 'pickle-for-sight-2026'] },
    { label: 'dm-schedule', path: '/_templates/dual-meet-template/schedule.html', events: ['pnf-x-bup-dual-meet'] },
  ];
  for (const p of pages) {
    for (const event of p.events) {
      const day = SNAPSHOTS[event].day;
      const facilities = registry.events[event].days[day].facilities.map(f => f.name);
      const views = [
        ['default', '', []],
        ['compact', '?compact=1', []],
        ['print', '', [printMedia()]],
      ];
      if (p.label === 'std-schedule') {
        views.push(['courts-1-2', '?courts=1-2', []]);
        if (facilities.length > 1) views.push(['venue-2', `?venue=${encodeURIComponent(facilities[1])}`, []]);
      }
      for (const state of STATES) for (const [vname, query, steps] of views) for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
        yield common({
          id: `${p.label}/${event}/${vname}/${state}/${vp}`, page: p.label, path: p.path + query, event, day, state, viewport,
          time: timeFor(registry, event, day), instantiate: templateInstance(event, registry), registry,
          snapshots: snapshotsFor([event], state), steps,
        });
      }
    }
  }
}

function* controlCenterCases(registry) {
  const allEvents = Object.keys(SNAPSHOTS);
  const csv = read(SITE_FIXTURES, 'attendance-demo-2026', 'attendance-main-pre.csv');
  for (const event of allEvents) {
    const day = SNAPSHOTS[event].day;
    const entry = registry.events[event];
    const word = firstPlayerWord(event);
    const views = [
      ['mission-control', []],
      ['finder', [tab('Match Finder')]],
      ['finder-by-number', [tab('Match Finder'), type('#teamInput', '1'), click('#searchBtn')]],
      ['finder-search', [tab('Match Finder'), type('#teamInput', word), click('#acList .ac-item')]],
      ['live', [tab('Live Matches')]],
      ['standings', [tab('Standings')]],
      ['awards', [tab('Awards')]],
    ];
    if (entry.type === 'team') views.push(['teams', [tab('Teams')]]);
    if (entry.attendance) views.push(['attendance', [tab('Attendance')]]);
    for (const state of STATES) for (const [vname, steps] of views) for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
      yield common({
        id: `cc/${event}/${vname}/${state}/${vp}`, page: 'cc', path: '/tools/control-center', event, day, state, viewport,
        time: timeFor(registry, event, day), instantiate: null, registry, snapshots: snapshotsFor(allEvents, state),
        external: [{ match: /docs\.google\.com\/spreadsheets\/d\/test\//, contentType: 'text/csv', body: csv }],
        allowErrors: [CONSOLE_404],
        steps: [choose('#eventPicker', event), ...steps],
      });
    }
  }
}

function* controlCenterSignedInCases(registry) {
  const allEvents = Object.keys(SNAPSHOTS);
  const event = 'piggleball-2026';
  const day = SNAPSHOTS[event].day;
  const time = timeFor(registry, event, day);
  const storage = { session: { 'sage.authToken': JSON.stringify({ token: 'harness-operator-token', expiresAt: Date.parse(time) + 3600e3 }) } };
  const csv = read(SITE_FIXTURES, 'attendance-demo-2026', 'attendance-main-pre.csv');
  const views = [
    ['mission-control', []],
    ['score-entry-save', [tab('Match Finder'), type('#teamInput', '1'), click('#searchBtn'), click('.ticket.scoreable'), enterScores(11, 5), saveScores()]],
  ];
  for (const state of STATES) for (const [vname, steps] of views) for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
    yield common({
      id: `cc-signed-in/${event}/${vname}/${state}/${vp}`, page: 'cc', path: '/tools/control-center', event, day, state, viewport,
      time, instantiate: null, registry, snapshots: snapshotsFor(allEvents, state), storage,
      external: [{ match: /docs\.google\.com\/spreadsheets\/d\/test\//, contentType: 'text/csv', body: csv }],
      cloudRun: [...signedInApi, scoreOk],
      allowErrors: [CONSOLE_404],
      steps: [choose('#eventPicker', event), ...steps],
    });
  }
}

function* scorerCases(registry) {
  // Piggleball is a standard event; the team demo runs the team branches of the same page.
  for (const event of ['piggleball-2026', 'team-demo-2026']) {
    const day = SNAPSHOTS[event].day;
    const time = timeFor(registry, event, day);
    const patched = JSON.parse(JSON.stringify(registry));
    patched.events[event].scoreEntry = 'links';
    const link = token('score-desk', day, Date.parse(time) + 3600e3);
    // The first playable match: nothing to do (the same in both trees) when the state leaves none.
    const save = [click('.score-card.scoreable'), enterScores(11, 9), saveScores()].map(s => ifPresent('.score-card.scoreable', s));
    const views = [
      { name: 'list', steps: [], cloudRun: [scoreOk], allowErrors: [] },
      { name: 'court-filter', steps: [clickNth('.court-chip', 2)], cloudRun: [scoreOk], allowErrors: [] },
      { name: 'save', steps: save, cloudRun: [scoreOk], allowErrors: [] },
      { name: 'save-conflict', steps: save, cloudRun: [scoreConflict], allowErrors: [CONSOLE_409] },
    ];
    for (const state of STATES) for (const v of views) for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
      yield common({
        id: `scorer/${event}/${v.name}/${state}/${vp}`, page: 'scorer', path: `/_templates/scorer/scorer.html?scorer=${link}`, event, day, state, viewport,
        time, instantiate: templateInstance(event, registry), registry: patched, snapshots: snapshotsFor([event], state),
        cloudRun: v.cloudRun, allowErrors: v.allowErrors, steps: v.steps,
      });
    }
  }
}

/**
 * The desk page's backend, made fresh for every run (the two trees run a case
 * at the same time and must not share it): each venue's ATTENDANCE tab as a CSV
 * that a routed PUT changes, as the sheet would. `venues` is
 * `[{ name, sheetIdPrefix, file }]`: the facility name lower-cased is what the
 * PUT's path names, the prefix is the start of that venue's sheet ID.
 */
function attendanceBackend(event, venueList) {
  return () => {
    const venues = Object.fromEntries(venueList.map(v => [v.name.toLowerCase(), parseCsv(read(SITE_FIXTURES, event, v.file))]));
    const csvOf = name => toCsv(venues[name]);
    const external = venueList.map(v => ({
      match: new RegExp(`docs\\.google\\.com/spreadsheets/d/${v.sheetIdPrefix}`),
      contentType: 'text/csv',
      body: () => csvOf(v.name.toLowerCase()),
    }));
    const cloudRun = [{
      method: 'PUT',
      path: attendanceOk.path,
      reply: request => {
        const [, facility, key] = request.pathname.match(/\/facilities\/([^/]+)\/people\/([^/]+)\/attendance$/).map(decodeURIComponent);
        const rows = venues[facility.toLowerCase()];
        const header = rows[0];
        const iKey = header.indexOf('key'), iPresent = header.indexOf('present'), iTime = header.indexOf('timeIn');
        const { present } = JSON.parse(request.body);
        for (const row of rows.slice(1)) {
          if (row[iKey] !== key) continue;
          row[iPresent] = present ? 'TRUE' : 'FALSE';
          row[iTime] = present ? '2026-10-03 13:00' : '';
        }
        return { status: 200, body: { ok: true } };
      },
    }];
    return { external, cloudRun };
  };
}

function* attendanceCases() {
  // The attendance fixture events (site _fixtures/): a CSV per venue. The standard demo has two
  // venues, the team demo one.
  const fixtures = [
    {
      event: 'attendance-demo-2026', title: 'Attendance Demo', mark: click('input.att-switch[data-k="ben lim"]'),
      venues: [
        { name: 'main', sheetIdPrefix: 'FIXTUREMAINSHEETID', file: 'attendance-main-pre.csv' },
        { name: 'annex', sheetIdPrefix: 'FIXTUREANNEXSHEETID', file: 'attendance-annex-pre.csv' },
      ],
    },
    {
      event: 'team-demo-2026', title: 'Team Demo', mark: click('input.att-switch'), snapshot: true,
      venues: [{ name: 'Demo Courts', sheetIdPrefix: 'FIXTURETEAMSHEETID', file: 'attendance-demo-courts-pre.csv' }],
    },
  ];
  for (const { event, title, mark, venues, snapshot } of fixtures) {
    const day = SNAPSHOTS[event]?.day || `${event}-day1`;
    const patched = JSON.parse(read(SITE_FIXTURES, 'config.json'));
    patched.events[event].attendance = 'desks';
    const time = timeFor(patched, event, day);
    const link = token('attendance-desk', day, Date.parse(time) + 3600e3);
    const instantiate = { tokens: { EVENT_KEY: event, EVENT_TITLE: title }, settings: { EVENT_KEY: event } };
    const backend = attendanceBackend(event, venues);
    const views = [
      ['list', []],
      ['mark', [mark]],
      ['mark-then-unmark', [mark, mark]],
    ];
    // The fixture is the ATTENDANCE tabs as they stood before check-in ("pre"). A standard event's desk reads no
    // snapshot; a team event's reads it for the team names.
    for (const [vname, steps] of views) for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
      yield common({
        id: `attendance/${event}/${vname}/pre/${vp}`, page: 'attendance', path: `/_templates/attendance/attendance.html?desk=${link}`, event, day,
        state: 'pre', viewport, time, instantiate, registry: patched, snapshots: snapshot ? snapshotsFor([event], 'pre') : {}, backend, steps,
      });
    }
  }
}

export function buildCases() {
  const registry = loadRegistry();
  const cases = [
    ...hubCases(registry),
    ...scheduleCases(registry),
    ...controlCenterCases(registry),
    ...controlCenterSignedInCases(registry),
    ...scorerCases(registry),
    ...attendanceCases(),
  ];
  const ids = new Set();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
    ids.add(c.id);
  }
  return cases;
}

