// The extractor has to be right on the real pages, because the harness and the
// characterization tests both trust it. Every column-0 function in every live
// page must come back whole.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT, LIVE_PAGES } from '../helpers/paths.mjs';
import { extractFunction, extractConst, functionNames, replaceConst, constValue, matchBracket } from '../helpers/extract.mjs';

for (const [label, rel] of Object.entries(LIVE_PAGES)) {
  test(`extractFunction returns every function of ${label} whole`, () => {
    const text = fs.readFileSync(path.join(SITE_ROOT, rel), 'utf8');
    const names = functionNames(text);
    assert.ok(names.length > 5, 'found functions');
    for (const name of names) {
      const fn = extractFunction(text, name);
      assert.ok(fn, `${name} extracted`);
      assert.ok(fn.endsWith('}'), `${name} ends at a brace`);
      // A function declared at column 0 closes on a line of its own when it
      // spans lines, and on the line it opened on when it does not.
      if (fn.includes('\n')) assert.equal(fn.split('\n').pop(), '}', `${name} closes at column 0`);
    }
  });
}

test('extractConst reads objects, arrays, strings, regexes and template literals', () => {
  const text = [
    String.raw`const A = { a: [1, 2, { b: '}' }], c: ` + '`x${\'}\'}y`' + String.raw` }; // trailing`,
    String.raw`const B = 'it\'s;';`,
    String.raw`const C = /[;}]\//g;`,
    'let D = [',
    '  { k: 1 },',
    '];',
    'const E = 5',
  ].join('\n');
  assert.equal(extractConst(text, 'A').init, String.raw`{ a: [1, 2, { b: '}' }], c: ` + '`x${\'}\'}y`' + ' }');
  assert.equal(extractConst(text, 'B').init, String.raw`'it\'s;'`);
  assert.equal(extractConst(text, 'C').init, String.raw`/[;}]\//g`);
  assert.deepEqual(constValue(text, 'D'), [{ k: 1 }]);
  assert.equal(extractConst(text, 'Z'), null);
});

test('replaceConst swaps only the initializer', () => {
  const text = 'const X = 1; // keep\nconst Y = [2];\n';
  assert.equal(replaceConst(text, 'X', '"two"'), 'const X = "two"; // keep\nconst Y = [2];\n');
  assert.equal(replaceConst(text, 'Q', '1'), null);
});

test('matchBracket ignores brackets inside strings, comments and regexes', () => {
  const text = String.raw`f(')', /\)/, ` + '`)${(1)}`' + String.raw`, /* ) */ x) // )` + '\n';
  assert.equal(matchBracket(text, 1), text.indexOf('x)') + 1);
});

test('the settings of the finished events read as plain literals', () => {
  for (const ev of ['piggleball-2026', 'pickle-for-sight-2026', 'pnf-x-bup-dual-meet']) {
    const text = fs.readFileSync(path.join(SITE_ROOT, 'events', ev, 'index.html'), 'utf8');
    assert.ok(Array.isArray(constValue(text, 'DAYS')), `${ev} DAYS`);
    assert.ok(Array.isArray(constValue(text, 'FACILITIES')), `${ev} FACILITIES`);
    assert.equal(typeof constValue(text, 'DIVISIONS'), 'object', `${ev} DIVISIONS`);
    assert.equal(typeof constValue(text, 'EVENTS'), 'object', `${ev} EVENTS`);
  }
});
