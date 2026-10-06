// Differences the harness accepts (site-engine-spec §6.5). An entry is allowed
// only for §3.3 items 3, 4 and 5: a fix carried to the other page (§5.2 cause
// 3), or an owner-approved presentation change. `row` is the §12 row that
// records the decision (a number), or the team template spec's §17 row (a string
// beginning "team"). Keep this list short.
//
//   { case: <RegExp over the case id>, kind: 'text' | 'pixels' | 'both', reason, row }
export const ACCEPTED = [
  // ---- Phase 3, the ticket (views/ticket.js, css/ticket.css) ----
  {
    case: /^std-index\/[^/]+\/(finder|finder-search)\//, kind: 'pixels', row: 8,
    reason: 'the pair code on a ticket is Control Center’s small muted label, on the Hub too',
  },
  {
    case: /^(cc\/[^/]+|dm-index\/[^/]+)\/(finder|finder-by-number|finder-search|live)\/[^/]+\/phone$|^cc-signed-in\/[^/]+\/score-entry-save\/[^/]+\/phone$/, kind: 'pixels', row: 10,
    reason: 'at phone sizes a ticket has the standard Hub’s names gap and players size, and a Live Matches row its team code and players sizes, in Control Center and the dual-meet Hub too',
  },
  {
    case: /^cc\/piggleball-2026\/finder\/[^/]+\/desktop$/, kind: 'pixels', row: 1,
    reason: 'a series final’s game that is never played is greyed out (“Not needed”) on Control Center’s tickets too',
  },
  {
    case: /^std-index\/[^/]+\/live\//, kind: 'pixels', row: 9,
    reason: 'a Live Matches row ends in Control Center’s 2px divider (rgba(20,27,44,.4)), on the Hub too',
  },
  // ---- Phase 3, Match Finder (views/finder.js) ----
  {
    case: /^cc\/(piggleball-2026|pickle-for-sight-2026|pnf-x-bup-dual-meet)\/finder\//, kind: 'both', row: 3,
    reason: 'the Teams count on the first screen counts real pairs only (codes ending in a bare number), as the Hub does',
  },
  // ---- the team tournament template (sage-docs/docs/specs/.../team-tournament-template-spec.md §9 rows 8-10;
  //      `row` names the row of the spec's §17) ----
  {
    case: /^cc\/pickledrive-anniversary-2026\/finder-search\//, kind: 'both', row: 'team §17 row 8',
    reason: 'a player result shows the player’s level and gender beside the name',
  },
  {
    case: /^cc\/team-demo-2026\//, kind: 'both', row: 'team §17 row 9',
    reason: 'the demo’s pair labels come from display.pairs (MD, WD, XD) where the baseline reads the old constant (MD, WD, XD 1); a player result shows level and gender',
  },
  {
    case: /^scorer\/team-demo-2026\//, kind: 'both', row: 'team §17 row 10',
    reason: 'a playoff side shows its team’s name (or Seed n · TBD), and the dialog’s sub line reads the stage and the pair',
  },
];
