// views/team-mark.js: a team's colour on a shape of its own, and the tint between two teams.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEAM_MARK_SHAPES, teamMarkOf, teamMarkHTML, teamTintStyle } from '../../../lib/v1/views/team-mark.js';

const COLORS = { Red: '#D55E00', Orange: '#E69F00', Yellow: '#F0E442', Green: '#009E73', Blue: '#0072B2', Purple: '#6F3FA0', Sky: '#56B4E9', Pink: '#CC79A7', Ninth: '#000' };

test('the n-th team in teamColors gets the n-th shape, and a ninth starts them again', () => {
  assert.equal(TEAM_MARK_SHAPES.length, 8);
  assert.equal(new Set(TEAM_MARK_SHAPES).size, 8, 'eight different shapes');
  assert.deepEqual(Object.keys(COLORS).slice(0, 8).map(c => teamMarkOf(COLORS, c).shape), TEAM_MARK_SHAPES);
  assert.deepEqual(teamMarkOf(COLORS, 'Red'), { color: '#D55E00', shape: 'circle' });
  assert.deepEqual(teamMarkOf(COLORS, 'Ninth'), { color: '#000', shape: 'circle' });
});

test('no mark for a team the map lacks, no team, or no map', () => {
  assert.equal(teamMarkOf(COLORS, 'Gold'), null);
  assert.equal(teamMarkOf(COLORS, null), null, 'a playoff slot with no team yet');
  assert.equal(teamMarkOf(COLORS, 'toString'), null, 'only the map’s own keys');
  assert.equal(teamMarkOf({}, 'Red'), null);
  assert.equal(teamMarkOf(undefined, 'Red'), null);
});

test('a mark is an SVG of its shape in its colour, hidden from screen readers; every shape has a path', () => {
  for (const shape of TEAM_MARK_SHAPES) {
    assert.match(teamMarkHTML({ color: '#123456', shape }),
      new RegExp(`^<svg class="team-mark team-mark-${shape}" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M[^"]+Z" fill="#123456"/></svg>$`), shape);
  }
  assert.equal(teamMarkHTML(null), '');
  assert.doesNotMatch(teamMarkHTML({ color: '"><script>', shape: 'circle' }), /<script>/, 'the colour is escaped');
});

test('the tint names each side that has a mark, left then right', () => {
  const red = teamMarkOf(COLORS, 'Red'), sky = teamMarkOf(COLORS, 'Sky');
  assert.equal(teamTintStyle(red, sky), '--team-a:#D55E00;--team-b:#56B4E9');
  assert.equal(teamTintStyle(null, sky), '--team-b:#56B4E9');
  assert.equal(teamTintStyle(red, null), '--team-a:#D55E00');
  assert.equal(teamTintStyle(null, null), '');
});
