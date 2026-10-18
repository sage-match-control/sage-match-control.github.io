// A team's mark, for a team event whose teams have colours (events.json display.teamColors): the team's colour
// on a shape of its own, drawn before the team's name, and a card tinted from one side's colour to the other's.
// The shape is there for a reader who can't tell the colours apart (red from green, blue from purple): it, the
// name and the colour each say which team it is, so no one of them has to carry it alone. The Hub's team views
// and the schedule board both draw it.
//
// The n-th team in display.teamColors gets the n-th shape, so the shapes follow the order events.json lists the
// teams in; a ninth team starts the shapes again.

import { escapeHtml } from './html.js';

export const TEAM_MARK_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'star', 'hexagon', 'plus', 'triangle-down'];

// 12 x 12, each filling about the same area so no shape reads as louder than another.
const PATHS = {
  'circle':        'M6 1a5 5 0 1 1 0 10A5 5 0 1 1 6 1Z',
  'square':        'M1.6 1.6h8.8v8.8H1.6Z',
  'triangle':      'M6 .9 11.4 10.6H.6Z',
  'diamond':       'M6 .4 11.6 6 6 11.6.4 6Z',
  'star':          'M6 .8 7.44 4.42 11.33 4.67 8.33 7.16 9.29 10.93 6 8.85 2.71 10.93 3.67 7.16.67 4.67 4.56 4.42Z',
  'hexagon':       'M6 .6 10.7 3.3v5.4L6 11.4 1.3 8.7V3.3Z',
  'plus':          'M4.2 .8h3.6v3.4h3.4v3.6H7.8v3.4H4.2V7.8H.8V4.2h3.4Z',
  'triangle-down': 'M.6 1.4h10.8L6 11.1Z',
};

/**
 * A team's mark, `{ color, shape }`, from the event's team colours (EventConfig.teamColors) and the team's
 * group-stage code; null when the map gives that team no colour, or there is no team yet (a playoff slot).
 */
export function teamMarkOf(teamColors, code){
  if(!teamColors || !code || !Object.prototype.hasOwnProperty.call(teamColors, code)) return null;
  const i = Object.keys(teamColors).indexOf(code);
  return { color: teamColors[code], shape: TEAM_MARK_SHAPES[i % TEAM_MARK_SHAPES.length] };
}

/** The mark drawn before a team's name, or '' without one. Hidden from screen readers: the name follows it. */
export function teamMarkHTML(mark){
  if(!mark) return '';
  return `<svg class="team-mark team-mark-${mark.shape}" viewBox="0 0 12 12" aria-hidden="true" focusable="false">` +
    `<path d="${PATHS[mark.shape]}" fill="${escapeHtml(mark.color)}"/></svg>`;
}

/**
 * The inline style that tints a card from the left team's colour to the right team's (the .team-tint rule in
 * css/teams.css and css/schedule-board.css): '--team-a:#…;--team-b:#…', with a side that has no mark left out,
 * so it fades to the card's own white. '' when neither side has one.
 */
export function teamTintStyle(left, right){
  return [left ? `--team-a:${escapeHtml(left.color)}` : '', right ? `--team-b:${escapeHtml(right.color)}` : '']
    .filter(Boolean).join(';');
}
