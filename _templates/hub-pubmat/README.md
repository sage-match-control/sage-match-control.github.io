# Tournament Hub board (pubmat)

A 24 × 36 in (2 × 3 ft) portrait sintra board for the venue that advertises
the Tournament Hub. It shows three phones (Live Matches, Match Finder,
Standings), a "How it works" strip, and a **QR panel** for the event, which
is the only part that changes between events.

There are two ways to use it:

- **Sticker swap.** Print `out/base/board-blank.pdf` on sintra once. Its QR
  slot is plain white. Each event, print that event's `qr-panel.pdf` as an
  8 × 8.75 in sticker and stick it over the slot, covering last event's.
- **Full reprint.** Print the event's `board.pdf`, which has the panel in place.

## Making an event's files

```bash
node _templates/hub-pubmat/render.mjs <event-key>
```

It runs from anywhere and takes several keys at once. With no key it writes
only the blank base. Everything on the panel is read from the event's own
page, `events/<event-key>/index.html`, so run it once that page is filled in
(runbook step 3 in `_templates/CLAUDE.md`):

| Panel line | Read from |
| --- | --- |
| Event name | `<title>`, without " — Tournament Hub" |
| Date and venue | the hero's `.eyebrow` |
| QR code | the QR panel's `<img>` (`{{QR_IMAGE}}`, usually `assets/qr.png`) |
| Short link | `.qr-link-text` (`{{QR_URL}}`) |

A wrong line on the panel is fixed on the page, then re-rendered. The script
refuses a page that still has `{{TOKENS}}` in it. A long date/venue line (a
dual meet names both clubs) wraps to two lines and shrinks to fit, and the QR
code shrinks slightly to make room.

Files land in `out/` (git-ignored):

| File | Use |
| --- | --- |
| `out/base/board-blank.pdf` | The board with an empty white QR slot. |
| `out/<event-key>/qr-panel.pdf` | The panel alone, exactly 8 × 8.75 in. |
| `out/<event-key>/board.pdf` | The whole board with the panel in place, exactly 24 × 36 in. |
| `out/<event-key>/board-150dpi.png` | 3600 × 5400 image, for a printer that won't take PDF. |
| `out/<event-key>/board-preview.png` | Small preview for checking before printing. |

The PDFs are cut to the exact finished size, with no bleed. Text keeps 1 in
clear of every edge. The QR slot sits 1.2 in from the right edge and 1 in
from the bottom. Scan the printed panel with a phone before mounting it.

## Files

- `board.html` — the design. Everything is sized in inches. Open it in Chrome
  to see it with a placeholder panel. `--panel-w`/`--panel-h` set the panel's
  size, and `render.mjs`'s `PANEL` must match them.
- `render.mjs` — reads an event's page and prints the files above.
- `shots/` — the three phone screenshots. They are the same for every event.
- `capture.mjs` — re-takes `shots/` from Pickle for Sight's published day,
  rewound to 12:45 PM so matches show as live and Match Finder has a LIVE and
  a NEXT UP ticket. Only needed after the hub's look changes:
  `node _templates/hub-pubmat/capture.mjs`. The screenshots show that event's
  real player names, as its published hub does.

Both scripts expect the `D:\Personal\SAGE` layout: this repo beside
`sage-tools-api/` (whose puppeteer they borrow, driving the installed Chrome
at `C:/Program Files/Google/Chrome/Application/chrome.exe`) and, for
`capture.mjs`, `event-data/`. The board loads its fonts from Google Fonts, so
rendering needs a network connection.
