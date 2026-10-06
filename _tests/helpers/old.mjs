// The old code, for the characterization tests (site-engine-spec §5.2): a
// function's text taken from the baseline page (the repo at the merge-base
// with main, so it stays the page as it was whatever this branch does to it),
// evaluated in a node:vm context together with the constants it reads.
//
// Delete the characterization tests, and this, once Phase 5 has merged: the
// unit tests are the record from then on.
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { SITE_ROOT } from './paths.mjs';
import { baselineCommit } from './baseline.mjs';
import { extractFunction, extractConst } from './extract.mjs';

const pageCache = new Map();

/** The text of a page (repo-relative path) at the baseline commit. */
export function baselinePage(rel) {
  if (!pageCache.has(rel)) {
    const text = execFileSync('git', ['show', `${baselineCommit()}:${rel}`], { cwd: SITE_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    pageCache.set(rel, text);
  }
  return pageCache.get(rel);
}

/**
 * Evaluate named top-level functions and consts of a baseline page.
 * @param {string} rel      page path, e.g. 'tools/control-center.html'
 * @param {object} spec
 *   functions  names of `function NAME(` declarations to take
 *   consts     names of `const NAME = …;` declarations to take (taken first)
 *   globals    page globals the code reads (CURRENT_TYPE, MATCHES, …); assign
 *              to the returned object's properties to change them between calls
 *   prelude    extra source evaluated first (a stub for a page helper)
 * @returns {object} the context: every taken function and const is a property, and so is every global
 */
export function oldCode(rel, { functions = [], consts = [], globals = {}, prelude = '' } = {}) {
  const text = baselinePage(rel);
  const parts = [prelude];
  for (const name of consts) {
    const c = extractConst(text, name);
    if (!c) throw new Error(`${rel} has no const ${name}`);
    parts.push(c.text);
  }
  for (const name of functions) {
    const fn = extractFunction(text, name);
    if (!fn) throw new Error(`${rel} has no function ${name}`);
    parts.push(fn);
  }
  const names = [...consts, ...functions];
  parts.push(`;globalThis.__taken = { ${names.join(', ')} };`);
  const sandbox = { ...globals, Math, JSON, Map, Set, Intl, console };
  vm.createContext(sandbox);
  vm.runInContext(parts.join('\n'), sandbox, { filename: rel });
  return Object.assign(sandbox, sandbox.__taken);
}

/**
 * A value from the vm realm as plain main-realm data, so it can be compared
 * with assert.deepStrictEqual: Maps and Sets become tagged arrays, objects are
 * copied, undefined and NaN survive.
 */
export function plain(v) {
  if (v === null || typeof v !== 'object') return typeof v === 'function' ? '[function]' : v;
  if (v instanceof Map || Object.prototype.toString.call(v) === '[object Map]') return { __map: [...v].map(([k, x]) => [plain(k), plain(x)]) };
  if (v instanceof Set || Object.prototype.toString.call(v) === '[object Set]') return { __set: [...v].map(plain) };
  // Array.from: v.map would build the result in the vm's realm.
  if (Array.isArray(v)) return Array.from(v, plain);
  const out = {};
  for (const k of Object.keys(v)) out[k] = plain(v[k]);
  return out;
}

/** Remove `keys` from every object in a plain structure (a field the new code deliberately adds). */
export function without(v, keys) {
  if (Array.isArray(v)) return Array.from(v, x => without(x, keys));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) if (!keys.includes(k)) out[k] = without(v[k], keys);
    return out;
  }
  return v;
}
