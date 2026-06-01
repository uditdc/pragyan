# X Feed Filter — Project Spec

A personal tool that scrapes the user's own logged-in X (Twitter) timeline via a
Chrome extension, ranks and filters posts down to high-signal news items on a
local backend, and displays them in a text-only terminal TUI.

This is a **personal-use** tool operating on the user's own authenticated feed.
The backend runs locally and never leaves the user's machine.

---

## 1. Architecture

```
[X timeline]
   │  (DOM scrape, incremental)
   ▼
Chrome extension (MV3)
   │  content script → service worker → fetch
   ▼  POST /ingest (batches)
Local API + SQLite  ──── async LLM scoring job
   │  GET /feed (ranked, filtered)
   ▼
Terminal TUI (read-only client)
```

Three components joined by **one shared data contract** (Section 2). Keep the
boundaries strict: the extension only harvests, the API does all ranking/filtering,
the TUI is a dumb renderer. This separation is what makes each piece independently
testable.

---

## 2. Data contract (build this first)

Every component shares this object. Define and freeze it before writing any
component logic.

```jsonc
{
  "schema_version": 1,
  "id": "string",            // X status ID from the permalink. THE dedup key.
                             // NEVER use array index or scroll position.
  "author_handle": "string",
  "author_name": "string",
  "text": "string",          // full expanded text
  "created_at": "ISO-8601",  // from <time datetime="..."> attr, NOT "2h" relative text
  "url": "string",           // permalink

  "is_repost": false,
  "is_quote": false,
  "is_reply": false,
  "is_ad": false,
  "is_thread": false,
  "thread_id": "string|null", // conversation-root status id when derivable. Posts are
                              // harvested/stored individually; the TUI groups thread
                              // parts under this for display (Section 5).

  "quoted_text": "string|null",
  "media_types": ["photo"],  // presence only: photo|video|gif|card. No assets.

  "metrics": {
    "replies": 0,
    "reposts": 0,
    "likes": 0,
    "views": 0
  },

  "harvested_at": "ISO-8601",

  // --- Set by the API at ingest (Stage 1 heuristic pre-filter) ---
  "kept": true,                  // false = pre-filter flagged it as bloat. The row is
                                 // NEVER deleted; /feed hides kept=false by default so
                                 // weights/topics can be re-tuned over the full corpus.
  "drop_reason": "string|null",  // "ad" | "pure_reply" | "below_engagement_floor" | ...
  "clickbait_heuristic": 0.0,    // 0..1 provisional, from cheap signals at ingest

  // --- Set by the API at Stage 2 (async LLM scoring); null until scored ---
  "scores": null,                // the object below once scored, else null
  // "scores": {
  //   "relevance": 0.0,         // 0..1 vs user interest topics
  //   "importance": 0.0,        // 0..1
  //   "clickbait": 0.0,         // 0..1, LLM verdict; supersedes clickbait_heuristic
  //   "is_news": false,         // gate
  //   "news_confidence": 0.0
  // },
  "scored_at": "ISO-8601|null", // null = needs scoring. THE Stage-2 work-queue cursor.

  // --- Feed lifecycle; sticky, set by the API, preserved on re-ingest (like scored_at) ---
  "viewed_at": "ISO-8601|null",  // set when the TUI reports the post as read (selected)
  "expired_at": "ISO-8601|null"  // set on manual dismiss. Row is NEVER deleted; /feed
                                 // hides it. Auto-expiry (TTL) is applied in the query,
                                 // not stored — see Section 4.

  // NOTE: the composite ordering score is NOT stored — it is computed at query time
  // from `scores` and the configured weights, so re-tuning weights needs no re-score.
}
```

---

## 3. Component 1 — Chrome extension (Manifest V3)

### Critical constraint: the timeline is virtualized

X's timeline is a **virtualized list**. Posts that scroll out of view are
**removed from the DOM**, not hidden. There is never a moment where all posts
exist in the DOM at once.

**Implication:** you MUST harvest incrementally — capture each post as it enters
the viewport, before it is recycled. Do NOT scroll to the bottom and then scrape.

### Capture

- Use a `MutationObserver` on the timeline container, or a scroll-tick harvester,
  to capture each `article[data-testid="tweet"]` as it appears.
- Store captured posts in an in-memory `Map` keyed by status ID for in-session dedup.
- **Selectors are volatile.** X changes its markup frequently. Inspect the LIVE DOM
  to confirm selectors before relying on them; centralize ALL selectors in one
  module so a markup change is a one-file fix. Starting points to verify (do not
  trust blindly):
  - tweet container: `article[data-testid="tweet"]`
  - text: `[data-testid="tweetText"]`
  - timestamp: the `<time>` element's `datetime` attribute
  - status ID: parsed from the permalink `<a href=".../status/NNN">`
  - metrics: the `[data-testid]` group on the action bar
- Detect and flag ads (`Promoted` / `Ad` label) → `is_ad: true`.
- Parse the real status ID and the `datetime` attribute. Relative time strings
  ("2h") and DOM order are NOT acceptable substitutes.
- Capture `thread_id` (conversation-root status id) best-effort when the DOM exposes it
  (e.g. thread connector / "Show this thread"); leave `null` otherwise. Never block a
  harvest on it — the TUI's same-author fallback covers the gap.

### Auto-scroll loop

- Scroll by ~80% of viewport height per tick.
- Wait for render/network to settle by **polling for new articles**, not a fixed
  sleep.
- Harvest, then repeat.
- Stop after N total scrolls OR after M consecutive scrolls that yield zero new IDs.
- Use jittered, human-paced delays. Rapid programmatic scrolling both gets
  throttled/flagged by X and causes the harvester to miss recycled posts.
- **User-disableable.** Auto-scroll is on by default but can be turned off in options
  (→ manual harvesting as posts enter view), and paused/resumed for the session from the
  on-page badge.

### Networking (common failure point)

A content script's `fetch` to `localhost` is frequently blocked by the page's CSP
`connect-src`. **Do not fetch from the content script.**

Instead:
1. Content script buffers captured posts.
2. Content script sends batches to the **background service worker** via
   `chrome.runtime.sendMessage`.
3. The service worker does the `POST` to the local API. The service worker is not
   subject to the page's CSP.

Declare the local API origin in `host_permissions`.

### Config

A small options page or hardcoded config for: API base URL, scroll cap, batch size.

---

## 4. Component 2 — Local API + ranking

### Server

- **Node + Express.** `better-sqlite3` for storage (synchronous, single-file, no
  external DB) — its sync API is a clean fit for the at-write-time pre-filter.
- Bind to `127.0.0.1` only. No auth required — it never leaves the machine and the
  extension rides the user's existing X session.
- The Stage-2 scorer runs in the same process as a background interval/loop (no
  separate worker needed at this scale); it pulls rows where `scored_at IS NULL`.

### Endpoints

- `POST /ingest`
  - Body: `{ posts: Post[] }`
  - Upsert by `id` (dedup across sessions). Re-ingesting a known id refreshes volatile
    fields (metrics) but never resets `scores`/`scored_at`.
  - Runs the synchronous heuristic pre-filter (below) at write time, setting
    `kept` / `drop_reason` / `clickbait_heuristic`. Flagged posts are **stored**, not
    discarded — "dropped" means `kept=false`, recoverable by re-tuning.
  - Returns counts: received / new / duplicate / flagged_dropped.

- `GET /feed`
  - Query: `min_score`, `since` (cursor on `harvested_at`), `limit`, optional
    `news_only=true`, optional `include_dropped=true` (default hides `kept=false`),
    optional `include_expired=true` (default hides expired — see below).
  - Returns `Post[]` ordered by the **query-time composite** (highest first), gated by
    `is_news` when `news_only`. Unscored posts (`scores=null`) sort last / are excluded
    when `min_score>0`.
  - Cursor: `since` is an ISO `harvested_at`; response includes the max `harvested_at`
    seen so the TUI can pass it back next poll.

- Feed-state controls (the TUI emits these; **all expiry policy stays server-side**):
  - `POST /viewed`    `{ ids: string[] }` → set `viewed_at` (if null). Returns `{ updated }`.
  - `POST /dismiss`   `{ ids: string[] }` → set `expired_at = now`. Returns `{ dismissed }`.
  - `POST /undismiss` `{ ids: string[] }` → clear `expired_at`. Returns `{ restored }`.

- **Auto-expiry (hybrid, applied lazily in the `/feed` query, never stored):** a post is
  hidden when `expired_at` is set, OR it was viewed longer than `viewed_ttl_min` ago, OR
  it was harvested longer than `unviewed_ttl_hours` ago (the backstop so unseen news
  isn't lost but nothing lingers forever). All three TTLs are config (Section 6).
  `include_expired=true` bypasses this filter for debugging/re-tuning.

- `GET /markets` — additional, non-tweet sources (separate from the post pipeline; no
  SQLite). A background loop refreshes an in-memory cache on `sources.poll_interval_ms`;
  the endpoint just returns the latest `MarketsSnapshot` (`shared/market.ts`):
  `{ crypto: Ticker[], indices: Ticker[], polymarkets: PredictionMarket[], fetched_at, stale }`.
  - `sources.provider` selects **mock** (random-walking demo data) or **real** keyless
    providers: CoinGecko (BTC), Yahoo Finance `^NSEI` (Nifty 50), and Polymarket gamma
    **`/events`** (top events by 24h volume, collapsed one-row-per-event with the leading
    outcome — so a 60-team event like the World Cup is a single "France 17%" row, not 60
    longshots). The real provider degrades gracefully — a failed source keeps its last good
    values and sets `stale: true`. ~3 outbound calls per `poll_interval_ms` (default 60s),
    well under provider rate limits.

- `GET /health` — for the TUI to detect the server.

### Ranking — hybrid, two stages

Don't pay LLM cost on garbage. Filter cheap first, then score the survivors.

**Stage 1 — synchronous heuristic pre-filter (at ingest)**
Flags obvious bloat (sets `kept=false` + `drop_reason`, never deletes) and writes a
fast provisional `clickbait_heuristic` so the LLM stage processes fewer posts.
- Flag as dropped: ads, pure replies (configurable), posts below an engagement floor,
  social chatter with no substantive text.
- Heuristic clickbait signals: engagement-bait phrasing ("you won't believe",
  "🧵👇", "RT if", "wait for it"), all-caps ratio, emoji density, curiosity-gap
  openers with no substance.
- Only `kept=true` posts are eligible for Stage 2 — don't spend LLM tokens on flagged
  bloat.

**Stage 2 — batched async LLM scoring (background job)**
Runs over un-scored survivors in batches. Calls Claude with a structured prompt and
parses JSON back. Batched + async so it never blocks ingest and respects rate limits.

Suggested scoring prompt contract (system prompt instructs JSON-only output, no
prose, no markdown fences):

```
For each post, return JSON:
{
  "id": "<echo>",
  "relevance": 0..1,        // match to user's interest topics: [<configured list>]
  "importance": 0..1,       // would a well-informed person consider this consequential?
  "clickbait": 0..1,        // manipulative framing / curiosity gap / bait
  "is_news": true|false,    // reports a real-world event/development vs opinion/social/promo
  "news_confidence": 0..1
}
```

- Work queue = rows where `kept=true AND scored_at IS NULL`. Feed in batches of ~10–20
  to amortize cost.
- Persist `scores` + `scored_at` back to the row; never re-score (the `scored_at IS NULL`
  filter makes this idempotent). The LLM `clickbait` supersedes `clickbait_heuristic`.
- Use a cheap, fast model for this high-volume step — **Claude Haiku**
  (`claude-haiku-4-5`) — with a JSON-only system prompt. Reserve larger models for
  cases where Haiku's quality proves insufficient.
- The **`is_news` gate plus interest-topic list does most of the bloat removal** —
  treat both as user-tunable config, not hardcoded logic.

**Relevance option:** start with the LLM judging relevance against an interests
list. If cost becomes an issue, swap to embeddings cosine-similarity against the
interest topics. Don't build embeddings first — only if needed.

**Composite score** for `/feed` ordering: a weighted blend, e.g.
`importance * w1 + relevance * w2 - clickbait * w3`, gated by `is_news`. Make the
weights config.

---

## 5. Component 3 — Terminal TUI (read-only client)

**TypeScript + Ink** (React for the terminal, runs on Node). Shares the language and
`Post` types with the Node API — the data contract is a single shared TS type imported
by both. (OpenTUI was evaluated first but is Bun-only via `bun:ffi`; Ink keeps the whole
project on one Node runtime.) Ink has no built-in scroll container, so the client windows
the consolidated feed to the terminal height and tracks a scroll offset itself.

**Design system** (from the Claude Design "FEEDWIRE" handoff): a muted dark realistic-TUI
look — color is emphasis only. Full-screen alternate buffer with two fixed chrome bars and
a flexing body between them:
- **Top bar** — `◆ XFEED` identity · **tab chips** (`1 feed · 2 crypto · 3 nifty ·
  4 polymarket`, active chip bright) · `all`/`news` filter · `min` threshold · live/offline
  dot · item count · clock.
- **Tabs** — number keys `1-4` (and `Tab`/`Shift+Tab`) switch views. `Feed` is the X-post
  two-pane; `Crypto`/`Nifty`/`Polymarket` are full-width market views (`MarketView`,
  reusing the design's `Ticker`/`Column`). Markets come from `GET /markets`, polled
  separately (~10s) into `markets` state.
- **Sticky market strip** — on the Feed tab, a compact one-line bar (`MarketStrip`) is
  pinned above the scrolling posts: `BTC price ▲Δ% · NIFTY price ▲Δ% · ◆ <#1 polymarket>`.
- **Two-pane body** — a feed list (`flexGrow`) + a `borderLeft` detail pane (hidden under
  80 cols). `↑↓`/`j`/`k` move a `selectedIndex`; the detail pane re-renders from the
  selection (full text, all thread parts, metrics, and the `scores` block).
- **Gutter-accent items** — a source-colored left border (`borderLeft`), source sigil,
  author + `@handle · time`, right-aligned metrics, 2-line clamped body (compact density).
  Selection swaps the gutter to the teal accent + bolds the name.
- **Bottom status bar** — per-source counts · buffer · stream state (`▶ LIVE` / `⏸ PAUSED`
  / `◌ offline`) · keyhints.
- **Palette** — `theme.ts` holds the exact tokens (bg `#16171c`, accent `#5cb6ac`, source
  hues: X blue, news amber, etc.). Source = `is_news ? news : x`; priority marker when
  `importance ≥ 0.7`.

Behavior:
- Polls `GET /feed` (`min_score`, `news_only`). Tracks a fresh-id set to flash new arrivals
  and show a `▲ N new` jump pill; `space` pauses (keeps buffering, shows buffered count).
- **Thread consolidation** is a display-time concern: group posts sharing a `thread_id`
  (falling back to consecutive same-author `is_thread` posts) into one stacked card,
  ordered by `created_at`. The store keeps them as individual rows — only rendering
  stitches them; the lead shows compact, the detail pane shows all parts.
- Keybindings: `1-4`/`Tab` switch tabs · `j/k`+arrows move · `g/G` top/bottom ·
  `enter`/`o` open link · `x` dismiss (expire selected) · `u` undo last dismiss ·
  `t` cycle threshold · `n` toggle `news_only` · `space` pause · `r` refresh · `q` quit.
  (Feed-specific keys act only on the Feed tab; `1-4`/`Tab`/`r`/`q` are global.)
- **Read-only on content/ranking.** The TUI does no scraping, ranking, or scoring. It
  *does* emit lightweight feed-state control events — reports the selected post as
  `viewed`, and `dismiss`/`undismiss` on `x`/`u` — but all expiry policy lives in the API.
  Selecting a card (active navigation, not the initial auto-select) marks its posts viewed;
  the ids are batched and POSTed to `/viewed`. Viewed posts then auto-expire server-side
  after `viewed_ttl_min`, so the feed self-clears like an unread inbox.

---

## 6. Configuration

Two config surfaces, kept deliberately small. Re-tuning the feed should never touch code.

**API config** (`api/config.json`) — owns all ranking behavior:
- `interest_topics`: string list the LLM scores `relevance` against.
- `weights`: `{ importance, relevance, clickbait }` for the composite ordering score.
- `gates`: `min_news_confidence`, default `news_only`.
- `prefilter`: `engagement_floor` (configurable, start **low** — e.g. 5 = likes+reposts),
  `drop_replies` (default **true**), `min_text_len`, `clickbait_phrases`.
- `scoring`: `model` (default `claude-haiku-4-5`), `batch_size` (10–20),
  `max_concurrent_batches`, poll interval for the background loop.
- `expiry`: `viewed_ttl_min` (default 10 — how long a read post lingers),
  `unviewed_ttl_hours` (default 48 — backstop age-out for everything), `mark_viewed_on`.
- `sources`: `provider` (`mock` default | `real`), `poll_interval_ms` (market refresh),
  `polymarket_count` (top-N markets).

**Extension config** (options page or hardcoded) — owns harvest behavior:
- `api_base_url`, `scroll_cap`, `consecutive_empty_stop`, `batch_size`, jitter range.

The TUI takes `poll_interval` and a default `min_score` as CLI flags or its own small
config; it holds no ranking logic.

---

## 7. Build sequence (phased — each phase independently testable)

1. **Contract + API skeleton.** Post schema, SQLite, `/ingest` + `/feed` with a
   pass-through dummy score. Test with curl'd fake posts. Unblocks everything else.
2. **Extension harvest (no scroll).** Capture + dedup + send to `/ingest`. Verify
   real posts land in the DB by scrolling manually.
3. **Auto-scroll.** Add the loop; tune settle-detection and stop conditions.
4. **TUI.** Read + render against the live (dummy-scored) feed. Now end-to-end.
5. **Ranking.** Heuristic pre-filter first, then the batched LLM job. Iterate on
   the prompt and weights against real captured data.

Never debug all three moving parts at once — keep dummy scores until phase 5.

---

## 8. Risks / gotchas (do not skip)

- **Virtualized timeline** — harvest incrementally as posts enter view; never
  "scrape at the end."
- **CSP** — do not fetch localhost from the content script; route through the
  service worker.
- **Volatile selectors** — centralize them in one module; inspect the live DOM to
  confirm; expect to update them when X changes markup.
- **Identity** — parse the real status ID and `datetime` attribute, not array
  index or relative time strings.
- **Pace + ToS** — this automates the user's own logged-in feed for personal use.
  Keep scrolling human-paced and jittered. Note that X's ToS restricts automation,
  so this remains a personal tool, not a distributed/commercial scraper.
- **LLM cost** — pre-filter before scoring; batch; never re-score.

---

## 9. Suggested repo layout

```
x-feed-filter/
├── shared/             # the Post TS type / data contract, imported by api + tui
├── extension/          # MV3: manifest, content script, service worker, options
│   └── selectors.js    # ALL DOM selectors live here
├── api/                # Node + Express, better-sqlite3, ingest + feed, scoring loop
│   ├── config.json     # ranking config (Section 6)
│   ├── prefilter.ts    # stage 1 heuristics
│   └── scorer.ts       # stage 2 batched LLM job (claude-haiku-4-5)
├── tui/                # TypeScript + Ink (React) read-only client
└── PRD.md              # this file
```