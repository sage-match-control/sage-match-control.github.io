// A facility's standings: the CSV rows of its standings tab turned into
// standings rows, and the ordering the site shows them in.
//
// Standings row = { teamCode, player1, player2, wins, loss, quotient, bracket,
//                   teamName, pf, pa }
//   teamName, pf and pa are team events only; '' / 0 elsewhere.

/**
 * @param {string[][]} rows  parseCSV of a facility's standingsCsv
 * @returns {object[]}
 */
export function rowsToStandings(rows){
  if(rows.length < 2) return [];
  const header = rows[0].map(h => h.trim());
  const idx = name => header.indexOf(name);
  const iCode = idx('teamCode'), iP1 = idx('player1'), iP2 = idx('player2'),
        iW = idx('wins'), iL = idx('loss'), iQ = idx('quotient'), iB = idx('bracket'),
        iName = idx('teamName'), iPF = idx('totalPoints'), iPA = idx('totalOpponentPoints');

  const out = [];
  for(let r = 1; r < rows.length; r++){
    const row = rows[r];
    if(!row || row.length === 0) continue;
    const teamCode = (row[iCode]||'').trim();
    if(!teamCode) continue;
    const player1 = iP1 > -1 ? (row[iP1]||'').trim() : '';
    const player2 = iP2 > -1 ? (row[iP2]||'').trim() : '';
    const rawW = iW > -1 ? (row[iW]||'').trim() : '';
    const rawL = iL > -1 ? (row[iL]||'').trim() : '';
    const rawQ = iQ > -1 ? (row[iQ]||'').trim() : '';
    const wins = rawW !== '' && !isNaN(rawW) ? parseInt(rawW, 10) : 0;
    const loss = rawL !== '' && !isNaN(rawL) ? parseInt(rawL, 10) : 0;
    const quotient = rawQ !== '' && !isNaN(rawQ) ? parseFloat(rawQ) : null;
    const bracket = iB > -1 ? (row[iB]||'').trim() : '';
    // team type only — existing events have no such columns, so these stay empty
    const teamName = iName > -1 ? (row[iName]||'').trim() : '';
    const rawPF = iPF > -1 ? (row[iPF]||'').trim() : '';
    const rawPA = iPA > -1 ? (row[iPA]||'').trim() : '';
    const pf = rawPF !== '' && !isNaN(rawPF) ? parseFloat(rawPF) : 0;
    const pa = rawPA !== '' && !isNaN(rawPA) ? parseFloat(rawPA) : 0;
    out.push({ teamCode, player1, player2, wins, loss, quotient, bracket, teamName, pf, pa });
  }
  return out;
}

/**
 * Orders one set of Round Robin standings rows: wins, then head-to-head
 * among the pairs tied on wins, then quotient. Head-to-head is a mini-league
 * over the tied pairs' played matches against each other, so a two-way tie is
 * settled by the one match between them, and a three-way cycle (A beat B,
 * B beat C, C beat A) falls through to quotient. Rows still level after all
 * three keep their STANDINGSCSV order. This is the site's ranking only — the
 * sheet's SORTBYWINS, which picks the playoff feeders, ranks wins then
 * quotient, so the two can disagree on a head-to-head tie.
 * @param {object[]} rows     standings rows
 * @param {object[]} matches  the day's matches (the head-to-head results)
 */
export function rankStandings(rows, matches){
  const byWins = rows.slice().sort((a, b) => b.wins - a.wins);
  const out = [];
  for(let i = 0; i < byWins.length;){
    let j = i;
    while(j < byWins.length && byWins[j].wins === byWins[i].wins) j++;
    const tied = byWins.slice(i, j);
    const h2h = headToHeadWins(tied, matches);
    tied.sort((a, b) =>
      (h2h.get(b.teamCode) - h2h.get(a.teamCode)) ||
      ((b.quotient ?? -Infinity) - (a.quotient ?? -Infinity)));
    out.push(...tied);
    i = j;
  }
  return out;
}

/**
 * teamCode -> wins in played matches between two of the given rows.
 * @param {object[]} tied     standings rows
 * @param {object[]} matches  the day's matches
 * @returns {Map<string, number>}
 */
export function headToHeadWins(tied, matches){
  const wins = new Map(tied.map(s => [s.teamCode, 0]));
  if(tied.length < 2) return wins;
  matches.forEach(m => {
    if(!m.played || m.t1Score === m.t2Score || !wins.has(m.t1) || !wins.has(m.t2)) return;
    const winner = m.t1Score > m.t2Score ? m.t1 : m.t2;
    wins.set(winner, wins.get(winner) + 1);
  });
  return wins;
}

/**
 * A slot whose names aren't in yet: the sheet fills the name cells with the
 * slot's own code. A twice-to-beat game's code carries its game number
 * ("IXD_F_1_(2)", see matchInstanceOf) but its placeholder name doesn't
 * ("IXD_F_1"), so the name is also checked against the code without it.
 */
export function isEmptyStanding(s){
  const slotCode = s.teamCode.replace(/_?\(\d+\)\s*$/, '');
  return !s.player1 || s.player1 === s.teamCode || s.player1 === slotCode;
}

/** A quotient as the sheet shows it. */
export function fmtQ(q){ return q === null ? '0.0000' : q.toFixed(4); }
