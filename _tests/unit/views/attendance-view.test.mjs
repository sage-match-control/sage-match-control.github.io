// views/attendance-view.js: the functions that need no DOM (the list itself is covered by the harness's
// attendance cases).
import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceCsvUrl, fetchPeople, markPerson } from '../../../lib/v1/views/attendance-view.js';

test('the ATTENDANCE tab is read from the facility workbook as CSV', () => {
  assert.equal(attendanceCsvUrl('abc123'), 'https://docs.google.com/spreadsheets/d/abc123/gviz/tq?tqx=out:csv&headers=1&sheet=ATTENDANCE');
});

test('a mark is a PUT to the person’s attendance with the bearer token', async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  try {
    await markPerson({ apiBase: 'https://api.test', token: 'T', day: 'd 1', facility: 'Main Hall', key: 'k/1', present: true });
  } finally {
    delete globalThis.fetch;
  }
  assert.equal(seen[0].url, 'https://api.test/v3/days/d%201/facilities/Main%20Hall/people/k%2F1/attendance');
  assert.equal(seen[0].init.method, 'PUT');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer T');
  assert.deepEqual(JSON.parse(seen[0].init.body), { present: true });
});

test('a refused mark rejects with the server’s message and status', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ error: 'Already marked' }) });
  try {
    await assert.rejects(markPerson({ apiBase: 'https://api.test', token: 'T', day: 'd', facility: 'f', key: 'k', present: false }),
      err => err.message === 'Already marked' && err.status === 409);
  } finally {
    delete globalThis.fetch;
  }
});

test('the list is a GET of the facility’s people with the bearer token', async () => {
  const seen = [];
  const people = [{ key: 'ana-santos', player: 'Ana Santos', teams: ['T_1'], categories: ['LIWD'], present: true, timeIn: '2026-10-03 08:14', withdrawn: false, shirt: 'M' }];
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, json: async () => people }; };
  let got;
  try {
    got = await fetchPeople({ apiBase: 'https://api.test', token: 'T', day: 'd 1', facility: 'Main Hall' });
  } finally {
    delete globalThis.fetch;
  }
  assert.equal(seen[0].url, 'https://api.test/v3/days/d%201/facilities/Main%20Hall/people');
  assert.equal(seen[0].init.method || 'GET', 'GET');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer T');
  assert.equal(seen[0].init.cache, 'no-store');
  assert.deepEqual(got, people);
});

test('a refused read rejects with the server’s message and status', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'This desk link is for another day' }) });
  try {
    await assert.rejects(fetchPeople({ apiBase: 'https://api.test', token: 'T', day: 'd', facility: 'f' }),
      err => err.message === 'This desk link is for another day' && err.status === 403);
  } finally {
    delete globalThis.fetch;
  }
});

test('a refused read without a JSON body rejects with the status', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => { throw new Error('not JSON'); } });
  try {
    await assert.rejects(fetchPeople({ apiBase: 'https://api.test', token: 'T', day: 'd', facility: 'f' }),
      err => err.message === 'HTTP 502' && err.status === 502);
  } finally {
    delete globalThis.fetch;
  }
});

test('a read that never got an answer rejects with no status', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  try {
    await assert.rejects(fetchPeople({ apiBase: 'https://api.test', token: 'T', day: 'd', facility: 'f' }),
      err => err.status === undefined);
  } finally {
    delete globalThis.fetch;
  }
});
