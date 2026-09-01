# PNF x BUP Dual Meet — Match Control Runbook

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

### 1.2 Console verification (operator device only — nothing public yet)

Follow §2.1–§2.2 below to get signed in and resynced, then check:

- [ ] **Live Matches** tab: Match A shows the final score you set; Match B shows a live pill on the court you set; every other configured court on that facility shows idle placeholders, not blank/missing
- [ ] **Standings** tab: a visible warning banner naming Match C's unmapped code — not a silent "Other" bucket
- [ ] **Match Finder** tab: search a real player name from any match → returns their matches in schedule order, correct opponent/score state
- [ ] **Live/Hide** toggle: set to `false`, then back to `auto` → a confirmation prompt appears before `false` takes effect; the console's own tabs stay visible throughout either way; it flips back cleanly to `auto`

Don't move on until every check above passes.

### 1.3 Public screens

Follow §2.3 below (screen setup), then:

- [ ] Screen 1 (Schedule board): courts/times render, Match B's court shows as in-progress
- [ ] Screen 2 (Live Matches): matches what the console showed (same score, same live court); if `false` was active at any point in §1.2, confirm this screen goes to hidden/idle instead of showing scores, since that's what actually happens publicly
- [ ] Screen 3 (Standings): same unmapped-code warning, same standings as the console

### 1.4 Cleanup

- [ ] Revert `team1Score`/`team2Score` on Match A (clear both)
- [ ] Clear `court` on Match B
- [ ] Restore Match C's original team code
- [ ] Resync once more to publish the reverted state

---

## Part 2 — Day of the event

### 2.1 Before doors open

**Operator device (laptop/tablet) — get this working first, before anything public:**

- [ ] Confirm it's on the venue wifi/network
- [ ] Open Match Control (`tools/match-control.html`)
- [ ] Select `PNF x BUP Dual Meet` → today's day
- [ ] Sign in with the operator username and password in Mission Control
- [ ] Click **Check connection** → confirms Cloud Run is reachable before anything depends on it
- [ ] Click **Resync this day now** → pulls the day's real schedule fresh, and doubles as a check that the sheet's Apps Script wiring actually works before a single match starts
- [ ] Confirm **Facility Sync Status** shows a fresh "Synced" for every venue this event uses

### 2.2 Decide on go-live timing

- [ ] Check Mission Control's **Public Site Status** line — under `auto`, the day goes live 4 hours before its earliest scheduled match time, computed automatically from the sheet's Schedule column (no config to set). If you want it live earlier than that — e.g. so players can check schedules from the moment they arrive — click **Force Live** now. Otherwise leave it on `auto`.

### 2.3 Bring up the public screens

- [ ] Connect the venue's displays (HDMI/casting), then, from the operator device, click **Open schedule** and load that on Screen 1
- [ ] Click **Open match finder**, load that same URL on Screen 2, click its **Live Matches** tab
- [ ] Load the same public URL again on Screen 3, click its **Standings** tab
- [ ] On a phone (not the console — the console always shows live data regardless of the switch above), open the public page and confirm it looks like what a player would actually see

### 2.4 During play

**The actual per-match rhythm, at the sheet:**

1. As a court frees up, enter the next match's number against that court in
   the **Court Control** tab — this is what makes it show as live on the
   console, the wall display, and the public site
2. When a match finishes, replace that court's entry with the *next* match
   number (not blank — a court sits idle otherwise instead of showing what's
   coming up)
3. Enter the finished match's score on its own row in the matches tab

Each edit triggers Apps Script's own debounced sync — you don't need to do
anything else for it to publish. Everything below is just watching for when
that pipeline needs a nudge:

- [ ] Periodically glance at Mission Control's Facility Sync Status. It should read "Synced" a few seconds to a couple minutes ago, continuously
- [ ] If it ever goes stale or shows "Last attempt failed," click **Resync this day now** yourself rather than waiting
- [ ] If Sheets API trouble persists, check **Use CSV export fallback instead of Sheets API** and resync again
- [ ] If a bad score or typo goes public and needs a moment to fix quietly: set **Live/Hide** to `false`, correct the sheet, resync, then set it back to `auto` (or `true`) — remember this hides the *public* page only, the console keeps showing everything the whole time
- [ ] The Schedule Board polls on its own every ~10s — no action needed, just glance at it occasionally to confirm it's still moving
- [ ] Use **Match Finder** on the console directly if a player asks where their match is

### 2.5 End of day

- [ ] After the last match, check **Standings** on the console look complete and correct
- [ ] No action needed on the go-live switch — `auto` stays live permanently once it's triggered, so there's nothing to turn off
- [ ] If anything broke mid-day, note the rough time — `event-data`'s git history (both `config/events.json` and the day's published JSON) has a timestamped commit for every sync and every override, so it's reconstructable after the fact
