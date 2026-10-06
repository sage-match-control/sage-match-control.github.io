// Characterization (site-engine-spec §5.2): codes.js, standings.js and the
// pair helpers of matches.js against Control Center's copies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { oldCode, plain } from '../../helpers/old.mjs';
import { SNAPSHOTS, STATES, loadSnapshot, deriveState, eventConfig } from '../../helpers/fixtures.mjs';
import { parseCSV } from '../../../lib/v1/domain/csv.js';
import { rowsToMatches, buildMatchByCodeIndex, isUnnamedScheduledPair, pairKey } from '../../../lib/v1/domain/matches.js';
import { rowsToStandings, rankStandings, headToHeadWins, isEmptyStanding, fmtQ } from '../../../lib/v1/domain/standings.js';
import * as Codes from '../../../lib/v1/domain/codes.js';

const CC = 'tools/control-center.html';

const ODD_CODES = ['', 'BYE', 'TBD', 'X', 'A_', '_B', 'PNF__1', 'PNF_LIWD_F_1_(2)', 'LIWD_SF_1', 'ZZ_B_1', 'N_QF_3', 'NWD_R16_2', 'IXD_F_2_(1)'];

/** Per fixture event: its type, display, and every code its matches and standings use. */
function events() {
  return Object.keys(SNAPSHOTS).map(event => {
    const cfg = eventConfig(event);
    const snap = loadSnapshot(event);
    const codes = new Set(ODD_CODES);
    for (const f of snap.facilities) {
      rowsToMatches(parseCSV(f.matchesCsv)).forEach(m => { codes.add(m.t1); codes.add(m.t2); });
      rowsToStandings(parseCSV(f.standingsCsv)).forEach(s => codes.add(s.teamCode));
    }
    return { event, type: cfg.type, display: cfg.display, codes: [...codes] };
  });
}

const DISPLAYS = display => [display, {}, { divisions: display.divisions }, { divisions: {}, events: display.events }];

const CODE_FUNCTIONS = [
  'parseCode', 'splitCategory', 'categoryLabel', 'clubLabel', 'matchInstanceOf', 'roundKeyword', 'roundLabel',
  'divisionLabel', 'divisionEventLabel', 'buildCategoryOrderIndex', 'categorySortKey', 'standingsStageKey',
];
const CODE_CONSTS = ['parseCodeCache', 'ROUND_KEYWORD_LABELS', 'STANDINGS_STAGE_KEY_BY_ROUND_KEYWORD', 'STAGE_META', 'CROSS_CLUB_STAGE_KEYS', 'STAGE_ORDER', 'BADGE_CLASSES'];

test('the fixed stage tables are the same', () => {
  const old = oldCode(CC, { consts: CODE_CONSTS, functions: CODE_FUNCTIONS, globals: { CURRENT_TYPE: 'standard', DISPLAY: {}, UNRESOLVED_CATEGORIES: new Set(), CATEGORY_ORDER_INDEX: new Map() } });
  assert.deepStrictEqual(Codes.STAGE_META, plain(old.STAGE_META));
  assert.deepStrictEqual(Codes.CROSS_CLUB_STAGE_KEYS, plain(old.CROSS_CLUB_STAGE_KEYS));
  assert.deepStrictEqual(Codes.STAGE_ORDER, plain(old.STAGE_ORDER));
  assert.deepStrictEqual(Codes.BADGE_CLASSES, plain(old.BADGE_CLASSES));
  assert.deepStrictEqual(Codes.ROUND_KEYWORD_LABELS, plain(old.ROUND_KEYWORD_LABELS));
  assert.deepStrictEqual(Codes.STANDINGS_STAGE_KEY_BY_ROUND_KEYWORD, plain(old.STANDINGS_STAGE_KEY_BY_ROUND_KEYWORD));
});

test('codes: CC’s parsing, labels and stage keys are the module’s, for every code of every fixture and every display', () => {
  let checked = 0;
  for (const { event, type, display, codes } of events()) {
    for (const shown of DISPLAYS(display)) {
      const unresolvedOld = new Set();
      const old = oldCode(CC, { consts: CODE_CONSTS, functions: CODE_FUNCTIONS, globals: { CURRENT_TYPE: type, DISPLAY: shown, UNRESOLVED_CATEGORIES: unresolvedOld, CATEGORY_ORDER_INDEX: new Map() } });
      const unresolvedNew = new Set();
      for (const code of codes) {
        const where = `${event} ${JSON.stringify(code)} ${Object.keys(shown)}`;
        assert.deepStrictEqual(Codes.parseCode(code, type), plain(old.parseCode(code)), where);
        const { category, rest } = Codes.parseCode(code, type);
        assert.deepStrictEqual(Codes.splitCategory(category, shown), plain(old.splitCategory(category)), where);
        assert.equal(Codes.categoryLabel(category, shown, unresolvedNew), old.categoryLabel(category), where);
        assert.equal(Codes.divisionLabel(code, type, shown, unresolvedNew), old.divisionLabel(code), where);
        assert.equal(Codes.divisionEventLabel(code, type, shown, unresolvedNew), old.divisionEventLabel(code), where);
        assert.equal(Codes.roundKeyword(rest), old.roundKeyword(rest), where);
        assert.equal(Codes.roundLabel(rest), old.roundLabel(rest), where);
        assert.equal(Codes.matchInstanceOf(code), old.matchInstanceOf(code), where);
        assert.equal(Codes.standingsStageKey(code, type), old.standingsStageKey(code), where);
        const club = Codes.parseCode(code, type).club;
        assert.equal(Codes.clubLabel(club, shown), old.clubLabel(club), where);
        checked++;
      }
      assert.deepStrictEqual([...unresolvedNew].sort(), [...unresolvedOld].sort(), `${event}: the same categories are flagged as unresolved`);

      const tokens = [...new Set(codes.map(c => Codes.parseCode(c, type).category).filter(Boolean))];
      assert.deepStrictEqual(plain(Codes.buildCategoryOrderIndex(tokens, shown)), plain(old.buildCategoryOrderIndex(tokens)), event);
      old.CATEGORY_ORDER_INDEX = old.buildCategoryOrderIndex(tokens);
      const orderIndex = Codes.buildCategoryOrderIndex(tokens, shown);
      for (const teamCode of codes) {
        assert.equal(Codes.categorySortKey({ teamCode }, orderIndex, type), old.categorySortKey({ teamCode }), `${event} ${teamCode}`);
      }
    }
  }
  assert.ok(checked > 1000);
});

// ---- standings ---------------------------------------------------------------------------------------

const everyDay = function* () {
  for (const event of Object.keys(SNAPSHOTS)) for (const state of STATES) {
    const snap = deriveState(loadSnapshot(event), state);
    const matches = snap.facilities.flatMap(f => rowsToMatches(parseCSV(f.matchesCsv))).sort((a, b) => a.num - b.num);
    const standings = snap.facilities.flatMap(f => rowsToStandings(parseCSV(f.standingsCsv)));
    yield { event, state, type: eventConfig(event).type, matches, standings };
  }
};

test('standings: rankStandings and headToHeadWins are CC’s, for every category of every fixture and state', () => {
  const old = oldCode(CC, { functions: ['rankStandings', 'headToHeadWins'], globals: { MATCHES: [] } });
  let ranked = 0;
  for (const { event, state, type, matches, standings } of everyDay()) {
    old.MATCHES = matches;
    const byCategory = new Map();
    standings.forEach(s => {
      const key = `${Codes.parseCode(s.teamCode, type).category}|${Codes.standingsStageKey(s.teamCode, type)}`;
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(s);
    });
    for (const [key, rows] of byCategory) {
      const where = `${event}/${state}/${key}`;
      assert.deepStrictEqual(plain(rankStandings(rows, matches).map(s => s.teamCode)), plain(old.rankStandings(rows).map(s => s.teamCode)), where);
      assert.deepStrictEqual(plain(headToHeadWins(rows, matches)), plain(old.headToHeadWins(rows)), where);
      ranked++;
    }
  }
  assert.ok(ranked > 50);
});

test('standings: isEmptyStanding and fmtQ are CC’s', () => {
  const old = oldCode(CC, { functions: ['isEmptyStanding', 'fmtQ'] });
  for (const { standings } of everyDay()) for (const s of standings) assert.equal(isEmptyStanding(s), old.isEmptyStanding(s), s.teamCode);
  for (const teamCode of ['IXD_F_1_(2)', 'ND_1']) for (const player1 of ['', teamCode, teamCode.replace(/_?\(\d+\)$/, ''), 'Ann']) {
    assert.equal(isEmptyStanding({ teamCode, player1 }), old.isEmptyStanding({ teamCode, player1 }));
  }
  for (const q of [null, 0, 1, 1.069, 6.2857, 12.345678]) assert.equal(fmtQ(q), old.fmtQ(q));
});

test('matches: isUnnamedScheduledPair and pairKey are CC’s, on every standings row and match', () => {
  for (const { event, type, matches, standings } of everyDay()) {
    const display = eventConfig(event).display;
    const byCode = buildMatchByCodeIndex(matches);
    const old = oldCode(CC, {
      functions: ['parseCode', 'standingsStageKey', 'roundKeyword', 'isEmptyStanding', 'isUnnamedScheduledPair', 'pairKey', 'splitCategory'],
      consts: ['parseCodeCache', 'STANDINGS_STAGE_KEY_BY_ROUND_KEYWORD'],
      globals: { CURRENT_TYPE: type, DISPLAY: display, MATCH_BY_CODE: byCode },
    });
    for (const s of standings) assert.equal(isUnnamedScheduledPair(s, byCode, type), old.isUnnamedScheduledPair(s), `${event} ${s.teamCode}`);
    for (const m of matches) {
      assert.equal(pairKey(m.t1, m.t1p1, m.t1p2, type), old.pairKey(m.t1, m.t1p1, m.t1p2), `${event} #${m.num}`);
    }
  }
});

test('matches: buildMatchByCodeIndex is CC’s', () => {
  const old = oldCode(CC, { functions: ['buildMatchByCodeIndex'] });
  for (const { matches } of everyDay()) {
    assert.deepStrictEqual(plain(buildMatchByCodeIndex(matches)), plain(old.buildMatchByCodeIndex(matches)));
  }
});

test('the Hubs’ stage tables and go-live lead are the module’s', () => {
  for (const rel of ['_templates/standard-tournament-template/index.html', '_templates/dual-meet-template/index.html']) {
    const dm = rel.includes('dual-meet');
    const old = oldCode(rel, { consts: ['STAGE_META', 'STAGE_ORDER', 'BADGE_CLASSES', ...(dm ? ['CROSS_CLUB_STAGE_KEYS'] : []), 'ROUND_KEYWORD_LABELS', 'STANDINGS_STAGE_KEY_BY_ROUND_KEYWORD', 'GO_LIVE_LEAD_HOURS'] });
    assert.deepStrictEqual(Codes.STAGE_META, plain(old.STAGE_META), rel);
    assert.deepStrictEqual(Codes.STAGE_ORDER, plain(old.STAGE_ORDER), rel);
    assert.deepStrictEqual(Codes.BADGE_CLASSES, plain(old.BADGE_CLASSES), rel);
    assert.deepStrictEqual(Codes.ROUND_KEYWORD_LABELS, plain(old.ROUND_KEYWORD_LABELS), rel);
    assert.deepStrictEqual(Codes.STANDINGS_STAGE_KEY_BY_ROUND_KEYWORD, plain(old.STANDINGS_STAGE_KEY_BY_ROUND_KEYWORD), rel);
    if (dm) assert.deepStrictEqual(Codes.CROSS_CLUB_STAGE_KEYS, plain(old.CROSS_CLUB_STAGE_KEYS), rel);
    assert.equal(4, old.GO_LIVE_LEAD_HOURS);
  }
});
