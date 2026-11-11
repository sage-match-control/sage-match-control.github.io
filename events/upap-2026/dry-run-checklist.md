# UPAP 3rd Annual Tournament — Control Center Runbook

Two parts: **Part 1** is a one-time rehearsal against this event's real
sheet, using a few temporarily-faked rows instead of a separate scratch day —
do this well before the event, while it doesn't matter if something's
briefly wrong. **Part 2** is what to actually do on the day itself. Both use
the same screen setup, so it only needs explaining once.

---

## Part 1 — Rehearsal (before the event)

### 1.0 Pick your test rows

Pick 3 real, already-scheduled matches from the day's matches sheet and
write down their match numbers and team codes here, so the rest of this
section can reference them without guessing at what's actually in the sheet:

- Match A (will simulate a **completed** match): # _____ — `____________` vs `____________`
- Match B (will simulate a **live, in-progress** match): # _____ — `____________` vs `____________`
- Match C (will simulate an **unmapped category code**): # _____ — `____________`

### 1.1 Sheet edits

- [ ] Match A — set `team1Score` and `team2Score` to any two different numbers (e.g. 11 and 7)
- [ ] Match B — using the **Court Control** tab (not the matches tab directly), enter Match B's number against any court this facility actually uses, the same way you'd mark a match live for real
- [ ] Match C — change one of its team codes so its division/event prefix no longer matches anything in this event's `display.divisions`/`display.events` config (e.g. tack on an extra letter) — this is what should trigger the console's unmapped-category warning instead of a silent "Other"
- [ ] **Lineup and playoff slots (team events).** Enter one matchup's
  lineup on `MatchUps`. Within about 30 seconds the site shows those
  players' names in place of *Lineup not set*; if not, check `MatchUps`
  is ticked in **SAGE → Set up live sync**. Then type a team letter into
  one quarterfinal seed cell on `MatchUps`. That quarterfinal card
  switches from *Seed n · TBD* to the team's name, and the team gets an
  *Advances* label. Put the seed number back afterwards.
- [ ] **Lineup reveal (team events with `lineupReveal`).** The lineup you
  just entered stays hidden on the Hub and the board, while Control Center
  shows it. Tick that matchup's **Show lineup** box, then click **Resync this
  day now** (the tick doesn't sync by itself): the names appear on the Hub
  and the board. Untick it and resync afterwards.
- [ ] **Team colours (team events with `display.teamColors`).** Every team
  shows its mark, a coloured shape, before its name on the Hub, the board and
  Control Center, and no two marks look alike.
- [ ] **Roster (team events).** Change one player's name on `Teams`. Edits
  there don't sync by themselves: click **Resync this day now**, check the Hub's
  Teams tab shows the change, then put the name back and resync.

### 1.2 Console verification (operator device only — nothing public yet)

Follow §2.1–§2.2 below to get signed in and resynced, then check:

- [ ] **Live Matches** tab: Match A shows the final score you set; Match B shows a live pill on the court you set; every other configured court on that facility shows idle placeholders, not blank/missing
- [ ] **Standings** tab: a visible warning banner naming Match C's unmapped code — not a silent "Other" bucket
- [ ] **Match Finder** tab: search a real player name from any match → returns their matches in schedule order, correct opponent/score state
- [ ] **Awards** tab: loads without errors and lists every category — before any Final/Bronze match is played, every placing reads "Pending," not a fabricated winner
- [ ] **Public site status**: click **Force hidden**, then **Auto** → a confirmation prompt appears before **Force hidden** takes effect; the console's own tabs stay visible throughout either way; it returns cleanly to **Auto**
- [ ] **Scorer link (events with `"scoreEntry": "links"`)**: under Mission Control's **Scorer links**, press **Issue scorer link**, fill in **Issued to** and **Note** in the dialog, press **Issue link**, and open the link on a phone. The page's title line names the day, the venue and who it was issued to. Change Match A's score from the phone → the console shows the new score within a few seconds, and both of Match A's score cells in `SCHEDULE` get a note naming that label

- [ ] **Best-of-3 round-robin meetings (categories with `bestOf` on `CSV`).** Enter one
  meeting 2–0 and leave its game 3 blank: game 3 is greyed on the Hub, the board and the
  scorer page, and the facility card is not held up by it. Enter another meeting at 1–1:
  its game 3 stays a match left. Standings count meetings, so a 2–0 and a 2–1 are each
  one W for the winner and one L for the loser. Clear the scores afterwards.

Don't move on until every check above passes.

### 1.3 Public screens

Follow §2.3 below (screen setup), then:

- [ ] Screen 1 (Schedule board): courts/times render, Match B's court shows as in-progress
- [ ] Screen 2 (Live Matches): matches what the console showed (same score, same live court); if **Force hidden** was active at any point in §1.2, confirm this screen goes to hidden/idle instead of showing scores, since that's what actually happens publicly
- [ ] Screen 3 (Standings): same unmapped-code warning, same standings as the console

### 1.4 Cleanup

- [ ] Revert `team1Score`/`team2Score` on Match A (clear both), and delete the note the scorer link left on those two cells, if any
- [ ] Clear `court` on Match B
- [ ] Restore Match C's original team code
- [ ] Resync once more to publish the reverted state

---

## Part 2 — Day of the event

### 2.1 Before doors open

**Operator device (laptop/tablet) — get this working first, before anything public:**

- [ ] Confirm it's on the venue wifi/network
- [ ] Open Control Center (`tools/control-center.html`)
- [ ] Select `UPAP 3rd Annual Tournament` → today's day
- [ ] Sign in with the operator username and password in Mission Control
- [ ] Click **Check connection** → confirms Cloud Run is reachable before anything depends on it
- [ ] Each facility workbook's **Share** dialog lists `sage-tools-api-runtime@sage-tools-api.iam.gserviceaccount.com` as Editor, and **General access** reads **Restricted** (not "Anyone with the link")
- [ ] If this event has attendance: open the **Attendance** tab, press **Update roster**, and check every venue reports its people; for `"desks"`, issue one desk link per desk (press **Issue desk link**, fill in **Issued to** with the person's name and **Note** with the gate in the dialog, then press **Issue link**) and send the link (or QR) to that desk with the desk handout
- [ ] If this event has scorer links (`"scoreEntry": "links"`): confirm Mission Control's **Scorer links** reads **Accepting**, then issue one link per scorer (press **Issue scorer link**, fill in **Issued to** and **Note** with their name and courts in the dialog, then press **Issue link**) and send the link (or QR) with the scorer handout. A scorer link lasts 24 hours, so issue them that morning
- [ ] Click **Resync this day now** → pulls the day's real schedule fresh, and confirms Cloud Run can read every facility's sheet. It doesn't involve the sheet's Apps Script: only the first real edit in the **Court Control** tab publishing on its own (§2.4) proves that
- [ ] Confirm **Facility Sync Status** shows a fresh "Synced" for every venue this event uses
- [ ] Confirm Mission Control reads **Live updates: push connected**

### 2.2 Decide on go-live timing

- [ ] Check Mission Control's **Public site status** line — under **Auto**, the day goes live 4 hours before its earliest scheduled match time, computed automatically from the sheet's Schedule column (no config to set). If you want it live earlier than that — e.g. so players can check schedules from the moment they arrive — click **Force live** now. Otherwise leave it on **Auto**.

### 2.3 Bring up the public screens

- [ ] Connect the venue's displays (HDMI/casting), then, from the operator device, click **Open schedule** and load that on Screen 1
- [ ] Click **Open Tournament Hub**, load that URL on Screen 2, click its **Live Matches** tab
- [ ] Load the same public URL again on Screen 3, click its **Standings** tab
- [ ] On a phone (not the console — the console always shows live data regardless of the switch above), open the public page and confirm it looks like what a player would actually see
- [ ] The hub board is up with **this** event's QR panel on it, and scanning it with a phone opens `UPAP 3rd Annual Tournament`'s Tournament Hub

### 2.4 During play

**The actual per-match rhythm, at the sheet:**

1. As a court frees up, enter the next match's number against that court in
   the **Court Control** tab — this is what makes it show as live on the
   console, the wall display, and the public site
2. When a match finishes, replace that court's entry with the *next* match
   number (not blank — a court sits idle otherwise instead of showing what's
   coming up)
3. Enter the finished match's score on its own row in the matches tab

Each edit syncs within a few seconds and reaches open pages by push — you
don't need to do anything else for it to publish. Everything below is just
watching for when that pipeline needs a nudge:

- [ ] **One-bracket Final (formats `final` and `final_bronze`).** The round robin sets
  no seats: when it ends, read the standings on the Hub or in Control Center (not the
  category tab, which ranks nothing; the site breaks a tie on wins by head-to-head first)
  and type RR #1–#4 into the category tab's draw column. RR #1 and #2 play the Final;
  with `final_bronze`, RR #3 and #4 play the Bronze match, and with `final` RR #3
  takes bronze with no match.
- [ ] **Double round robin (`rr_legs` 2).** When packing `SCHEDULE` from `MATCHES`,
  pack all of leg 1 (`RR n`) before any of leg 2 (`RR n · Leg 2`): halfway through the
  standings mean something, a day running late can drop leg 2 and still have a complete
  round robin, and no pairing plays twice in a row. Players see both meetings as
  "Round robin".
- [ ] **Best-of-3 meetings (`rr_best_of` 3).**
  - Pack each meeting's three games (`RR n · G1`–`G3` on `MATCHES`) back to back on one
    court. Every pairing has exactly three rows: a fourth row would count towards the
    standings but not on the site.
  - After a 2–0, leave game 3's scores blank. Never type `0`–`0` into it: a typed score
    is a played game.
  - The organiser can move the next meeting onto that court early.
  - Check that a game 3 after a 2–0 is greyed on the Hub, and that the facility card
    reads "All matches done" once every meeting is decided.
- [ ] **Playoff teams (team events).** When the bracket stage ends,
  enter each qualifier's letter against its seed on `MatchUps`; after
  each playoff round, enter the next round's teams the same way. The
  site takes every playoff team from these cells and never picks them
  itself. The seed cells are listed in `_templates/CLAUDE.md` (the
  team workbook step).
- [ ] **Playoff tiebreakers (team events whose workbook has `_TB` rows).**
  A playoff matchup still level after its games plays its tiebreaker row:
  type the two nominated players into that row's player cells, then enter
  its score like any other. A matchup already settled needs nothing: its
  tiebreaker row reads *Not needed* on the board and drops off the Hub's card.
- [ ] **Tiebreaker pair (team events that collect one with the lineup).** A team
  submits 3 pairs for a playoff matchup, the third for its tiebreaker. Wait until
  the tiebreaker is needed to type that pair in: the Hub shows anything typed in
  the row at once, unless the event uses `lineupReveal`.
- [ ] **Spare rows (team events).** A row in `CSV` with `-` as its team code isn't
  a match: it stays off the schedule board, the match count and the estimated
  finish, and it doesn't keep the day from finishing.
- [ ] **Show lineup (team events with `lineupReveal`).** Tick each matchup's
  **Show lineup** box when the organiser says, then click **Resync this day
  now**: the tick doesn't sync by itself.
- [ ] **Roster changes (team events).** A change on `Teams` (a substitute,
  a spelling fix) doesn't sync by itself either: click **Resync this day now**
  after it.
- [ ] If Mission Control reads *Live updates: polling GitHub (push not connected)*, updates still arrive, just 30–60s slower — keep going and tell whoever maintains the system
- [ ] Periodically glance at Mission Control's Facility Sync Status. It should read "Synced" a few seconds to a couple minutes ago, continuously
- [ ] If it ever goes stale or shows "Last attempt failed," click **Resync this day now** yourself rather than waiting
- [ ] If a score or court entry hasn't appeared on the site within about **2 minutes**, click **Resync this day now**. A sync can lose a race with another venue's sync, or with another event's on the same day, and Facility Sync Status only turns amber after 5 minutes without one
- [ ] If Sheets API trouble persists, check **Use CSV export fallback instead of Sheets API** and resync again
- [ ] If a bad score or typo goes public and needs a moment to fix quietly: set **Public site status** to **Force hidden**, correct the sheet, resync, then set it back to **Auto** (or **Force live**) — remember this hides the *public* page only, the console keeps showing everything the whole time
- [ ] The Schedule Board updates on its own (pushed within seconds, with a ~10s poll as the fallback) — no action needed, just glance at it occasionally to confirm it's still moving
- [ ] Use **Match Finder** on the console directly if a player asks where their match is
- [ ] If scorer links must stop (one sent to the wrong person, say): set **Scorer links** to **Stopped**. Within about a minute every scorer save is refused; enter scores in Match Finder meanwhile, and set it back to **Accepting** when ready

### 2.5 End of day

- [ ] After the last match, check **Standings** on the console look complete and correct
- [ ] Once the day's Finals and Bronze matches are scored, check the **Awards** tab — every category should show its gold/silver/bronze (or a named-match warning if a score looks wrong); use **Export image** per category, or **Export whole tournament**, to hand results to the emcee/ceremony
- [ ] No action needed on the go-live switch — **Auto** stays live permanently once it's triggered, so there's nothing to turn off
- [ ] If anything broke mid-day, note the rough time — `event-data`'s git history (both `config/events.json` and the day's published JSON) has a timestamped commit for every sync and every override, so it's reconstructable after the fact
