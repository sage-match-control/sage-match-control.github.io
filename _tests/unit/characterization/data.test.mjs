// Characterization (site-engine-spec §5.2): the data/ modules against the page
// code they replace.
import test from 'node:test';
import assert from 'node:assert/strict';
import { oldCode, baselinePage } from '../../helpers/old.mjs';
import { extractFunction, stripComments } from '../../helpers/extract.mjs';
import * as Api from '../../../lib/v1/data/api.js';
import * as Tokens from '../../../lib/v1/data/tokens.js';
import { createLiveChannel } from '../../../lib/v1/data/live-channel.js';

const CC = 'tools/control-center.html';
const PAGES = [CC, '_templates/standard-tournament-template/index.html', '_templates/dual-meet-template/index.html',
  '_templates/standard-tournament-template/schedule.html', '_templates/dual-meet-template/schedule.html', '_templates/scorer/scorer.html'];

const squash = s => stripComments(s).replace(/\s+/g, ' ').trim();

test('the live channel is the page block, verbatim but for the address and the ./ constants', () => {
  const mine = Tokens && createLiveChannel.toString();
  const normalize = s => squash(s)
    .replace(/LIVE_BASE_URL/g, 'baseUrl')
    .replace(/function createLiveChannel\(\{ enabled, onSnapshot \}\)/, 'function createLiveChannel({ baseUrl, enabled, onSnapshot })')
    .replace(/^export /, '');
  const want = normalize(mine);
  for (const rel of PAGES) {
    const old = extractFunction(baselinePage(rel), 'createLiveChannel');
    assert.ok(old, `${rel} has the block`);
    assert.equal(normalize(old), want, `${rel}'s copy`);
  }
});

test('the live channel’s timings are the block’s', async () => {
  const consts = await import('../../../lib/v1/data/live-channel.js');
  for (const rel of PAGES) {
    const old = oldCode(rel, { consts: ['LIVE_PING_MS', 'LIVE_PONG_TIMEOUT_MS', 'LIVE_SAFETY_POLL_MS', 'LIVE_RETRY_MAX_MS'] });
    assert.equal(consts.LIVE_PING_MS, old.LIVE_PING_MS, rel);
    assert.equal(consts.LIVE_PONG_TIMEOUT_MS, old.LIVE_PONG_TIMEOUT_MS, rel);
    assert.equal(consts.LIVE_SAFETY_POLL_MS, old.LIVE_SAFETY_POLL_MS, rel);
    assert.equal(consts.LIVE_RETRY_MAX_MS, old.LIVE_RETRY_MAX_MS, rel);
  }
});

const MESSAGES = [
  undefined, null, '', '   ', 'HTTP 500', 'HTTP 404', 'HTTP 418', 'HTTP 401 {"error":"unauthorized"}',
  'GitHub commit failed: HTTP 409 {"message":"is at abc but expected def","documentation_url":"x"}',
  'live Worker publish failed: HTTP 401 {"error":"unauthorized"}; GitHub commit failed: HTTP 403 {"message":"nope"}',
  '{"error":"The sheet changed"}', '{"error":{"message":"quota exceeded"}}', '{"message":"m"}', '{broken', '{"x":1}',
  'timed out after 90000ms', 'timed out after 1234ms and then HTTP 503', 'Could not reach the server', 'HTTP 403 {"error":{"message":"deep"}}',
  'a HTTP 200 b HTTP 502', 'HTTP 400 {"error":"x"}', 5,
];

for (const rel of [CC, '_templates/scorer/scorer.html']) {
  test(`api: ${rel}'s readable messages are the module's`, () => {
    const old = oldCode(rel, { consts: ['HTTP_WORDS'], functions: ['httpWords', 'messageFromJson', 'friendlyApiMessage'] });
    assert.deepEqual({ ...Api.HTTP_WORDS }, { ...old.HTTP_WORDS });
    for (const status of [0, 200, 400, 401, 403, 404, 409, 418, 422, 429, 500, 503, 599]) assert.equal(Api.httpWords(status), old.httpWords(status), String(status));
    for (const text of MESSAGES) {
      assert.equal(Api.messageFromJson(text), old.messageFromJson(text), String(text));
      assert.equal(Api.friendlyApiMessage(text), old.friendlyApiMessage(text), String(text));
    }
  });
}

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKENS = [
  undefined, null, '', 'x', 'a.b', `${b64({ scope: 'score-desk', day: 'd', exp: 5 })}.sig`, `${b64({ scope: 'attendance-desk', day: 'd', exp: 5 })}.sig`,
  `${b64({ day: 'd', exp: 5 })}.sig`, `${b64({ day: 'd' })}.sig`, `${b64({ scope: 'score-desk', day: 7, exp: 5 })}.sig`, `${b64('str')}.sig`, `${b64(null)}.sig`, '%%%.sig',
  Buffer.from(JSON.stringify({ day: 'é', exp: 1 })).toString('base64') + '.x',
];

test('tokens: the scorer page’s scorerDecode and the desk page’s deskDecode are the module’s', () => {
  const scorer = oldCode('_templates/scorer/scorer.html', { functions: ['scorerDecode'], globals: { atob } });
  const desk = oldCode('_templates/attendance/attendance.html', { functions: ['deskDecode'], globals: { atob } });
  for (const token of TOKENS) {
    assert.deepEqual(JSON.parse(JSON.stringify(Tokens.scorerDecode(token))), JSON.parse(JSON.stringify(scorer.scorerDecode(token))), String(token));
    assert.deepEqual(JSON.parse(JSON.stringify(Tokens.deskDecode(token))), JSON.parse(JSON.stringify(desk.deskDecode(token))), String(token));
  }
});

test('tokens: the storage keys are the pages’', () => {
  const scorer = baselinePage('_templates/scorer/scorer.html');
  const desk = baselinePage('_templates/attendance/attendance.html');
  assert.match(scorer, /const SCORER_STORAGE_KEY = `sage\.scorer\.\$\{EVENT_KEY\}`;/);
  assert.match(desk, /const DESK_STORAGE_KEY = `sage\.attendance\.desk\.\$\{EVENT_KEY\}`;/);
  assert.equal(Tokens.scorerStorageKey('E'), 'sage.scorer.E');
  assert.equal(Tokens.deskStorageKey('E'), 'sage.attendance.desk.E');
});
