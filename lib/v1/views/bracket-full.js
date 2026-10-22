// Full tree (sage-docs/docs/specs/.../standings-bracket-chart-spec.md §7.7): a category's whole bracket chart
// on a layer that covers the page, scaled to fit the screen, with pinch to zoom and drag to pan. It is a fixed
// layer inside the page, not the browser's Fullscreen API (which iPhone Safari does not offer for page
// elements), and the phone's Back gesture closes it.
//
// createFullTree is the layer; fitScale, clampScale, clampPan, centredAt and zoomAbout are its arithmetic.

import { escapeHtml } from './html.js';

export const MAX_SCALE = 2.5;
/** Below this scale the cards switch to surnames in larger type (css: .bk-full--compact). */
export const COMPACT_BELOW = 0.6;
/** Panning never takes more of the canvas than this off screen on an axis. */
export const MIN_VISIBLE = 80;
const MARGIN = 16;           // the canvas's padding on every side
const TAP_MOVE = 6;          // a press that moves less than this is a tap
const DOUBLE_TAP_MS = 300, DOUBLE_TAP_PX = 24;

/** The scale that fits a chart `w` by `h` and its margin in a stage: shrunk on a phone, grown on a big screen up to MAX_SCALE. */
export function fitScale(stageW, stageH, w, h){
  return Math.min(stageW / (w + 2 * MARGIN), stageH / (h + 2 * MARGIN), MAX_SCALE);
}

export const clampScale = (s, fit) => Math.min(MAX_SCALE, Math.max(fit, s));
export const isCompact = s => s < COMPACT_BELOW;

/** Where a double-tap takes scale `s`: from fit, closer in (full size at least, twice fit, at most MAX_SCALE); else back to fit. */
export function doubleTapScale(s, fit){
  return Math.abs(s - fit) < 0.001 ? Math.min(MAX_SCALE, Math.max(1, fit * 2)) : fit;
}

/** `tx`/`ty` moved the least that keeps MIN_VISIBLE px of the (scaled) canvas on the stage on each axis. */
export function clampPan(tx, ty, s, stage, canvas){
  const axis = (t, stageSize, canvasSize) => Math.min(stageSize - MIN_VISIBLE, Math.max(MIN_VISIBLE - canvasSize * s, t));
  return { tx: axis(tx, stage.w, canvas.w), ty: axis(ty, stage.h, canvas.h) };
}

/** The canvas at scale `s`, centred on the stage. */
export function centredAt(s, stage, canvas){
  return { s, tx: (stage.w - canvas.w * s) / 2, ty: (stage.h - canvas.h * s) / 2 };
}

/** `view` zoomed to `newScale` (kept between `fit` and the maximum) so the content under (px, py) stays under it. */
export function zoomAbout(view, newScale, px, py, fit, stage, canvas){
  const s = clampScale(newScale, fit);
  const pan = clampPan(px - (px - view.tx) * (s / view.s), py - (py - view.ty) * (s / view.s), s, stage, canvas);
  return { s, ...pan };
}

/**
 * The layer. open() shows it for a category, update() gives it that category's chart (and again on every
 * refresh while it is open), close() puts the page back as it was.
 * @param {{ hostEl?: HTMLElement }} [options]  where the layer is appended; the page body by default
 * @returns {{ open(cat: string, title: string): void, update(html: string, width: number, height: number): void,
 *             close(): void, isOpen(): boolean, category(): string|null }}
 */
export function createFullTree({ hostEl } = {}){
  let root = null, stage = null, canvas = null, closeBtn = null;
  let cat = null, opener = null, pushed = false, prevOverflow = '';
  let chart = null;            // { w, h } of the chart in the canvas
  let view = null;             // { s, tx, ty }
  let fit = 1;
  let lastType = 'mouse';
  const pointers = new Map();  // id -> { x, y, x0, y0 }
  let pinch = null, dragging = false, lastTap = null;

  const stageSize = () => ({ w: stage.clientWidth, h: stage.clientHeight });
  const canvasSize = () => ({ w: chart.w + 2 * MARGIN, h: chart.h + 2 * MARGIN });
  const atFit = () => !!view && Math.abs(view.s - fit) < 0.001;

  function apply(next){
    view = next;
    canvas.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`;
    root.classList.toggle('bk-full--compact', isCompact(view.s));
  }
  const fitView = () => apply(centredAt(fit, stageSize(), canvasSize()));

  function relayout(){
    if(!root || !chart || !stage.clientWidth) return;
    const wasAtFit = !view || atFit();
    fit = fitScale(stage.clientWidth, stage.clientHeight, chart.w, chart.h);
    if(wasAtFit) return fitView();
    const s = clampScale(view.s, fit);
    apply({ s, ...clampPan(view.tx, view.ty, s, stageSize(), canvasSize()) });
  }

  function point(e){
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function zoomTo(s, p){ apply(zoomAbout(view, s, p.x, p.y, fit, stageSize(), canvasSize())); }
  function toggleZoom(p){
    const s = doubleTapScale(view.s, fit);
    if(s === fit) fitView(); else zoomTo(s, p);
  }

  function startPinch(){
    const [a, b] = Array.from(pointers.values());
    pinch = { dist: Math.hypot(b.x - a.x, b.y - a.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: { ...view } };
  }

  function onPointerDown(e){
    if(!chart) return;
    lastType = e.pointerType || 'mouse';
    const p = point(e);
    pointers.set(e.pointerId, { x: p.x, y: p.y, x0: p.x, y0: p.y });
    if(pointers.size === 2){ startPinch(); dragging = true; for(const id of pointers.keys()) try { stage.setPointerCapture(id); } catch(_) { /* gone */ } }
  }
  function onPointerMove(e){
    const rec = pointers.get(e.pointerId);
    if(!rec) return;
    const p = point(e);
    const dx = p.x - rec.x, dy = p.y - rec.y;
    rec.x = p.x; rec.y = p.y;
    if(pointers.size === 2 && pinch){
      const [a, b] = Array.from(pointers.values());
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const s = clampScale(pinch.view.s * dist / pinch.dist, fit);
      // The content point that was under the pinch's first midpoint follows the midpoint as it moves.
      const cx = (pinch.mid.x - pinch.view.tx) / pinch.view.s, cy = (pinch.mid.y - pinch.view.ty) / pinch.view.s;
      apply({ s, ...clampPan(mid.x - cx * s, mid.y - cy * s, s, stageSize(), canvasSize()) });
      return;
    }
    if(pointers.size !== 1) return;
    // A press that has not moved is still a tap and its click reaches the card under it; only a drag takes the pointer.
    if(!dragging && Math.hypot(p.x - rec.x0, p.y - rec.y0) > TAP_MOVE){
      dragging = true;
      try { stage.setPointerCapture(e.pointerId); } catch(_) { /* gone */ }
    }
    if(dragging) apply({ s: view.s, ...clampPan(view.tx + dx, view.ty + dy, view.s, stageSize(), canvasSize()) });
  }
  function onPointerUp(e){
    const rec = pointers.get(e.pointerId);
    if(!rec) return;
    const moved = Math.hypot(rec.x - rec.x0, rec.y - rec.y0);
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    if(pointers.size < 2) pinch = null;
    if(pointers.size === 0) dragging = false;
    else if(pointers.size === 1){ const left = pointers.values().next().value; left.x0 = left.x; left.y0 = left.y; }
    if(!wasSingle || moved >= TAP_MOVE || e.type === 'pointercancel' || lastType === 'mouse') return;
    // Two taps close together are a double-tap; a mouse has dblclick.
    const now = e.timeStamp;
    if(lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(rec.x - lastTap.x, rec.y - lastTap.y) < DOUBLE_TAP_PX){
      lastTap = null;
      toggleZoom({ x: rec.x, y: rec.y });
    } else {
      lastTap = { t: now, x: rec.x, y: rec.y };
    }
  }
  function onDblClick(e){
    if(lastType !== 'mouse' || !chart) return;
    toggleZoom(point(e));
  }
  function onWheel(e){
    if(!e.ctrlKey || !chart) return;
    e.preventDefault();
    zoomTo(view.s * Math.exp(-e.deltaY * 0.01), point(e));
  }

  function onKey(e){ if(e.key === 'Escape') close(); }
  function onPop(){ if(root){ pushed = false; teardown(); } }

  function teardown(){
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('resize', relayout);
    window.removeEventListener('orientationchange', relayout);
    if(root) root.remove();
    document.documentElement.style.overflow = prevOverflow;
    const back = opener;
    root = stage = canvas = closeBtn = null;
    cat = opener = chart = view = pinch = lastTap = null;
    dragging = false;
    pointers.clear();
    if(back && back.isConnected && back.focus) back.focus();
  }

  function close(){
    if(!root) return;
    if(pushed) history.back();   // popstate closes it
    else teardown();
  }

  function open(nextCat, title){
    if(root) teardown();
    cat = nextCat;
    opener = document.activeElement;
    root = document.createElement('div');
    root.className = 'bk-full';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', `${title} bracket`);
    root.innerHTML = `<div class="bk-full-bar"><button type="button" class="bk-full-close" aria-label="Close">✕</button>` +
      `<span class="bk-full-title">${escapeHtml(title)}</span><button type="button" class="bk-full-fit">Fit</button></div>` +
      `<div class="bk-full-stage"><div class="bk-full-canvas"></div></div>`;
    (hostEl || document.body).appendChild(root);
    stage = root.querySelector('.bk-full-stage');
    canvas = root.querySelector('.bk-full-canvas');
    closeBtn = root.querySelector('.bk-full-close');
    closeBtn.addEventListener('click', close);
    root.querySelector('.bk-full-fit').addEventListener('click', () => { if(chart) fitView(); });
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerUp);
    stage.addEventListener('dblclick', onDblClick);
    stage.addEventListener('wheel', onWheel, { passive: false });
    prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    history.pushState({ sageBracketFull: true }, '');
    pushed = true;
    document.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPop);
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', relayout);
    closeBtn.focus();
  }

  function update(html, width, height){
    if(!root) return;
    canvas.innerHTML = html;
    const resized = !chart || chart.w !== width || chart.h !== height;
    chart = { w: width, h: height };
    if(!view) { relayout(); return; }
    if(resized) relayout();
  }

  return { open, update, close, isOpen: () => !!root, category: () => cat };
}
