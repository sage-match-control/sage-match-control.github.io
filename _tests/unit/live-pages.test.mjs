// Every live page is a module script that imports the engine (site-engine-spec
// §4.9 and the Phase 1 acceptance): one inline script, `type="module"`, and no
// classic inline script left.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT, LIVE_PAGES } from '../helpers/paths.mjs';

for (const [label, rel] of Object.entries(LIVE_PAGES)) {
  test(`${label} runs its script as a module that imports /lib/v1/`, () => {
    const text = fs.readFileSync(path.join(SITE_ROOT, rel), 'utf8');
    const scripts = [...text.matchAll(/<script\b([^>]*)>/g)].map(m => m[1].trim());
    const inline = scripts.filter(attrs => !/\bsrc=/.test(attrs));
    assert.deepEqual(inline, ['type="module"'], `${rel}: its inline scripts`);
    const module = text.slice(text.indexOf('<script type="module">'), text.indexOf('</script>', text.indexOf('<script type="module">')));
    assert.match(module, /import\b[^;]*from\s+'\/lib\/v1\//, `${rel} imports the engine`);
    for (const m of module.matchAll(/from\s+'([^']+)'/g)) assert.ok(m[1].startsWith('/lib/v1/'), `${rel}: ${m[1]} is a root-absolute engine path`);
  });
}
