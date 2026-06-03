# pragyan harvester (Chrome extension, MV3)

Harvests your own logged-in X timeline and sends posts to the local pragyan API.
Personal use only — it automates *your* feed, nothing distributed.

## Architecture

```
content.js  ── MutationObserver harvest (incremental, virtualized-safe) ──┐
            ── in-session dedup by status id, buffers batches             │
            └─ chrome.runtime.sendMessage ─► background.js ─► POST /ingest
selectors.js  ── ALL DOM selectors + parseTweet (the one file to fix when X changes)
options.html  ── API base URL + batch size (chrome.storage.local)
```

The content script never `fetch`es localhost itself — the page CSP (`connect-src`)
blocks that. It hands batches to the service worker, which is not bound by the page CSP.

## Load it

1. Start the API: `npm start` (from the repo root).
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select this `extension/` folder.
3. (Optional) click the extension icon → set API base URL / batch size.

## Auto-scroll (Phase 3)

By default the harvester auto-scrolls the timeline: each tick scrolls ~80% of a viewport,
waits for new articles to render (polls — no fixed sleep), harvests, then repeats with a
jittered human-paced delay. It stops after `scrollCap` total scrolls **or** `emptyStop`
consecutive scrolls that surface nothing new (i.e. the end of the loaded feed).

- **Disable it** in options (uncheck *Auto-scroll the timeline*) → falls back to manual
  harvesting: posts are still captured as you scroll by hand.
- **Pause/resume for the session**: click the bottom-right badge.

## Verify

1. Open `https://x.com/home` while logged in.
2. A badge appears bottom-right: `pragyan ▶ scrolling · seen N · sent M · queue Q`
   (`⦿ idle` / `⏸ paused` / `✓ done` reflect loop state; red = a POST failed).
3. Watch it scroll and harvest, or disable auto-scroll and scroll by hand.
4. Confirm posts landed: `curl 'http://127.0.0.1:8787/feed?limit=20'` — or open the TUI.

## Selectors are volatile

X changes its markup often. Everything that touches the DOM lives in `selectors.js`.
When harvesting breaks, inspect a live tweet's DOM and update the selectors there —
no other file should need changes. Run `npm run test:ext` to check the parser against
synthetic fixtures after editing.

## Tests

- `npm run test:ext` — parser + auto-scroll loop tests (jsdom, no server needed).
- `npm run test:ext:e2e` — parse synthetic tweets and POST to a running API.
