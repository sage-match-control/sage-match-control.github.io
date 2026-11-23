// A finished category's podium, and a team event's, on the Hub's Standings (hub-player-experience-spec §8).
//
// The rule is Control Center's Awards tab's (domain/awards.js buildPodiums / buildTeamPodium), so the two never
// disagree: a podium is shown once it is known, which is when
//   - there is no warning (a tied Final or Bronze),
//   - gold and silver are set, and
//   - bronze is set, or the category has no bronze at all (no Bronze match, and no bronze walkover in the standings).
// A category decided by its round robin alone (source 'standings') is shown too, once its round robin is done
// (buildPodiums leaves the places empty until then) and carries no final line.
//
// podiumFor(model, category) and teamPodiumFor(model) return `{ gold, silver, bronze, finalLine }` or null. Each
// place is the display name (a pair's two names joined by " / ", with " · <club>" after them at a dual meet; a
// team's name), `bronze` is null when there is no bronze, and `finalLine` is "Beat <silver> <score> in the final"
// (no score for a series final, whose games are not one score; a team event's is its points, or its pairs won when
// `teamScoring` is "games", and "37–35 on points" for a Final level on games; null without a Final to read).
// podiumHTML(p) is the card, or '' for null.
//
// Control Center does not pass `podium` to createStandings or createTeams (it has an Awards tab), so it never draws one.

import { buildPodiums, buildTeamPodium, resolveDecisiveMatch, standingsBronzeWalkover } from '../domain/awards.js';
import { seriesGameOf } from '../domain/series.js';
import { parseCode } from '../domain/codes.js';
import { escapeHtml } from './html.js';

const podiumsByModel = new WeakMap();

/** buildPodiums(model), by category code, kept per model (a model is built once per snapshot). */
function podiumsOf(model){
  let byCategory = podiumsByModel.get(model);
  if(!byCategory){
    byCategory = new Map(buildPodiums(model).map(p => [p.category, p]));
    podiumsByModel.set(model, byCategory);
  }
  return byCategory;
}

const nameOf = medalist => {
  if(!medalist) return null;
  const names = [medalist.p1, medalist.p2].filter(Boolean).join(' / ');
  return medalist.clubLabel ? `${names} · ${medalist.clubLabel}` : names;
};

/**
 * @param {object} model  a DayModel (domain/model.js)
 * @param {string} category  a category code, as parseCode(...).category gives it
 * @returns {{ gold: string, silver: string, bronze: string|null, finalLine: string|null }|null}
 */
export function podiumFor(model, category){
  const entry = podiumsOf(model).get(category);
  if(!entry || entry.warning || !entry.gold || !entry.silver) return null;
  if(!entry.bronze){
    const hasBronze = resolveDecisiveMatch(model, category, 'B').any || standingsBronzeWalkover(model, category).walkover;
    if(hasBronze) return null;
  }
  const silver = nameOf(entry.silver);
  let finalLine = null;
  if(entry.source === 'bracket'){
    const m = resolveDecisiveMatch(model, category, 'F').match;
    if(m){
      if(seriesGameOf(m.t1)) finalLine = `Beat ${silver} in the final`;
      else {
        const t1Won = m.t1Score > m.t2Score;
        finalLine = `Beat ${silver} ${t1Won ? m.t1Score : m.t2Score}–${t1Won ? m.t2Score : m.t1Score} in the final`;
      }
    }
  }
  return { gold: nameOf(entry.gold), silver, bronze: nameOf(entry.bronze), finalLine };
}

/**
 * A team event's podium: the Final matchup's winner, loser and the Bronze matchup's winner.
 * @returns {{ gold: string, silver: string, bronze: string|null, finalLine: string|null }|null}
 */
export function teamPodiumFor(model){
  if(!model.team) return null;
  const t = buildTeamPodium(model);
  if(t.warning || !t.gold || !t.silver) return null;
  const matchups = model.team.matchups;
  if(!t.bronze && matchups.some(mu => mu.stage === 'Br')) return null;
  const finalMu = matchups.find(mu => mu.stage === 'Fi');
  let finalLine = null;
  if(finalMu){
    const r = finalMu.result;
    // 'games' scoring counts pairs won; a Final level on games was won on points (Millennium's was 2–2, 37–35), and
    // "2–2" would read as a tie, so that line gives the points.
    const onGames = r.scoring === 'games' && r.pairs1 !== r.pairs2;
    const [a, b] = onGames ? [r.pairs1, r.pairs2] : [r.pts1, r.pts2];
    finalLine = `Beat ${t.silver.teamName} ${r.winner === 1 ? a : b}–${r.winner === 1 ? b : a}${r.scoring === 'games' && !onGames ? ' on points' : ''} in the final`;
  }
  return { gold: t.gold.teamName, silver: t.silver.teamName, bronze: t.bronze ? t.bronze.teamName : null, finalLine };
}

const PLACES = [['gold', 1], ['silver', 2], ['bronze', 3]];

/** The podium card for a Standings card's body or a team event's Standings; '' without a podium. */
export function podiumHTML(p){
  if(!p) return '';
  const places = PLACES.filter(([key]) => p[key]).map(([key, rank]) => {
    const line = key === 'gold' && p.finalLine ? `<small>${escapeHtml(p.finalLine)}</small>` : '';
    return `<li class="podium-place podium-place--${key}"><span class="podium-rank">${rank}</span>`
      + `<span class="podium-names">${escapeHtml(p[key])}${line}</span></li>`;
  }).join('');
  return `<div class="podium"><div class="podium-title">Podium</div><ol class="podium-list">${places}</ol></div>`;
}

/** The podium card for one category of a standard event or dual meet, from the rows the card draws. */
export function categoryPodiumHTML(model, rows){
  if(!rows || !rows.length) return '';
  return podiumHTML(podiumFor(model, parseCode(rows[0].teamCode, model.event.type).category));
}
