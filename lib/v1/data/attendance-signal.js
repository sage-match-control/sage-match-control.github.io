// The attendance nudge (sage-docs/docs/specs/.../attendance-push-spec.md).
// One WebSocket per page to the Worker's attendance object for a day. A message says
// only which facility's list changed; the page re-reads it from the API.
import { LIVE_PING_MS, LIVE_PONG_TIMEOUT_MS, LIVE_RETRY_MAX_MS } from './live-channel.js';

export const ATTENDANCE_NUDGE_GAP_MS = 2000;   // at most one re-read per facility this often
export const ATTENDANCE_SETTLE_MS = 11000;     // sage-tools-api's PEOPLE_CACHE_MS (10 s) + 1 s

/**
 * @param {{ baseUrl: string, enabled: boolean, event: string, day: string,
 *           onChange: (facility: string) => void,
 *           onStatus?: (open: boolean) => void }} options
 *   baseUrl   the Worker's wss:// address
 *   enabled   false: never connect (no address, or a local fixture); onStatus(false) is called once, on the next tick
 *   onChange  a facility's list changed: re-read it. Coalesced per facility (see below)
 *   onStatus  true when the socket opens, false when it closes or an attempt fails; once per change
 * @returns {{ isOpen(): boolean, close(): void }}
 */
export function createAttendanceSignal(options){
  const { baseUrl, enabled, event, day, onChange, onStatus } = options;
  let ws = null, closed = false, retries = 0, status = null;   // status: null (unknown) | true | false
  let retryTimer = null, pingTimer = null, pongTimer = null, offTimer = null;
  const facilities = new Map();   // facility -> { last, gapTimer, settleTimer }

  function report(open){
    if(closed || status === open) return;
    status = open;
    if(onStatus) onStatus(open);
  }

  // ---- coalescing: at most one onChange per facility every ATTENDANCE_NUDGE_GAP_MS, and one more
  // ATTENDANCE_SETTLE_MS after the last nudge, because another Cloud Run instance can hold a list up to 10 s old ----
  function fire(facility){
    const rec = facilities.get(facility);
    rec.last = Date.now();
    onChange(facility);
  }
  function nudge(facility){
    let rec = facilities.get(facility);
    if(!rec){ rec = { last: null, gapTimer: null, settleTimer: null }; facilities.set(facility, rec); }
    if(!rec.gapTimer){
      const wait = rec.last === null ? 0 : ATTENDANCE_NUDGE_GAP_MS - (Date.now() - rec.last);
      if(wait <= 0){
        fire(facility);
      }else{
        rec.gapTimer = setTimeout(() => { rec.gapTimer = null; fire(facility); }, wait);
      }
    }
    clearTimeout(rec.settleTimer);
    rec.settleTimer = setTimeout(() => { rec.settleTimer = null; fire(facility); }, ATTENDANCE_SETTLE_MS);
  }

  // ---- the socket ----
  function clearSocketTimers(){
    clearTimeout(retryTimer); clearInterval(pingTimer); clearTimeout(pongTimer);
    retryTimer = pingTimer = pongTimer = null;
  }
  function detach(){
    clearSocketTimers();
    if(ws){
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try { ws.close(); } catch(e){}
      ws = null;
    }
  }
  function scheduleRetry(){
    if(closed) return;
    const delay = Math.min(LIVE_RETRY_MAX_MS, 1000 * 2 ** retries) + Math.random() * 1000;
    retries++;
    retryTimer = setTimeout(open, delay);
  }
  function open(){
    detach();
    if(closed) return;
    const socket = (() => {
      try { return new WebSocket(`${baseUrl}/attendance/${encodeURIComponent(event)}/${encodeURIComponent(day)}`); }
      catch(e){ return null; }
    })();
    if(!socket){ report(false); scheduleRetry(); return; }
    ws = socket;
    ws.onopen = () => {
      retries = 0;
      report(true);
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
      if(!msg || msg.type !== 'attendance' || typeof msg.facility !== 'string') return;
      nudge(msg.facility);
    };
    ws.onclose = () => { clearSocketTimers(); ws = null; report(false); scheduleRetry(); };
    ws.onerror = () => { /* onclose follows */ };
  }

  if(enabled){
    open();
  }else{
    // On the next tick, so the caller has its view by the time it hears.
    offTimer = setTimeout(() => { offTimer = null; report(false); }, 0);
  }

  return {
    isOpen(){ return !!ws && ws.readyState === WebSocket.OPEN; },
    // Stops everything for good: no callback fires again.
    close(){
      closed = true;
      detach();
      clearTimeout(offTimer);
      facilities.forEach(rec => { clearTimeout(rec.gapTimer); clearTimeout(rec.settleTimer); });
      facilities.clear();
    },
  };
}
