// A rule-level reader for the pages' inline <style> blocks and for lib/v1/css:
// enough CSS to move rules between files and to compare two pages' rules for
// the same selector. It knows rules, @media / @supports nesting, @keyframes and
// comments; it does not interpret declarations.
//
//   rules(css) -> [{ at, selector, body, start, end }]
//     at        the enclosing at-rule's prelude ('' at top level, '@media (…)' inside one)
//     selector  the rule's selector list, whitespace-squeezed
//     body      the declarations between its braces, trimmed
//     start,end the rule's text span in `css` (end is just past its closing brace)

const squeeze = s => s.replace(/\s+/g, ' ').trim();

/** The text of a page's <style> element(s) concatenated, with each block's offset. */
export function styleBlocks(html) {
  const out = [];
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) out.push({ css: m[1], offset: m.index + m[0].indexOf('>') + 1 });
  return out;
}

function skipComment(css, i) {
  const end = css.indexOf('*/', i + 2);
  return end === -1 ? css.length : end + 2;
}

function matchBrace(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') { i = skipComment(css, i) - 1; continue; }
    if (c === '"' || c === "'") { const q = c; i++; while (i < css.length && css[i] !== q) i += css[i] === '\\' ? 2 : 1; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  throw new Error('unclosed brace');
}

export function rules(css, at = '', base = 0) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    if (/\s/.test(css[i])) { i++; continue; }
    if (css[i] === '/' && css[i + 1] === '*') { i = skipComment(css, i); continue; }
    const open = css.indexOf('{', i);
    const semi = css.indexOf(';', i);
    if (open === -1) break;
    if (semi !== -1 && semi < open && css[i] === '@') { i = semi + 1; continue; } // @import, @charset
    const prelude = css.slice(i, open);
    const close = matchBrace(css, open);
    const body = css.slice(open + 1, close);
    if (prelude.trimStart().startsWith('@')) {
      const name = prelude.trimStart().split(/[\s({]/)[0];
      if (name === '@media' || name === '@supports' || name === '@layer') {
        out.push(...rules(body, squeeze(prelude), base + open + 1));
      } else {
        out.push({ at, selector: squeeze(prelude), body: body.trim(), start: base + i, end: base + close + 1, atRule: true });
      }
    } else {
      out.push({ at, selector: squeeze(prelude.replace(/\/\*[\s\S]*?\*\//g, '')), body: body.trim(), start: base + i, end: base + close + 1 });
    }
    i = close + 1;
  }
  return out;
}

/** Every rule of every <style> in a page, with offsets into the page's text. */
export function pageRules(html) {
  return styleBlocks(html).flatMap(b => rules(b.css, '', b.offset));
}

/** Declarations as a sorted, normalised list, for comparing two bodies. */
export function declarations(body) {
  return body.replace(/\/\*[\s\S]*?\*\//g, '').split(';').map(d => squeeze(d)).filter(Boolean).sort();
}
