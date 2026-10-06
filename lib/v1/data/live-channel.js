// The live channel (sage-docs/docs/specs/.../durable-object-push-spec.md §7).
//
// Receives each new snapshot the moment Cloud Run publishes it, over one
// WebSocket per page. GitHub Pages polling stays as the fallback: whenever the
// socket isn't open, fetchDaySnapshot (data/snapshot.js) polls GitHub exactly
// as before.
//
// This is the block every page used to carry a byte-identical copy of. The
// Worker's address is now the page's `baseUrl` setting: '' turns push off for
// that page, which a finished event's pages do (_templates/CLAUDE.md §7).

export const LIVE_PING_MS = 50000;          // under Cloudflare's idle-connection timeout
export const LIVE_PONG_TIMEOUT_MS = 10000;  // no pong by then: treat the socket as dead
export const LIVE_SAFETY_POLL_MS = 60000;   // while connected, still check GitHub this often
export const LIVE_RETRY_MAX_MS = 30000;

/**
 * @param {{ baseUrl: string, enabled: boolean, onSnapshot: () => void }} options
 *   baseUrl     the Worker's wss:// address, e.g. 'wss://sage-live.<subdomain>.workers.dev'
 *   enabled     false: never connect (no address, or a local fixture)
 *   onSnapshot  called after every pushed snapshot has been kept; the page re-reads it through fetchDaySnapshot
 */
export function createLiveChannel({ baseUrl, enabled, onSnapshot }){
  let ws = null, key = null, latest = null, paused = false;
  let retries = 0, retryTimer = null, pingTimer = null, pongTimer = null;
  let lastSafetyPoll = 0;

  const stamp = s => Date.parse((s && (s.publishedAt || s.generatedAt)) || 0) || 0;

  function clearTimers(){
    clearTimeout(retryTimer); clearInterval(pingTimer); clearTimeout(pongTimer);
    retryTimer = pingTimer = pongTimer = null;
  }
  function close(){
    clearTimers();
    if(ws){ ws.onclose = null; try { ws.close(); } catch(e){} ws = null; }
  }
  function scheduleRetry(){
    if(paused || !key) return;
    const delay = Math.min(LIVE_RETRY_MAX_MS, 1000 * 2 ** retries) + Math.random() * 1000;
    retries++;
    retryTimer = setTimeout(open, delay);
  }
  function open(){
    close();
    if(!enabled || paused || !key) return;
    const myKey = key;
    ws = new WebSocket(`${baseUrl}/live/${myKey.event}/${myKey.day}`);
    ws.onopen = () => {
      retries = 0;
      pingTimer = setInterval(() => {
        try { ws.send('ping'); } catch(e){}
        clearTimeout(pongTimer);
        pongTimer = setTimeout(() => { try { ws.close(); } catch(e){} }, LIVE_PONG_TIMEOUT_MS);
      }, LIVE_PING_MS);
    };
    ws.onmessage = ev => {
      clearTimeout(pongTimer);
      if(ev.data === 'pong') return;
      let msg; try { msg = JSON.parse(ev.data); } catch(e){ return; }
      if(msg.type !== 'snapshot' || !msg.snapshot) return;
      if(!key || key.event !== myKey.event || key.day !== myKey.day) return; // switched away
      if(latest && latest.key === `${myKey.event}/${myKey.day}` && msg.version <= latest.version) return;
      latest = { key: `${myKey.event}/${myKey.day}`, version: msg.version, snapshot: msg.snapshot };
      onSnapshot();
    };
    ws.onclose = () => { clearTimers(); ws = null; scheduleRetry(); };
    ws.onerror = () => { /* onclose follows */ };
  }

  return {
    // Point the channel at a day (or at nothing with null). Reconnects.
    follow(event, day){
      const next = event && day ? { event, day } : null;
      if(next && key && next.event === key.event && next.day === key.day) return;
      key = next; retries = 0; open();
    },
    pause(){ paused = true; close(); },
    resume(){ paused = false; retries = 0; open(); },
    isOpen(){ return !!ws && ws.readyState === WebSocket.OPEN; },
    // What fetchDaySnapshot should return, or null to fetch from GitHub.
    cached(event, day){
      if(!this.isOpen() || !latest || latest.key !== `${event}/${day}`) return null;
      if(Date.now() - lastSafetyPoll > LIVE_SAFETY_POLL_MS) return null; // time for a GitHub check
      return latest.snapshot;
    },
    // Called with every snapshot fetched from GitHub: returns whichever of
    // it and the pushed one is newer. Catches a push path that has quietly
    // stopped while the socket stays open (e.g. Cloud Run's live publish failing).
    newer(event, day, fetched){
      lastSafetyPoll = Date.now();
      if(!latest || latest.key !== `${event}/${day}`) return fetched;
      return stamp(fetched) > stamp(latest.snapshot) ? fetched : latest.snapshot;
    },
  };
}
