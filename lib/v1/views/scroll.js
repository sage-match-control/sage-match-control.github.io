// Scroll positions across re-renders. The Standings board (per-category
// vertical scroll on desktop) and the Live Matches board (per-facility
// horizontal table scroll on mobile) both fully rebuild their HTML on every
// refresh, so without this their scroll position would silently reset every
// 10 seconds: capture each scrollable node's position before the render and
// restore it after.
//
// Only nodes with a scroll offset are recorded, and only a handful of nodes
// under a panel are ever scrollable, so walking just the selector's matches
// (not every descendant) keeps it cheap on a panel that can hold hundreds of
// rows, cells and spans.

export const SCROLLABLE_SELECTOR = '.standings-board-desktop, .standings-col, .category-clubs-row, .live-table-wrap, .br-table-wrap, .gt-wrap';

/**
 * Stable identity for a scrollable node, preferred over raw className/
 * tagName matching — the same category or facility can render in a
 * different slot after a reload (categories/courts added, removed, or
 * re-sorted), and position-based matching would hand its scroll offset to
 * whatever unrelated element now occupies that slot instead.
 */
export function scrollNodeIdentity(node){
  const key = node.dataset && (node.dataset.catKey || node.dataset.facilityKey || node.dataset.groupKey);
  return key ? `id:${key}` : (node.className || node.tagName);
}

export function captureScrollPositions(root){
  const positions = [];
  const counts = {};
  root.querySelectorAll(SCROLLABLE_SELECTOR).forEach(node => {
    if(node.scrollTop > 0 || node.scrollLeft > 0){
      const key = scrollNodeIdentity(node);
      counts[key] = (counts[key] || 0) + 1;
      positions.push({ key, occurrence: counts[key], top: node.scrollTop, left: node.scrollLeft });
    }
  });
  return positions;
}

export function restoreScrollPositions(root, positions){
  if(!positions.length) return;
  const counts = {};
  root.querySelectorAll(SCROLLABLE_SELECTOR).forEach(node => {
    const key = scrollNodeIdentity(node);
    counts[key] = (counts[key] || 0) + 1;
    const match = positions.find(p => p.key === key && p.occurrence === counts[key]);
    if(match){
      node.scrollTop = match.top;
      node.scrollLeft = match.left;
    }
  });
}
