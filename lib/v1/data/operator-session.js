// The operator's sign-in, shared between this browser's open pages of the site
// (sage-docs/docs/specs/.../mission-control-layout-spec.md §6). A BroadcastChannel
// reaches only same-origin pages in this browser profile: never another device,
// another browser or a private window. It carries { token, expiresAt } and nothing
// else; nothing here touches storage or a URL.
//
// Messages: { type: 'ask' }, { type: 'session', token, expiresAt }, { type: 'signed-out' }.

export const OPERATOR_SESSION_CHANNEL = 'sage.operator-session';

const valid = s => !!s && typeof s.token === 'string' && s.token !== ''
  && typeof s.expiresAt === 'number' && s.expiresAt > Date.now();

/**
 * @param {{ getSession?: () => ({ token: string, expiresAt: number } | null),
 *           onSession: (s: { token: string, expiresAt: number }) => void,
 *           onSignedOut: () => void,
 *           answer?: boolean }} options
 *   getSession   this page's own unexpired sign-in, or null. Read only when answer is true
 *   onSession    another page signed in, or answered an ask, with an unexpired sign-in
 *   onSignedOut  another page signed out
 *   answer       true (Control Center): answer other pages' asks. false (the board): never answer
 * @returns {{ ask(): void, announce(s): void, signedOut(): void, close(): void }}
 *   Without BroadcastChannel every method does nothing.
 */
export function createOperatorSession({ getSession = () => null, onSession, onSignedOut, answer = true }){
  if(typeof BroadcastChannel !== 'function') return { ask(){}, announce(){}, signedOut(){}, close(){} };
  const channel = new BroadcastChannel(OPERATOR_SESSION_CHANNEL);
  channel.onmessage = e => {
    const msg = e.data || {};
    if(msg.type === 'ask'){
      if(!answer) return;
      const s = getSession();
      if(valid(s)) channel.postMessage({ type: 'session', token: s.token, expiresAt: s.expiresAt });
    }else if(msg.type === 'session'){
      if(valid(msg)) onSession({ token: msg.token, expiresAt: msg.expiresAt });
    }else if(msg.type === 'signed-out'){
      onSignedOut();
    }
  };
  return {
    ask(){ channel.postMessage({ type: 'ask' }); },
    announce(s){ if(valid(s)) channel.postMessage({ type: 'session', token: s.token, expiresAt: s.expiresAt }); },
    signedOut(){ channel.postMessage({ type: 'signed-out' }); },
    close(){ channel.close(); },
  };
}
