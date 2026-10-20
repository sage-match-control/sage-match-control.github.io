// lib/v1/data/*: the browser I/O, with the browser faked (fetch, localStorage,
// location, history, document, WebSocket).
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { PAIRS } from '../../../lib/v1/domain/teams.js';
import { registryUrl, loadRegistry, eventConfigFrom, REGISTRY_LAST_GOOD_KEY } from '../../../lib/v1/data/registry.js';
import { snapshotUrlFor, fetchDaySnapshotFromPages, fetchDaySnapshot, createPoller } from '../../../lib/v1/data/snapshot.js';
import { createLiveChannel, LIVE_PING_MS, LIVE_PONG_TIMEOUT_MS, LIVE_SAFETY_POLL_MS, LIVE_RETRY_MAX_MS } from '../../../lib/v1/data/live-channel.js';
import { createAttendanceSignal, ATTENDANCE_NUDGE_GAP_MS, ATTENDANCE_SETTLE_MS } from '../../../lib/v1/data/attendance-signal.js';
import { httpWords, messageFromJson, friendlyApiMessage, fetchJson } from '../../../lib/v1/data/api.js';
import { scorerDecode, deskDecode, scorerLoadToken, deskLoadToken, scorerStorageKey, deskStorageKey } from '../../../lib/v1/data/tokens.js';
import { loadRegistry as loadFixtureRegistry, eventConfig } from '../../helpers/fixtures.mjs';

// ---- a browser to run in -------------------------------------------------------------------------------------------

function fakeStorage() {
  const data = new Map();
  return { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, removeItem: k => { data.delete(k); }, data };
}

/** Install fakes on globalThis for one test and put the real ones back afterwards. */
function browser(t, { fetch: fetchImpl, search = '', pathname = '/page', hostname = 'sage-match-control.github.io' } = {}) {
  const saved = {};
  const set = (name, value) => { saved[name] = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  const env = { storage: fakeStorage(), calls: [], replaced: [] };
  set('localStorage', env.storage);
  set('location', { search, pathname, hash: '', hostname });
  set('history', { replaceState: (...args) => { env.replaced.push(args[2]); } });
  if (fetchImpl) set('fetch', async (url, init) => { env.calls.push({ url: String(url), init }); return fetchImpl(String(url), init); });
  t.after(() => { for (const [name, desc] of Object.entries(saved)) { if (desc) Object.defineProperty(globalThis, name, desc); else delete globalThis[name]; } });
  return env;
}

const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const fail = (status, body) => ({ ok: false, status, json: async () => { if (body === undefined) throw new Error('no json'); return body; }, text: async () => JSON.stringify(body) });

// ---- registry ------------------------------------------------------------------------------------------------------------

test('registryUrl: GitHub Pages, cache-busted; a fixture reads /_fixtures/config.json', () => {
  assert.equal(registryUrl({ now: 5 }), 'https://sage-match-control.github.io/event-data/config/events.json?t=5');
  assert.equal(registryUrl({ fixture: 'pre', now: 5 }), '/_fixtures/config.json?t=5');
});

test('loadRegistry: keeps the text it loaded, and uses it when a later load fails', async t => {
  const reg = { events: { e: { type: 'standard' } } };
  let answer = () => ok(reg);
  const env = browser(t, { fetch: () => answer() });
  assert.deepEqual(await loadRegistry({ fixture: null }), reg);
  assert.equal(env.storage.getItem(REGISTRY_LAST_GOOD_KEY), JSON.stringify(reg));
  assert.match(env.calls[0].url, /^https:\/\/sage-match-control\.github\.io\/event-data\/config\/events\.json\?t=\d+$/);
  assert.equal(env.calls[0].init.cache, 'no-store');
  answer = () => fail(503);
  assert.deepEqual(await loadRegistry({ fixture: null }), reg, 'the kept copy, for a failing load');
  answer = () => { throw new TypeError('Failed to fetch'); };
  assert.deepEqual(await loadRegistry({ fixture: null }), reg, 'and for an unreachable network');
});

test('loadRegistry: with nothing kept, a failed load throws what went wrong', async t => {
  let answer = () => fail(404);
  browser(t, { fetch: () => answer() });
  await assert.rejects(loadRegistry({ fixture: null }), /HTTP 404/);
  answer = () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(loadRegistry({ fixture: null }), /Failed to fetch/);
});

test('loadRegistry: a load that outlives the timeout fails as "timed out"', async t => {
  browser(t, { fetch: (_url, init) => new Promise((_res, rej) => { init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }) });
  await assert.rejects(loadRegistry({ fixture: null, timeoutMs: 20 }), /^Error: timed out$/);
});

test('loadRegistry: a fixture registry is never kept, and never stands in for the real one', async t => {
  let answer = () => ok({ events: { f: {} } });
  const env = browser(t, { fetch: () => answer() });
  assert.deepEqual(await loadRegistry({ fixture: 'pre' }), { events: { f: {} } });
  assert.equal(env.storage.getItem(REGISTRY_LAST_GOOD_KEY), null);
  env.storage.setItem(REGISTRY_LAST_GOOD_KEY, JSON.stringify({ events: { real: {} } }));
  answer = () => fail(500);
  await assert.rejects(loadRegistry({ fixture: 'missing' }), /HTTP 500/);
});

test('loadRegistry reads ?fixture= on localhost when asked for nothing', async t => {
  const env = browser(t, { search: '?fixture=pre', hostname: 'localhost', fetch: () => ok({ events: {} }) });
  await loadRegistry();
  assert.match(env.calls[0].url, /^\/_fixtures\/config\.json/);
});

test('eventConfigFrom reads an event the way Control Center does', () => {
  const registry = { events: {
    e: {
      type: 'dual-meet', title: 'T', scoreEntry: 'links', attendance: 'desks', display: { divisions: { A: 'a' } },
      days: {
        late: { label: 'Day 2', date: '2026-10-04', facilities: [{ name: 'Main', sheetId: 'x' }, { name: 'Annex' }] },
        undated: { label: 'TBD' },
        early: { label: 'Day 1', date: '2026-10-03', facilities: [] },
      },
    },
    odd: { type: 'knockout' },
    bare: { type: 'team' },
  } };
  const cfg = eventConfigFrom(registry, 'e');
  assert.deepEqual(cfg.days.map(d => d.key), ['early', 'late', 'undated'], 'date order, undated last');
  assert.deepEqual(cfg.days[1], { key: 'late', label: 'Day 2', date: '2026-10-04', facilities: ['Main', 'Annex'] });
  assert.equal(cfg.days[2].date, undefined);
  assert.deepEqual([cfg.key, cfg.type, cfg.title, cfg.scoreEntry, cfg.attendance, cfg.display], ['e', 'dual-meet', 'T', 'links', 'desks', { divisions: { A: 'a' } }]);
  assert.equal(eventConfigFrom(registry, 'odd').type, null, 'an unrecognised type is never guessed');
  assert.deepEqual([eventConfigFrom(registry, 'bare').days, eventConfigFrom(registry, 'bare').display], [[], {}]);
  assert.equal(eventConfigFrom(registry, 'nope'), null);
  assert.equal(eventConfigFrom(null, 'e'), null);
});

test('eventConfigFrom gives a team event its pair labels from display.pairs', () => {
  const pairs = { 1: { full: "Men's Doubles", short: 'MD' }, 2: { full: 'Mixed Doubles', short: 'XD' }, 3: { full: 'Mixed Doubles', short: 'XD' } };
  const registry = { events: { t: { type: 'team', display: { pairs } }, plain: { type: 'team' } } };
  const cfg = eventConfigFrom(registry, 't');
  assert.deepEqual(cfg.pairs, { 1: { full: "Men's Doubles", short: 'MD' }, 2: { full: 'Mixed Doubles 1', short: 'XD 1' }, 3: { full: 'Mixed Doubles 2', short: 'XD 2' } }, 'repeats are numbered');
  assert.deepEqual(eventConfigFrom(registry, 'plain').pairs, PAIRS, 'without the map, the default pairs');
});

test('eventConfigFrom falls back to the default pairs, and warns once, for a malformed display.pairs', t => {
  const warn = mock.method(console, 'warn', () => {});
  t.after(() => warn.mock.restore());
  const bad = [{ x: { full: 'A', short: 'a' } }, { 1: { full: 'A' } }, { 1: { full: '', short: 'a' } }, { 1: 'MD' }, 'MD'];
  for (const pairs of bad) {
    warn.mock.resetCalls();
    const cfg = eventConfigFrom({ events: { t: { type: 'team', display: { pairs } } } }, 't');
    assert.deepEqual(cfg.pairs, PAIRS, JSON.stringify(pairs));
    assert.equal(warn.mock.callCount(), 1);
    assert.equal(warn.mock.calls[0].arguments[0], 'events.json: display.pairs for t is malformed; using the default pair labels');
  }
});

test('eventConfigFrom gives a team event its colours from display.teamColors, hex only, {} without them', t => {
  const warn = mock.method(console, 'warn', () => {});
  t.after(() => warn.mock.restore());
  const teamColors = { Red: '#D62828', Sky: '#4cc9f0', Short: '#abc', Word: 'red', Bad: 'url(x)', Num: 7 };
  const registry = { events: { t: { type: 'team', display: { teamColors } }, plain: { type: 'team' }, list: { type: 'team', display: { teamColors: ['#fff'] } } } };
  assert.deepEqual(eventConfigFrom(registry, 't').teamColors, { Red: '#D62828', Sky: '#4cc9f0', Short: '#abc' });
  assert.deepEqual(warn.mock.calls.map(c => c.arguments[0]), ['Word', 'Bad', 'Num'].map(k => `events.json: display.teamColors.${k} for t is not a hex colour; ignoring it`));
  warn.mock.resetCalls();
  assert.deepEqual(eventConfigFrom(registry, 'plain').teamColors, {}, 'without the map, none');
  assert.equal(warn.mock.callCount(), 0);
  assert.deepEqual(eventConfigFrom(registry, 'list').teamColors, {});
  assert.equal(warn.mock.calls[0].arguments[0], 'events.json: display.teamColors for list must be an object of team code -> hex colour; ignoring it');
});

test('eventConfigFrom agrees with the fixture events', () => {
  const registry = loadFixtureRegistry();
  for (const key of Object.keys(registry.events)) assert.deepEqual(JSON.parse(JSON.stringify(eventConfigFrom(registry, key))), JSON.parse(JSON.stringify(eventConfig(key))), key);
});

// ---- snapshot --------------------------------------------------------------------------------------------------------------

test('snapshotUrlFor: one folder per event, cache-busted; a fixture reads /_fixtures/', () => {
  assert.equal(snapshotUrlFor('piggleball-2026', 'piggleball-day1', { now: 9 }), 'https://sage-match-control.github.io/event-data/piggleball-2026/data/piggleball-day1.json?t=9');
  assert.equal(snapshotUrlFor('piggleball-2026', 'd', { fixture: 'pre final', now: 9 }), '/_fixtures/piggleball-2026/pre%20final.json?t=9');
});

test('fetchDaySnapshotFromPages: the snapshot, a status on failure, and "timed out"', async t => {
  let answer = () => ok({ day: 'd' });
  const env = browser(t, { fetch: (_u, init) => answer(init) });
  assert.deepEqual(await fetchDaySnapshotFromPages('e', 'd'), { day: 'd' });
  assert.equal(env.calls[0].init.cache, 'no-store');
  answer = () => fail(404);
  await assert.rejects(fetchDaySnapshotFromPages('e', 'd'), err => err.message === 'HTTP 404' && err.status === 404);
  answer = init => new Promise((_res, rej) => { init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))); });
  await assert.rejects(fetchDaySnapshotFromPages('e', 'd', { timeoutMs: 15 }), /^Error: timed out$/);
});

function fakeChannel({ cached = null, newer = (_e, _d, fetched) => fetched } = {}) {
  const log = [];
  return { log, cached: (e, d) => { log.push(['cached', e, d]); return cached; }, newer: (e, d, fetched) => { log.push(['newer', e, d, fetched]); return newer(e, d, fetched); }, pause: () => log.push(['pause']), resume: () => log.push(['resume']) };
}

test('fetchDaySnapshot: a pushed snapshot is used without a fetch', async t => {
  const env = browser(t, { fetch: () => ok({ from: 'github' }) });
  assert.deepEqual(await fetchDaySnapshot('e', 'd', { liveChannel: fakeChannel({ cached: { from: 'push' } }) }), { from: 'push' });
  assert.equal(env.calls.length, 0);
});

test('fetchDaySnapshot: otherwise GitHub, passed through the channel to keep the newer copy', async t => {
  browser(t, { fetch: () => ok({ from: 'github' }) });
  const channel = fakeChannel({ newer: () => ({ from: 'newer' }) });
  assert.deepEqual(await fetchDaySnapshot('e', 'd', { liveChannel: channel }), { from: 'newer' });
  assert.deepEqual(channel.log.at(-1), ['newer', 'e', 'd', { from: 'github' }]);
});

test('fetchDaySnapshot: a failing GitHub falls back to a pushed copy, else the error stands', async t => {
  browser(t, { fetch: () => fail(404) });
  assert.deepEqual(await fetchDaySnapshot('e', 'd', { liveChannel: fakeChannel({ newer: (_e, _d, f) => (f === null ? { from: 'push' } : f) }) }), { from: 'push' });
  await assert.rejects(fetchDaySnapshot('e', 'd', { liveChannel: fakeChannel({ newer: () => null }) }), /HTTP 404/);
});

test('fetchDaySnapshot reads the fixture when asked', async t => {
  const env = browser(t, { fetch: () => ok({}) });
  await fetchDaySnapshot('e', 'd', { liveChannel: fakeChannel(), fixture: 'mid' });
  assert.match(env.calls[0].url, /^\/_fixtures\/e\/mid\.json\?t=\d+$/);
});

test('createPoller ticks on the interval, and pauses with the page being hidden', t => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  t.after(() => mock.timers.reset());
  const listeners = {};
  const doc = { hidden: false, addEventListener: (n, f) => { listeners[n] = f; }, removeEventListener: n => { delete listeners[n]; } };
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
  t.after(() => { delete globalThis.document; });
  const channel = fakeChannel();
  let ticks = 0;
  const poller = createPoller({ intervalMs: 1000, onTick: () => { ticks++; }, liveChannel: channel });
  poller.start();
  mock.timers.tick(3500);
  assert.equal(ticks, 3);
  doc.hidden = true; listeners.visibilitychange();
  mock.timers.tick(5000);
  assert.equal(ticks, 3, 'nothing while hidden');
  assert.deepEqual(channel.log, [['pause']]);
  doc.hidden = false; listeners.visibilitychange();
  assert.equal(ticks, 4, 'an immediate tick on return');
  assert.deepEqual(channel.log, [['pause'], ['resume']]);
  mock.timers.tick(2000);
  assert.equal(ticks, 6);
  poller.stop();
  mock.timers.tick(5000);
  assert.equal(ticks, 6);
  assert.equal(listeners.visibilitychange, undefined);
});

test('createPoller needs no live channel, and starts at most one timer', t => {
  mock.timers.enable({ apis: ['setInterval'] });
  t.after(() => mock.timers.reset());
  Object.defineProperty(globalThis, 'document', { value: { hidden: false, addEventListener() {}, removeEventListener() {} }, configurable: true, writable: true });
  t.after(() => { delete globalThis.document; });
  let ticks = 0;
  const poller = createPoller({ onTick: () => { ticks++; } });
  poller.start(); poller.start();
  mock.timers.tick(10000);
  assert.equal(ticks, 1, 'the default is every 10 s, and a second start does not double it');
  poller.stop();
});

// ---- live channel ---------------------------------------------------------------------------------------------------------------

class FakeSocket {
  static instances = [];
  static OPEN = 1;
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.closed = false; FakeSocket.instances.push(this); }
  send(m) { this.sent.push(m); }
  close() { this.closed = true; this.readyState = 3; if (this.onclose) this.onclose(); }
  open() { this.readyState = 1; this.onopen(); }
  push(obj) { this.onmessage({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) }); }
}

function liveSetup(t, options = {}) {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: Date.parse('2026-10-03T00:00:00Z') });
  FakeSocket.instances = [];
  Object.defineProperty(globalThis, 'WebSocket', { value: FakeSocket, configurable: true, writable: true });
  t.after(() => { mock.timers.reset(); delete globalThis.WebSocket; });
  const seen = [];
  const channel = createLiveChannel({ baseUrl: 'wss://live.example', enabled: true, onSnapshot: () => seen.push('snapshot'), ...options });
  return { channel, seen };
}

test('live channel: follows a day over one socket and keeps the pushed snapshot', t => {
  const { channel, seen } = liveSetup(t);
  channel.follow('e', 'd');
  const [ws] = FakeSocket.instances;
  assert.equal(ws.url, 'wss://live.example/live/e/d');
  assert.equal(channel.isOpen(), false, 'connecting');
  assert.equal(channel.cached('e', 'd'), null);
  ws.open();
  assert.equal(channel.isOpen(), true);
  ws.push({ type: 'snapshot', version: 3, snapshot: { generatedAt: '2026-10-03T08:00:00Z', n: 1 } });
  assert.deepEqual(seen, ['snapshot']);
  assert.equal(channel.cached('e', 'd'), null, 'GitHub is checked first, once');
  assert.deepEqual(channel.newer('e', 'd', null), { generatedAt: '2026-10-03T08:00:00Z', n: 1 });
  assert.deepEqual(channel.cached('e', 'd'), { generatedAt: '2026-10-03T08:00:00Z', n: 1 });
  assert.equal(channel.cached('e', 'other'), null, 'only for the day it follows');
});

test('live channel: ignores pongs, junk, other messages, old versions and a day it has left', t => {
  const { channel, seen } = liveSetup(t);
  channel.follow('e', 'd');
  const [ws] = FakeSocket.instances;
  ws.open();
  ws.push('pong'); ws.push('not json'); ws.push({ type: 'hello' }); ws.push({ type: 'snapshot' });
  assert.deepEqual(seen, []);
  ws.push({ type: 'snapshot', version: 5, snapshot: { n: 5 } });
  ws.push({ type: 'snapshot', version: 5, snapshot: { n: 'same version' } });
  ws.push({ type: 'snapshot', version: 4, snapshot: { n: 'older' } });
  assert.deepEqual(seen, ['snapshot']);
  channel.newer('e', 'd', null);
  assert.deepEqual(channel.cached('e', 'd'), { n: 5 });
  channel.follow('e', 'next');
  ws.push({ type: 'snapshot', version: 9, snapshot: { n: 'late, for the day left' } });
  assert.equal(seen.length, 1);
  assert.equal(FakeSocket.instances.length, 2, 'a new socket for the new day');
});

test('live channel: following the same day again keeps the socket; following nothing closes it', t => {
  const { channel } = liveSetup(t);
  channel.follow('e', 'd');
  channel.follow('e', 'd');
  assert.equal(FakeSocket.instances.length, 1);
  channel.follow(null, null);
  assert.equal(FakeSocket.instances[0].closed, true);
  channel.follow('e', undefined);
  assert.equal(FakeSocket.instances.length, 1, 'no day, no socket');
});

test('live channel: a pushed snapshot is trusted for LIVE_SAFETY_POLL_MS, then GitHub is checked and the newer copy kept', t => {
  const { channel } = liveSetup(t);
  channel.follow('e', 'd');
  const [ws] = FakeSocket.instances;
  ws.open();
  ws.push({ type: 'snapshot', version: 1, snapshot: { publishedAt: '2026-10-03T08:00:00Z', from: 'push' } });
  assert.equal(channel.cached('e', 'd'), null, 'never checked GitHub yet: time for a check');
  assert.equal(channel.newer('e', 'd', { publishedAt: '2026-10-03T07:00:00Z', from: 'github' }).from, 'push', 'the pushed copy is newer');
  assert.equal(channel.cached('e', 'd').from, 'push');
  mock.timers.tick(LIVE_SAFETY_POLL_MS + 1);
  assert.equal(channel.cached('e', 'd'), null, 'a minute on, time for a check again');
  assert.equal(channel.newer('e', 'd', { generatedAt: '2026-10-03T09:00:00Z', from: 'github' }).from, 'github', 'GitHub is newer: the push path had quietly stopped');
  assert.equal(channel.newer('other', 'd', { from: 'github' }).from, 'github');
  assert.equal(channel.newer('e', 'd', null) && channel.newer('e', 'd', null).from, 'push', 'with nothing fetched, the pushed copy stands');
});

test('live channel: pings, and treats a missing pong as a dead socket', t => {
  const { channel } = liveSetup(t);
  channel.follow('e', 'd');
  const [ws] = FakeSocket.instances;
  ws.open();
  mock.timers.tick(LIVE_PING_MS);
  assert.deepEqual(ws.sent, ['ping']);
  mock.timers.tick(LIVE_PONG_TIMEOUT_MS);
  assert.equal(ws.closed, true);
});

test('live channel: retries with a growing delay, and a successful open starts the count again', t => {
  const { channel } = liveSetup(t);
  mock.method(Math, 'random', () => 0);
  t.after(() => mock.restoreAll());
  channel.follow('e', 'd');
  FakeSocket.instances[0].close();
  assert.equal(FakeSocket.instances.length, 1);
  mock.timers.tick(999);
  assert.equal(FakeSocket.instances.length, 1);
  mock.timers.tick(1);
  assert.equal(FakeSocket.instances.length, 2, 'after 1 s');
  FakeSocket.instances[1].close();
  mock.timers.tick(2000);
  assert.equal(FakeSocket.instances.length, 3, 'then 2 s');
  FakeSocket.instances[2].open();
  FakeSocket.instances[2].close();
  mock.timers.tick(1000);
  assert.equal(FakeSocket.instances.length, 4, 'back to 1 s once it connected');
  for (let i = 0; i < 12; i++) { FakeSocket.instances.at(-1).close(); mock.timers.tick(LIVE_RETRY_MAX_MS); }
  const before = FakeSocket.instances.length;
  FakeSocket.instances.at(-1).close();
  mock.timers.tick(LIVE_RETRY_MAX_MS);
  assert.equal(FakeSocket.instances.length, before + 1, 'never waits longer than LIVE_RETRY_MAX_MS');
});

test('live channel: pause closes it and stops retrying; resume opens it again', t => {
  const { channel } = liveSetup(t);
  channel.follow('e', 'd');
  channel.pause();
  assert.equal(FakeSocket.instances[0].closed, true);
  mock.timers.tick(60000);
  assert.equal(FakeSocket.instances.length, 1);
  channel.resume();
  assert.equal(FakeSocket.instances.length, 2);
});

test('live channel: disabled (no address, or a fixture) never connects', t => {
  const { channel } = liveSetup(t, { enabled: false });
  channel.follow('e', 'd');
  assert.equal(FakeSocket.instances.length, 0);
  assert.equal(channel.isOpen(), false);
});

// ---- attendance signal ----------------------------------------------------------------------------------------------------------
// sage-docs/docs/specs/.../attendance-push-spec.md §5.1

function signalSetup(t, options = {}) {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: Date.parse('2026-10-03T00:00:00Z') });
  FakeSocket.instances = [];
  Object.defineProperty(globalThis, 'WebSocket', { value: FakeSocket, configurable: true, writable: true });
  mock.method(Math, 'random', () => 0);
  t.after(() => { mock.restoreAll(); mock.timers.reset(); delete globalThis.WebSocket; });
  const changes = [], statuses = [];
  const signal = createAttendanceSignal({
    baseUrl: 'wss://live.example', enabled: true, event: 'e', day: 'd',
    onChange: f => changes.push(f), onStatus: open => statuses.push(open), ...options,
  });
  return { signal, changes, statuses };
}
const nudge = (ws, facility) => ws.push({ type: 'attendance', facility });

test('attendance signal: connects to the day\'s attendance socket, with both keys URL-encoded', t => {
  const { signal } = signalSetup(t, { event: 'e x', day: 'd/1' });
  assert.equal(FakeSocket.instances.length, 1);
  assert.equal(FakeSocket.instances[0].url, 'wss://live.example/attendance/e%20x/d%2F1');
  assert.equal(signal.isOpen(), false, 'connecting');
});

test('attendance signal: isOpen follows the socket', t => {
  const { signal } = signalSetup(t);
  const [ws] = FakeSocket.instances;
  assert.equal(signal.isOpen(), false);
  ws.open();
  assert.equal(signal.isOpen(), true);
  ws.close();
  assert.equal(signal.isOpen(), false);
});

test('attendance signal: disabled never connects, and says so once, on the next tick', t => {
  const { signal, statuses } = signalSetup(t, { enabled: false });
  assert.equal(FakeSocket.instances.length, 0);
  assert.deepEqual(statuses, [], 'the caller has its view by the next tick');
  mock.timers.tick(1);
  assert.deepEqual(statuses, [false]);
  mock.timers.tick(60000);
  assert.deepEqual(statuses, [false]);
  assert.equal(FakeSocket.instances.length, 0);
  assert.equal(signal.isOpen(), false);
});

test('attendance signal: a nudge calls onChange with the facility at once', t => {
  const { changes } = signalSetup(t);
  const [ws] = FakeSocket.instances;
  ws.open();
  nudge(ws, 'Gym');
  assert.deepEqual(changes, ['Gym']);
});

test('attendance signal: a second nudge inside the gap waits for the gap to end, and a third joins it', t => {
  const { changes } = signalSetup(t);
  const [ws] = FakeSocket.instances;
  ws.open();
  nudge(ws, 'Gym');
  mock.timers.tick(500);
  nudge(ws, 'Gym');
  nudge(ws, 'Gym');
  assert.deepEqual(changes, ['Gym'], 'not yet');
  mock.timers.tick(ATTENDANCE_NUDGE_GAP_MS - 500 - 1);
  assert.deepEqual(changes, ['Gym']);
  mock.timers.tick(1);
  assert.deepEqual(changes, ['Gym', 'Gym'], 'once, when 2 s have passed since the first');
});

test('attendance signal: a nudge after the gap is called at once', t => {
  const { changes } = signalSetup(t);
  const [ws] = FakeSocket.instances;
  ws.open();
  nudge(ws, 'Gym');
  mock.timers.tick(ATTENDANCE_NUDGE_GAP_MS);
  nudge(ws, 'Gym');
  assert.deepEqual(changes, ['Gym', 'Gym']);
});

test('attendance signal: two facilities do not share a gap', t => {
  const { changes } = signalSetup(t);
  const [ws] = FakeSocket.instances;
  ws.open();
  nudge(ws, 'Gym');
  nudge(ws, 'Court');
  assert.deepEqual(changes, ['Gym', 'Court']);
  mock.timers.tick(100);
  nudge(ws, 'Gym');
  nudge(ws, 'Court');
  assert.deepEqual(changes, ['Gym', 'Court'], 'each is inside its own gap');
});

test('attendance signal: asks again ATTENDANCE_SETTLE_MS after the last nudge, and a nudge in between pushes that back', t => {
  const { changes } = signalSetup(t);
  const [ws] = FakeSocket.instances;
  ws.open();
  nudge(ws, 'Gym');
  mock.timers.tick(5000);
  nudge(ws, 'Gym');                                              // 5 s in: its own immediate call
  assert.deepEqual(changes, ['Gym', 'Gym']);
  mock.timers.tick(ATTENDANCE_SETTLE_MS - 1);
  assert.deepEqual(changes, ['Gym', 'Gym'], '11 s after the first is not yet 11 s after the last');
  mock.timers.tick(1);
  assert.deepEqual(changes, ['Gym', 'Gym', 'Gym']);
  mock.timers.tick(60000);
  assert.deepEqual(changes, ['Gym', 'Gym', 'Gym'], 'one settle call per run of nudges, then nothing');
});

test('attendance signal: ignores pongs, junk, other types and a nudge without a facility', t => {
  const { changes } = signalSetup(t);
  const [ws] = FakeSocket.instances;
  ws.open();
  ws.push('pong'); ws.push('not json'); ws.push('null'); ws.push({ type: 'snapshot', snapshot: {} }); ws.push({ type: 'hello' });
  ws.push({ type: 'attendance' }); ws.push({ type: 'attendance', facility: 5 }); ws.push({ facility: 'Gym' });
  mock.timers.tick(60000);
  assert.deepEqual(changes, []);
});

test('attendance signal: pings, and treats a missing pong as a dead socket', t => {
  signalSetup(t);
  const [ws] = FakeSocket.instances;
  ws.open();
  mock.timers.tick(LIVE_PING_MS);
  assert.deepEqual(ws.sent, ['ping']);
  mock.timers.tick(LIVE_PONG_TIMEOUT_MS);
  assert.equal(ws.closed, true);
});

test('attendance signal: a pong keeps the socket', t => {
  signalSetup(t);
  const [ws] = FakeSocket.instances;
  ws.open();
  mock.timers.tick(LIVE_PING_MS);
  ws.push('pong');
  mock.timers.tick(LIVE_PONG_TIMEOUT_MS);
  assert.equal(ws.closed, false);
});

test('attendance signal: retries with a growing delay, and a successful open starts the count again', t => {
  signalSetup(t);
  FakeSocket.instances[0].close();
  mock.timers.tick(999);
  assert.equal(FakeSocket.instances.length, 1);
  mock.timers.tick(1);
  assert.equal(FakeSocket.instances.length, 2, 'after 1 s');
  FakeSocket.instances[1].close();
  mock.timers.tick(2000);
  assert.equal(FakeSocket.instances.length, 3, 'then 2 s');
  FakeSocket.instances[2].open();
  FakeSocket.instances[2].close();
  mock.timers.tick(1000);
  assert.equal(FakeSocket.instances.length, 4, 'back to 1 s once it connected');
  for (let i = 0; i < 12; i++) { FakeSocket.instances.at(-1).close(); mock.timers.tick(LIVE_RETRY_MAX_MS); }
  const before = FakeSocket.instances.length;
  FakeSocket.instances.at(-1).close();
  mock.timers.tick(LIVE_RETRY_MAX_MS);
  assert.equal(FakeSocket.instances.length, before + 1, 'never waits longer than LIVE_RETRY_MAX_MS');
});

test('attendance signal: onStatus fires once per change of state, not once per retry', t => {
  const { statuses } = signalSetup(t);
  assert.deepEqual(statuses, [], 'unknown until the first open or failure');
  FakeSocket.instances[0].close();                                // the first attempt fails
  assert.deepEqual(statuses, [false]);
  mock.timers.tick(1000);
  FakeSocket.instances[1].close();                                // and again
  mock.timers.tick(2000);
  FakeSocket.instances[2].close();
  assert.deepEqual(statuses, [false], 'still down: nothing new to say');
  mock.timers.tick(4000);
  FakeSocket.instances[3].open();
  assert.deepEqual(statuses, [false, true]);
  FakeSocket.instances[3].close();
  assert.deepEqual(statuses, [false, true, false]);
});

test('attendance signal: the first open is reported, even before any failure', t => {
  const { statuses } = signalSetup(t);
  FakeSocket.instances[0].open();
  assert.deepEqual(statuses, [true]);
});

test('attendance signal: a socket that cannot be made counts as down and is retried', t => {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: Date.parse('2026-10-03T00:00:00Z') });
  mock.method(Math, 'random', () => 0);
  let attempts = 0;
  Object.defineProperty(globalThis, 'WebSocket', { value: class { constructor() { attempts++; throw new Error('SecurityError'); } }, configurable: true, writable: true });
  t.after(() => { mock.restoreAll(); mock.timers.reset(); delete globalThis.WebSocket; });
  const statuses = [];
  createAttendanceSignal({ baseUrl: 'ws://x', enabled: true, event: 'e', day: 'd', onChange: () => {}, onStatus: o => statuses.push(o) });
  assert.deepEqual(statuses, [false]);
  mock.timers.tick(1000);
  assert.equal(attempts, 2);
  assert.deepEqual(statuses, [false]);
});

test('attendance signal: close stops the socket, the retries and every pending call, for good', t => {
  const { signal, changes, statuses } = signalSetup(t);
  const [ws] = FakeSocket.instances;
  ws.open();
  nudge(ws, 'Gym');
  mock.timers.tick(100);
  nudge(ws, 'Gym');                                               // a call waiting for the gap to end
  signal.close();
  assert.equal(ws.closed, true);
  assert.equal(ws.onmessage, null, 'handlers detached before closing');
  assert.equal(ws.onclose, null);
  mock.timers.tick(120000);
  assert.deepEqual(changes, ['Gym'], 'neither the gap call nor the settle call fires');
  assert.deepEqual(statuses, [true], 'closing it does not report a drop');
  assert.equal(FakeSocket.instances.length, 1, 'no reconnect');
  assert.equal(signal.isOpen(), false);
});

test('attendance signal: close while a retry is waiting means no retry', t => {
  const { signal } = signalSetup(t);
  FakeSocket.instances[0].close();
  signal.close();
  mock.timers.tick(60000);
  assert.equal(FakeSocket.instances.length, 1);
});

test('attendance signal: close before the disabled signal has spoken means it never speaks', t => {
  const { signal, statuses } = signalSetup(t, { enabled: false });
  signal.close();
  mock.timers.tick(10);
  assert.deepEqual(statuses, []);
});

// ---- api -------------------------------------------------------------------------------------------------------------------------

test('friendlyApiMessage puts each "HTTP <status> <json>" into words', () => {
  assert.equal(httpWords(403), 'refused access');
  assert.equal(httpWords(503), 'had a server error');
  assert.equal(httpWords(418), 'answered with an error');
  assert.equal(messageFromJson('{"error":{"message":"quota"}}'), 'quota');
  assert.equal(messageFromJson('{"message":"is at abc"}'), 'is at abc');
  assert.equal(messageFromJson('{"error":"unauthorized"}'), 'unauthorized');
  assert.equal(messageFromJson('nope'), null);
  assert.equal(messageFromJson('[1]'), null);
  assert.equal(friendlyApiMessage('live Worker publish failed: HTTP 401 {"error":"unauthorized"}'), 'live Worker publish failed: refused the credentials (401) — unauthorized');
  assert.equal(friendlyApiMessage('GitHub commit failed: HTTP 409 {"message":"is at abc but expected def"}; next'), 'GitHub commit failed: reported a conflict (409) — is at abc but expected def; next');
  assert.equal(friendlyApiMessage('HTTP 500'), 'Cloud Run had a server error (500)');
  assert.equal(friendlyApiMessage('failed after HTTP 429.'), 'failed after is rate-limiting requests (429).');
  assert.equal(friendlyApiMessage('{"error":"The sheet changed"}'), 'The sheet changed');
  assert.equal(friendlyApiMessage('timed out after 90000ms'), 'timed out after 90 s');
  assert.equal(friendlyApiMessage(undefined), '');
});

test('fetchJson: the token and body ride along; an error carries its status and body', async t => {
  let answer = () => ok({ fine: true });
  const env = browser(t, { fetch: () => answer() });
  assert.deepEqual(await fetchJson('https://api.example/x', { method: 'PUT', body: { a: 1 }, token: 'tok' }), { fine: true });
  const { init } = env.calls[0];
  assert.equal(init.method, 'PUT');
  assert.equal(init.headers.Authorization, 'Bearer tok');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.body, '{"a":1}');
  await fetchJson('https://api.example/x');
  assert.deepEqual(env.calls[1].init.headers, {});
  assert.equal(env.calls[1].init.body, undefined);
  answer = () => fail(409, { error: 'The sheet changed', current: { a: 1 } });
  await assert.rejects(fetchJson('https://api.example/x'), err => err.message === 'The sheet changed' && err.status === 409 && err.body.current.a === 1);
  answer = () => fail(502);
  await assert.rejects(fetchJson('https://api.example/x'), err => err.message === 'HTTP 502' && err.status === 502 && err.body === null);
  answer = () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(fetchJson('https://api.example/x'), err => err.status === undefined);
});

// ---- tokens ------------------------------------------------------------------------------------------------------------------------

const token = payload => Buffer.from(JSON.stringify(payload)).toString('base64url') + '.signature';

test('tokens: a payload is read for display only, and each kind has its own shape', () => {
  assert.deepEqual(scorerDecode(token({ scope: 'score-desk', day: 'd', exp: 5 })), { scope: 'score-desk', day: 'd', exp: 5 });
  assert.equal(scorerDecode(token({ scope: 'attendance', day: 'd', exp: 5 })), null);
  assert.equal(scorerDecode(token({ scope: 'score-desk', day: 5, exp: 5 })), null);
  assert.equal(scorerDecode('garbage'), null);
  assert.equal(scorerDecode(undefined), null);
  assert.deepEqual(deskDecode(token({ day: 'd', exp: 7 })), { day: 'd', exp: 7 });
  assert.equal(deskDecode(token({ day: 'd' })), null);
  assert.equal(deskDecode('%%%'), null);
  assert.equal(scorerStorageKey('e'), 'sage.scorer.e');
  assert.equal(deskStorageKey('e'), 'sage.attendance.desk.e');
});

// A link issued to someone carries `to` and `note` in its payload (link-attribution-spec.md §5.1). The API encodes the
// payload as UTF-8, so a name with an accent or a dash has to decode as UTF-8 too, not one character per byte.
test('tokens: who a link was issued to comes back intact, accents and dashes included', () => {
  const scorer = scorerDecode(token({ scope: 'score-desk', day: 'd', exp: 5, to: 'Niño', note: 'Courts 3–4' }));
  assert.equal(scorer.to, 'Niño');
  assert.equal(scorer.note, 'Courts 3–4');
  assert.deepEqual(scorer, { scope: 'score-desk', day: 'd', exp: 5, to: 'Niño', note: 'Courts 3–4' });
  const desk = deskDecode(token({ scope: 'attendance-desk', day: 'd', exp: 7, to: 'Zoë 😀', note: 'Gate A' }));
  assert.equal(desk.to, 'Zoë 😀');
  assert.equal(desk.note, 'Gate A');
});

test('tokens: a link issued before labels existed still decodes, with nothing to show', () => {
  const scorer = scorerDecode(token({ scope: 'score-desk', day: 'd', exp: 5 }));
  assert.deepEqual(scorer, { scope: 'score-desk', day: 'd', exp: 5 });
  assert.equal(scorer.to, undefined);
  assert.equal(scorer.note, undefined);
  assert.deepEqual(deskDecode(token({ scope: 'attendance-desk', day: 'd', exp: 7 })), { scope: 'attendance-desk', day: 'd', exp: 7 });
});

test('tokens: a link’s token is kept, dropped from the address bar, and read back later', t => {
  const link = token({ scope: 'score-desk', day: 'd', exp: 5 });
  const env = browser(t, { search: `?scorer=${link}&fixture=x`, pathname: '/events/e/scorer' });
  assert.equal(scorerLoadToken('e'), link);
  assert.deepEqual(env.replaced, ['/events/e/scorer?fixture=x'], 'the token is gone, the rest stays');
  assert.equal(JSON.parse(env.storage.getItem('sage.scorer.e')).token, link);
  globalThis.location.search = '';
  assert.equal(scorerLoadToken('e'), link, 'from storage');
  assert.equal(scorerLoadToken('other'), null);
});

test('tokens: a newer link replaces an older one; a desk link is kept apart from a scorer link', t => {
  const env = browser(t, { search: '?desk=old', pathname: '/d' });
  assert.equal(deskLoadToken('e'), 'old');
  globalThis.location.search = '?desk=new';
  assert.equal(deskLoadToken('e'), 'new');
  assert.equal(scorerLoadToken('e'), null);
  assert.equal(env.storage.getItem('sage.attendance.desk.e') !== null, true);
});

test('tokens: storage that throws is survived', t => {
  browser(t, { search: '?scorer=abc', pathname: '/s' });
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, configurable: true, writable: true });
  assert.equal(scorerLoadToken('e'), null);
});

// ---- teamScoring (sage-docs/docs/specs/.../millennium-invitational-spec.md §4) -------------------------------------

test('eventConfigFrom reads teamScoring: "points" unless the event says "games"', t => {
  const warn = mock.method(console, 'warn', () => {});
  t.after(() => warn.mock.restore());
  const registry = { events: { g: { type: 'team', teamScoring: 'games' }, p: { type: 'team', teamScoring: 'points' }, none: { type: 'team' }, odd: { type: 'team', teamScoring: 'wins' } } };
  assert.equal(eventConfigFrom(registry, 'g').teamScoring, 'games');
  assert.equal(eventConfigFrom(registry, 'p').teamScoring, 'points');
  assert.equal(eventConfigFrom(registry, 'none').teamScoring, 'points');
  assert.equal(warn.mock.calls.length, 0);
  assert.equal(eventConfigFrom(registry, 'odd').teamScoring, 'points');
  assert.equal(warn.mock.calls.length, 1);
  assert.equal(warn.mock.calls[0].arguments[0], 'events.json: teamScoring for odd must be "points" or "games"; using "points"');
});

test('eventConfigFrom gives a team event its playoff placeholders from display.seedLabels, labels only', t => {
  const warn = mock.method(console, 'warn', () => {});
  t.after(() => warn.mock.restore());
  const registry = { events: {
    t: { type: 'team', display: { seedLabels: { 'Fi-1': 'Rank 1', 'Br-1': ' Rank 3 ', 'Br-2': '', 'Fi-2': 2 } } },
    plain: { type: 'team' },
  } };
  assert.deepEqual(eventConfigFrom(registry, 't').seedLabels, { 'Fi-1': 'Rank 1', 'Br-1': 'Rank 3' });
  assert.equal(warn.mock.callCount(), 2, 'the empty and the numeric label each warn');
  assert.deepEqual(eventConfigFrom(registry, 'plain').seedLabels, {});
});

test('eventConfigFrom: lineupReveal is true only when events.json says true', () => {
  const registry = { events: { on: { type: 'team', lineupReveal: true }, odd: { type: 'team', lineupReveal: 'yes' }, off: { type: 'team' } } };
  assert.deepEqual(['on', 'odd', 'off'].map(k => eventConfigFrom(registry, k).lineupReveal), [true, false, false]);
});
