# pragyan

A personal tool that scrapes your own logged-in X (Twitter) timeline, ranks and
filters it down to high-signal news on a local backend, and reads it in a
text-only terminal TUI. Everything runs on your machine — the backend binds to
`127.0.0.1` and the extension rides your existing X session. Personal use only.

<img width="2820" height="1737" alt="image" src="https://github.com/user-attachments/assets/afd12278-d407-45e5-b58f-5356c052dbcd" />

```
[X timeline]
   │  DOM scrape (incremental, virtualized-safe)
   ▼
Chrome extension (MV3)   content script → service worker → POST /ingest
   ▼
Local API + SQLite   ──── heuristic pre-filter + scoring
   │  GET /feed (ranked, filtered)
   ▼
Terminal TUI (read-only renderer)
```

## Structure

| Path         | What                                                                 |
|--------------|----------------------------------------------------------------------|
| `shared/`    | The `Post` data contract, imported by both api and tui.              |
| `extension/` | MV3 harvester — content script, service worker, options. See its [README](extension/README.md). All DOM selectors live in `selectors.js`. |
| `api/`       | Node + Express + `better-sqlite3`. Ingest, feed, feed-state, markets. |
| `tui/`       | TypeScript + Ink (React) read-only client.                           |
| `docs/`      | `PRD.md` (spec) and `plans/`.                                         |

## Requirements

- Node ≥ 20
- Chrome (for the harvester extension)

## Setup

```sh
npm install
```

## Run

Start the API (port `8787` by default):

```sh
npm start          # or: npm run dev   (tsx watch, reloads on change)
```

Load the extension:

1. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked**
   → select the `extension/` folder.
2. Open `https://x.com/home` while logged in. A badge appears bottom-right and
   the harvester auto-scrolls, capturing posts as they enter view. Auto-scroll
   can be disabled or paused from the options page / on-page badge.

Read the feed in the TUI:

```sh
npm run tui
```

## TUI keys

`1-4`/`Tab` switch tabs (feed · crypto · nifty · polymarket) · `j/k`+arrows move ·
`g/G` top/bottom · `enter`/`o` open link · `x` dismiss · `u` undo dismiss ·
`t` cycle threshold · `n` toggle news-only · `space` pause · `r` refresh · `q` quit.

## Configuration

Ranking behavior lives in [`api/config.json`](api/config.json) — interest topics,
composite-score weights, news gates, the heuristic pre-filter, scoring, expiry
TTLs, and market sources. Re-tuning the feed never touches code. Harvest behavior
(API URL, scroll cap, batch size) is set on the extension options page. See PRD
§6 for every field.

`sources.provider` picks market data: `mock` (random-walking demo) or `real`
(keyless CoinGecko / Yahoo Finance / Polymarket).

## Scoring

Posts go through a two-stage rank: a synchronous heuristic pre-filter at ingest
(flags ads, pure replies, low-engagement and clickbait — flagged rows are kept,
not deleted), then scoring of the survivors. The current scorer is a heuristic
stand-in (`api/dummyScorer.ts`); replacing it with a batched async LLM job is
planned — see [`docs/plans/phase5.md`](docs/plans/phase5.md).

## Tests

```sh
npm run test:ext       # extension parser + auto-scroll loop (jsdom, no server)
npm run test:ext:e2e   # parse synthetic tweets and POST to a running API
npm run typecheck      # tsc --noEmit
```
