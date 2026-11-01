// A team event's page re-skins by its :root tokens alone (_templates/CLAUDE.md §2 step 2). The engine's CSS
// still writes some tints and shadows as literal S.A.G.E. house colours (rgba(124,185,44,…) and so on), which
// a page with its own palette would show unchanged: green winning sides on a pink event. So each team page
// restates every such rule through its tokens, as color-mix(in srgb, var(--token) N%, transparent), which on
// the house palette is exactly the engine's value.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT } from '../helpers/paths.mjs';

const TEAM_PAGES = [
  '_templates/team-tournament-template/index.html',
  '_templates/team-tournament-template/schedule.html',
  'events/ladies-dink-2026/index.html',
  'events/ladies-dink-2026/schedule.html',
];

/** The house palette: each token's channels, as lib/v1/css writes them. */
const HOUSE = {
  '--green': '124,185,44',
  '--green-dark': '92,143,31',
  '--ink': '20,38,60',
  '--navy-deep': '11,24,38',
  '--paper': '246,247,242',
};
const HOUSE_LITERAL = new RegExp(String.raw`rgba\(\s*(${Object.values(HOUSE).map(c => c.replace(/,/g, String.raw`\s*,\s*`)).join('|')})\s*,`);

const squash = s => s.replace(/\s+/g, ' ').replace(/\s*([,{}():;])\s*/g, '$1').trim();
const normalizeRgba = v => v.replace(/rgba\(([^)]*)\)/g, (_, args) => `rgba(${args.split(',').map(a => String(Number(a))).join(',')})`);

/** A token version of a value, as the house palette renders it. */
function asHouse(value) {
  return value.replace(/color-mix\(\s*in srgb\s*,\s*var\(\s*(--[a-z-]+)\s*\)\s*([\d.]+)%\s*,\s*transparent\s*\)/g, (whole, token, pct) => {
    if (!HOUSE[token]) return whole;
    return `rgba(${HOUSE[token]},${Number(pct) / 100})`;
  });
}

/**
 * Every declaration in a stylesheet, with the rule it sits in: { at, selector, prop, value }. `at` is the
 * enclosing at-rule's prelude ('' at the top level); a keyframe step's `at` is its @keyframes prelude.
 */
function declarations(css) {
  const out = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      stack.push(squash(text.slice(start, i)));
      start = i + 1;
    } else if (ch === '}' || ch === ';') {
      const chunk = text.slice(start, i);
      const colon = chunk.indexOf(':');
      if (stack.length && colon > 0 && !stack[stack.length - 1].startsWith('@')) {
        out.push({
          at: stack.length > 1 ? stack[stack.length - 2] : '',
          selector: stack[stack.length - 1],
          prop: chunk.slice(0, colon).trim(),
          value: squash(chunk.slice(colon + 1)),
        });
      }
      if (ch === '}') stack.pop();
      start = i + 1;
    }
  }
  return out;
}

const read = rel => fs.readFileSync(path.join(SITE_ROOT, rel), 'utf8');
const inlineStyle = html => [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const engineSheets = html => [...html.matchAll(/href="\/lib\/v1\/css\/([a-z-]+\.css)"/g)].map(m => `lib/v1/css/${m[1]}`);

for (const rel of TEAM_PAGES) {
  test(`${rel} restates every engine rule written in a house colour through its own tokens`, () => {
    const html = read(rel);
    const own = declarations(inlineStyle(html));
    const sheets = engineSheets(html);
    assert.ok(sheets.length, `${rel} links lib/v1/css`);
    const missing = [];
    for (const sheet of sheets) {
      for (const d of declarations(read(sheet)).filter(d => HOUSE_LITERAL.test(d.value))) {
        const mine = own.filter(o => o.at === d.at && o.selector === d.selector && o.prop === d.prop).pop();
        const where = `${sheet}: ${d.at ? d.at + ' ' : ''}${d.selector} { ${d.prop} }`;
        if (!mine) missing.push(`${where} is not restated`);
        else if (HOUSE_LITERAL.test(mine.value)) missing.push(`${where} is restated in a house colour`);
        else if (normalizeRgba(asHouse(mine.value)) !== normalizeRgba(d.value)) missing.push(`${where} is restated as "${mine.value}", not the engine's "${d.value}" through tokens`);
      }
    }
    assert.deepEqual(missing, []);
  });

  test(`${rel} writes no house colour of its own`, () => {
    const stray = declarations(inlineStyle(read(rel))).filter(d => HOUSE_LITERAL.test(d.value));
    assert.deepEqual(stray.map(d => `${d.selector} { ${d.prop}: ${d.value} }`), []);
  });
}

// The Teams tab's Expand all / Collapse all: the Hub's button has no class of its own (Control Center passes
// one), so a team Hub styles it.
for (const rel of TEAM_PAGES.filter(r => r.endsWith('index.html'))) {
  test(`${rel} styles the Teams tab's Expand all button`, () => {
    const own = declarations(inlineStyle(read(rel)));
    const props = new Set(own.filter(d => d.selector === '.roster-actions button').map(d => d.prop));
    for (const p of ['font-family', 'border', 'border-radius', 'background', 'color', 'cursor']) assert.ok(props.has(p), `.roster-actions button sets ${p}`);
  });
}
