// Characterization (site-engine-spec §5.2): attendance.js against the
// ATTENDANCE CLIENT block (Control Center and the desk page carry identical
// copies) and schedule-grid.js against the two schedule boards.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { oldCode, plain } from '../../helpers/old.mjs';
import { SITE_ROOT } from '../../helpers/paths.mjs';
import { SNAPSHOTS, STATES, loadSnapshot, deriveState, eventConfig } from '../../helpers/fixtures.mjs';
import * as Att from '../../../lib/v1/domain/attendance.js';
import * as G from '../../../lib/v1/domain/schedule-grid.js';

const CC = 'tools/control-center.html';
const DESK = '_templates/attendance/attendance.html';
const STD_SCHEDULE = '_templates/standard-tournament-template/schedule.html';
const DM_SCHEDULE = '_templates/dual-meet-template/schedule.html';

// ---- attendance ----------------------------------------------------------------------------------------------------

const fixtureCsvs = () => {
  const dir = path.join(SITE_ROOT, '_fixtures');
  const out = [];
  for (const sub of fs.readdirSync(dir)) {
    const full = path.join(dir, sub);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const f of fs.readdirSync(full)) if (f.endsWith('.csv')) out.push({ label: `${sub}/${f}`, text: fs.readFileSync(path.join(full, f), 'utf8') });
  }
  return out;
};

const HAND = [
  '', 'key,player', 'nokey,player\n1,2',
  '"key","player","teams","categories","present","timeIn","withdrawn","TShirt Size"\n"a b","A B","X_1, Y_2","X, Y","TRUE","2026-10-03 08:30","FALSE","M"\n"a b","dup","","","","","",""\n"","blank","","","","","",""\r\n"c","","Z","","FALSE","","TRUE","XL"',
  'key,player,teams,categories,present,timeIn,withdrawn,shirtSize\nk1,P,T,C,TRUE,12:05 PM,FALSE,S',
];

const ATT_FUNCTIONS = ['attParseCsv', 'attClockTime', 'attSplitList', 'parseAttendanceCsv', 'defaultCategoryLabel', 'groupForDesk', 'attLettersOnly', 'attOneEditApart', 'possibleDuplicates', 'sameNameSameCategory'];

for (const [label, rel] of [['Control Center', CC], ['the desk page', DESK]]) {
  test(`attendance: ${label}’s ATTENDANCE CLIENT functions are the module’s, on every fixture CSV and hand CSV`, () => {
    const old = oldCode(rel, { consts: ['ATTENDANCE_SHIRT_HEADERS'], functions: ATT_FUNCTIONS });
    assert.deepStrictEqual(Att.ATTENDANCE_SHIRT_HEADERS, plain(old.ATTENDANCE_SHIRT_HEADERS));
    const csvs = [...fixtureCsvs(), ...HAND.map((text, i) => ({ label: `hand ${i}`, text }))];
    assert.ok(csvs.length >= 8);
    for (const { label: l, text } of csvs) {
      assert.deepStrictEqual(Att.attParseCsv(text), plain(old.attParseCsv(text)), l);
      const people = Att.parseAttendanceCsv(text);
      assert.deepStrictEqual(people, plain(old.parseAttendanceCsv(text)), l);
      assert.deepStrictEqual(Att.possibleDuplicates(people).map(p => p.map(x => x.key)), plain(old.possibleDuplicates(people)).map(p => p.map(x => x.key)), l);
      assert.deepStrictEqual(Att.sameNameSameCategory(people).map(x => x.key), plain(old.sameNameSameCategory(people)).map(x => x.key), l);
      for (const type of ['standard', 'dual-meet', 'team']) for (const showWithdrawn of [false, true]) {
        const opts = { type, showWithdrawn, teamName: c => (c.length % 2 ? `Name ${c}` : null), categoryLabel: c => `Label ${c}` };
        assert.deepStrictEqual(Att.groupForDesk(people, opts), plain(old.groupForDesk(people, opts)), `${l} ${type} ${showWithdrawn}`);
        assert.deepStrictEqual(Att.groupForDesk(people, { type, showWithdrawn }), plain(old.groupForDesk(people, { type, showWithdrawn })), `${l} ${type} bare`);
      }
    }
    for (const t of ['2026-10-03 08:30', '2026-10-03 13:05', '12:00 AM', '12:15 PM', '1:05 p.m.', 'whenever', '', undefined, '09:07:33', '2026-10-03 00:00']) {
      assert.equal(Att.attClockTime(t), old.attClockTime(t), String(t));
    }
    for (const v of [undefined, '', 'a,b', ' a , b ,, c ']) assert.deepStrictEqual(Att.attSplitList(v), plain(old.attSplitList(v)));
    const displays = [undefined, {}, { divisions: { N: 'Novice', NW: 'NW' }, events: { MD: "Men's", D: 'Open' } }];
    for (const display of displays) for (const code of ['NMD', 'NWD', 'ND', 'QQ', '', 'NMDX']) {
      assert.equal(Att.defaultCategoryLabel(code, display), old.defaultCategoryLabel(code, display), `${code} ${JSON.stringify(display)}`);
    }
    const words = ['dela cruz', 'delacruz', 'juan', 'juana', 'maria santos', 'maria santoz', 'abcde', 'abcdf', 'abcd', 'a', '', 'Dela-Cruz'];
    for (const a of words) for (const b of words) {
      assert.equal(Att.attOneEditApart(a, b), old.attOneEditApart(a, b), `${a}|${b}`);
      assert.equal(Att.attLettersOnly(a), old.attLettersOnly(a));
    }
  });
}

// ---- schedule board --------------------------------------------------------------------------------------------------------

const SCHEDULE_FUNCTIONS = [
  'parseCSV', 'nameOrNull', 'scoreOrNull', 'parseCourtAssignment', 'parseFacilityCsv', 'assignCourts', 'buildScheduleData',
  'markUnneededGames', 'unneededSeriesGames', 'seriesGameOf', 'courtsToParam', 'chunkBalanced', 'readableOn', 'parseCourtsParam',
];

for (const [label, rel, type] of [['standard board', STD_SCHEDULE, 'standard'], ['dual-meet board', DM_SCHEDULE, 'dual-meet']]) {
  test(`schedule: the ${label}’s grid code is the module’s, on every fixture, state and venue`, () => {
    const search = { value: '' };
    const old = oldCode(rel, {
      consts: ['SERIES_GAME_RE'], functions: SCHEDULE_FUNCTIONS,
      globals: { location: { get search() { return search.value; } }, URLSearchParams },
    });
    let boards = 0;
    for (const event of Object.keys(SNAPSHOTS)) {
      if (eventConfig(event).type !== type) continue;
      for (const state of STATES) {
        const snap = deriveState(loadSnapshot(event), state);
        const venues = [null, 'No such venue', ...snap.facilities.map(f => f.name)];
        for (const venue of venues) {
          const mine = G.buildScheduleData(snap, venue, type);
          const theirs = old.buildScheduleData(snap, venue);
          assert.deepStrictEqual(mine, plain(theirs), `${event}/${state}/${venue}`);
          boards++;
          for (const raw of ['', '1-2', '1,3', '2-99', '99', '1-3,5', 'x', '3-1']) {
            search.value = raw ? `?courts=${raw}` : '';
            const a = G.parseCourtsParam(raw || null, mine.courtList);
            const b = old.parseCourtsParam(mine.courtList);
            assert.deepStrictEqual(a && [...a], b && [...b], `${event} ?courts=${raw}`);
            if (a) assert.equal(G.courtsToParam(a, mine.courtList), old.courtsToParam(b, mine.courtList));
          }
        }
        for (const f of snap.facilities) {
          assert.deepStrictEqual(G.parseFacilityCsv(f.matchesCsv, type), plain(old.parseFacilityCsv(f.matchesCsv)), `${event}/${state}/${f.name}`);
        }
      }
    }
    assert.ok(boards >= 9);
    for (const list of [[], [1], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6, 7, 8, 9], Array.from({ length: 31 }, (_, i) => i)]) for (const per of [1, 4, 15]) {
      assert.deepStrictEqual(G.chunkBalanced(list, per), plain(old.chunkBalanced(list, per)), `${list.length}/${per}`);
    }
    for (const hex of ['#741B47', '#F6B26B', '#14263C', '#FFFFFF', '#000000', '#5B6B74', '#C27BA0']) assert.equal(G.readableOn(hex), old.readableOn(hex), hex);
    for (const v of [undefined, '', ' x ', '#REF!', '0', ' 11', 'abc', '-1']) {
      assert.equal(G.nameOrNull(v), old.nameOrNull(v), String(v));
      assert.equal(G.scoreOrNull(v), old.scoreOrNull(v), String(v));
      assert.equal(G.parseCourtAssignment(v), old.parseCourtAssignment(v), String(v));
    }
  });
}

test('schedule: the dual-meet board’s clubOf is the module’s', () => {
  const old = oldCode(DM_SCHEDULE, { consts: ['clubOf'] });
  for (const code of ['PNF_LIWD_1', 'bup_LIWD_1', '', 'X', undefined, 'A_B_C']) assert.equal(G.clubOf(code), old.clubOf(code), String(code));
});
