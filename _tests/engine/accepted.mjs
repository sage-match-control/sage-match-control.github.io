// Differences the harness accepts (site-engine-spec §6.5). An entry is allowed
// only for §3.3 items 3, 4 and 5: a fix carried to the other page (§5.2 cause
// 3), or an owner-approved presentation change. `row` is the §12 row that
// records the decision. Keep this list short.
//
//   { case: <RegExp over the case id>, kind: 'text' | 'pixels' | 'both', reason, row }
export const ACCEPTED = [
  // ---- Phase 3, the ticket (views/ticket.js, css/ticket.css) ----
  {
    case: /^std-index\/[^/]+\/(finder|finder-search)\//, kind: 'pixels', row: 8,
    reason: 'the pair code on a ticket is Control Center’s small muted label, on the Hub too',
  },
  {
    case: /^(cc\/[^/]+|dm-index\/[^/]+)\/(finder|finder-by-number|finder-search)\/[^/]+\/phone$|^cc-signed-in\/[^/]+\/score-entry-save\/[^/]+\/phone$/, kind: 'pixels', row: 10,
    reason: 'at phone sizes a ticket has the standard Hub’s names gap and players size, in Control Center and the dual-meet Hub too',
  },
  {
    case: /^cc\/piggleball-2026\/finder\/[^/]+\/desktop$/, kind: 'pixels', row: 1,
    reason: 'a series final’s game that is never played is greyed out (“Not needed”) on Control Center’s tickets too',
  },
];
