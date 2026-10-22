// The playoff bracket chart (sage-docs/docs/specs/.../standings-bracket-chart-spec.md §7.4): a category's
// playoffs as rounds side by side with a line from each match to the seat its winner fills, and, for a
// screen the chart does not fit, the same cards one round at a time. The data and the geometry are
// domain/bracket.js's; this is markup, drawn into a category card by views/standings.js.
//
// What differs between the public Hub and Control Center is added through one extension point that does
// nothing by default: options.decorate(match) returns { className?, attrs? } for a card whose game has a
// scheduled Match (Control Center makes those cards open the score dialog).

import { escapeHtml } from './html.js';
import { roundLabel } from '../domain/codes.js';
import { layoutBracket, seatText, seatContext, matchDisplayLabel } from '../domain/bracket.js';

/** The chart's geometry in pixels; the card is cardW wide and headH + 2 * seatH tall (css/standings.css agrees). */
export const BRACKET_DIMS = { cardW: 172, colGap: 36, headH: 20, seatH: 30, rowGap: 16, captionH: 22, bronzeGap: 34, seriesGap: 8 };

const lastWord = name => String(name).trim().split(/\s+/).pop();

function statusOf(game){
  const m = game.m;
  if(game.notNeeded) return 'Not needed';
  if(m && m.played) return 'Done';
  if(m && m.liveCourt) return 'Live';
  return (m && m.time) || '';
}

function seatHTML(seat, ctx){
  const text = seatText(seat, ctx);
  const open = text.kind !== 'pair';
  const cls = ['bk-seat', seat.result, open && 'bk-seat--open'].filter(Boolean).join(' ');
  const score = seat.score !== null ? escapeHtml(String(seat.score)) : '–';
  if(open) return `<div class="${cls}"><span class="bk-names">${escapeHtml(text.label)}</span><span class="bk-score">${score}</span></div>`;
  const names = text.names.filter(Boolean);
  const full = names.join(' / ');
  const short = names.map(lastWord).join(' / ');
  const tag = text.tag ? `<span class="bk-tag">${escapeHtml(text.tag)}</span>` : '';
  return `<div class="${cls}" title="${escapeHtml(full)}"><span class="bk-names"><span class="bk-full">${escapeHtml(full)}</span><span class="bk-short">${escapeHtml(short)}</span></span>${tag}<span class="bk-score">${score}</span></div>`;
}

function cardHTML(game, node, ctx, linked, decorate){
  const m = game.m;
  const classes = ['bk-card'];
  if(node.stageKey === 'FINAL') classes.push('bk-card--final');
  if(m && m.liveCourt && !m.played) classes.push('bk-card--live');
  if(game.notNeeded) classes.push('not-needed');
  const deco = (m && decorate && decorate(m)) || {};
  const rest = (game.seats.find(s => s.rest) || { rest: '' }).rest;
  const label = (linked ? matchDisplayLabel(game.id) : (roundLabel(rest) || game.id)) + (m && m.court ? ` · ${m.court}` : '');
  return `<div class="${classes.join(' ')}${deco.className || ''}" data-bk-match="${escapeHtml(game.id)}"${deco.attrs || ''}>` +
    `<div class="bk-head"><span class="bk-label">${escapeHtml(label)}</span><span class="bk-status">${escapeHtml(statusOf(game))}</span></div>` +
    game.seats.map(seat => seatHTML(seat, ctx)).join('') +
    `</div>`;
}

/**
 * The whole chart, laid out in pixels.
 * @param {ReturnType<typeof import('../domain/bracket.js').buildBracket>} bracket
 * @param {import('../domain/model.js').DayModel} model
 * @param {{ decorate?: (match: object) => { className?: string, attrs?: string }, cardW?: number }} [options]
 *   cardW  a card's width in px, when wider than BRACKET_DIMS.cardW (the lines follow it)
 * @returns {{ html: string, width: number, height: number }}
 */
export function bracketChartHTML(bracket, model, { decorate, cardW = BRACKET_DIMS.cardW } = {}){
  const lay = layoutBracket(bracket, { ...BRACKET_DIMS, cardW });
  const ctx = seatContext(bracket, model);
  const { width, height } = lay;
  const nodeWidth = cardW === BRACKET_DIMS.cardW ? '' : `;width:${cardW}px`;
  let html = `<div class="bk" style="width:${width}px;height:${height}px" data-bk-cat="${escapeHtml(bracket.category)}">` +
    `<svg class="bk-lines" width="${width}" height="${height}" aria-hidden="true">${lay.lines.map(l => `<path d="${l.d}"/>`).join('')}</svg>`;
  lay.captions.forEach(c => { html += `<div class="bk-caption" style="left:${c.x}px;top:${c.y}px">${escapeHtml(c.text)}</div>`; });
  lay.nodes.forEach(n => {
    html += `<div class="bk-node" style="left:${n.x}px;top:${n.y}px${nodeWidth}">` +
      n.node.games.map(game => cardHTML(game, n.node, ctx, bracket.linked, decorate)).join('') + `</div>`;
  });
  return { html: html + `</div>`, width, height };
}

/** The button that opens a category's Full tree (views/bracket-full.js), under its chart or its window. */
export function fullTreeButtonHTML(category){
  return `<button type="button" class="bk-full-open" data-bk-full="${escapeHtml(category)}">Full tree</button>`;
}

/**
 * The round to open the strip on: the earliest with a game still to play between two named pairs, else the
 * latest with a played game, else the first.
 * @param {ReturnType<typeof import('../domain/bracket.js').buildBracket>} bracket
 */
export function startRound(bracket){
  const ready = bracket.rounds.findIndex(r => r.matches.some(n => n.games.some(g => !g.notNeeded && !(g.m && g.m.played) && g.seats.every(s => !s.empty))));
  if(ready >= 0) return ready;
  for(let i = bracket.rounds.length - 1; i >= 0; i--){
    if(bracket.rounds[i].matches.some(n => n.games.some(g => g.m && g.m.played))) return i;
  }
  return 0;
}

/**
 * The card width at which `perView` rounds, and the gaps between them, fill `width` px exactly; never narrower
 * than BRACKET_DIMS.cardW (an unknown or too narrow width gives that).
 * @param {number} width
 * @param {number} [perView]
 */
export function fitCardWidth(width, perView = 1){
  const w = Math.floor((width - (perView - 1) * BRACKET_DIMS.colGap) / perView);
  return Number.isFinite(w) && w > BRACKET_DIMS.cardW ? w : BRACKET_DIMS.cardW;
}

/**
 * The whole chart, lines and all, in a window that scrolls sideways under a row of round chips, for a screen
 * the chart does not fit (a phone, in portrait too). A chip scrolls the window to its round, a swipe settles on
 * one, and createStandings opens the window on data-bk-start-x and keeps the chips in step with it.
 * Given the window's `width`, the cards stretch so it holds `perView` whole rounds (bk-rounds--fit).
 * @param {ReturnType<typeof import('../domain/bracket.js').buildBracket>} bracket
 * @param {import('../domain/model.js').DayModel} model
 * @param {{ decorate?: (match: object) => { className?: string, attrs?: string }, width?: number, perView?: number }} [options]
 */
export function roundStripHTML(bracket, model, { decorate, width, perView = 1 } = {}){
  const cat = escapeHtml(bracket.category);
  const cardW = width === undefined ? BRACKET_DIMS.cardW : fitCardWidth(width, perView);
  const fit = cardW !== BRACKET_DIMS.cardW;
  const x = i => i * (cardW + BRACKET_DIMS.colGap);
  const start = startRound(bracket);
  // A snap point at the left edge of each round, inside the chart so it scrolls with it.
  const chart = bracketChartHTML(bracket, model, { decorate, cardW });
  const snaps = bracket.rounds.map((r, i) => `<i class="bk-snap" style="left:${x(i)}px"></i>`).join('');
  const chartHtml = chart.html.slice(0, -'</div>'.length) + snaps + '</div>';
  return `<div class="bk-rounds${fit ? ' bk-rounds--fit' : ''}" data-bk-cat="${cat}" data-bk-start="${start}" data-bk-start-x="${x(start)}"` +
    (fit ? ` data-bk-card-w="${cardW}" data-bk-per-view="${perView}">` : '>') +
    `<div class="bk-chips" role="tablist">` +
    bracket.rounds.map((r, i) => `<button type="button" class="bk-chip${i === 0 ? ' active' : ''}" data-bk-round="${i}" data-bk-x="${x(i)}" role="tab" aria-selected="${i === 0}">${escapeHtml(r.label)}</button>`).join('') +
    `</div><div class="bk-track" data-group-key="${cat}"${fit ? ` style="max-width:${perView * cardW + (perView - 1) * BRACKET_DIMS.colGap}px"` : ''}>${chartHtml}</div>` +
    `${fullTreeButtonHTML(bracket.category)}</div>`;
}
