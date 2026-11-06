// A team event's scoresheets print each team's name (sage-docs/docs/specs/.../scoresheet-team-names-spec.md).
// The Scoresheet Generator sends this CSV in place of the snapshot's matchesCsv.

import { parseCSV } from './csv.js';
import { rowsToStandings } from './standings.js';
import { sideOf, teamNameOf } from './teams.js';

const csvCell = v => /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

/**
 * matchesCsv with teamName1 and teamName2 added to every row, '' for a side with no name yet.
 * Returned unchanged when it has no teamCode1 and teamCode2 columns, or the standings have no names.
 * @param {string} matchesCsv
 * @param {string} standingsCsv
 * @returns {string}
 */
export function withTeamNames(matchesCsv, standingsCsv){
  const rows = parseCSV(matchesCsv);
  if(rows.length === 0) return matchesCsv;
  const header = rows[0].map(h => h.trim());
  const i1 = header.indexOf('teamCode1'), i2 = header.indexOf('teamCode2');
  if(i1 < 0 || i2 < 0) return matchesCsv;

  const standings = rowsToStandings(parseCSV(standingsCsv));
  if(!standings.some(s => s.teamName)) return matchesCsv;
  const rowByCode = new Map(standings.map(s => [s.teamCode, s]));
  const nameOf = code => (code || '').trim() ? teamNameOf(sideOf(code.trim()), rowByCode) || '' : '';

  const out = rows.map((row, r) => r === 0
    ? [...row, 'teamName1', 'teamName2']
    : [...row, nameOf(row[i1]), nameOf(row[i2])]);
  return out.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
