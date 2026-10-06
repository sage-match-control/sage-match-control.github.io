// Pull a function or a top-level `const NAME = …;` out of a page's text, and
// replace a const's initializer. Used by the harness (settings of a finished
// event's pages, §6.3) and by the characterization tests (the old function's
// text from the baseline page, site-engine-spec §5.2).
//
// It is a scanner, not a parser: it knows enough JavaScript to skip strings,
// template literals (with nested `${}`), comments and regex literals while it
// matches brackets, and nothing more. unit/extract.test.mjs checks it against
// every function in every live page.

const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await',
]);

function isRegexStart(text, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  if (j < 0) return true;
  const c = text[j];
  if ('(,=:[!&|?{};+-*%<>~^'.includes(c)) return true;
  if (/[A-Za-z_$]/.test(c)) {
    let k = j;
    while (k >= 0 && /[\w$]/.test(text[k])) k--;
    return REGEX_KEYWORDS.has(text.slice(k + 1, j + 1));
  }
  return false; // ')' ']' an identifier or a number: a division
}

/** If a string, template, comment or regex starts at i, the index just past it; else -1. */
function skipNonCode(text, i) {
  const c = text[i];
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
    return j + 1;
  }
  if (c === '`') {
    let j = i + 1;
    while (j < text.length && text[j] !== '`') {
      if (text[j] === '\\') j += 2;
      else if (text[j] === '$' && text[j + 1] === '{') j = matchBracket(text, j + 1) + 1;
      else j++;
    }
    return j + 1;
  }
  if (c === '/') {
    if (text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      return end === -1 ? text.length : end;
    }
    if (text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      return end === -1 ? text.length : end + 2;
    }
    if (isRegexStart(text, i)) {
      let j = i + 1, inClass = false;
      while (j < text.length) {
        const d = text[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        else if (d === '\n') return -1; // not a regex after all
        j++;
      }
      j++;
      while (/[a-z]/.test(text[j] || '')) j++;
      return j;
    }
  }
  return -1;
}

/** The index of the bracket that closes the one at `open`. */
export function matchBracket(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const skipped = skipNonCode(text, i);
    if (skipped !== -1) { i = skipped - 1; continue; }
    const c = text[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`no closing bracket for the one at index ${open}`);
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The text of `function NAME(...) { ... }` (or `async function`), from its
 * first keyword to its closing brace. Prefers a column-0 declaration.
 * Returns null when there is none.
 */
export function extractFunction(text, name) {
  const re = new RegExp(`^([ \\t]*)(async[ \\t]+)?function[ \\t]*\\*?[ \\t]*${escapeRe(name)}[ \\t]*\\(`, 'gm');
  const hits = [...text.matchAll(re)];
  if (!hits.length) return null;
  const hit = hits.find(m => m[1] === '') || hits[0];
  const start = hit.index + hit[1].length;
  const paren = text.indexOf('(', start + (hit[0].length - hit[1].length) - 1);
  const afterParams = matchBracket(text, paren) + 1;
  const brace = text.indexOf('{', afterParams);
  return text.slice(start, matchBracket(text, brace) + 1);
}

/**
 * A top-level `const|let|var NAME = <initializer>;`. Returns
 * `{ start, end, initStart, initEnd, text, init }` (indexes into `text`;
 * `initEnd` is before the `;`), or null.
 */
export function extractConst(text, name) {
  const re = new RegExp(`^(const|let|var)[ \\t]+${escapeRe(name)}[ \\t]*=`, 'm');
  const hit = re.exec(text);
  if (!hit) return null;
  const initStart = hit.index + hit[0].length;
  let depth = 0, i = initStart;
  for (; i < text.length; i++) {
    const skipped = skipNonCode(text, i);
    if (skipped !== -1) { i = skipped - 1; continue; }
    const c = text[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === ';' && depth === 0) break;
  }
  const initEnd = i;
  return {
    start: hit.index,
    end: i + 1,
    initStart,
    initEnd,
    text: text.slice(hit.index, i + 1),
    init: text.slice(initStart, initEnd).trim(),
  };
}

/** The value of a const whose initializer is a plain literal (object, array, string, null). */
export function constValue(text, name) {
  const c = extractConst(text, name);
  if (!c) return undefined;
  return new Function(`return (${c.init});`)();
}

/** `text` with the initializer of `const NAME = …;` replaced by `literal` (JavaScript source). */
export function replaceConst(text, name, literal) {
  const c = extractConst(text, name);
  if (!c) return null;
  return text.slice(0, c.initStart) + ' ' + literal + text.slice(c.initEnd);
}

/** The names of every column-0 `function NAME(` in `text`, in order. */
export function functionNames(text) {
  return [...text.matchAll(/^(?:async[ \t]+)?function[ \t]*\*?[ \t]*([A-Za-z_$][\w$]*)[ \t]*\(/gm)].map(m => m[1]);
}

/** `text` with comments removed (strings, templates and regexes are kept as written). */
export function stripComments(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const skipped = skipNonCode(text, i);
    if (skipped === -1) { out += text[i]; continue; }
    const chunk = text.slice(i, skipped);
    if (!(chunk.startsWith('//') || chunk.startsWith('/*'))) out += chunk;
    else if (chunk.startsWith('//')) out += '';
    i = skipped - 1;
  }
  return out;
}

/** `text` with comments removed and the inside of strings and templates blanked: the code and nothing else. */
export function codeSkeleton(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const skipped = skipNonCode(text, i);
    if (skipped === -1) { out += text[i]; continue; }
    const chunk = text.slice(i, skipped);
    if (chunk.startsWith('//') || chunk.startsWith('/*')) { /* dropped */ }
    else if (/^["'`]/.test(chunk)) out += chunk[0] + chunk[0];
    else out += chunk; // a regex literal
    i = skipped - 1;
  }
  return out;
}
