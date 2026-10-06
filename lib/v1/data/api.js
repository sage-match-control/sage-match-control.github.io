// Cloud Run (sage-tools-api): a request with a timeout and the operator's or
// link's token, and the errors it answers with turned into words.
//
// What the API and the services behind it say when they fail:
//   GitHub commit failed: HTTP 409 {"message":"is at abc but expected def","documentation_url":"…"}
//   live Worker publish failed: HTTP 401 {"error":"unauthorized"}
// friendlyApiMessage turns each "HTTP <status> <json>" into words plus the
// JSON's own message.

import { FETCH_TIMEOUT_MS } from '../platform.js';

export const HTTP_WORDS = {
  400: 'rejected the request', 401: 'refused the credentials', 403: 'refused access',
  404: 'was not found', 409: 'reported a conflict', 422: 'rejected the data',
  429: 'is rate-limiting requests'
};
export function httpWords(status){
  return HTTP_WORDS[status] || (status >= 500 ? 'had a server error' : 'answered with an error');
}

/**
 * The human part of a JSON error body: Google's { error: { message } },
 * GitHub's { message }, the Worker's and this API's { error }. Null if none.
 */
export function messageFromJson(text){
  try{
    const o = JSON.parse(text);
    if(o && typeof o === 'object'){
      if(o.error && typeof o.error === 'object' && typeof o.error.message === 'string') return o.error.message;
      if(typeof o.message === 'string') return o.message;
      if(typeof o.error === 'string') return o.error;
    }
  } catch(e){}
  return null;
}

export function friendlyApiMessage(raw){
  let s = String(raw || '').trim();
  if(s.startsWith('{')){
    const whole = messageFromJson(s);
    if(whole) s = whole;
  }
  // "HTTP 403 {…}" up to the end of that reason (the next "; " or the end).
  s = s.replace(/HTTP (\d{3})\s*(\{[\s\S]*?\})(?=\s*(?:;\s|$))/g, (m, status, json) => {
    const inner = messageFromJson(json);
    return `${httpWords(+status)} (${status})` + (inner ? ` — ${inner}` : '');
  });
  // A bare "HTTP 500" (no message from the server) needs a subject.
  const bare = /^HTTP \d{3}$/.test(s);
  s = s.replace(/\bHTTP (\d{3})\b/g, (m, status) => `${httpWords(+status)} (${status})`);
  s = s.replace(/timed out after (\d+)ms/g, (m, ms) => `timed out after ${Math.round(ms / 100) / 10} s`);
  return bare ? `Cloud Run ${s}` : s;
}

/**
 * A JSON request. Resolves to the parsed body. Rejects with Error(body.error ||
 * "HTTP <status>"), carrying `status` and `body`; a request that never got an
 * answer rejects with no status, and one that outlived `timeoutMs` with
 * Error('timed out').
 * @param {string} url
 * @param {{ method?: string, body?: any, token?: string|null, timeoutMs?: number }} [options]
 */
export async function fetchJson(url, { method = 'GET', body, token = null, timeoutMs = FETCH_TIMEOUT_MS } = {}){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {};
  if(token) headers.Authorization = `Bearer ${token}`;
  if(body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(url, {
      method, headers, cache: 'no-store', signal: controller.signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let parsed = null;
    try { parsed = await res.json(); } catch(e){ /* not JSON */ }
    if(!res.ok){
      const err = new Error((parsed && typeof parsed.error === 'string' && parsed.error) || `HTTP ${res.status}`);
      err.status = res.status;
      err.body = parsed;
      throw err;
    }
    return parsed;
  } catch(err){
    if(err.name === 'AbortError') throw new Error('timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
