// Run one case on one tree and return what it showed (site-engine-spec §6.4):
// the innerText of the case's root and a full-page PNG, after the last step
// and a network-idle wait, plus the page's collected errors.
import { startSite } from './server.mjs';
import { openPage, settle } from './browser.mjs';

/**
 * `tree` is a site from startSite() (shared by a run) or a folder to serve for this one case.
 */
export async function runCase(browser, tree, c) {
  // A case with a stateful backend makes a fresh one for every run.
  const backend = c.backend ? c.backend() : { external: [], cloudRun: [] };
  const own = typeof tree === 'string';
  const site = own ? await startSite({ root: tree }) : tree;
  site.register(c.id, c.instantiate);
  const h = await openPage(browser, site.baseUrl + c.path, {
    viewport: c.viewport,
    time: c.time,
    registry: c.registry,
    snapshots: c.snapshots,
    fixtureFiles: c.fixtureFiles,
    external: [...c.external, ...backend.external],
    cloudRun: [...c.cloudRun, ...backend.cloudRun],
    allowErrors: c.allowErrors,
    storage: c.storage,
    caseId: c.id,
  });
  try {
    await settle(h.page);
    for (const s of c.steps) {
      try {
        await s.run(h.page, h);
      } catch (err) {
        throw new Error(`step "${s.name}" failed: ${err.message.split('\n')[0]}`);
      }
      await settle(h.page);
    }
    const text = await h.page.locator(c.root).first().innerText();
    const png = await h.page.screenshot({ fullPage: true });
    return { text, png, errors: h.errors.slice(), requests: h.requests.slice() };
  } finally {
    await h.close();
    if (own) await site.close();
  }
}
