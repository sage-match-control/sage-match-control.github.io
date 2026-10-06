// A static server for one tree of the site (site-engine-spec §6.3): the
// baseline worktree or the working tree. One server serves a whole run: the
// case a request belongs to arrives in an x-harness-case header (see
// openPage's caseId), and `register(caseId, instantiate)` says how to fill in
// that case's templates. (A server per case ran a long run out of sockets.)
// It does what GitHub Pages does (an extensionless path is its .html file, a
// folder is its index.html) and instantiates any file under _templates/ as it
// is served:
//
//   1. settings: for each name in SETTING_NAMES that the file declares as a
//      top-level `const NAME =`, the initializer is replaced with the case's
//      value, written as a JavaScript literal. A shell that no longer declares
//      a name is simply left alone, so one case table drives both trees;
//   2. tokens: every {{TOKEN}} is replaced from the case's token table, and a
//      token the table does not have answers 500 with its name.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { replaceConst } from './extract.mjs';

export const SETTING_NAMES = ['EVENT_KEY', 'DAYS', 'FACILITIES', 'DIVISIONS', 'EVENTS', 'CLUBS', 'DAY_KEY', 'CAT_META'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

/** `text` instantiated for a case: settings first, then tokens. Throws `UnknownToken` naming a missing token. */
export function instantiateTemplate(text, { tokens = {}, settings = {} } = {}) {
  let out = text;
  for (const name of SETTING_NAMES) {
    if (!(name in settings)) continue;
    const replaced = replaceConst(out, name, JSON.stringify(settings[name], null, 2));
    if (replaced !== null) out = replaced;
  }
  out = out.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole, name) => {
    if (!(name in tokens)) throw Object.assign(new Error(`unknown token ${name}`), { token: name });
    return tokens[name];
  });
  return out;
}

function resolveFile(root, urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const full = path.join(root, clean);
  if (!full.startsWith(root)) return null;
  const tries = [full, full + '.html', path.join(full, 'index.html')];
  for (const candidate of tries) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* next */ }
  }
  return null;
}

/**
 * Serve `root` on 127.0.0.1, port 0.
 * `instantiate` is `{ tokens, settings }` for files under _templates/, or null to serve them as they are;
 * it applies to requests that name no registered case.
 * Returns `{ baseUrl, close, register(caseId, instantiate) }`.
 */
export async function startSite({ root, instantiate = null }) {
  const rootDir = path.resolve(root);
  const registered = new Map();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const file = resolveFile(rootDir, url.pathname);
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(`not found: ${url.pathname}`);
      return;
    }
    let body = fs.readFileSync(file);
    const rel = path.relative(rootDir, file).split(path.sep).join('/');
    const forCase = registered.has(req.headers['x-harness-case']) ? registered.get(req.headers['x-harness-case']) : instantiate;
    if (forCase && rel.startsWith('_templates/') && rel.endsWith('.html')) {
      try {
        body = Buffer.from(instantiateTemplate(body.toString('utf8'), forCase));
      } catch (err) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(err.message);
        return;
      }
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    register: (caseId, forCase) => registered.set(caseId, forCase),
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}
