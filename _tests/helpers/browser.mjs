// openPage: one page under identical conditions in either tree
// (site-engine-spec §6.4, the conditions table).
//
//   Clock      fake timers installed at the case's time, then Date held fixed
//              there, so the time moves only when a step moves it (ctx.setTime)
//   Data       events.json and the day snapshots are answered from the case
//   Live Worker  every socket to it is closed at once: the page falls back to
//              polling, as it does when the Worker is down
//   Cloud Run  answered from the case's handler table; an unhandled request
//              fails the case
//   Fonts      Google Fonts answer 200 with an empty body (fallback fonts in
//              both trees)
//   Anything else leaving 127.0.0.1 fails the case with its URL
//   Motion     reduced motion, and transitions, animations and the caret off
//   Errors     a pageerror or console.error fails the case unless it is listed
//   Storage    a fresh browser context per case
import { chromium } from 'playwright';

const GH_PAGES = 'https://sage-match-control.github.io/event-data/';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

const QUIET_CSS = '*{transition:none!important;animation:none!important;caret-color:transparent!important}';

export const launchBrowser = () => chromium.launch();

const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

function allowed(text, allowList) {
  return allowList.some(a => (a instanceof RegExp ? a.test(text) : text.includes(a)));
}

/**
 * @param browser  from launchBrowser()
 * @param url      the page's URL on a site tree
 * @param options
 *   viewport         { width, height }
 *   time             ISO 8601 instant the clock starts and stays at
 *   registry         the object served as event-data/config/events.json
 *   snapshots        { [eventKey]: { [dayKey]: snapshot } } served as the day files
 *   fixtureFiles     { [pathname]: { body, contentType } } any other 127.0.0.1-relative file to answer
 *   external         [{ match: RegExp over the full URL, status?, contentType?, body: string | () => string }] other hosts to answer
 *   cloudRun         [{ method, path: RegExp over the pathname, reply(request) → { status, body } }]
 *   allowErrors      messages (substring or RegExp) a console.error or pageerror may carry
 *   storage          { session: {k: v}, local: {k: v} } seeded before the page's own scripts run
 *   caseId           sent as x-harness-case on every request to the site, so a shared server can
 *                    instantiate this case's templates
 * @returns {Promise<{ page, context, errors: string[], requests: object[], setTime(iso), close() }>}
 */
export async function openPage(browser, url, options = {}) {
  const {
    viewport = { width: 1280, height: 800 },
    time,
    registry,
    snapshots = {},
    fixtureFiles = {},
    external = [],
    cloudRun = [],
    allowErrors = [],
    storage = {},
    caseId,
  } = options;
  const origin = new URL(url).origin;

  const context = await browser.newContext({
    viewport,
    timezoneId: 'Asia/Manila',
    locale: 'en-US',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    deviceScaleFactor: 1,
  });
  const errors = [];
  const requests = [];

  await context.route('**/*', async route => {
    const request = route.request();
    const reqUrl = request.url();
    const u = new URL(reqUrl);

    if (u.origin === origin) {
      const file = fixtureFiles[u.pathname];
      if (file) return route.fulfill({ status: 200, contentType: file.contentType, body: file.body });
      return caseId ? route.continue({ headers: { ...request.headers(), 'x-harness-case': caseId } }) : route.continue();
    }
    if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();

    if (u.hostname === 'fonts.googleapis.com') {
      return route.fulfill({ status: 200, contentType: 'text/css', body: '', headers: CORS });
    }
    if (u.hostname === 'fonts.gstatic.com') {
      return route.fulfill({ status: 200, contentType: 'font/woff2', body: '', headers: CORS });
    }

    if (reqUrl.startsWith(GH_PAGES)) {
      const rest = u.pathname.slice('/event-data/'.length);
      if (rest === 'config/events.json' && registry) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(registry), headers: CORS });
      }
      const m = rest.match(/^([^/]+)\/data\/([^/]+)\.json$/);
      if (m && snapshots[m[1]] && snapshots[m[1]][m[2]]) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshots[m[1]][m[2]]), headers: CORS });
      }
      errors.push(`unrouted request: ${reqUrl}`);
      return route.fulfill({ status: 404, body: 'not in the case', headers: CORS });
    }

    if (/^sage-tools-api-[^.]*\.[^.]+\.run\.app$/.test(u.hostname)) {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      const handler = cloudRun.find(h => (h.method || 'GET') === request.method() && h.path.test(u.pathname));
      if (!handler) {
        errors.push(`unhandled Cloud Run request: ${request.method()} ${reqUrl}`);
        return route.fulfill({ status: 501, contentType: 'application/json', body: '{"error":"not in the case"}', headers: CORS });
      }
      const seen = { method: request.method(), url: reqUrl, pathname: u.pathname, headers: request.headers(), body: request.postData() };
      requests.push(seen);
      const out = handler.reply(seen);
      const body = typeof out.body === 'string' ? out.body : JSON.stringify(out.body);
      return route.fulfill({ status: out.status, contentType: out.contentType || 'application/json', body, headers: CORS });
    }

    const extra = external.find(e => e.match.test(reqUrl));
    if (extra) {
      return route.fulfill({
        status: extra.status || 200,
        contentType: extra.contentType || 'text/plain',
        body: typeof extra.body === 'function' ? extra.body() : (extra.body ?? ''),
        headers: CORS,
      });
    }

    errors.push(`request left 127.0.0.1: ${reqUrl}`);
    return route.abort('failed');
  });

  const seedSession = storage.session || {};
  const seedLocal = storage.local || {};
  await context.addInitScript(({ origin: o, session, local, css }) => {
    if (location.origin === o) {
      try { for (const [k, v] of Object.entries(session)) sessionStorage.setItem(k, v); } catch (e) { /* ignore */ }
      try { for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v); } catch (e) { /* ignore */ }
    }
    const add = () => {
      const parent = document.head || document.documentElement;
      if (!parent || document.getElementById('__engine_harness_quiet')) return;
      const s = document.createElement('style');
      s.id = '__engine_harness_quiet';
      s.textContent = css;
      parent.appendChild(s);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
    add();
  }, { origin, session: seedSession, local: seedLocal, css: QUIET_CSS });

  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (time) {
    await page.clock.install({ time: new Date(time) });
    await page.clock.setFixedTime(new Date(time));
  }
  await page.routeWebSocket(/sage-live/, ws => ws.close());

  page.on('pageerror', err => {
    const text = `pageerror: ${err.message}`;
    if (!allowed(text, allowErrors)) errors.push(text);
  });
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = `console.error: ${msg.text()}`;
    if (!allowed(text, allowErrors)) errors.push(text);
  });

  // Windows can briefly run out of socket buffers under load; that is the machine, not the page.
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'load' });
      break;
    } catch (err) {
      if (attempt >= 3 || !/ERR_NO_BUFFER_SPACE|ERR_CONNECTION_(RESET|REFUSED|CLOSED)/.test(err.message)) throw err;
      await page.waitForTimeout(500 * attempt);
    }
  }

  return {
    page,
    context,
    errors,
    requests,
    setTime: iso => page.clock.setFixedTime(new Date(iso)),
    close: () => context.close(),
  };
}

/** Wait until the page has stopped changing: network idle, two frames, fonts, a short real pause. */
export async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))));
  await page.waitForTimeout(150);
  await page.waitForLoadState('networkidle');
}
