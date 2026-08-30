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
that file (step 6 below) is how you add an event or fix a wrong sheet ID;
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
   `EVENT_KEY` and its folder name in the `event-data` repo (step 8 below),
   so pick it once and keep it identical in all three places.

2. **Add the QR code image.** Drop the event's QR PNG into
   `events/<event-key>/`, then set `{{QR_IMAGE}}` (below) to its filename.

3. **Replace every `{{TOKEN}}`.** See §3 for the full list per template.
   When done, this must come back empty:

   ```
   grep -r '{{' events/<event-key>/
   ```

4. **Fill in the `// EXAMPLE — replace` config values** in `index.html`'s
   and `match-control.html`'s `CONFIGURATION` block: `DAYS`, `FACILITIES`,
   `DIVISIONS`, `EVENTS` — and, for `dual-meet-template/`, `CLUBS` (which
   is filled from tokens directly, not left as an example — see §3).
   `bracket-generator.html` needs no config at all.

5. **Set the `:root` theme block** in each file's `<style>` (under the
   `THEME` banner) if this event wants its own color palette instead of
   the shipped default.

6. **Add the event + its days to the shared config.** In the `event-data`
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

7. **Install the sync script.** Once per facility spreadsheet for this
   event (this is the Apps Script side of things — `scripts/sheets-sync.gs`
   lives in `sage-tools-api`, not in this repo):

   1. Open the spreadsheet → Extensions → Apps Script.
   2. Delete the default empty `Code.gs` content and paste in the whole
      contents of `sage-tools-api/scripts/sheets-sync.gs`.
   3. Edit its `CONFIG` block: set `DAY_KEY` to match whatever day key
      this spreadsheet is for (the same key you used in `DAYS` in step 4
      and in `config/events.json` in step 6), set `FACILITY_NAME` to
      match a `name` in this event's `FACILITIES` array **exactly**
      (case-sensitive), and set `CLOUD_RUN_BASE_URL` to the same URL you
      used for `{{CLOUD_RUN_BASE_URL}}` in step 3 (no trailing slash).
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

8. **Create the data folder.** In the `event-data` repo, create
   `<event-key>/data/` (an empty folder — or just let the first successful
   sync create it). Nothing else in that repo needs touching per-event —
   see §0 above if it needs setting up for the first time.

## 3. Required `{{TOKEN}}` replacements

**Both templates** (`index.html`, `match-control.html`, and — for a few of
these — `bracket-generator.html`):

| Token | Meaning |
| --- | --- |
| `{{EVENT_KEY}}` | Folder-name-safe slug. Must equal the `events/` folder name and the `event-data` folder name. |
| `{{EVENT_TITLE}}` | Event name — `<title>`, hero `<h1>`, footer, bracket generator. |
| `{{EVENT_TAGLINE}}` | Hero subtitle line. |
| `{{EVENT_HEADLINE}}` | Hero's big secondary line. Optional — blank is fine. |
| `{{EVENT_DATE_RANGE}}` | Hero eyebrow, footer, meta description. |
| `{{VENUE}}` | Hero eyebrow, footer. |
| `{{QR_IMAGE}}` | Filename of the QR PNG dropped in alongside `index.html` (§2 step 2). |
| `{{QR_URL}}` | The short link printed under the QR code. |

`match-control.html` only:

| Token | Meaning |
| --- | --- |
| `{{CLOUD_RUN_BASE_URL}}` | The Cloud Run service's base URL (must match `CLOUD_RUN_BASE_URL` in the installed Apps Script). |

`dual-meet-template/` only (`index.html` and `match-control.html`):

| Token | Meaning |
| --- | --- |
| `{{CLUB_A_CODE}}` / `{{CLUB_B_CODE}}` | Short club codes used in team codes (e.g. `PPA`) and as the `CLUBS` object's keys. |
| `{{CLUB_A_NAME}}` / `{{CLUB_B_NAME}}` | Full club names — hero eyebrow, `CLUBS` config. |

Unlike `DAYS`/`FACILITIES`/`DIVISIONS`/`EVENTS`, the `CLUBS` config in
`dual-meet-template/` is **not** an example to replace — it's built
directly from the four club tokens above, since a dual meet always has
exactly two clubs.

## 4. Required spreadsheet columns

Check this first if a new event's page loads but renders empty — it's the
most common cause. Exact, case-sensitive:

- **Matches tab**: `matchNumber`, `teamCode1`, `team1Player1`, `team1Player2`,
  `teamCode2`, `team2Player1`, `team2Player2`, `Schedule`, `team1Score`,
  `team2Score`, `CourtAssignment`, `court`.
  `court` is the *live* court (distinct from the scheduled `CourtAssignment`)
  and is what drives the Live Matches board. Without it, the Live tab will
  render "No matches are currently on court." forever.
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
