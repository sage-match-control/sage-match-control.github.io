# Event site templates — instantiation runbook

This directory holds three reusable event-site templates. Instantiating one
for a real event is a copy-and-fill job: copy the folder, replace every
`{{TOKEN}}`, fill in a handful of example config arrays, and wire up the
backend. This file is the checklist for doing that. It assumes you're
working in this repo (`sage-match-control.github.io`) with the
`sage-tools-api` backend repo also available.

**These templates are not served as pages.** This repo has no
`.nojekyll`, so GitHub Pages runs Jekyll over it, and Jekyll excludes
top-level directories beginning with `_` from the published site — that's
what keeps `_templates/` unpublished. Do not add a `.nojekyll` file to
*this* repo without also finding another way to exclude `_templates/`. (The
*data* repo, `event-data`, needs its own `.nojekyll` — see §0 below. Don't
cross the wires between the two repos.) Templates contain only
placeholders and example values, never secrets, so if they ever did leak
into the published site nothing would be exposed — this is a tidiness
boundary, not a security one.

## 0. One-time backend prerequisites

The three items below live in `sage-tools-api`'s Cloud Run env vars (not in
code), are shared across every event, and only need doing once — skip this
section if they're already in place (which they will be for any event
after the first one instantiated with these templates).

- **`GITHUB_REPO` must be `event-data`.** Every page reads its snapshot from
  `sage-match-control.github.io/event-data/<event-key>/data/` (the
  `GHPAGES_OWNER`/`GHPAGES_REPO` constants in `lib/v1/platform.js`, which
  mirror this), so Cloud Run has to publish there too. This is fixed platform config now, not something you pick per
  event.
- **The `event-data` repo must exist**, with GitHub Pages enabled
  (Settings → Pages → Deploy from branch → whatever `GITHUB_BRANCH` is set
  to) and a `.nojekyll` file at its **root** — without it, GitHub runs
  `<event>/data/<day>.json` through Jekyll instead of serving it as a
  plain static file. (This is the opposite of the note above about *this*
  repo, `sage-match-control.github.io`: the data repo needs `.nojekyll`,
  the site repo must not have one. Don't cross the wires.)
- **`GITHUB_TOKEN` must be scoped to the `event-data` repo.** It's a
  fine-grained PAT with only "Contents: Read and write" permission (see
  `.env.example` in `sage-tools-api`). If it's still scoped to an old
  single-event repo from before templating, generate a new one against
  `event-data` and update it in Cloud Run.

The event/day/facility registry itself lives at `config/events.json` in
`event-data` (`config/README.md` right next to it documents the shape and
validation rules) — not in `sage-tools-api` source. Editing and committing
that file (step 7 below) is how you add an event or fix a wrong sheet ID;
every running `sage-tools-api` instance picks up a change within
`SYNC_CONFIG_TTL_MS` (about a minute by default), with **no redeploy**.

Not sure whether this migration has already happened? Check Cloud Run's
current env vars — either in the console (the service → Edit & Deploy New
Revision → Variables & Secrets) or via:

```
gcloud run services describe sage-tools-api --region us-central1 --format="value(spec.template.spec.containers[0].env)"
```

## 1. Choosing a template

- Two clubs facing off (a "dual meet") → `dual-meet-template/`.
- Named teams meeting in matchups (a team tournament) → `team-tournament-template/`.
- Everything else (an open-entry bracket tournament) → `standard-tournament-template/`.

Day count and category count do **not** affect this choice — all three
templates handle any number of tournament days. The standard and dual-meet
templates handle any number of divisions/events. `dual-meet-template/`
additionally handles exactly two clubs; it is not a general multi-club
template. `team-tournament-template/` is for teams of several pairs, each
meeting another team in a matchup won on total points, with a bracket stage
and playoffs; its pages are the team views of the engine (§8).

## 2. The steps

> **The event workbook is generated, not hand-copied.** These steps
> instantiate the *site*; they assume the event's Google Sheets already exist
> (step 8 installs the sync script into them). Build them from the plan
> instead of duplicating the previous event's and find-replacing team codes:
> in the Tournament Time Calculator hit **Copy plan & open generator**, which
> opens the master for the plan's format, make your own copy, and run
> `SAGE -> Generate event tabs`.
>
> - **Dual meet** (SAGE Dual Meet Master) — every category tab, `SCHEDULE`
>   with every match placed and numbered, and all four readout tabs. See
>   `sage-docs/docs/specs/.../dual-meet-sheet-generator-spec.md`.
> - **Standard tournament** (SAGE Standard Tournament Master) — one copy per
>   facility per day. Every category tab, a `MATCHES` tab of all the
>   matches, an empty `SCHEDULE`, and the readout tabs. `SCHEDULE` is then
>   packed by hand from `MATCHES` and numbered with `SAGE -> Fill match
>   numbers`. See `sage-docs/docs/specs/.../standard-tournament-master-spec.md`.
>
> Either way the workbook is renamed `<date> <title> - <FACILITY>` when the
> generator finishes.

1. **Copy the template folder** into `events/` under this event's key:

   ```
   cp -r _templates/standard-tournament-template events/<event-key>/
   ```

   (or `_templates/dual-meet-template` or `_templates/team-tournament-template`,
   per §1 above; the team template is the third choice). `<event-key>` must
   be a good folder-name-safe slug — it will also become this event's
   `EVENT_KEY` and its folder name in the `event-data` repo (step 9 below),
   so pick it once and keep it identical in all three places.

2. **Add the event's images.** Drop the QR PNG into `events/<event-key>/`
   (usually `assets/qr.png`) and set `{{QR_IMAGE}}` to its path. Drop the
   event's own logo in alongside it (e.g. `assets/logo.png`) and set
   `{{EVENT_LOGO}}` to its path — it renders paired with the S.A.G.E. logo
   at the top of the hero, replacing the old crown mark. For
   `dual-meet-template/`, drop both clubs' logos in alongside it and set
   `{{CLUB_A_LOGO}}` / `{{CLUB_B_LOGO}}` to their paths — these render in the
   hero, the club win summary, the Live Matches table and every match card,
   so square images crop best (they are shown in a circle).

   These are the one place relative paths are correct: they sit inside the
   event's own folder, unlike the shared site assets in §6.

3. **Replace every `{{TOKEN}}`.** See §3 for the full list per template.
   When done, this must come back empty:

   ```
   grep -r '{{' events/<event-key>/
   ```

4. **There is no config to fill in.** The pages are shells (§8): the days,
   the facilities and the division, event and club labels come from
   `event-data/config/events.json` at run time (step 7), the same file
   Control Center reads. A team event's labels are its pair labels,
   `display.pairs` (step 7). The one setting a dual meet's `index.html` adds is
   `CLUB_LOGOS`, filled from tokens (§3). The schedule board's `CAT_META`
   is step 6.

5. **Leave the theme alone unless the event genuinely needs its own.** Every
   page ships the S.A.G.E. house palette — navy structure, green accent,
   off-white paper — in a `:root` block under the `THEME` banner at the top
   of its `<style>`. It is the same palette as `/assets/logo.png`,
   `tools/scoresheet-generator.html` and `tools/tournament-calculator.html`,
   so an event site, the tools and the schedule board all read as one
   product. Type is Archivo Black (display/numbers), Barlow Condensed
   (tracked uppercase labels) and Inter (body).

   To re-skin, change the brand tokens in that block and nothing else —
   every other rule resolves through them or through the role aliases
   underneath (`--court`, `--cork`, `--amber`, `--muted`, …, kept so the
   rules read by intent rather than by hue).

   > **The green is a fill colour, not a text colour.** `--green` on white
   > is ~2.3:1 and fails AA at any size; `--green-dark` is ~4.0:1 and still
   > misses the 4.5:1 body floor. Use green as a background with `--navy`
   > text on it (~5.4:1), or on a navy panel. Small text on paper is
   > `--ink` or `--ink-soft`. The banner in each file repeats this.

   One place does **not** resolve through `:root` and must be changed by hand
   if you re-skin: `schedule.html`'s `CAT_META` (see step 6).

6. **Set up the schedule board** (`schedule.html`). This is the venue wall
   display — courts as columns, time slots as rows, one card per match. It
   is **unlisted from the public pages on purpose**: nothing links to it
   except the `Open schedule` button at the foot of Mission Control in
   Control Center (`tools/control-center.html`), so operators can launch
   it and spectators never see it. GitHub Pages resolves extensionless
   HTML, so it is reachable as `/events/<event-key>/schedule`.

   Two things to fill in beyond the shared tokens:

   - **`{{SCHEDULE_DAY_KEY}}`** — the board shows exactly one day. Set this
     to that day's key in `events.json` (step 7). For a multi-day event, point
     it at whichever day is being played; there is no day picker on the board.
   - **`CAT_META`** — one entry per `<DIVISION><EVENT>` code, giving each
     category its chip label and the hue that tints its cells. For a team
     event it is one hue per bracket (`G<n>`, `G1` is Bracket 1) plus `PO`
     for every playoff match. We choose these colours ourselves, because
     the team workbook's `SCHEDULE` tab is uncoloured. Keep each hue dark
     enough that navy text stays readable on its 40% tint. A bracket with no
     entry still gets a `BR <n>` chip in grey.

   > **A standard or dual-meet event's `CAT_META` colours are the organiser's, not ours.** Read them off
   > the colour-coded SCHEDULE tab of the source spreadsheet so the wall
   > display and the organiser's own printed schedule agree. They are **not
   > exportable** — cell fills are formatting, so they appear in neither the
   > CSV nor the gviz export, and Sheets paints the grid to a single
   > `<canvas>`, so the DOM has nothing either. Sample them by eye (or from
   > a screenshot). **If the organiser recolours the sheet these must be
   > re-read by hand — nothing detects that drift.**

   The board reads the same published snapshot the event pages do — pushed
   over the live channel, with the same 10s poll as the fallback — so it needs
   no separate data wiring. Court
   count is derived from the data (the highest `CourtAssignment` seen), not
   configured — one less value to keep in sync.

   On a day with more than one facility, the board shows a **Venue** row
   built from the snapshot's facility names. `?venue=<facility name>`
   narrows it to one facility's matches and courts, and composes with
   `?courts=`, so each venue's screen can be bookmarked to its own board.
   Nothing to configure. It relies on court numbers that run on across a
   day's facilities (Main 1–4, Annex 5–9), which the workbooks' `SCHEDULE`
   tabs set.

7. **Add the event + its days to the shared config.** In the `event-data`
   repo, open `config/events.json` and add an entry to `events` for
   `<event-key>`, with one sub-entry per day under `days` (see
   `config/README.md` in that repo for the full shape). **Day keys must be
   globally unique across every event already in that file** — prefix them
   with something event-specific (e.g. `<event-key>-day1`), matching the
   schedule board's `{{SCHEDULE_DAY_KEY}}` (step 6). (If this event's spreadsheets use
   different tab **names** than that file's `defaults` block, set
   `matchesSheetName` / `standingsSheetName` on the day entry to override
   them. Most events won't need this — and there is no GID equivalent to
   set: both fetch paths address tabs by name only, deliberately, since a
   tab's GID is assigned per-workbook and doesn't carry over if a
   spreadsheet is duplicated from another event's — see
   `event-data/config/README.md` for the incident that motivated this.)

   Commit it. **No `sage-tools-api` deploy is needed** — every running
   instance re-checks `config/events.json` within `SYNC_CONFIG_TTL_MS`
   (about a minute by default; see §0). Give it a minute, or confirm with
   `GET /v3/diagnostics/sync` (`X-Sync-Secret` header) that your day keys show up
   in its `days` list, before installing the Apps Script in the next step
   — a sync attempt against a day key that isn't live yet fails with
   `UnknownSyncDayError`.

   **Also fill in this event's display block.** Beyond the day/facility
   registry the sync itself needs, the entry carries a few fields that exist
   purely so the central Control Center console can render this event without
   any per-event code of its own:

   ```jsonc
   "<event-key>": {
     "type": "dual-meet",              // or "standard", or "team" — picks the layout
     "title": "PNF × BUP Dual Meet",   // masthead
     "days": { ... },                  // as above
     "display": {                      // optional — see below
       "divisions": { "LI": "Low Intermediate", "HI": "High Intermediate" },
       "events":    { "WD": "Women's Doubles", "MD": "Men's Doubles" },
       "clubs":     { "PNF": "Pickle & Friends Community" }
     }
   }
   ```

   - **`type` is required and must be explicit** (`"dual-meet"`,
     `"standard"` or `"team"`, matching which template you copied in step 1). It decides
     both the standings layout and how team codes are split. It is deliberately
     not inferred from the data: guessing from code shape works most of the
     time and fails *silently*, and an unmatched code currently disappears into
     an "Other" bucket with no warning.
   - **`display` is optional.** Without it the console still works — it just
     shows raw codes (`LIWD`, `PNF`) instead of "Low Intermediate Women's
     Doubles" and the full club name. Fill it in when convenient; a newly
     registered event is usable immediately either way.
   - A team event adds `display.pairs`, the label of each pair in a
     matchup, keyed by the pair number in a team code (the `3` of `A_3`):

     ```jsonc
     "display": {
       "pairs": {
         "1": { "full": "Men's Doubles",   "short": "MD" },
         "2": { "full": "Women's Doubles", "short": "WD" },
         "3": { "full": "Mixed Doubles",   "short": "XD" },
         "4": { "full": "Mixed Doubles",   "short": "XD" }
       }
     }
     ```

     A type that repeats is numbered ("XD 1", "XD 2"). Without `pairs` the
     labels are MD, WD, XD 1, XD 2; a pair number the event doesn't list
     reads "Pair <n>". A facility whose roster tab isn't named `Teams` sets
     `rosterSheetName` on that facility (`event-data/config/README.md`).
   - All three maps (`divisions`, `events`, `clubs`) are the same shape: **code → label**. Only codes that
     actually appear in `teamCode1`/`teamCode2` matter.
   - **Order comes from key order.** Categories are displayed in the order the
     division and event keys appear in the JSON, so there is no separate
     ordering config to keep in step.
   - **No logos here.** `display.clubs` maps to a plain name string. The
     console shows the 3-letter code on every row, so a logo beside it would
     be repeating information (and the live board would render 18 of them at
     once). Club logos remain an `index.html` concern — see `{{CLUB_A_LOGO}}`
     in §3.

   > These are presentation labels living in the *data* repo, which is a
   > deliberate trade: it is the only place the console reads, so it is the
   > only place they can live without reintroducing per-event code. The cost
   > is that fixing a division label is a commit to `event-data` rather than
   > to this repo. The public `index.html` reads the same block (it no longer
   > keeps its own `DIVISIONS`/`EVENTS`/`CLUBS`), so for a Hub `display` is
   > not optional in practice: without it the Hub shows raw codes too.
   >
   > **An event stays in `events.json` for as long as any page built on the
   > engine shows it.** Removing a finished event's entry would blank its
   > Hub, schedule board, scorer page and desk page.

   > Control Center lives at `tools/control-center.html` (see
   > `sage-docs/docs/specs/.../match-control-console-spec.md`, written before the console's
   > rename from "Match Control" to "Control Center"). Filling these fields in is what
   > makes a newly registered event usable there immediately; leaving them
   > out (or leaving `type` unset/wrong) shows a visible error there rather
   > than guessing — see §1 above.

**Team events: the workbook.** The Team Tournament Master does not exist yet
(`sage-docs/docs/specs/.../team-tournament-master-spec.md`),
so for now a team event's workbook is made by copying PickleDrive's and
clearing it. **Only an event of PickleDrive's shape can be made this
way:** 15 teams `A`–`O` in three brackets of five, four pairs per matchup, a
group-stage round robin, eight quarterfinalists then semifinals, Bronze and
Final, 152 matches, one facility and 10 courts. The team codes are generic
(`A_3`, `QF-3_4`), so copying carries over no other event's names; that is
why the other formats are never made by copying. **Any other shape waits for
the master.**

1. **Source:** the live PickleDrive workbook, Drive file
   `1Bk3iAqB6Fdt6t-EiI8MrU0Or8UZc4MAZcnWcMUOCkOA` ("2026-10-03 PickleDrive
   Club One Year Celebration"). It carries the optimised calculation (the
   hidden `StackCache` tab;
   `sage-docs/docs/specs/.../team-workbook-stack-cache-spec.md`). **Never
   edit the source:** **File → Make a copy**, named
   `<date> <title> - <FACILITY>` like a generated workbook.
2. **Its tabs:**
   - **input:** `Title`, `Teams`, `MatchUps`, `SCHEDULE`, `Court Control`,
     `ATTENDANCE`, `Raffle`;
   - **computed:** `Standings`, `FINAL RANK`, `Awards`, `CSV`,
     `STANDINGSCSV`, `MatchLookup`, `StackCache`, `Variables`,
     `Variables V2`, `Reference for Players`, `Timeline`,
     `Timeline (Individual}`, `Pairings Guide`;
   - **`Brackets`** is a leftover from another event; ignore it.
3. **Clear the inputs. Clear values only, and never a cell holding a
   formula:** turn on **View → Show → Formulas** first, and leave any cell
   that starts with `=`.
   - **`Teams`:** type the new event's team names and players over the old
     ones.
   - **`MatchUps`:**
     - clear every lineup;
     - type each playoff seed cell back to its seed number: quarterfinal
       seeds 3, 6, 1, 8, 2, 7, 4, 5 in `D604`, `D614`, `D624`, `D634`,
       `D644`, `D654`, `D664`, `D674`; semifinal seeds 1–4 in `D684`,
       `D694`, `D704`, `D714`; Bronze 1–2 in `D724`, `D734`; Final 1–2 in
       `D744`, `D754`.
   - **`SCHEDULE`:** clear every typed score. A score must be a truly empty
     cell (**Delete**, not a space), because the formulas test for an
     empty cell.
   - **`Court Control`:** clear every match number on a court.
   - **`ATTENDANCE`:** clear rows 2 down in `A:G`. **Update roster**
     refills them.
   - **`Title`:** the new event's title and date.
   - **`Raffle`:** clear it.
   - The scorers' **slot times** are `SCHEDULE!B6:B`: retype them if the
     new event starts at another time and they are typed values.
4. **Check before wiring it up:**
   - `STANDINGSCSV` lists the 15 new team names with zero points;
   - `CSV` has 152 rows with every score empty;
   - every quarterfinal and later row reads its seed (`QF-3_1` …).
5. **Then step 8 as usual.** The copy keeps the bound `sheets-sync.gs` but
   not its trigger. Run **SAGE → Set up live sync** with the new day key
   and facility; that creates the trigger and replaces the copied day key.
   Then share it with the service account (step 13).

The team checks of steps 10–14 are in the shared dry-run template
(step 10); the other steps apply as written. When the Team Tournament
Master exists its spec replaces this subsection with "generate it from the
master", and the site needs no change.

8. **Install the sync script.** Once per facility spreadsheet for this
   event (this is the Apps Script side of things — `apps-script/sheets-sync.gs`
   lives in `sage-tools-api`, not in this repo — though a dual meet's
   generated workbook carries it already, so this reduces to reload + set up
   for those):

   1. Open the spreadsheet → Extensions → Apps Script.
   2. Delete the default empty `Code.gs` content and paste in the whole
      contents of `sage-tools-api/apps-script/sheets-sync.gs`. The file is
      identical for every workbook of every event — nothing in it is
      spreadsheet-specific.
   3. Reload the spreadsheet and run **SAGE → Set up live sync**.
   4. Enter the day key (the same key as in `config/events.json`, step 7)
      and the facility name (must match a facility `name` of that day in
      `config/events.json` **exactly**, case-sensitive), and confirm the tabs to watch (SCHEDULE and Court
      Control are pre-ticked when present). Setup validates the secret, the
      day key and the facility name against Cloud Run — including a real
      test sync — before saving anything, and reports what it found.

      The dialog asks for the **shared secret** only in a workbook that
      doesn't already have one — that is, one you pasted `sheets-sync.gs`
      into by hand. A workbook copied from the Dual Meet Master carries the
      secret with it and shows *Secret stored* instead. If you do have to
      enter it, it's the same value as `SYNC_SHARED_SECRET` in Cloud Run's
      env vars.
   5. Repeat for every other facility spreadsheet this event uses (a
      different day key/facility name each time). Full detail, including
      why this needs an *installable* `onEdit` trigger rather than a bare
      `onEdit(e)`, is in the script's own header comment.

   You can sanity-check an install without waiting for a real edit: **SAGE →
   Sync now** fires a sync immediately and reports the result in a dialog.

   Once configured, the **SAGE** menu also carries **Generate
   Scoresheets**, which deep-links into `tools/scoresheet-generator.html`
   with this workbook's day and facility preselected (it needs no
   authorization of its own — it opens a link and calls nothing), and
   **Pause live sync** / **Resume live sync**, which stops and restarts
   automatic publishing without touching the saved config — for editing a
   watched tab (a late roster or schedule fix) after sync is already wired
   up. Do the setup step *last*, after rosters and schedule fixes, and you
   generally won't need it: the trigger doesn't exist until setup runs.

   **SAGE → Fill match numbers** is also present whether configured or not.
   It numbers the matches on SCHEDULE starting after a number you give it.
   For a multi-facility day, give each facility's workbook its own range
   (e.g. 1000 and 2000), because all of a day's facilities merge into one
   snapshot and match numbers must not repeat within it. It writes the same
   numbers into the `CSV` tab's `matchNumber` column. The site only shows
   matches listed there. It leaves that column alone if it holds formulas,
   and warns if the column still doesn't list every new number.

   **SAGE → Help** is present in every workbook whether configured or not,
   and carries this whole procedure plus a troubleshooting list — point an
   operator at it rather than at this file. It also lists the version of each
   SAGE script in the workbook.

9. **Create the data folder.** In the `event-data` repo, create
   `<event-key>/data/` (an empty folder — or just let the first successful
   sync create it). Nothing else in that repo needs touching per-event —
   see §0 above if it needs setting up for the first time.

10. **Copy the dry-run/day-of runbook.** Copy
    `_templates/dry-run-checklist-template.md` to
    `events/<event-key>/dry-run-checklist.md` and replace `{{EVENT_TITLE}}`
    (the same token you already filled in step 3). It's two things in one
    file: a rehearsal against this event's real sheet using a few
    temporarily-faked rows (do this once, before the event), and the actual
    day-of steps for running it for real — screens, signing in, deciding on
    go-live timing, what to watch during play. Genuinely optional (nothing
    breaks without it) but cheap, and worth having before the first event
    you run through the console rather than improvising it live.

11. **Add the attendance desk page, if the event uses desk links.** For an
    event with `"attendance": "desks"` in `config/events.json`, copy
    `_templates/attendance/attendance.html` to
    `events/<event-key>/attendance.html` and replace its two tokens,
    `{{EVENT_KEY}}` and `{{EVENT_TITLE}}`. For `"console"`, or no attendance,
    skip it. The page is linked from nowhere public; Control Center's
    **Issue desk link** produces the link to it. See
    `sage-docs/docs/specs/.../multi-event-attendance-spec.md`.

12. **Add the scorer page, if the event uses scorer links.** For
    `"scoreEntry": "links"`, copy `_templates/scorer/scorer.html` to
    `events/<event-key>/scorer.html` and replace `{{EVENT_KEY}}` and
    `{{EVENT_TITLE}}`. Linked from nowhere public; Mission Control's
    **Issue scorer link** produces the link. For `"console"`, or no
    `scoreEntry`, skip it. See
    `sage-docs/docs/specs/.../control-center-score-entry-spec.md`.

13. **Share every facility workbook with the API's service account** as
    **Editor**, for an event with any `attendance` or `scoreEntry` setting:
    `sage-tools-api-runtime@sage-tools-api.iam.gserviceaccount.com`. Without it
    the roster update, every mark and every score save fail with a message naming the account.
    A workbook copied into a Drive folder already shared with the account is
    expected to inherit the share, but that is not confirmed yet: check the
    workbook's Share dialog lists the account.

14. **Make the hub board's QR panel.** The venue's Tournament Hub board is a
    24 × 36 in sintra print, `_templates/hub-pubmat/`, that's the same for
    every event except its QR panel. Once step 3 is done, run

    ```
    node _templates/hub-pubmat/render.mjs <event-key>
    ```

    It reads the panel's event name, date/venue line, QR image and short
    link from `events/<event-key>/index.html` (`<title>`, `.eyebrow`,
    `{{QR_IMAGE}}`, `{{QR_URL}}`), so there's nothing to fill in; fix a wrong
    line on the page and re-run. It writes `qr-panel.pdf` (an 8 × 8.75 in
    sticker for the board's slot) and `board.pdf` (the whole board, for a
    reprint) to `_templates/hub-pubmat/out/<event-key>/`, which is
    git-ignored. Scan the printed panel before mounting it. See that
    folder's `README.md`.

## 3. Required `{{TOKEN}}` replacements

**All three templates** (`index.html`; the team template uses the standard
set, and its `schedule.html` the board's set):

| Token | Meaning |
| --- | --- |
| `{{EVENT_KEY}}` | Folder-name-safe slug. Must equal the `events/` folder name and the `event-data` folder name. |
| `{{EVENT_TITLE}}` | Event name — `<title>`, hero `<h1>`, footer. In `schedule.html`: `<title>`, meta description and `og:title`. |
| `{{EVENT_TAGLINE}}` | Hero subtitle line. |
| `{{EVENT_HEADLINE}}` | Hero's big secondary line. Optional — blank is fine. |
| `{{EVENT_DATE_RANGE}}` | Hero eyebrow, footer, meta description. |
| `{{VENUE}}` | Hero eyebrow, footer. |
| `{{QR_IMAGE}}` | Path to the QR PNG dropped in alongside `index.html` (§2 step 2). |
| `{{QR_URL}}` | The short link printed under the QR code. Write it with a `<wbr>` after the `/` (`tinyurl.com/<wbr>SAGExEvent`), so on desktop it wraps there instead of mid-word. |
| `{{EVENT_LOGO}}` | Path to the event's own logo dropped in alongside `index.html` (§2 step 2). Shown paired with `/assets/logo.png` at the top of the hero. |
| `{{SCHEDULE_DAY_KEY}}` | `schedule.html` only — which day's key the wall display shows (§2 step 6). |

`dual-meet-template/` only (`index.html`):

| Token | Meaning |
| --- | --- |
| `{{CLUB_A_CODE}}` / `{{CLUB_B_CODE}}` | Short club codes used in team codes (e.g. `PPA`) and as the `CLUB_LOGOS` keys. Also drive `schedule.html`'s `CLUB_ORDER`, which decides which club tag gets which fill. |
| `{{CLUB_A_NAME}}` / `{{CLUB_B_NAME}}` | Full club names — hero eyebrow and alt text. The names the page shows come from `display.clubs` in `events.json` (step 7). |
| `{{CLUB_A_LOGO}}` / `{{CLUB_B_LOGO}}` | Paths to each club's logo image (§2 step 2), passed to the engine as `CLUB_LOGOS`. Shown in the hero, the club win summary, the Live Matches table and every match card. |

A dual meet always has exactly two clubs, so `CLUB_LOGOS` and `CLUB_ORDER`
are filled from the club tokens above, not left as examples.

> **Watch `&` in names.** Tokens land in raw HTML (the hero eyebrow, an
> `alt=`, the footer). A name like `Pickle & Friends Community` needs
> `&amp;` there. The `events.json` names are plain text, so they take a
> plain `&`. Same applies to `{{EVENT_TITLE}}` and `{{VENUE}}`. If you see
> `&amp;` on the rendered page, this is why.

## 4. Required spreadsheet columns

Check this first if a new event's page loads but renders empty — it's the
most common cause. Exact, case-sensitive:

- **Matches tab**: `matchNumber`, `teamCode1`, `team1Player1`, `team1Player2`,
  `teamCode2`, `team2Player1`, `team2Player2`, `Schedule`, `team1Score`,
  `team2Score`, `CourtAssignment`, `court`.
  `court` is the *live* court (distinct from the scheduled `CourtAssignment`)
  and is what drives the Live Matches board. Without it, every court on the
  Live tab sits on "No match playing" forever, and the schedule board never
  highlights anything as in progress.

  `CourtAssignment` is what the schedule board lays matches out by. It holds
  `"Court 1"`…`"Court N"`; the board parses the trailing integer, and the
  highest one seen sets how many columns it draws. A blank, unparseable or
  duplicated value doesn't drop the match — it falls to the first free lane,
  and if the slot is genuinely full the time cell gets a `+n` badge listing
  the match numbers that wouldn't fit.
- **Standings tab**: `teamCode`, `player1`, `player2`, `wins`, `loss`,
  `quotient`, `bracket`.

## 5. Team code format

- `standard-tournament-template/`: `<DIVISION><EVENT>_<REST>`
  (e.g. `B18MD_1`, `HI40XD_SF_2`, `B35XD_F_1_(2)`).
- `dual-meet-template/`: `<CLUB>_<DIVISION><EVENT>_<REST>`
  (e.g. `{{CLUB_A_CODE}}_B18MD_1` in the raw template — with a real code
  filled in, something like `PPA_B18MD_1`).
- `team-tournament-template/`: `<SIDE>_<PAIR>` (`A_3`, `QF-3_4`,
  `SF-A_2`, `Fi-J_1`). `PAIR` is the pair number in the matchup (the key
  of `display.pairs`). `SIDE` is a team letter (`A`) in the bracket stage,
  or `<STAGE>-<SLOT>` in a playoff, where `STAGE` is `QF`, `SF`, `Br` or
  `Fi` and `SLOT` is a seed number (`3`) until the organiser types a team
  letter over it (`A`). The board reads a team match's stage from the
  side's prefix; the bracket comes from the team's `bracket` column in
  `STANDINGSCSV`.

`_(N)` suffixes mark a twice-to-beat playoff instance (see the
`matchInstanceOf`/`pairUpMatchups` comments in `index.html` if you need the
details) — you generally don't need to think about this when just filling
in a spreadsheet.

`schedule.html` classifies the tail of a team code into its stage pill
(`RR` / `R16` / `QF` / `SF` / `BRONZE` / `FINAL`) using the same regexes as
`roundKeyword()` in `index.html`, so a code is read the same way everywhere.
Because the two templates' codes differ by one leading segment, each copy's
`stageOf()` is anchored differently — don't copy that function between them.
An unrecognised tail falls back to `RR`, matching `standingsStageKey()`.

## 5.1 Things that must be kept in sync by hand

Within one event's folder, across `index.html` and `schedule.html`:

| Value | Where |
| --- | --- |
| `EVENT_KEY` | every shell — and the `events/` folder name, the `event-data` folder name, and the event's key in `config/events.json` |
| day key | `config/events.json`, plus `schedule.html`'s `DAY_KEY`, plus each spreadsheet's day key, set through its **SAGE → Set up live sync** |
| facility name | `config/events.json`, and each spreadsheet's venue name, set through its **SAGE → Set up live sync** — compared exactly, case-sensitive |
| club codes | `index.html`'s `CLUB_LOGOS`, and `schedule.html`'s `CLUB_ORDER` (dual meet only) |
| theme `:root` | `index.html` and `schedule.html` — plus the two non-CSS palettes noted in §2 step 5 |
| `LIVE_BASE_URL` | each shell, as a literal: `''` turns push off for that page (§7) |

Nothing new is kept in sync by hand for a team event: pair labels live only
in `events.json` (`display.pairs`), and the colour key only in the board.

The `ATTENDANCE CLIENT`, `SCORE CLIENT` and `LIVE CHANNEL` blocks this table
used to list are modules of the engine now (§8), so there is nothing to
keep byte-identical. The three finished events' `attendance.html` files
(Pickle for Sight, Piggleball, PickleDrive) keep their own copy of the
attendance block; they are frozen.

`LIVE_BASE_URL` (the live Worker's `wss://` address) is platform-wide rather
than per-event, so each shell carries it as a literal, **not** a `{{TOKEN}}`.
The `event-data` Pages address (`GHPAGES_OWNER`/`GHPAGES_REPO`) is in
`lib/v1/platform.js`. A new event inherits both from its template and needs
nothing set.

The Hub's auto-live threshold (`computeDayIsLive` in
`lib/v1/domain/golive.js`) is derived from the day's own data: it goes live `GO_LIVE_LEAD_HOURS` (4) before the
earliest scheduled match time on the synced Schedule column, computed
fresh from whatever's published — no hour to set or keep in sync per
event. A day's `isLive` override (`true`/`false`), set from the Match
Control console, wins over `auto` either way — see
`sage-docs/docs/specs/.../match-control-console-spec.md` §4.1.

## 6. Root-absolute asset paths — do not "fix" them to relative

Both templates load icons and images with root-absolute paths
(`/assets/favicons/...`, `/assets/logo.png` — one shared `assets/` folder
at the repo root, used by every page on the site), not relative ones
(`../favicons/...`). This is deliberate, not an oversight. A relative path
resolves differently depending on how deep the page's own folder is nested,
so archiving a page — a pure rename into `events/archives/` — silently
breaks every icon on it. Root-absolute paths work regardless of nesting,
because `sage-match-control.github.io` is a user/org Pages site served at
the domain root. Leave them root-absolute; do not "simplify" them to
relative paths, or archiving this event later (§7) will break its icons.

(If this site is ever moved to a project-pages repo served under a
`/<repo>/` prefix, every template's root-absolute paths would need an
added prefix. Not a concern today.)

## 7. After the event: live push off, then archiving

Once the event's last day is over, turn live push off for its pages: set
`LIVE_BASE_URL = ''` in the settings script of its `index.html`,
`schedule.html` and `scorer.html` (if it has one). Nothing is published
for the event any more, so a socket would only hold a Worker connection open
(and ping it every 50 s) for every visitor, against the Worker's daily
request cap. With the constant empty the page never connects and reads its
snapshot from GitHub instead, so the final results still show. Leave the
shell's `import` lines alone, and leave the event in `config/events.json`
(§2 step 7): the shells read it.

The folder stays where it is, at the URL the venue's QR code points to.
Archiving is a separate, later step. When you do it, move the folder into
`events/archives/`:

```
mv events/<event-key> events/archives/<event-key>
```

Because its asset paths are root-absolute (§6), nothing needs
re-prefixing — this is the exact step the earliest, pre-template event
pages got wrong, and why their icons are currently broken in
`events/archives/`. The same goes for the shells' `/lib/v1/...` imports and
stylesheet links: root-absolute, so the move needs no edit.

## 8. The engine, and its versioning rule

The event pages are **shells**: their markup (the hero, the tabs, the empty
view containers), a `THEME` block of colours and one small `<script
type="module">` of settings that calls the engine. Everything else is the
engine, at `lib/v1/` in the root of this repo, which this folder's pages and
Control Center share:

- `lib/v1/apps/` — one module per kind of page: `hub.js` (`mountHub`),
  `schedule-board.js`, `scorer.js`, `attendance-desk.js`. Each documents its
  settings in its header and rejects an unknown or missing one with a
  console error that names it.
- `lib/v1/views/`, `lib/v1/css/` — the Match Finder, tickets, Live Matches,
  Standings, team views, score dialog and attendance list, and their CSS.
- `lib/v1/domain/` — the rules (played, BYE, series, standings, go-live,
  team events), plain functions with no DOM. `lib/v1/data/` — events.json,
  snapshots, the live channel, the API. `lib/v1/platform.js` — the constants.
- Dependencies point one way (`platform` ← `domain` ← `data` ← `views` ←
  `apps`); `_tests/unit/guards.test.mjs` enforces it. The theme contract
  (`_tests/unit/theme-contract.test.mjs`) lists the custom properties a
  shell's `:root` must define.

**The versioning rule.** Pages import `/lib/v1/...`. Only the newest version
folder is ever edited, and an edit to it must be compatible: it may add a
module, an export, an option or a CSS class, or fix a bug, but it never
removes or renames an export, a CSS class a page's markup or CSS uses, or a
theme property, and never changes an export's parameters or return shape in a
way an existing caller would notice. Within a version, one module may only
start using another module's export after that export was published in an
**earlier** push (browsers keep a file up to 10 minutes). An incompatible
change is `lib/v2/`: copy `v1`, change it there, move Control Center, the
templates and every unfinished event's pages to it, and freeze `v1`. A
finished event's shell never moves version. The comparison harness
(`_tests/`, `npm run verify`) has to pass before a push to `main`.
