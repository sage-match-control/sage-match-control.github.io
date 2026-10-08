// The tokens that arrive in a link: a scorer link (?scorer=…) lets staff enter
// scores for a day, a desk link (?desk=…) lets them check people in. Neither
// page checks a token's signature in the browser: the payload is only read for
// display (the day, and whether it has run out). The API decides what a token
// may do.

export const scorerStorageKey = eventKey => `sage.scorer.${eventKey}`;
export const deskStorageKey = eventKey => `sage.attendance.desk.${eventKey}`;

// The API writes the payload as UTF-8 JSON. atob() gives one character per byte, so the bytes are
// decoded as UTF-8 here, or a name like "Niño" would read as mojibake.
function decodePayload(token){
  const part = String(token).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(part + '='.repeat((4 - part.length % 4) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
}

/**
 * A scorer token's payload { scope: 'score-desk', day, exp, to?, note? }, or null if it isn't one.
 * `to` and `note` say who the link was issued to; they are there only when the operator gave them.
 */
export function scorerDecode(token){
  try{
    const json = decodePayload(token);
    return json && json.scope === 'score-desk' && typeof json.day === 'string' && typeof json.exp === 'number' ? json : null;
  }catch(e){ return null; }
}

/** A desk token's payload { day, exp, to?, note? }, or null if it isn't one. */
export function deskDecode(token){
  try{
    const json = decodePayload(token);
    return json && typeof json.day === 'string' && typeof json.exp === 'number' ? json : null;
  }catch(e){ return null; }
}

function store(key, value){ try{ localStorage.setItem(key, value); }catch(e){} }
function recall(key){ try{ return localStorage.getItem(key); }catch(e){ return null; } }

/**
 * A link carries the token as ?<param>=…: keep it (a newer link replaces an
 * older one), then drop it from the address bar so it does not show in
 * screenshots or reshared links. Returns the stored token, or null.
 */
function loadToken(param, storageKey){
  const params = new URLSearchParams(location.search);
  const fromLink = params.get(param);
  if(fromLink){
    store(storageKey, JSON.stringify({ token: fromLink }));
    params.delete(param);
    const rest = params.toString();
    try{ history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash); }catch(e){}
  }
  try{
    const stored = JSON.parse(recall(storageKey) || 'null');
    return stored && stored.token ? stored.token : null;
  }catch(e){ return null; }
}

export const scorerLoadToken = eventKey => loadToken('scorer', scorerStorageKey(eventKey));
export const deskLoadToken = eventKey => loadToken('desk', deskStorageKey(eventKey));
