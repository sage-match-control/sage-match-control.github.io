# Event site templates — instantiation runbook

This directory holds two reusable event-site templates. Instantiating one
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

- **`GITHUB_REPO` must be `event-data`.** Every template's `snapshotUrlFor`
  now points at `sage-match-control.github.io/event-data/<event-key>/data/`
  (see the `GHPAGES_OWNER`/`GHPAGES_REPO` constants in each template's
  `CONFIGURATION` block, which mirror this), so Cloud Run has to publish
  there too. This is fixed platform config now, not something you pick per
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
- Everything else (an open-entry bracket tournament) → `standard-tournament-template/`.

Day count and category count do **not** affect this choice — both
templates handle any number of tournament days and any number of
divisions/events. `dual-meet-template/` additionally handles exactly two
clubs; it is not a general multi-club template.

## 2. The steps

1. **Copy the template folder** into `events/` under this event's key:

   ```
   cp -r _templates/standard-tournament-template events/<event-key>/
   ```

   (or `_templates/dual-meet-template`, per §1 above). `<event-key>` must
   be a good folder-name-safe slug — it will also become this event's
   `EVENT_KEY` and its folder name in the `event-data` repo (step 9 below),
   so pick it once and keep it identical in all three places.

2. **Add the event's images.** Drop the QR PNG into `events/<event-key>/`
   (usually `assets/qr.png`) and set `{{QR_IMAGE}}` to its path. For
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

4. **Fill in the `// EXAMPLE — replace` config values** in `index.html`'s
   `CONFIGURATION` block: `DAYS`, `FACILITIES`, `DIVISIONS`, `EVENTS` — and,
   for `dual-meet-template/`, `CLUBS` (which is filled from tokens directly,
   not left as an example — see §3). `bracket-generator.html` needs no
   config at all. Control Center (`tools/control-center.html`) takes
   its config from `event-data/config/events.json` — see step 7.

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

   Two places do **not** resolve through `:root` and must be changed by hand
   if you re-skin: `bracket-generator.html`'s `BADGE_FILL`/`BADGE_TEXT` and
   the colours in its canvas export (see §8), and `schedule.html`'s
   `CAT_META` (see step 6).

6. **Set up the schedule board** (`schedule.html`). This is the venue wall
   display — courts as columns, time slots as rows, one card per match. It
   is **unlisted from the public pages on purpose**: nothing links to it
   except the `Open schedule` button at the foot of Mission Control in
   Control Center (`tools/control-center.html`), so operators can launch
   it and spectators never see it. GitHub Pages resolves extensionless
   HTML, so it is reachable as `/events/<event-key>/schedule`.

   Two things to fill in beyond the shared tokens:

   - **`{{SCHEDULE_DAY_KEY}}`** — the board shows exactly one day. Set this
     to that day's key from `DAYS` (step 4). For a multi-day event, point it
     at whichever day is being played; there is no day picker on the board.
   - **`CAT_META`** — one entry per `<DIVISION><EVENT>` code, giving each
     category its chip label and the hue that tints its cells.

   > **`CAT_META`'s colours are the organiser's, not ours.** Read them off
   > the colour-coded SCHEDULE tab of the source spreadsheet so the wall
   > display and the organiser's own printed schedule agree. They are **not
   > exportable** — cell fills are formatting, so they appear in neither the
   > CSV nor the gviz export, and Sheets paints the grid to a single
   > `<canvas>`, so the DOM has nothing either. Sample them by eye (or from
   > a screenshot). **If the organiser recolours the sheet these must be
   > re-read by hand — nothing detects that drift.**

   The board reads the same published snapshot the event pages do and polls
   it on the same 10s interval, so it needs no separate data wiring. Court
   count is derived from the data (the highest `CourtAssignment` seen), not
   configured — one less value to keep in sync.

7. **Add the event + its days to the shared config.** In the `event-data`
   repo, open `config/events.json` and add an entry to `events` for
   `<event-key>`, with one sub-entry per day under `days` (see
   `config/README.md` in that repo for the full shape). **Day keys must be
   globally unique across every event already in that file** — prefix them
   with something event-specific (e.g. `<event-key>-day1`), matching
   whatever you used in `DAYS` in step 4. (If this event's spreadsheets use
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
   `GET /sync/config` (`X-Sync-Secret` header) that your day keys show up
   in its `days` list, before installing the Apps Script in the next step
   — a sync attempt against a day key that isn't live yet fails with
   `UnknownSyncDayError`.

   **Also fill in this event's display block.** Beyond the day/facility
   registry the sync itself needs, the entry carries a few fields that exist
   purely so the central Control Center console can render this event without
   any per-event code of its own:

   ```jsonc
   "<event-key>": {
     "type": "dual-meet",              // or "standard" — picks the layout
     "title": "PNF × BUP Dual Meet",   // masthead
     "days": { ... },                  // as above
     "display": {                      // optional — see below
       "divisions": { "LI": "Low Intermediate", "HI": "High Intermediate" },
       "events":    { "WD": "Women's Doubles", "MD": "Men's Doubles" },
       "clubs":     { "PNF": "Pickle & Friends Community" }
     }
   }
   ```

   - **`type` is required and must be explicit** (`"dual-meet"` or
     `"standard"`, matching which template you copied in step 1). It decides
     both the standings layout and how team codes are split. It is deliberately
     not inferred from the data: guessing from code shape works most of the
     time and fails *silently*, and an unmatched code currently disappears into
     an "Other" bucket with no warning.
   - **`display` is optional.** Without it the console still works — it just
     shows raw codes (`LIWD`, `PNF`) instead of "Low Intermediate Women's
     Doubles" and the full club name. Fill it in when convenient; a newly
     registered event is usable immediately either way.
   - All three maps are the same shape: **code → label**. Only codes that
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
   > to this repo. The public `index.html` is unaffected — it keeps its own
   > `DIVISIONS`/`EVENTS`/`CLUBS` block from step 4.

   > Control Center lives at `tools/control-center.html` (see
   > `specs/match-control-console-spec.md`, written before the console's
   > rename from "Match Control" to "Control Center"). Filling these fields in is what
   > makes a newly registered event usable there immediately; leaving them
   > out (or leaving `type` unset/wrong) shows a visible error there rather
   > than guessing — see §1 above.

8. **Install the sync script.** Once per facility spreadsheet for this
   event (this is the Apps Script side of things — `scripts/sheets-sync.gs`
   lives in `sage-tools-api`, not in this repo):

   1. Open the spreadsheet → Extensions → Apps Script.
   2. Delete the default empty `Code.gs` content and paste in the whole
      contents of `sage-tools-api/scripts/sheets-sync.gs`.
   3. Edit its `CONFIG` block: set `DAY_KEY` to match whatever day key
      this spreadsheet is for (the same key you used in `DAYS` in step 4
      and in `config/events.json` in step 7), set `FACILITY_NAME` to
      match a `name` in this event's `FACILITIES` array **exactly**
      (case-sensitive), and set `CLOUD_RUN_BASE_URL` to `sage-tools-api`'s
      Cloud Run URL (no trailing slash) — the same fixed platform value
      `tools/control-center.html` hardcodes in its own `CLOUD_RUN_BASE_URL`
      constant.
   4. Check `WATCHED_SHEET_GIDS`. The SCHEDULE/COURT CONTROL tab GIDs are
      per-spreadsheet (a new spreadsheet's tabs get their own GIDs), so
      confirm the shipped defaults actually match *this* spreadsheet's
      tabs instead of assuming they carry over — find a tab's GID in its
      URL (`.../edit#gid=<number>`).
   5. Run the `setup` function once (select it from the function dropdown
      at the top, click Run). It will:
      - prompt you to authorize the script (needed for `UrlFetchApp` +
        trigger management) — approve it;
      - ask you to paste the shared secret — this is the same value as
        `SYNC_SHARED_SECRET` in Cloud Run's env vars, stored here in this
        script's own Script Properties, never in the source code;
      - install the installable `onEdit` trigger the script relies on.
   6. Repeat steps 1–5 for every other facility spreadsheet this event
      uses (a different `DAY_KEY`/`FACILITY_NAME` each time). Full detail,
      including why this needs an *installable* trigger rather than a
      bare `onEdit(e)`, is in the script's own header comment.

   You can sanity-check an install without waiting for a real edit: run
   `testSyncNow` from the function dropdown to fire a sync immediately.

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

## 3. Required `{{TOKEN}}` replacements

**Both templates** (`index.html`, and — for a few of these —
`bracket-generator.html`):

| Token | Meaning |
| --- | --- |
| `{{EVENT_KEY}}` | Folder-name-safe slug. Must equal the `events/` folder name and the `event-data` folder name. |
| `{{EVENT_TITLE}}` | Event name — `<title>`, hero `<h1>`, footer, bracket generator. |
| `{{EVENT_TAGLINE}}` | Hero subtitle line. |
| `{{EVENT_HEADLINE}}` | Hero's big secondary line. Optional — blank is fine. |
| `{{EVENT_DATE_RANGE}}` | Hero eyebrow, footer, meta description. |
| `{{VENUE}}` | Hero eyebrow, footer. |
| `{{QR_IMAGE}}` | Path to the QR PNG dropped in alongside `index.html` (§2 step 2). |
| `{{QR_URL}}` | The short link printed under the QR code. |
| `{{SCHEDULE_DAY_KEY}}` | `schedule.html` only — which day's key the wall display shows (§2 step 6). |

`dual-meet-template/` only (`index.html`):

| Token | Meaning |
| --- | --- |
| `{{CLUB_A_CODE}}` / `{{CLUB_B_CODE}}` | Short club codes used in team codes (e.g. `PPA`) and as the `CLUBS` object's keys. Also drive `schedule.html`'s `CLUB_ORDER`, which decides which club tag gets which fill. |
| `{{CLUB_A_NAME}}` / `{{CLUB_B_NAME}}` | Full club names — hero eyebrow, `CLUBS` config. |
| `{{CLUB_A_LOGO}}` / `{{CLUB_B_LOGO}}` | Paths to each club's logo image (§2 step 2). Shown in the hero, the club win summary, the Live Matches table and every match card. |

Unlike `DAYS`/`FACILITIES`/`DIVISIONS`/`EVENTS`, the `CLUBS` config in
`dual-meet-template/` is **not** an example to replace — it's built
directly from the club tokens above, since a dual meet always has exactly
two clubs.

> **Watch `&` in names.** Most tokens land in two kinds of place: raw HTML
> (the hero eyebrow, an `alt=`, the footer) and a JavaScript string literal
> (the `CLUBS` config). A name like `Pickle & Friends Community` needs
> `&amp;` in the HTML occurrences but a plain `&` in the JS one — the page
> escapes that value again on its way into the DOM, so an entity there
> renders as the literal `&amp;`. Same applies to `{{EVENT_TITLE}}` and
> `{{VENUE}}`. If you see `&amp;` on the rendered page, this is why.

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
| `EVENT_KEY` | both — and the `events/` folder name, and the `event-data` folder name |
| `DAYS[].key` | `index.html`, plus `schedule.html`'s `DAY_KEY`, plus `config/events.json`, plus each spreadsheet's `DAY_KEY` in `sheets-sync.gs` |
| `FACILITIES[].name` | `index.html`, and each spreadsheet's `FACILITY_NAME` in `sheets-sync.gs` — compared exactly, case-sensitive |
| `CLUBS` | `index.html`, and `schedule.html`'s `CLUB_ORDER` (dual meet only) |
| theme `:root` | both — plus the two non-CSS palettes noted in §2 step 5 |

`index.html`'s `computeDayIsLive()` derives the auto-live threshold from
the day's own data: it goes live `GO_LIVE_LEAD_HOURS` (4) before the
earliest scheduled match time on the synced Schedule column, computed
fresh from whatever's published — no hour to set or keep in sync per
event. A day's `isLive` override (`true`/`false`), set from the Match
Control console, wins over `auto` either way — see
`specs/match-control-console-spec.md` §4.1.

## 6. Root-absolute asset paths — do not "fix" them to relative

Both templates load icons and images with root-absolute paths
(`/assets/favicons/...`, `/assets/logo.png` — one shared `assets/` folder
at the repo root, used by every page on the site), not relative ones
(`../favicons/...`). This is deliberate, not an oversight: several of the
earliest event pages in `events/archives/` were originally written with
relative paths, then moved there as pure renames — which broke their
icons, because a relative path resolves differently depending on how deep
the page's own folder is nested. Root-absolute paths work regardless of
nesting, because `sage-match-control.github.io` is a user/org Pages site
served at the domain root. Leave them root-absolute; do not "simplify"
them to relative paths, or archiving this event later (§7) will silently
break its icons the same way it broke those earlier pages'.

(If this site is ever moved to a project-pages repo served under a
`/<repo>/` prefix, every template's root-absolute paths would need an
added prefix. Not a concern today.)

## 7. Archiving, later

When the event is over, move its folder into `events/archives/`:

```
mv events/<event-key> events/archives/<event-key>
```

Because its asset paths are root-absolute (§6), nothing needs
re-prefixing — this is the exact step the earliest, pre-template event
pages got wrong, and why their icons are currently broken in
`events/archives/`.

## 8. `bracket-generator.html`

Byte-identical in both templates by design — a change to one must be
mirrored to the other (each copy has a comment at the top saying so). It's
fully self-contained: no config block, no sheet access, pairs are pasted
in by hand. Copy it as-is; the only tokens in it are `{{EVENT_TITLE}}`
(§3), which get replaced along with everything else in step 3.

It exports a PNG by hand-drawing to a `<canvas>`, which means **its palette
lives in JS literals, not in `:root`** — `BADGE_FILL` / `BADGE_TEXT` plus
the background, glow, header and footer fills inside `exportAsImage`. Those
are kept in step with the `.badge-0..3` CSS rules above them; if you re-skin
the theme (§2 step 5), change both or the exported image will not match the
page it came from.

The four bracket fills are each paired with a text colour that clears
4.5:1 against it. Two of them (`--green-dark` under white at 4.3:1, and the
stock purple at 3.3:1) don't clear it at their natural values, so they ship
darkened — don't "restore" them to the palette tokens without re-checking
the contrast.
