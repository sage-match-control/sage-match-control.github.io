// views/ticket.js, views/html.js: pure string builders, tested on hand-made models.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDayModel } from '../../../lib/v1/domain/model.js';
import { escapeHtml } from '../../../lib/v1/views/html.js';
import { ticketHTML, pairCell, standingRowClass } from '../../../lib/v1/views/ticket.js';

const HEADER = 'matchNumber,court,Schedule,CourtAssignment,teamCode1,team1Player1,team1Player2,team1Score,teamCode2,team2Player1,team2Player2,team2Score';
const row = (n, live, t1, p1, p2, s1, t2, q1, q2, s2) => `${n},${live},9:00 AM,Court 1,${t1},${p1},${p2},${s1},${t2},${q1},${q2},${s2}`;
const model = (rows, { type = 'standard', isLive = true, facilities = ['Main'], standings = '' } = {}) => buildDayModel(
  { key: 'e', type, title: 'E', display: {}, days: [] },
  { key: 'd', facilities },
  { isLive, facilities: [{ name: 'Main', matchesCsv: [HEADER, ...rows].join('\n'), standingsCsv: 'teamCode,player1,player2,wins,loss,quotient,bracket\n' + standings }] },
  { now: 0 },
);

test('escapeHtml escapes markup and quotes', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(5), '5');
});

test('a played ticket shows the score from the asked team’s side, and marks the winner', () => {
  const m = model([row(1, '', 'ND_1', 'Ann', 'Bo', 11, 'ND_2', 'Cy', 'Di', 4)]);
  const html = ticketHTML(m.matches[0], m, { teamCode: 'ND_2' });
  assert.match(html, /<span class="score-num ">4<\/span><span class="score-colon">:<\/span><span class="score-num win">11<\/span>/);
  assert.match(html, /ND_2<span class="you-badge">You<\/span>/);
  assert.match(html, /<span class="tag pool">Round Robin<\/span>/);
});

test('a neutral ticket keeps team 1 on the left with no You badge', () => {
  const m = model([row(1, '', 'ND_1', 'Ann', 'Bo', '', 'ND_2', 'Cy', 'Di', '')]);
  const html = ticketHTML(m.matches[0], m);
  assert.doesNotMatch(html, /you-badge/);
  assert.match(html, /vs-text">VS/);
  assert.ok(html.indexOf('ND_1') < html.indexOf('ND_2'));
});

test('scores stay hidden before the day is live', () => {
  const m = model([row(1, '', 'ND_1', 'Ann', 'Bo', 11, 'ND_2', 'Cy', 'Di', 4)], { isLive: false });
  assert.match(ticketHTML(m.matches[0], m), /vs-text/);
});

test('a match on court is live, and Next Up shows only when it is not', () => {
  const m = model([row(1, '2', 'ND_1', 'Ann', 'Bo', '', 'ND_2', 'Cy', 'Di', ''), row(2, '', 'ND_3', 'E', 'F', '', 'ND_4', 'G', 'H', '')]);
  const live = ticketHTML(m.matches[0], m, { isNext: true });
  assert.match(live, /live-pill/);
  assert.doesNotMatch(live, /next-pill| next"/);
  assert.match(live, /Court 2/);
  const next = ticketHTML(m.matches[1], m, { isNext: true });
  assert.match(next, /next-pill">Next Up/);
  assert.match(next, /class="ticket next"/);
});

test('the facility is named only on a day with more than one', () => {
  const rows = [row(1, '', 'ND_1', 'Ann', 'Bo', '', 'ND_2', 'Cy', 'Di', '')];
  assert.doesNotMatch(ticketHTML(model(rows).matches[0], model(rows)), /Main/);
  const two = model(rows, { facilities: ['Main', 'Annex'] });
  assert.match(ticketHTML(two.matches[0], two), /Court 1 &middot; Main/);
});

test('a series game after the decider is greyed out, with a title', () => {
  const m = model([
    row(1, '', 'ND_F_1_(1)', 'A', 'a', 11, 'ND_F_2_(1)', 'B', 'b', 3),
    row(2, '', 'ND_F_1_(2)', 'A', 'a', '', 'ND_F_2_(2)', 'B', 'b', ''),
  ]);
  assert.match(ticketHTML(m.matches[1], m), /class="ticket not-needed" title="Not needed"/);
  assert.doesNotMatch(ticketHTML(m.matches[0], m), /not-needed/);
});

test('decorate and teamLogoHTML are the only ways a page adds to a ticket, and do nothing by default', () => {
  const m = model([row(1, '', 'ND_1', 'Ann', 'Bo', '', 'ND_2', 'Cy', 'Di', '')]);
  const plain = ticketHTML(m.matches[0], m);
  const html = ticketHTML(m.matches[0], m, {
    decorate: x => ({ className: ' scoreable', attrs: ` data-num="${x.num}"`, metaHTML: '<span class="hint">edit</span>' }),
    teamLogoHTML: code => `<img alt="${code}">`,
  });
  assert.match(html, /class="ticket scoreable" data-num="1"/);
  assert.match(html, /<span class="hint">edit<\/span>/);
  assert.match(html, /<img alt="ND_1">/);
  assert.doesNotMatch(plain, /scoreable|hint|<img/);
});

test('TBD sides read "To be determined", and a playoff opponent names its round', () => {
  const m = model([row(1, '', 'ND_SF_1', 'ND_SF_1', '', '', 'ND_2', 'Cy', 'Di', '')]);
  const html = ticketHTML(m.matches[0], m, { teamCode: 'ND_2' });
  assert.match(html, /To be determined/);
  assert.match(html, /tag round">Semifinal/);
});

test('pairCell: names, the code of an unnamed scheduled pair, TBD for an empty slot', () => {
  const m = model([row(1, '', 'ND_1', 'ND_1', '', '', 'ND_2', 'Cy', 'Di', '')]);
  assert.equal(pairCell({ teamCode: 'ND_2', player1: 'Cy <b>', player2: 'Di', wins: 0, loss: 0 }, m), '<td class="pair" title="Cy &lt;b&gt; / Di"><span>Cy &lt;b&gt;</span><span>Di</span></td>');
  assert.equal(pairCell({ teamCode: 'ND_1', player1: 'ND_1', player2: '' }, m), '<td class="pair tbd"><span>ND_1</span></td>');
  assert.equal(pairCell({ teamCode: 'ND_SF_1', player1: '', player2: '' }, m), '<td class="pair tbd"><span>TBD</span></td>');
});

test('standingRowClass', () => {
  assert.equal(standingRowClass({ wins: 0, loss: 0 }), '');
  assert.equal(standingRowClass({ wins: 2, loss: 1 }), 'win');
  assert.equal(standingRowClass({ wins: 1, loss: 1 }), 'loss');
});
