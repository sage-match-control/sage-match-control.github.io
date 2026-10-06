// The engine's reason to exist (site-engine-spec §3.1 goal 1): one copy on the
// site of every function used by more than one live page. No live page may
// define a function that a lib/v1/ module exports.
//
// A one-line wrapper is the exception while the engine is being adopted
// (site-engine-spec §7.1 step 3): where the engine's version takes `type`,
// `display` or `now` as a parameter, a page keeps
//     const parseCode = code => Codes.parseCode(code, CURRENT_TYPE);
// until its callers move into the engine. A wrapper is a definition whose body
// calls the same name on a namespace the page imports (`import * as Codes`) and
// is short: it passes the page's state, and nothing else is in it.
// Phase 5 removes every wrapper and sets ALLOW_WRAPPERS to false.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT, LIVE_PAGES } from '../helpers/paths.mjs';
import { extractFunction, extractConst, functionNames, stripComments } from '../helpers/extract.mjs';

const ALLOW_WRAPPERS = true;
// Names the engine exports but a page may still define: shrinks every phase,
// and is empty once Phase 5 has merged.
const PENDING = [];

const LIB = path.join(SITE_ROOT, 'lib', 'v1');

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) yield* walk(full);
    else if (name.endsWith('.js')) yield full;
  }
}

/** Every name the engine exports. */
function engineExports() {
  const names = new Set();
  for (const file of walk(LIB)) {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    for (const m of code.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
    for (const m of code.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop();
        if (name) names.add(name);
      }
    }
  }
  return names;
}

/** The functions and arrow-function consts a page defines at its top level. */
function definitions(text) {
  const defs = [];
  for (const name of functionNames(text)) defs.push({ name, text: extractFunction(text, name) });
  for (const m of text.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/gm)) {
    defs.push({ name: m[1], text: extractConst(text, m[1]).text });
  }
  return defs;
}

const isWrapper = (def, namespaces) => {
  const code = stripComments(def.text);
  return code.length < 900 && namespaces.some(ns => new RegExp(String.raw`\b${ns}\.${def.name}\(`).test(code));
};

const exported = engineExports();

for (const [label, rel] of Object.entries(LIVE_PAGES)) {
  test(`${label} defines nothing the engine exports`, () => {
    const text = fs.readFileSync(path.join(SITE_ROOT, rel), 'utf8');
    const namespaces = [...text.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]\/lib\/v1\//g)].map(m => m[1]);
    const copies = definitions(text)
      .filter(d => exported.has(d.name) && !PENDING.includes(d.name))
      .filter(d => !(ALLOW_WRAPPERS && isWrapper(d, namespaces)))
      .map(d => d.name);
    assert.deepEqual(copies, [], `${rel} still defines ${copies.join(', ')}, which lib/v1 exports`);
  });
}

test('the engine exports something to be copied', () => {
  assert.ok(exported.has('parseCSV') && exported.has('rowsToMatches') && exported.size > 100, `${exported.size} exports`);
});
