// The playoff bracket chart's data (sage-docs/docs/specs/.../standings-bracket-chart-spec.md §7.3):
// a standard event's playoff rows grouped into rounds of matches, what each empty seat says, and
// where a card sits on the chart. Pure; views/bracket.js draws it.
//
// A workbook made since the generator's 1.3.0 carries two columns in STANDINGSCSV, `match` (the
// match a playoff slot plays in: "QF-2", "F", "B", "F (1)") and `from` ("W:QF-2" when that match's
// winner fills the slot, "L:SF-1" its loser, '' for a slot filled from the round robin). With them
// the chart has its lines and its "Winner of QF-2" seats ("linked"). Without them it pairs rows the
// way the matchup cards do and draws rounds side by side with no lines.

import { parseCode, standingsStageKey, matchInstanceOf, STAGE_META, STAGE_ORDER } from './codes.js';
import { isEmptyStanding } from './standings.js';
import { isByeStandingRow } from './byes.js';
import { categoryBronzeIsByeDecided } from './awards.js';

// ---- small readers ---------------------------------------------------------------------------------

/**
 * A `from` cell: "W:QF-2" is the winner of QF-2, "L:SF-1" the loser of SF-1.
 * @param {string|null|undefined} text
 * @returns {{ kind: 'W'|'L', match: string }|null}
 */
export function parseFrom(text){
  const m = /^([WL]):(.+)$/.exec(String(text ?? '').trim());
  return m ? { kind: m[1], match: m[2].trim() } : null;
}

/** A match id as a card names it: "F" is the Final, "B" the Bronze, "F (2)" a series game. */
export function matchDisplayLabel(id){
  if(id === 'F') return 'Final';
  if(id === 'B') return 'Bronze';
  const series = /^F \((\d+)\)$/.exec(id);
  return series ? `Final · Match ${series[1]}` : id;
}

/**
 * A stable copy ordered by wins, then quotient (a missing quotient lowest): the order the sheet seats
 * the playoff by. It leaves out head-to-head, which rankStandings uses, so a tag says the finish the
 * sheet seated the pair by.
 * @param {object[]} rows  standings rows
 */
export function rankByWinsThenQuotient(rows){
  const q = r => r.quotient ?? -Infinity;
  return rows.slice().sort((a, b) => {
    if(b.wins !== a.wins) return b.wins - a.wins;
    if(q(b) === q(a)) return 0;
    return q(b) > q(a) ? 1 : -1;
  });
}

const normName = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const namesKey = row => [normName(row.player1), normName(row.player2)].sort().join('|');

// ---- grouping ----------------------------------------------------------------------------------------

const SEAT_NUMBER = /_(?:R32|R16|QF|SF|F|B)_(\d+)/;
const SERIES_ID = /^(.+) \((\d+)\)$/;
const seatNumber = code => { const m = SEAT_NUMBER.exec(code); return m ? parseInt(m[1], 10) : 0; };
const idNumber = id => { const m = /-(\d+)$/.exec(id); return m ? parseInt(m[1], 10) : 0; };

function stageRank(key){
  const i = STAGE_ORDER.indexOf(key);
  return i === -1 ? Infinity : i;
}
const byStage = (a, b) => (stageRank(a) - stageRank(b)) || (stageRank(a) === Infinity ? a.localeCompare(b) : 0);

/**
 * Groups a playoff stage's rows into head-to-head matchups so it's obvious who's facing whom, instead
 * of a flat list of teams. Uses the match-instance number encoded in the code itself when every row has
 * one, else the same "bracket" column RR pools use (as a per-match slot id) when every row in the stage
 * has one set; otherwise falls back to pairing rows in the order they arrived (a spreadsheet naturally
 * lists a match's two sides together).
 * @param {object[]} rows  one stage's standings rows
 * @returns {object[][]}
 */
export function pairPlayoffRows(rows){
  const allHaveMatchInstance = rows.length > 0 && rows.every(s => matchInstanceOf(s.teamCode) !== null);
  if(allHaveMatchInstance){
    const groups = new Map();
    rows.forEach(s => {
      const key = matchInstanceOf(s.teamCode);
      if(!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    });
    return Array.from(groups.keys()).sort((a, b) => a - b).map(k => groups.get(k));
  }

  const allBracketed = rows.length > 0 && rows.every(s => (s.bracket || '').trim() !== '');
  if(allBracketed){
    const groups = new Map();
    rows.forEach(s => {
      const key = s.bracket.trim();
      if(!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    });
    return Array.from(groups.values());
  }
  const pairs = [];
  for(let i = 0; i < rows.length; i += 2){
    pairs.push(rows.slice(i, i + 2));
  }
  return pairs;
}

function makeSeat(row, m){
  if(!row) return { row: undefined, code: '', rest: '', from: null, empty: true, result: '', score: null };
  const code = row.teamCode;
  const seat = { row, code, rest: parseCode(code, 'standard').rest, from: parseFrom(row.from), empty: isEmptyStanding(row), result: '', score: null };
  if(m && m.played){
    const side = m.t1 === code ? 1 : m.t2 === code ? 2 : 0;
    if(side){
      const own = side === 1 ? m.t1Score : m.t2Score;
      const other = side === 1 ? m.t2Score : m.t1Score;
      seat.score = own;
      if(own !== other) seat.result = own > other ? 'win' : 'loss';
    }
  }
  return seat;
}

function makeGame(id, pair, model){
  const m = pair.map(r => r && model.matchByCode.get(r.teamCode)).find(Boolean) || null;
  return { id, m, notNeeded: !!m && model.unneededGames.has(m), seats: [makeSeat(pair[0], m), makeSeat(pair[1], m)] };
}

function linkedNodes(playoff, model){
  const groups = new Map();
  playoff.forEach(s => {
    if(!groups.has(s.match)) groups.set(s.match, []);
    groups.get(s.match).push(s);
  });
  const nodes = [];
  const series = new Map();
  groups.forEach((rows, id) => {
    const pair = rows.slice().sort((a, b) => seatNumber(a.teamCode) - seatNumber(b.teamCode)).slice(0, 2);
    const game = makeGame(id, pair, model);
    const stageKey = standingsStageKey(pair[0].teamCode, 'standard');
    const sm = SERIES_ID.exec(id);
    if(sm){
      let node = series.get(sm[1]);
      if(!node){ node = { id: sm[1], stageKey, games: [], order: [] }; series.set(sm[1], node); nodes.push(node); }
      node.games.push(game);
      node.order.push(parseInt(sm[2], 10));
    } else {
      nodes.push({ id, stageKey, games: [game] });
    }
  });
  series.forEach(node => {
    const sorted = node.games.map((g, i) => ({ g, o: node.order[i] })).sort((a, b) => a.o - b.o);
    node.games = sorted.map(x => x.g);
    delete node.order;
  });
  return nodes;
}

function pairedNodes(playoff, model){
  const stages = new Map();
  playoff.forEach(s => {
    const key = standingsStageKey(s.teamCode, 'standard');
    if(!stages.has(key)) stages.set(key, []);
    stages.get(key).push(s);
  });
  const nodes = [];
  Array.from(stages.keys()).sort(byStage).forEach(stageKey => {
    const pairs = pairPlayoffRows(stages.get(stageKey));
    const isSeries = stageKey === 'FINAL' && pairs.length > 0 && pairs.every(p => matchInstanceOf(p[0].teamCode) !== null);
    if(isSeries){
      const id = `${stageKey}-1`;
      nodes.push({ id, stageKey, games: pairs.map(p => makeGame(`${id} (${matchInstanceOf(p[0].teamCode)})`, p, model)) });
    } else {
      pairs.forEach((p, i) => { const id = `${stageKey}-${i + 1}`; nodes.push({ id, stageKey, games: [makeGame(id, p, model)] }); });
    }
  });
  return nodes;
}

/**
 * A category's playoffs as rounds of matches.
 * @param {object[]} rows  every standings row of one category (round robin rows too)
 * @param {import('./model.js').DayModel} model
 * @returns {{ linked: boolean, category: string, rounds: { key: string, label: string, matches: object[] }[],
 *             bronze: object|null, eligible: boolean }}
 *   linked   every playoff row has a `match` (the sheet carries the bracket's links)
 *   rounds   earliest to latest, the Bronze left out; a match is a Node { id, stageKey, games: Game[] },
 *            with more than one game only for a series final
 *   eligible two or more rounds: a single final or series is not worth a chart
 */
export function buildBracket(rows, model){
  const real = rows.filter(s => !isByeStandingRow(s));
  const category = real.length ? parseCode(real[0].teamCode, 'standard').category : '';
  let playoff = real.filter(s => standingsStageKey(s.teamCode, 'standard') !== 'RR');
  if(playoff.some(s => standingsStageKey(s.teamCode, 'standard') === 'BRONZE') && categoryBronzeIsByeDecided(model, category)){
    playoff = playoff.filter(s => standingsStageKey(s.teamCode, 'standard') !== 'BRONZE');
  }
  const linked = playoff.length > 0 && playoff.every(s => !!s.match); // a row from an older domain/standings.js has no match at all
  const nodes = linked ? linkedNodes(playoff, model) : pairedNodes(playoff, model);

  const byKey = new Map();
  let bronze = null;
  nodes.forEach(n => {
    if(n.stageKey === 'BRONZE'){ if(!bronze) bronze = n; return; }
    if(!byKey.has(n.stageKey)) byKey.set(n.stageKey, []);
    byKey.get(n.stageKey).push(n);
  });
  const rounds = Array.from(byKey.keys()).sort(byStage).map(key => {
    const matches = byKey.get(key);
    if(linked) matches.sort((a, b) => (idNumber(a.id) - idNumber(b.id)) || a.id.localeCompare(b.id));
    const meta = STAGE_META[key];
    return { key, label: meta ? meta.label : key.charAt(0) + key.slice(1).toLowerCase(), matches };
  });
  return { linked, category, rounds, bronze, eligible: rounds.length >= 2 };
}

/**
 * `<brackets>x<seats a bracket sends>`, e.g. "3x2" for three round robin brackets whose top two advance:
 * the key an event's display.playoffSeats can label a whole shape by. null without links.
 * @param {ReturnType<typeof buildBracket>} bracket
 * @param {object[]} rows  every standings row of the category
 */
export function bracketShapeKey(bracket, rows){
  if(!bracket.linked) return null;
  const labels = new Set();
  rows.forEach(s => {
    if(standingsStageKey(s.teamCode, 'standard') !== 'RR') return;
    const b = (s.bracket || '').trim();
    if(b) labels.add(b);
  });
  const groups = Math.max(1, labels.size);
  let fresh = 0;
  const count = node => node.games.forEach(g => g.seats.forEach(seat => { if(seat.from === null) fresh++; }));
  bracket.rounds.forEach(r => r.matches.forEach(count));
  if(bracket.bronze) count(bracket.bronze);
  return fresh % groups === 0 ? `${groups}x${fresh / groups}` : null;
}

// ---- what a seat says --------------------------------------------------------------------------------

/**
 * Where a named pair came from in the round robin, found by matching its names (order, case and spacing
 * ignored) to the category's round robin rows: "Br 2 · #1", or "#1" when the round robin has no
 * brackets. '' when the names match no row, or more than one.
 * @param {{ player1: string, player2: string }} row  a playoff seat's standings row
 * @param {object[]} rrRows  the category's round robin rows that are named and not a BYE
 */
export function sourceTag(row, rrRows){
  const key = namesKey(row);
  const hits = rrRows.filter(r => namesKey(r) === key);
  if(hits.length !== 1) return '';
  const b = (hits[0].bracket || '').trim();
  const sameBracket = rrRows.filter(r => (r.bracket || '').trim() === b);
  const rank = rankByWinsThenQuotient(sameBracket).indexOf(hits[0]) + 1;
  return b ? `Br ${b} · #${rank}` : `#${rank}`;
}

/**
 * What one seat shows, by the first case that fits: the pair (with its source tag when the round robin
 * filled it); "Winner of QF-2" / "Loser of SF-1"; the workbook's label for the seat (its standings row's
 * `seat`), else the event's; "Qualifier" (the sheet has links); "TBD". A seat never shows a name the sheet
 * does not have.
 * @param {object} seat  a Seat of buildBracket
 * @param {{ playoffSeats?: object, category: string, shapeKey: string|null, rrRows: object[], linked: boolean }} ctx  see seatContext
 * @returns {{ kind: 'pair'|'winner'|'loser'|'label'|'qualifier'|'tbd', names: string[], label: string, tag: string }}
 */
export function seatText(seat, ctx){
  if(!seat.empty){
    return { kind: 'pair', names: [seat.row.player1, seat.row.player2], label: '', tag: seat.from === null ? sourceTag(seat.row, ctx.rrRows) : '' };
  }
  if(seat.from){
    const winner = seat.from.kind === 'W';
    return { kind: winner ? 'winner' : 'loser', names: [], label: `${winner ? 'Winner' : 'Loser'} of ${matchDisplayLabel(seat.from.match)}`, tag: '' };
  }
  // The workbook's own label for the seat first, then the event's (events.json display.playoffSeats)
  const labels = ctx.playoffSeats || {};
  const label = (seat.row && seat.row.seat)
    || ((labels[ctx.category] && labels[ctx.category][seat.rest])
    ?? (ctx.shapeKey && labels[ctx.shapeKey] && labels[ctx.shapeKey][seat.rest]));
  if(label) return { kind: 'label', names: [], label, tag: '' };
  if(ctx.linked) return { kind: 'qualifier', names: [], label: 'Qualifier', tag: '' };
  return { kind: 'tbd', names: [], label: 'TBD', tag: '' };
}

/**
 * What seatText needs besides the seat, read from the model: the event's labels, the category, its
 * shape key, and its named round robin rows.
 * @param {ReturnType<typeof buildBracket>} bracket
 * @param {import('./model.js').DayModel} model
 */
export function seatContext(bracket, model){
  const rows = model.standings.filter(s => parseCode(s.teamCode, 'standard').category === bracket.category);
  const rrRows = rows.filter(s => standingsStageKey(s.teamCode, 'standard') === 'RR' && !isEmptyStanding(s) && !isByeStandingRow(s));
  return {
    playoffSeats: (model.event && model.event.playoffSeats) || {},
    category: bracket.category,
    shapeKey: bracketShapeKey(bracket, rows),
    rrRows,
    linked: bracket.linked,
  };
}

// ---- geometry ----------------------------------------------------------------------------------------

/**
 * Where every card and line of the chart sits, in pixels. With links, each match is centred on the seat
 * its feeders enter, matches with no feeder stack down the column, and a card overlapping the one above
 * is pushed down. Without links each round is a column of its matches, centred on the tallest.
 * @param {ReturnType<typeof buildBracket>} bracket
 * @param {{ cardW: number, colGap: number, headH: number, seatH: number, rowGap: number, captionH: number,
 *           bronzeGap: number, seriesGap: number }} dims
 * @returns {{ width: number, height: number, captions: { text: string, x: number, y: number }[],
 *             nodes: { node: object, x: number, y: number, h: number }[], lines: { d: string }[] }}
 */
export function layoutBracket(bracket, dims){
  const { cardW, colGap, headH, seatH, rowGap, captionH, bronzeGap, seriesGap } = dims;
  const cardH = headH + 2 * seatH;
  const heightOf = node => node.games.length * cardH + (node.games.length - 1) * seriesGap;
  const count = bracket.rounds.length;
  const colX = i => i * (cardW + colGap);

  const entries = [];
  const entryOf = new Map();
  bracket.rounds.forEach((round, i) => round.matches.forEach(node => {
    const e = { node, x: colX(i), y: null, h: heightOf(node), round: i };
    entries.push(e);
    entryOf.set(node, e);
  }));
  const captions = bracket.rounds.map((round, i) => ({ text: round.label, x: colX(i), y: 0 }));
  const lines = [];

  let feeders = () => [];
  if(bracket.linked){
    const nodeOfGame = new Map();
    entries.forEach(e => e.node.games.forEach(g => nodeOfGame.set(g.id, e.node)));
    // The matches whose winners fill the seats of `node`'s first game, with the seat each fills.
    feeders = node => {
      const out = [];
      [0, 1].forEach(k => {
        const seat = node.games[0].seats[k];
        if(!seat || !seat.from || seat.from.kind !== 'W') return;
        const feeder = nodeOfGame.get(seat.from.match);
        if(feeder && feeder !== node && entryOf.get(feeder).round < entryOf.get(node).round) out.push({ k, feeder });
      });
      return out;
    };

    let cursor = captionH;
    const placed = new Set();
    const middle = e => e.y + e.h / 2;
    const place = node => {
      if(placed.has(node)) return;
      placed.add(node);
      const e = entryOf.get(node);
      const fs = feeders(node);
      fs.forEach(f => place(f.feeder));
      if(fs.length === 0) e.y = cursor;
      else if(fs.length === 1) e.y = middle(entryOf.get(fs[0].feeder)) - (headH + fs[0].k * seatH + seatH / 2);
      else e.y = (middle(entryOf.get(fs[0].feeder)) + middle(entryOf.get(fs[1].feeder))) / 2 - e.h / 2;
      cursor = Math.max(cursor, e.y + e.h + rowGap);
    };
    if(count) bracket.rounds[count - 1].matches.forEach(place);
    bracket.rounds.forEach(round => round.matches.forEach(place));

    bracket.rounds.forEach((round, i) => {
      const col = entries.filter(e => e.round === i).sort((a, b) => a.y - b.y);
      col.forEach((e, j) => { if(j > 0) e.y = Math.max(e.y, col[j - 1].y + col[j - 1].h + rowGap); });
    });
    const top = Math.min(...entries.map(e => e.y));
    if(entries.length && captionH - top > 0) entries.forEach(e => { e.y += captionH - top; });

    entries.forEach(e => feeders(e.node).forEach(({ k, feeder }) => {
      const f = entryOf.get(feeder);
      const x1 = f.x + cardW, y1 = f.y + f.h / 2, x2 = e.x, y2 = e.y + headH + k * seatH + seatH / 2;
      const xm = x1 + colGap / 2;
      lines.push({ d: `M${Math.round(x1)} ${Math.round(y1)} H${Math.round(xm)} V${Math.round(y2)} H${Math.round(x2)}` });
    }));
  } else {
    const columns = bracket.rounds.map((round, i) => {
      let y = captionH;
      const col = entries.filter(e => e.round === i);
      col.forEach(e => { e.y = y; y += e.h + rowGap; });
      return col.length ? y - rowGap - captionH : 0;
    });
    const tallest = Math.max(0, ...columns);
    entries.forEach(e => { e.y += (tallest - columns[e.round]) / 2; });
  }

  const nodes = entries.map(e => ({ node: e.node, x: e.x, y: e.y, h: e.h }));
  if(bracket.bronze){
    const y = Math.max(captionH, ...entries.map(e => e.y + e.h)) + bronzeGap;
    const x = count ? colX(count - 1) : 0;
    nodes.push({ node: bracket.bronze, x, y, h: heightOf(bracket.bronze) });
    captions.push({ text: STAGE_META.BRONZE.label, x, y: y - captionH + 4 });
  }
  return {
    width: count * cardW + Math.max(0, count - 1) * colGap,
    height: Math.max(0, ...nodes.map(n => n.y + n.h)),
    captions, nodes, lines,
  };
}
