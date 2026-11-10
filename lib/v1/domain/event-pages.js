// Where an event's pages live on the site.
//
// A running event's pages are at events/<key>/. A finished event's can be moved
// to events/archives/<key>/, and its entry in events.json then carries
// `pagesArchived: true`, which is how Control Center finds them. That flag is
// separate from `archived`, which hides an event from the console's picker.
//
// Moving a folder ends its old address: nothing redirects it. The event's short
// link has to be pointed at the new one.

/**
 * The folder of an event's pages, root-absolute, with a trailing slash.
 * @param {string} eventKey @param {{ pagesArchived?: boolean }} [entry] its events.json entry
 */
export function eventPagesPath(eventKey, entry){
  const folder = entry && entry.pagesArchived === true ? 'events/archives' : 'events';
  return `/${folder}/${encodeURIComponent(eventKey)}/`;
}

/**
 * The address a page missing from events/ would have under events/archives/, or
 * null when there is none. No page uses this; it stays because lib/v1 only adds.
 * @param {string} pathname
 */
export function archivedPagePath(pathname){
  const m = /^\/events\/(?!archives(?:\/|$))([^/]+)(\/.*)?$/.exec(pathname);
  return m ? `/events/archives/${m[1]}${m[2] || '/'}` : null;
}
