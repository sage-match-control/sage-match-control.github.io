// Characterization (site-engine-spec §5.2): teams.js and awards.js against
// Control Center's team block and awards derivation, on every fixture and
// state and on hand-made brackets that exercise the bronze walkover.
import test from 'node:test';
import assert from 'node:assert/strict';
import { oldCode, plain } from '../../helpers/old.mjs';
import { SNAPSHOTS, STATES, loadSnapshot, deriveState, eventConfig } from '../../helpers/fixtures.mjs';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import * as T from '../../../lib/v1/domain/teams.js';
import * as A from '../../../lib/v1/domain/awards.js';

const CC = 'tools/control-center.html';

const CODES_FUNCTIONS = [
  'parseCode', 'splitCategory', 'categoryLabel', 'clubLabel', 'matchInstanceOf', 'roundKeyword', 'roundLabel', 'standingsStageKey',
  'buildCategoryOrderIndex', 'matchByeSide', 'sideIsBye', 'isByeStandingRow', 'seriesGameOf', 'seriesGroups', 'walkSeries',
  'rankStandings', 'headToHeadWins', 'isEmptyStanding',
];
const TEAM_FUNCTIONS = [
  'numberRepeatedPairs', 'parseSideCode', 'sideOf', 'pairOf', 'stageOf', 'slotOf', 'isGroupTeamCode', 'baseTeamOf', 'teamNameOf',
  'sideLabel', 'groupOf', 'stageLabel', 'pairLabel', 'teamMatchupResult', 'rebuildTeamData', 'teamRowsToRoster', 'teamSetRoster',
  'teamRosterOf', 'teamRankBracket', 'teamRosterFor', 'teamMedalist', 'buildTeamPodium', 'parseCSV',
];
const AWARDS_FUNCTIONS = [
  'nonByeCode', 'matchCategoryOf', 'matchRestOf', 'resolveDecisiveMatch', 'winnerOfMatch', 'loserOfMatch', 'medalistFromTeam',
  'categoryBronzeIsByeDecided', 'standingsBronzeWalkover', 'standingsTop3ForCategory', 'categoryRoundRobinDone', 'buildPodiums', 'computeOverallChampion',
];
const CONSTS = ['parseCodeCache', 'sideCodeCache', 'PAIRS', 'STAGES', 'ROUND_KEYWORD_LABELS', 'STANDINGS_STAGE_KEY_BY_ROUND_KEYWORD', 'SERIES_GAME_RE', 'BYE_RE'];

/** The old team/awards code with the day's globals set from a DayModel. */
function oldFor(model) {
  const old = oldCode(CC, {
    consts: CONSTS,
    functions: [...CODES_FUNCTIONS, ...TEAM_FUNCTIONS, ...AWARDS_FUNCTIONS],
    globals: {
      CURRENT_TYPE: model.event.type, DISPLAY: model.event.display || {}, UNRESOLVED_CATEGORIES: new Set(), CATEGORY_ORDER_INDEX: new Map(),
      MATCHES: model.matches, STANDINGS: model.standings,
      TEAM_ROW_BY_CODE: new Map(), TEAM_MATCHUPS: [], ADVANCING: new Set(), TEAM_ROSTER: [], TEAM_ROSTER_BY_CODE: new Map(),
    },
  });
  if (model.event.type === 'team') {
    old.teamSetRoster(model.snapshot);
    old.rebuildTeamData();
  }
  return old;
}

/** Every fixture × state as a DayModel (and the snapshot behind it). */
function* models() {
  for (const event of Object.keys(SNAPSHOTS)) for (const state of STATES) {
    const cfg = eventConfig(event);
    yield { event, state, model: buildDayModel(cfg, cfg.days[0], deriveState(loadSnapshot(event), state), { now: Date.parse(`${cfg.days[0].date}T13:00:00+08:00`) }) };
  }
}

// ---- hand-made days: the bracket cases the fixtures may not have ----------------------------------------------------

const HEADER = 'matchNumber,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const row = (num, t1, a, b, s1, t2, c, d, s2) => `${num},,9:00 AM,Court 1,${t1},${a},${b},${s1 ?? ''},${t2},${c},${d},${s2 ?? ''}`;
const day = (type, display, matches, standings) => buildDayModel(
  { key: 'e', type, display, days: [], title: 'E' }, { key: 'd', date: '2026-10-03' },
  { isLive: true, facilities: [{ name: 'Main', matchesCsv: [HEADER, ...matches].join('\n'), standingsCsv: ['teamCode,player1,player2,wins,loss,quotient,bracket', ...standings].join('\n') }] },
  { now: 0 },
);
const DISPLAY = { divisions: { N: 'Novice', LI: 'Low' }, events: { MD: 'M', WD: 'W' }, clubs: { PNF: 'Pickle', BUP: 'Bataan' } };
const HAND = {
  'final and bronze': day('standard', DISPLAY, [row(1, 'NMD_F_1', 'A', 'a', 11, 'NMD_F_2', 'B', 'b', 5), row(2, 'NMD_B_1', 'C', 'c', 3, 'NMD_B_2', 'D', 'd', 11)], []),
  'bronze by walkover (code)': day('standard', DISPLAY, [row(1, 'NMD_F_1', 'A', 'a', 11, 'NMD_F_2', 'B', 'b', 5), row(2, 'NMD_B_1', 'C', 'c', null, 'BYE', 'x', 'y', null)], []),
  'bronze by walkover (name)': day('standard', DISPLAY, [row(1, 'NMD_F_1', 'A', 'a', 11, 'NMD_F_2', 'B', 'b', 5), row(2, 'NMD_B_1', 'bye', 'c', null, 'NMD_B_2', 'D', 'd', null)], []),
  'bronze in the standings alone': day('standard', DISPLAY, [row(1, 'NMD_F_1', 'A', 'a', 11, 'NMD_F_2', 'B', 'b', 5)], ['NMD_B_1,Ed,Flo,0,0,,', 'NMD_B_2,BYE,,0,0,,']),
  'bronze in the standings, names not in': day('standard', DISPLAY, [row(1, 'NMD_F_1', 'A', 'a', 11, 'NMD_F_2', 'B', 'b', 5)], ['NMD_B_1,,,0,0,,', 'NMD_B_2,BYE,,0,0,,']),
  'tied final': day('standard', DISPLAY, [row(1, 'NMD_F_1', 'A', 'a', 11, 'NMD_F_2', 'B', 'b', 11)], []),
  'series, undecided': day('standard', DISPLAY, [row(1, 'NMD_F_1_(1)', 'A', 'a', 5, 'NMD_F_2_(1)', 'B', 'b', 11), row(2, 'NMD_F_1_(2)', 'A', 'a', null, 'NMD_F_2_(2)', 'B', 'b', null)], []),
  'series, decided in game 2': day('standard', DISPLAY, [row(1, 'NMD_F_1_(1)', 'A', 'a', 5, 'NMD_F_2_(1)', 'B', 'b', 11), row(2, 'NMD_F_1_(2)', 'A', 'a', 4, 'NMD_F_2_(2)', 'B', 'b', 11)], []),
  'series, decided in game 1': day('standard', DISPLAY, [row(1, 'NMD_F_1_(1)', 'A', 'a', 11, 'NMD_F_2_(1)', 'B', 'b', 2), row(2, 'NMD_F_1_(2)', 'A', 'a', null, 'NMD_F_2_(2)', 'B', 'b', null)], []),
  'round robin only': day('standard', DISPLAY, [row(1, 'NMD_1', 'A', 'a', 11, 'NMD_2', 'B', 'b', 3), row(2, 'NMD_3', 'C', 'c', 11, 'NMD_4', 'D', 'd', 3)], ['NMD_1,A,a,3,0,3,1', 'NMD_2,B,b,2,1,2,1', 'NMD_3,C,c,1,2,1,1', 'NMD_4,D,d,0,3,0.1,1', 'NMD_5,NMD_5,,0,0,,1']),
  'round robin, unfinished': day('standard', DISPLAY, [row(1, 'NMD_1', 'A', 'a', 11, 'NMD_2', 'B', 'b', 3), row(2, 'NMD_3', 'C', 'c', null, 'NMD_4', 'D', 'd', null)], ['NMD_1,A,a,3,0,3,1', 'NMD_2,B,b,2,1,2,1', 'NMD_3,C,c,1,2,1,1']),
  'unresolved category': day('standard', DISPLAY, [row(1, 'ZZ_F_1', 'A', 'a', 11, 'ZZ_F_2', 'B', 'b', 5)], []),
  'dual meet clubs': day('dual-meet', DISPLAY, [row(1, 'PNF_NMD_F_1', 'A', 'a', 11, 'BUP_NMD_F_1', 'B', 'b', 5), row(2, 'PNF_LIWD_F_1', 'C', 'c', 2, 'BUP_LIWD_F_1', 'D', 'd', 11)], ['PNF_NMD_1,A,a,3,0,3,1', 'BUP_NMD_1,B,b,1,2,1,1', 'PNF_NMD_F_1,A,a,9,0,1,1']),
  'dual meet, no display': day('dual-meet', {}, [row(1, 'PNF_NMD_F_1', 'A', 'a', 11, 'BUP_NMD_F_1', 'B', 'b', 5)], ['PNF_NMD_1,A,a,3,0,3,1', 'BUP_NMD_1,B,b,1,2,1,1']),
  'nothing': day('standard', DISPLAY, [], []),
};

const allModels = function* () {
  for (const m of models()) yield { label: `${m.event}/${m.state}`, model: m.model };
  for (const [label, model] of Object.entries(HAND)) yield { label, model };
};

// ---- awards ---------------------------------------------------------------------------------------------------------------

test('awards: buildPodiums is CC’s, on every fixture and state and every hand-made bracket', () => {
  let podiums = 0;
  for (const { label, model } of allModels()) {
    const old = oldFor(model);
    const mine = A.buildPodiums(model);
    assert.deepStrictEqual(mine, plain(old.buildPodiums()), label);
    podiums += mine.length;
  }
  assert.ok(podiums > 50);
});

test('awards: every step of the derivation agrees, category by category', () => {
  for (const { label, model } of allModels()) {
    const old = oldFor(model);
    const type = model.event.type;
    const categories = [...new Set(model.matches.map(m => A.matchCategoryOf(m, type)).filter(Boolean))];
    model.standings.forEach(s => { const c = old.parseCode(s.teamCode).category; if (c && !categories.includes(c)) categories.push(c); });
    for (const category of categories) {
      const where = `${label}/${category}`;
      for (const keyword of ['R16', 'QF', 'SF', 'F', 'B']) {
        const mine = A.resolveDecisiveMatch(model, category, keyword);
        const theirs = old.resolveDecisiveMatch(category, keyword);
        assert.deepStrictEqual(plain({ ...mine, match: mine.match && mine.match.num }), plain({ ...theirs, match: theirs.match && theirs.match.num }), `${where}/${keyword}`);
      }
      assert.equal(A.categoryBronzeIsByeDecided(model, category), old.categoryBronzeIsByeDecided(category), where);
      assert.deepStrictEqual(A.standingsBronzeWalkover(model, category), plain(old.standingsBronzeWalkover(category)), where);
      assert.deepStrictEqual(A.standingsTop3ForCategory(model, category), plain(old.standingsTop3ForCategory(category)), where);
      assert.equal(A.categoryRoundRobinDone(model, category), old.categoryRoundRobinDone(category), where);
    }
    for (const m of model.matches) {
      assert.equal(A.nonByeCode(m), old.nonByeCode(m), `${label} #${m.num}`);
      assert.deepStrictEqual(A.winnerOfMatch(m), plain(old.winnerOfMatch(m)), `${label} #${m.num}`);
      assert.deepStrictEqual(A.loserOfMatch(m), plain(old.loserOfMatch(m)), `${label} #${m.num}`);
    }
    assert.deepStrictEqual(A.computeOverallChampion(model), plain(old.computeOverallChampion()), label);
    for (const team of [null, { p1: 'a', p2: 'b', code: 'PNF_NMD_1' }, { p1: 'a', p2: 'b', code: 'NMD_1' }]) {
      assert.deepStrictEqual(A.medalistFromTeam(model, team), plain(old.medalistFromTeam(team)), `${label} ${JSON.stringify(team)}`);
    }
  }
});

// ---- teams ---------------------------------------------------------------------------------------------------------------------

test('teams: side codes, names and labels are CC’s, on the team fixtures and on codes of every shape', () => {
  const codes = ['A_1', 'A_4', 'SF-1_2', 'SF-A_2', 'Br-F_4', 'Fi-A_1', 'QF-3_1', 'A', 'Fi-A', 'ZZ-1_9', '', 'X_Y'];
  for (const { label, model } of allModels()) {
    if (model.event.type !== 'team') continue;
    const old = oldFor(model);
    const rowByCode = model.team.rowByCode;
    const all = new Set([...codes, ...model.matches.flatMap(m => [m.t1, m.t2]), ...model.standings.map(s => s.teamCode)]);
    for (const code of all) {
      const where = `${label} ${JSON.stringify(code)}`;
      assert.deepStrictEqual(T.parseSideCode(code), plain(old.parseSideCode(code)), where);
      const side = T.sideOf(code);
      assert.equal(T.pairOf(code), old.pairOf(code), where);
      assert.equal(T.stageOf(side), old.stageOf(side), where);
      assert.equal(T.slotOf(side), old.slotOf(side), where);
      assert.equal(T.isGroupTeamCode(code), old.isGroupTeamCode(code), where);
      assert.equal(T.baseTeamOf(side, rowByCode), old.baseTeamOf(side), where);
      assert.equal(T.teamNameOf(side, rowByCode), old.teamNameOf(side), where);
      assert.equal(T.sideLabel(side, rowByCode), old.sideLabel(side), where);
      assert.equal(T.groupOf(side, rowByCode), old.groupOf(side), where);
      assert.equal(T.stageLabel(side, rowByCode), old.stageLabel(side), where);
      assert.equal(T.pairLabel(code, true), old.pairLabel(code, true), where);
      assert.equal(T.pairLabel(code, false), old.pairLabel(code, false), where);
    }
    assert.deepStrictEqual(T.PAIRS, plain(old.PAIRS));
    assert.deepStrictEqual(T.STAGES, plain(old.STAGES));
  }
});

test('teams: matchups, the advancing set and every matchup result are CC’s', () => {
  let matchups = 0;
  for (const { label, model } of allModels()) {
    if (model.event.type !== 'team') continue;
    const old = oldFor(model);
    assert.deepStrictEqual(plain(model.team.matchups), plain(old.TEAM_MATCHUPS), label);
    assert.deepStrictEqual(plain(model.team.advancing), plain(old.ADVANCING), label);
    assert.deepStrictEqual(plain(model.team.rowByCode), plain(old.TEAM_ROW_BY_CODE), label);
    for (const mu of model.team.matchups) {
      assert.deepStrictEqual(T.teamMatchupResult(mu.matches), plain(old.teamMatchupResult(mu.matches)), `${label} ${mu.matchUp}`);
      matchups++;
    }
  }
  assert.ok(matchups > 100);
});

test('teams: bracket ranking and rosters are CC’s', () => {
  for (const { label, model } of allModels()) {
    if (model.event.type !== 'team') continue;
    const old = oldFor(model);
    const groups = new Map();
    model.standings.filter(s => T.isGroupTeamCode(s.teamCode)).forEach(s => {
      const g = s.bracket || '';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(s);
    });
    for (const [g, rows] of groups) {
      assert.deepStrictEqual(T.teamRankBracket(rows, model.matches).map(s => s.teamCode), plain(old.teamRankBracket(rows)).map(s => s.teamCode), `${label} bracket ${g}`);
    }
    assert.deepStrictEqual(plain(model.team.roster), plain(old.TEAM_ROSTER), label);
    assert.deepStrictEqual(plain(model.team.rosterByCode), plain(old.TEAM_ROSTER_BY_CODE), label);
    for (const code of new Set([...model.team.rosterByCode.keys(), 'nobody'])) {
      assert.deepStrictEqual(T.teamRosterOf(model.team.rosterByCode, code), plain(old.teamRosterOf(code)), `${label} ${code}`);
    }
    const parsed = rows => T.teamRowsToRoster(rows);
    assert.deepStrictEqual(parsed([]), plain(old.teamRowsToRoster([])));
  }
});

test('teams: the team podium and every medalist are CC’s', () => {
  for (const { label, model } of allModels()) {
    if (model.event.type !== 'team') continue;
    const old = oldFor(model);
    assert.deepStrictEqual(A.buildTeamPodium(model), plain(old.buildTeamPodium()), label);
    for (const base of model.team.rowByCode.keys()) {
      assert.deepStrictEqual(A.teamRosterFor(model, base), plain(old.teamRosterFor(base)), `${label} ${base}`);
      assert.deepStrictEqual(A.teamMedalist(model, base), plain(old.teamMedalist(base)), `${label} ${base}`);
    }
  }
});
