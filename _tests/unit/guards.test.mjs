// The engine's dependency rules (site-engine-spec §4.2) and its one separation
// of concerns (§4.10): nothing under views/ or domain/ knows what an operator is.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT } from '../helpers/paths.mjs';
import { stripComments, codeSkeleton } from '../helpers/extract.mjs';

const LIB = path.join(SITE_ROOT, 'lib', 'v1');

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) yield* walk(full);
    else if (name.endsWith('.js')) yield full;
  }
}

const files = [...walk(LIB)].map(full => ({ full, rel: path.relative(LIB, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') }));
const layer = rel => (rel === 'platform.js' ? 'platform' : rel.split('/')[0]);

/** Every static, re-exported and dynamic import specifier of a file, resolved to a path under lib/v1. */
function importsOf(file) {
  const code = stripComments(file.text);
  const specs = [...code.matchAll(/(?:import|export)\s+(?:[^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]/g)].map(m => m[1])
    .concat([...code.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]));
  return specs.map(spec => {
    if (!spec.startsWith('.')) return { spec, external: true };
    const target = path.relative(LIB, path.resolve(path.dirname(file.full), spec)).split(path.sep).join('/');
    return { spec, target };
  });
}

const ALLOWED = {
  platform: [],
  domain: ['domain'],
  data: ['platform', 'domain', 'data'],
  views: ['domain', 'views'],
  apps: ['platform', 'domain', 'data', 'views'],
};

test('there are engine files to check', () => {
  assert.ok(files.length > 10);
  for (const f of files) assert.ok(layer(f.rel) in ALLOWED || f.rel.startsWith('css/'), `${f.rel} is in a known layer`);
});

for (const file of files) {
  const from = layer(file.rel);
  if (!(from in ALLOWED)) continue;
  test(`${file.rel} imports only what ${from} may import`, () => {
    for (const imp of importsOf(file)) {
      assert.ok(!imp.external, `${file.rel} imports ${imp.spec}: nothing outside lib/v1`);
      const to = layer(imp.target);
      assert.ok(ALLOWED[from].includes(to), `${file.rel} (${from}) imports ${imp.target} (${to})`);
      if (from === 'apps') assert.notEqual(to, 'apps', `${file.rel}: an app imports no other app`);
    }
  });
}

const BROWSER_GLOBALS = /\b(document|window|fetch|localStorage|sessionStorage|location|navigator|setTimeout|setInterval|clearTimeout|clearInterval|requestAnimationFrame|history|Date\.now)\b/;

for (const file of files.filter(f => layer(f.rel) === 'domain')) {
  test(`${file.rel} uses no browser global (a domain function that needs the time takes \`now\`)`, () => {
    const code = codeSkeleton(file.text);
    const hit = code.match(BROWSER_GLOBALS);
    assert.equal(hit, null, hit && `${file.rel} mentions ${hit[0]}`);
  });
}

// Words that name an operator feature. They belong to Control Center's own
// script, which attaches to the shared core through extension points (§4.10).
const OPERATOR_WORDS = /getToken|authToken|signIn|scoreEntry|scoreable|organizer|missionControl|CLOUD_RUN/i;
const OPERATOR_COMPONENTS = ['views/score-dialog.js', 'views/attendance-view.js'];

for (const file of files.filter(f => ['views', 'domain'].includes(layer(f.rel)) && !OPERATOR_COMPONENTS.includes(f.rel))) {
  test(`${file.rel} names no operator feature`, () => {
    const hit = stripComments(file.text).match(OPERATOR_WORDS);
    assert.equal(hit, null, hit && `${file.rel} mentions ${hit[0]}`);
  });
}

test('no page-naming flag in a function the Hub and Control Center share (§4.10)', () => {
  for (const file of files.filter(f => ['views', 'domain'].includes(layer(f.rel)))) {
    const hit = stripComments(file.text).match(/\b(isConsole|isHub|mode\s*[:=]\s*['"](?:hub|console)['"])/);
    assert.equal(hit, null, hit && `${file.rel} has the flag ${hit[0]}`);
  }
});
