// The actions a case can take (site-engine-spec §6.4): click a tab, type into
// the search box and pick the first suggestion, choose a standings category,
// open the score dialog for match N, fill scores, press Review, and so on.
//
// A step is `{ name, run(page, ctx) }`. `name` shows in a failing case's
// report. Selectors are the ones both trees share: the ids and classes the
// engine must keep (site-engine-spec §4.3 rule 2).

export const step = (name, run) => ({ name, run });

/** Click the first element matching `selector`. */
export const click = selector =>
  step(`click ${selector}`, page => page.locator(selector).first().click({ timeout: 8000 }));

/** Click a `.view-tab` by its label. */
export const tab = label =>
  step(`tab "${label}"`, page => page.locator('.view-tab', { hasText: label }).first().click({ timeout: 8000 }));

/** Type into an input one key at a time, so the page's input handlers fire. */
export const type = (selector, text) =>
  step(`type "${text}" into ${selector}`, async page => {
    const input = page.locator(selector).first();
    await input.click({ timeout: 8000 });
    await input.fill('');
    await input.pressSequentially(text, { delay: 10 });
  });

/** Click the nth (0-based) element matching `selector`. */
export const clickNth = (selector, n) =>
  step(`click ${selector} #${n}`, page => page.locator(selector).nth(n).click({ timeout: 8000 }));

/** Select an <option> by its visible label or value. */
export const choose = (selector, value) =>
  step(`choose ${value} in ${selector}`, page => page.selectOption(selector, value));

export const press = key => step(`press ${key}`, page => page.keyboard.press(key));

/** Run `inner` only when `selector` is on the page; otherwise do nothing, the same in both trees. */
export const ifPresent = (selector, inner) =>
  step(`if ${selector}: ${inner.name}`, async (page, ctx) => {
    if (await page.locator(selector).count()) await inner.run(page, ctx);
  });

/** Run `inner` only when `selector` is on the page and visible (a layout may hide a control). */
export const ifVisible = (selector, inner) =>
  step(`if visible ${selector}: ${inner.name}`, async (page, ctx) => {
    if (await page.locator(selector).first().isVisible()) await inner.run(page, ctx);
  });

/** Print-media rendering, for the schedule board. */
export const printMedia = () => step('print media', page => page.emulateMedia({ media: 'print' }));

/** Fixed pause, only where a page animates in JS. */
export const pause = ms => step(`pause ${ms}`, page => page.waitForTimeout(ms));

/** Fill both score inputs of the open score dialog and press Review. */
export const enterScores = (a, b) =>
  step(`enter ${a}–${b} and Review`, async page => {
    const dlg = page.locator('dialog[open]');
    await dlg.locator('.score-input[data-score-side="1"]').fill(String(a));
    await dlg.locator('.score-input[data-score-side="2"]').fill(String(b));
    await dlg.getByRole('button', { name: /^Review/ }).click({ timeout: 8000 });
  });

/** Press Save on the review step of the score dialog. */
export const saveScores = () =>
  step('Save', async page => {
    await page.locator('dialog[open]').getByRole('button', { name: /^Save \d+–\d+ to sheet$/ }).click({ timeout: 8000 });
  });
