// The Tournament Calculator's shared estimate and its category presets
// (sage-docs/docs/specs/.../calculator-share-estimate-spec.md). The summary and
// its text are pure: they are pulled out of the page and run here against the
// two Paddle Aces day plans, a dual meet and the edge cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT } from '../../helpers/paths.mjs';
import { extractFunction, extractConst } from '../../helpers/extract.mjs';

const page = fs.readFileSync(path.join(SITE_ROOT, 'tools/tournament-calculator.html'), 'utf8');
const consts = ['rrMatches', 'roundLabel', 'PRESETS', 'catCode', 'catName', 'SHARE_ROUND', 'SHARE_VERDICT']
  .map(n => extractConst(page, n).text);
const fns = ['groupSizes', 'reduceToTarget', 'solveForTarget', 'tieredRounds', 'playoffPlan', 'splitEven',
  'dualGroupStage', 'dualPlayoffPlan', 'calcDualCategory', 'calcCategory', 'rrRoundFloor', 'seqParts', 'calcAll',
  'catTime', 'fmtTime', 'fmtDur', 'groupShorthand', 'defaultCat', 'finishLevel', 'buildEstimateSummary',
  'buildEstimateText'].map(n => extractFunction(page, n));
const lib = new Function('let cats=[],nextId=1;\n' + [...consts, ...fns].join('\n')
  + '\nreturn { PRESETS, catName, defaultCat, calcAll, finishLevel, buildEstimateSummary, buildEstimateText,'
  + ' setCats: c => { cats = c; } };')();

// A category as Import CSV makes it, and a plan around it.
const cat = (code, teams, group, o = {}) => ({ code, name: '', teams, group, adv: 2, fill: 'bye', soloFormat: 'ttb',
  rrLegs: 1, rrBestOf: 1, groupDual: 1, teamsA: 5, teamsB: 5, poFormat: 'semis', ...o });
const plan = (o, cats) => ({ title: '', date: '', start: '10:00', startMin: 600, courts: 4, dur: 25, buf: 0,
  format: 'standard', clubA: 'Club A', clubB: 'Club B', ...o, cats });
const estimate = cfg => lib.buildEstimateSummary(cfg, lib.calcAll(cfg));
const longDate = iso => new Date(iso + 'T00:00').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const TTB = 'Final: twice-to-beat (#1 needs one win, #2 must win twice) · #3 takes bronze';
const FOOT_TTB = ' Twice-to-beat finals and best-of-3 matches are counted at full length, so the day ends earlier if they’re decided sooner.';

test('Paddle Aces Day 1 (28 Nov): the whole message', () => {
  const cfg = plan({ title: 'Paddle Aces The Ultimate Generation Cup DAY 1', date: '2026-11-28', courts: 10 }, [
    cat('NMD', 13, 4), cat('NWD', 8, 2), cat('NXD', 12, 3), cat('LIMD', 14, 4), cat('LIWD', 9, 2),
    cat('LIXD', 10, 2), cat('HIMD', 7, 2), cat('HIXD', 4, 1), cat('AMD', 4, 1), cat('AXD', 4, 1)]);
  const s = estimate(cfg);
  assert.deepEqual([s.finish, s.level, s.pairs, s.matches, s.ranged, s.slots, s.play],
    ['5:05 PM', 'good', 85, 170, true, 17, '7h 5m']);
  assert.equal(lib.buildEstimateText(s), [
    'PADDLE ACES THE ULTIMATE GENERATION CUP DAY 1', 'Schedule estimate', '',
    longDate('2026-11-28'), 'Start 10:00 AM · 10 courts · 25-min matches', '',
    'Projected finish: 5:05 PM', 'Comfortable one-day plan',
    '85 pairs · up to 170 matches · 17 time slots · 7h 5m play time', '', 'CATEGORIES', '',
    "NMD · Novice Men's Doubles", '13 pairs · 4 groups (4-3-3-3) · top 2 advance', 'Playoffs: QF, SF, Bronze, Final',
    '23 matches (15 RR + 8 PO) · 2h 30m', '',
    "NWD · Novice Women's Doubles", '8 pairs · 2 groups (4-4) · top 2 advance', 'Playoffs: SF, Bronze, Final',
    '16 matches (12 RR + 4 PO) · 2h 5m', '',
    'NXD · Novice Mixed Doubles', '12 pairs · 3 groups (4-4-4) · top 2 advance, top seed bye',
    'Playoffs: R16, QF, SF, Bronze, Final', '24 matches (18 RR + 6 PO) · 2h 55m', '',
    "LIMD · Low Intermediate Men's Doubles", '14 pairs · 4 groups (4-4-3-3) · top 2 advance',
    'Playoffs: QF, SF, Bronze, Final', '26 matches (18 RR + 8 PO) · 2h 30m', '',
    "LIWD · Low Intermediate Women's Doubles", '9 pairs · 2 groups (5-4) · top 2 advance',
    'Playoffs: SF, Bronze, Final', '20 matches (16 RR + 4 PO) · 2h 55m', '',
    'LIXD · Low Intermediate Mixed Doubles', '10 pairs · 2 groups (5-5) · top 2 advance',
    'Playoffs: SF, Bronze, Final', '24 matches (20 RR + 4 PO) · 2h 55m', '',
    "HIMD · High Intermediate Men's Doubles", '7 pairs · 2 groups (4-3) · top 2 advance',
    'Playoffs: SF, Bronze, Final', '13 matches (9 RR + 4 PO) · 2h 5m', '',
    'HIXD · High Intermediate Mixed Doubles', '4 pairs · 1 group of 4 · round robin', TTB,
    '7–8 matches (6 RR + 1–2 PO) · 2h 5m', '',
    "AMD · Advanced Men's Doubles", '4 pairs · 1 group of 4 · round robin', TTB,
    '7–8 matches (6 RR + 1–2 PO) · 2h 5m', '',
    'AXD · Advanced Mixed Doubles', '4 pairs · 1 group of 4 · round robin', TTB,
    '7–8 matches (6 RR + 1–2 PO) · 2h 5m', '',
    'Estimate only: assumes all 10 courts are in use from 10:00 AM with 25-minute matches and no buffer.' + FOOT_TTB,
    'S.A.G.E. Tournament Time Calculator'].join('\n'));
});

test("Paddle Aces Day 2 (29 Nov): Open Women's Doubles is a preset, double round robins", () => {
  const cfg = plan({ title: 'Paddle Aces The Ultimate Generation Cup DAY 2', date: '2026-11-29', courts: 6 }, [
    cat('NMD', 4, 1), cat('LIMD', 11, 3), cat('LIXD', 4, 1),
    cat('AMD', 3, 1, { rrLegs: 2 }), cat('OWD', 3, 1, { rrLegs: 2 })]);
  const s = estimate(cfg);
  assert.deepEqual([s.finish, s.pairs, s.matches, s.slots, s.play], ['1:45 PM', 25, 53, 9, '3h 45m']);
  assert.equal(lib.buildEstimateText(s), [
    'PADDLE ACES THE ULTIMATE GENERATION CUP DAY 2', 'Schedule estimate', '',
    longDate('2026-11-29'), 'Start 10:00 AM · 6 courts · 25-min matches', '',
    'Projected finish: 1:45 PM', 'Comfortable one-day plan',
    '25 pairs · up to 53 matches · 9 time slots · 3h 45m play time', '', 'CATEGORIES', '',
    "NMD · Novice Men's Doubles", '4 pairs · 1 group of 4 · round robin', TTB,
    '7–8 matches (6 RR + 1–2 PO) · 2h 5m', '',
    "LIMD · Low Intermediate Men's Doubles", '11 pairs · 3 groups (4-4-3) · top 2 advance, top seed bye',
    'Playoffs: R16, QF, SF, Bronze, Final', '21 matches (15 RR + 6 PO) · 2h 55m', '',
    'LIXD · Low Intermediate Mixed Doubles', '4 pairs · 1 group of 4 · round robin', TTB,
    '7–8 matches (6 RR + 1–2 PO) · 2h 5m', '',
    "AMD · Advanced Men's Doubles", '3 pairs · 1 group of 3 · double round robin', TTB,
    '7–8 matches (6 RR + 1–2 PO) · 3h 20m', '',
    "OWD · Open Women's Doubles", '3 pairs · 1 group of 3 · double round robin', TTB,
    '7–8 matches (6 RR + 1–2 PO) · 3h 20m', '',
    'Estimate only: assumes all 6 courts are in use from 10:00 AM with 25-minute matches and no buffer.' + FOOT_TTB,
    'S.A.G.E. Tournament Time Calculator'].join('\n'));
});

test('the other playoff shapes, a buffer, and one court', () => {
  const s = estimate(plan({ courts: 1, buf: 5, startMin: 540 }, [
    cat('BWD', 2, 1),
    cat('OXD', 5, 1, { soloFormat: 'final_bronze' }),
    cat('BMD', 4, 1, { soloFormat: 'final' }),
    cat('BXD', 3, 1, { soloFormat: 'rr' }),
    cat('OPEN', 8, 2, { rrBestOf: 3 })]));
  const [h2h, fb, fin, rr, bo3] = s.cats;
  assert.deepEqual([h2h.name, h2h.format, h2h.playoff, h2h.count, h2h.split],
    ["Beginner Women's Doubles", '2 pairs · head-to-head, no round robin', 'Final: best of 3 (first to 2 wins)', '2–3', '']);
  assert.deepEqual([fb.name, fb.playoff, fb.count, fb.split],
    ['Open Mixed Doubles', 'Final: #1 v #2 · Bronze: #3 v #4', '12', '10 RR + 2 PO']);
  assert.deepEqual([fin.playoff, fin.count], ['Final: #1 v #2 · #3 takes bronze', '7']);
  assert.deepEqual([rr.format, rr.playoff, rr.count, rr.split],
    ['3 pairs · 1 group of 3 · round robin only, standings decide', '', '3', '']);
  assert.deepEqual([bo3.format, bo3.count, bo3.split],
    ['8 pairs · 2 groups (4-4) · top 2 advance · best-of-3 round robin', '28–40', '24–36 RR + 4 PO']);
  assert.equal(s.meta, 'Start 9:00 AM · 1 court · 25-min matches + 5-min buffer');
  assert.match(s.foot, /^Estimate only: assumes the court is in use from 9:00 AM with 25-minute matches and a 5-minute buffer\. Twice/);
  assert.equal(s.title, 'Untitled tournament');
  assert.equal(s.date, '');
  assert.ok(!lib.buildEstimateText(s).includes('\n\n\n'), 'no date line, and no doubled blank line');
});

test('a dual meet: the clubs under the title, pairs per club, cross-club group stage', () => {
  const s = estimate(plan({ format: 'dual', clubA: 'PNF', clubB: 'BUP' }, [
    cat('NMD', 10, 4, { teamsA: 5, teamsB: 5, groupDual: 1 }),
    cat('LIMD', 10, 4, { teamsA: 6, teamsB: 6, groupDual: 2 }),
    cat('HIMD', 2, 4, { teamsA: 1, teamsB: 1, groupDual: 1 })]));
  assert.equal(s.clubs, 'PNF vs BUP');
  assert.equal(s.pairs, 24);
  assert.deepEqual(s.cats.map(k => [k.format, k.playoff, k.count, k.split]), [
    ['5 v 5 pairs · 1 bracket · cross-club group stage', 'Playoffs: Bronze, Final', '27', '25 group + 2 PO'],
    ['6 v 6 pairs · 2 brackets (3v3, 3v3) · cross-club group stage', 'Playoffs: Club playoff, Bronze, Final', '22', '18 group + 4 PO'],
    ['1 v 1 pairs · one match decides it', '', '1', '']]);
  assert.deepEqual(lib.buildEstimateText(s).split('\n').slice(0, 3), ['UNTITLED TOURNAMENT', 'PNF vs BUP', 'Schedule estimate']);
  assert.ok(lib.buildEstimateText(s).includes('\n1 match · '));
});

test('finishLevel: the three alert levels', () => {
  const at = (startMin, endMin) => lib.finishLevel({ startMin }, { matches: 1, endMin });
  assert.equal(at(540, 21 * 60 + 59), 'good');
  assert.equal(at(540, 22 * 60), 'warn');
  assert.equal(at(540, 24 * 60), 'bad');
  assert.equal(at(300, 300 + 15 * 60 + 5), 'bad');
  assert.equal(lib.finishLevel({ startMin: 540 }, { matches: 0, endMin: null }), null);
});

test('presets: Beginner first, the three Opens, and a new category still starts from Novice', () => {
  const codes = lib.PRESETS.map(p => p[0]);
  assert.deepEqual(codes, ['BWD', 'BMD', 'BXD', 'NWD', 'NMD', 'NXD', 'LIWD', 'LIMD', 'LIXD', 'IWD', 'IMD', 'IXD',
    'HIWD', 'HIMD', 'HIXD', 'AWD', 'AMD', 'AXD', 'OWD', 'OPEN', 'OXD', 'CUSTOM']);
  assert.deepEqual(['BWD', 'BMD', 'BXD', 'OWD', 'OPEN', 'OXD'].map(code => lib.catName({ code })), [
    "Beginner Women's Doubles", "Beginner Men's Doubles", 'Beginner Mixed Doubles',
    "Open Women's Doubles", "Open Men's Doubles", 'Open Mixed Doubles']);
  lib.setCats([]);
  assert.equal(lib.defaultCat().code, 'NWD');
  lib.setCats(codes.slice(3, -1).map(code => ({ code })));
  assert.equal(lib.defaultCat().code, 'BWD');
  lib.setCats(codes.slice(0, -1).map(code => ({ code })));
  assert.equal(lib.defaultCat().code, 'BWD', 'every preset used: the first one, as before');
});
