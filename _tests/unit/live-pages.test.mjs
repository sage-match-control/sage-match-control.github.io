// Every live page is a module script that imports the engine (site-engine-spec
// §4.9 and the Phase 1 acceptance): one inline script, `type="module"`, and no
// classic inline script left.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT, LIVE_PAGES } from '../helpers/paths.mjs';
import { stripComments } from '../helpers/extract.mjs';

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

// Phase 2: the live channel, the registry and the snapshot come from lib/v1/data.
for (const [label, rel] of Object.entries(LIVE_PAGES)) {
  test(`${label} carries no LIVE CHANNEL block and builds its channel from the engine`, () => {
    const text = fs.readFileSync(path.join(SITE_ROOT, rel), 'utf8');
    assert.doesNotMatch(text, /LIVE CHANNEL/, `${rel} still says LIVE CHANNEL`);
    assert.doesNotMatch(text, /function createLiveChannel/, `${rel} defines createLiveChannel`);
    if (/createLiveChannel\(/.test(text)) {
      assert.match(text, /import \{[^}]*createLiveChannel[^}]*\} from '\/lib\/v1\/data\/live-channel\.js'/, `${rel} imports it`);
      assert.match(text, /createLiveChannel\(\{\s*baseUrl: LIVE_BASE_URL,/, `${rel} passes its address as the baseUrl setting`);
      assert.match(text, /const LIVE_BASE_URL = '(wss:\/\/[^']*|)';/, `${rel} keeps LIVE_BASE_URL as a setting`);
    }
  });

  test(`${label} reads event-data only through lib/v1/data`, () => {
    const page = fs.readFileSync(path.join(SITE_ROOT, rel), 'utf8');
    const open = page.indexOf('<script type="module">');
    const text = stripComments(page.slice(open, page.indexOf('</script>', open)));
    assert.doesNotMatch(text, /github\.io\/\$\{GHPAGES|GHPAGES_OWNER|GHPAGES_REPO/, `${rel} builds a GitHub Pages address itself`);
    // (The attendance fixtures, /_fixtures/<event>/attendance-<venue>-<name>.csv, are the attendance block's.)
    assert.doesNotMatch(text, /\/_fixtures\/config\.json|\/_fixtures\/\$\{[\w.]+\}\/\$\{encodeURIComponent\(FIXTURE\)\}\.json/, `${rel} builds a fixture registry or snapshot address itself`);
  });
}
