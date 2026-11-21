// The person key exists twice (root CLAUDE.md, "Things that must be kept in sync by hand"):
// sage-tools-api's personKey.mjs, which the ATTENDANCE tab's keys come from, and this site's
// attendanceKey (lib/v1/domain/attendance-marks.js), which matches a match's player names against
// that roster. If they disagree, a player is marked "not in" (or not) wrongly.
//
// Runs when the sibling sage-tools-api checkout exists, and skips with a message when it does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WORKSPACE_ROOT } from '../helpers/paths.mjs';
import { SNAPSHOTS, loadSnapshot, parseCsv } from '../helpers/fixtures.mjs';
import { attendanceKey } from '../../lib/v1/domain/attendance-marks.js';

const SERVER = path.join(WORKSPACE_ROOT, 'sage-tools-api', 'src', 'attendance', 'domain', 'personKey.mjs');
const present = fs.existsSync(SERVER);
const server = present ? await import(pathToFileURL(SERVER).href) : null;
const options = { skip: present ? false : `no ${SERVER}: the sage-tools-api checkout is not beside this repo` };

const NAMES = [
  'Ana Reyes', '  Ana   Reyes ', 'ANA reyes', 'José Niño', 'Ñino', 'Dan\tEmil\nDizon', 'Yanna Palo-Apilado',
  "O'Brien", '', null, undefined, 'Zoë Ångström', 'Ana Reyes', 'ﬁne', 'Ｆull Ｗidth', 'İstanbul', 'ΑΣ',
];

test('attendanceKey equals the servers personKey for the tricky names', options, () => {
  for (const name of NAMES) assert.equal(attendanceKey(name), server.personKey(name), JSON.stringify(name));
});

test('attendanceKey equals the servers personKey for every player in every harness snapshot', options, () => {
  let count = 0;
  for (const event of Object.keys(SNAPSHOTS)) {
    for (const facility of loadSnapshot(event).facilities || []) {
      const [header, ...rows] = parseCsv(facility.matchesCsv || '');
      if (!header) continue;
      const cols = ['team1Player1', 'team1Player2', 'team2Player1', 'team2Player2'].map(c => header.indexOf(c)).filter(i => i >= 0);
      for (const row of rows) {
        for (const i of cols) {
          assert.equal(attendanceKey(row[i]), server.personKey(row[i]), `${event}: ${row[i]}`);
          count++;
        }
      }
    }
  }
  assert.ok(count > 100, `checked ${count} names`);
});
