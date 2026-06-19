# Plan: Phase 6 — agentic knowledge base (Claude as external brain; pragyan as eyes, ears, hands & memory)

## Context

Phase 6 turns pragyan into a knowledge engine with a **two-tier intelligence model**:

- **Claude = the external brain** (the user's Claude subscription, driven by Claude Code
  `/loop` or a routine). It runs the agentic loop: pulls context from pragyan, researches and
  analyzes (its own web research + pragyan's tools), and **submits reports and insights back to
  pragyan, which stores them**. Across loops it compounds by pulling in its own prior output and
  pragyan's accumulated memory.
- **Pragyan = eyes, ears, hands & memory.** It is the part Claude *cannot replicate*.

### Design north star — invest in the moat, rent the cognition

Claude out-thinks pragyan on every analysis task. Pragyan's irreplaceable value is **access,
continuity, and structured memory** — so the build invests there and deliberately keeps the
Cerebras tier thin:

1. **Proprietary access** — pragyan rides your authenticated, personalized X session. Your home
   timeline (what the algorithm chose to show *you*) is not on the open web and Claude's
   `WebFetch` can't reach it. The harvester's reach — and its **hands** inside that session — is
   the moat. → invest in *capture fidelity* (Step 2) and *hands* (Step 4).
2. **Continuity** — pragyan is always-on; Claude is episodic. Only a thing that "was watching"
   can know a post went 10→10k likes in an hour, that an author keeps recurring, or what changed
   since the last loop. The timeline is ephemeral; pragyan freezes a durable, timestamped
   trajectory. → invest in the *longitudinal record* (Step 2) and a *change feed* (Step 4).
3. **Structured memory** — Claude's context resets; pragyan persists. An entity graph + living
   topic dossiers that survive every context window are what let judgment compound. → invest in
   *structured memory* (Step 3).
4. **Cheap triage, not cognition** — Cerebras `gpt-oss-120b` exists only to reduce the firehose
   to the slice worth a brain. **Keep the scorer dumb-but-cheap and the digest a heads-up, never
   real analysis** — the moment pragyan tries to "think," it's a worse Claude on a free tier.
5. **Extensible hands** — the tool layer is a *registry* designed to grow toward capabilities
   beyond Claude's reach (authenticated actions, local-device access, background jobs that run
   while Claude sleeps, future sensors), not a fixed tool set.

This supersedes [`phase5.md`](phase5.md) and the earlier internal-agent idea: **the loop lives in
Claude**; there is no internal Cerebras agent.

### The Cerebras budget constraint (triage tier only)

Only the scorer + digest touch Cerebras (`XFEED_LLM_*`); **Claude is on a separate subscription,
off this budget.** Free-plan limits: **5 req/min · 150/hr · 2,400/day; 30k tok/min · 1M tok/hr ·
1M tok/day.** Governing numbers: **1M tokens/day** and **5 req/min**. Split: scorer ~850k ·
digest ~150k (config-driven). Phase 5's cadence (5s × 2 concurrent ≈ 24 req/min) would trip the
cap and is revised in Step 1.

### Reuse

`api/tools.ts` (`runTool`, built for an MCP server) → Step 4 core. `api/llm.ts` (Cerebras
client). The `scored_at`/`idx_posts_scoring` queue + `Scores` contract. `summaries` + its coerce
pattern. `markets.ts` `getSnapshot()` (cross-signals). Each step is independently shippable.

---

## Step 0 — Shared LLM budget gate + client hardening (Cerebras tier)

**Goal:** the scorer + digest never exceed the pool, and a hung call can't deadlock a loop.

- **`api/llm.ts`** — add `timeout` + `maxRetries` from config to the `OpenAI` constructor.
- **`api/budget.ts`** (new) — sliding min/hour/day windows + per-consumer daily slices
  (`scorer`|`summary`); `acquire(consumer, estTokens)` (spaces for 5/min, returns false to force
  fallback), `record(consumer, usage)`, `note429(retryAfterMs)` backstop; `callLLM(...)` wrapper
  throwing `BudgetExceeded`.
- **`api/config.json`** — `llm` block: `timeout_ms`, `max_retries`, `max_completion_tokens`,
  `reasoning_effort: "low"`, `limits{rpm,rph,rpd,tpm,tph,tpd}`, `daily_token_budget{scorer:850000,
  summary:150000}`. (`reasoning_effort` param name to confirm vs Cerebras.)
- **Quick wins:** add `max_completion_tokens` + try/catch around `JSON.parse`
  (`summaryGenerator.ts:121`); delete dead `XFEED_CHAT_*` from `.env`.

**Verify:** tiny budget forces clean fallback; unreachable URL → timeout fires.

---

## Step 1 — Cheap triage scorer (dumb-but-cheap, not a brain)

**Goal:** coarse topic-relevance so Claude sees the high-signal slice, not the firehose. This is
triage, not analysis — keep it simple and bounded.

- **`api/server.ts`** — wrap ingest (lines 44–68) in one `db.transaction`; enqueue kept posts
  with `scores:null, scored_at:null`; drop the synchronous `dummyScore` import; call
  `startScorer()`.
- **`api/db.ts`** — `getUnscoredPosts(limit)` (newest-first) + `updatePostScores` (`WHERE id=@id
  AND scored_at IS NULL`, never re-score).
- **`api/scorer.ts`** (new) — `scoreBatch` (JSON-only, injects `interest_topics`; relevance =
  topic match; `temperature:0`, `reasoning_effort:low`, capped tokens). **Amortize the call:**
  in the same batch response, extract coarse **entities** (`{name, kind}[]` per post) — you're
  already paying for the read; this seeds the entity graph cheaply (Step 3). `scoreBatchSafe`
  falls back to `dummyScore` on `BudgetExceeded`/`!llmEnabled`/throw. `startScorer` = guarded
  `setInterval`; only LLM-score posts above `engagement_floor_for_llm`, rest get one-shot
  heuristic so the queue can't grow unbounded.
- **`api/news.ts`** — replace hardcoded `newsScores()` (lines 98–106) with `scored_at:null`.
- **`api/config.json`** — `scoring: { batch_size:30, max_concurrent_batches:1,
  poll_interval_ms:45000, engagement_floor_for_llm:5 }`.

**Verify:** off-topic/clickbait → low relevance; ≤5 req/min; exhausted budget → heuristic.

---

## Step 2 — Capture fidelity & the longitudinal record (the always-on moat)

**Goal:** stop overwriting and start *recording history* — the data only a thing that was
watching can have. This is the highest-moat step.

### Extension (`extension/`)
- **Capture thread structure** — populate `thread_id` (currently hardcoded `null` at
  `selectors.js:136`) so threads are reconstructable.
- **Capture feed position** — the index/order a post appeared in *your* timeline, sent on
  `/ingest`. Position + recurrence is the personalization signal (what the algorithm pushed at
  you), which is itself unique data.
- Keep media/quote capture; add a per-batch heartbeat (tweets-seen count) so a logged-in session
  silently yielding zero is detectable (the harvester is the single point of failure).

### Source abstraction — build the seam, defer the sources
We will eventually harvest more authenticated streams (Step 7), so make ingest source-agnostic
*now* to avoid baking in X-shaped assumptions — but **do not build the other adapters yet** (more
sources before the loop is proven on X just multiplies firehose + fragility). The cheap seam:
- A `HarvestAdapter` contract: each source (`x`, `google_news`, later `linkedin`, `reddit`)
  normalizes its raw DOM/API into the existing `HarvestedPost` contract (`shared/post.ts` — the
  `source` field + the existing `google_news` path already prove this works).
- A **source-normalized engagement scalar**: map X likes/reposts, LinkedIn reactions, Reddit
  upvotes/ratio → one common `engagement` value so prefilter/scoring/velocity are source-blind.
- Extend `PostSource` (`shared/post.ts:7`) as a closed union; keep selectors per-source in the
  extension. This turns "add LinkedIn" into writing one adapter, not a pipeline rewrite.

### `api/db.ts` — stop overwriting, start appending
- The ingest `ON CONFLICT` (db.ts:194–200) currently overwrites metrics. Instead **append**:
  - `post_metrics(post_id FK, observed_at, replies, reposts, likes, views)` — a time series per
    post. Derive **engagement velocity** (Δengagement/Δt) — high-velocity-early is signal Claude
    cannot reconstruct after the fact.
  - `post_seen(post_id FK, observed_at, feed_position)` — recurrence + placement.
  - `authors(handle PK, name, first_seen, last_seen, post_count, kept_count)` — accumulated voice
    track-record over time.
- Add velocity/recurrence as inputs the scorer and change-feed can read.

**Verify:** re-harvesting a post appends metric rows (not overwrite); velocity computable;
threads reconstruct; author profiles accumulate across runs.

---

## Step 3 — Structured memory: entity graph + topic dossiers (migrations)

**Goal:** memory as a queryable graph that compounds, not a flat list of reports.

### `api/db.ts` — real migrations
Replace the ad-hoc `PRAGMA table_info`+`ALTER` loop (db.ts:76–87) with **`PRAGMA user_version`**
steps; set **`PRAGMA busy_timeout`** (multi-process — Step 4). Existing tables = migration 1.

### Tables
- `topics(id, label UNIQUE, priority, relevance, last_ranked_at, created_at)` — seeded from
  `interest_topics`.
- `entities(id, kind /* person|org|ticker|product|place|topic */, name, aliases json,
  first_seen, last_seen, mention_count)` — seeded coarsely by the scorer (Step 1), refined by
  Claude.
- `mentions(entity_id FK, post_id FK NULL, report_id FK NULL, created_at)` — graph edges linking
  entities to their sources across time.
- `post_topics(post_id FK, topic_id FK)` — provenance link.
- `topic_dossiers(topic_id FK, state TEXT /* living synthesis */, updated_at, updated_by)` — the
  **compounding memory**: a living per-topic state Claude updates each loop. Reports are the
  change-log; the dossier is the current understanding.
- `reports(id, created_at, author DEFAULT 'claude', topic_id FK NULL, title, body, opinion,
  citations json /* [{kind:'post'|'url', ref, label}] */, model)` — long-form analyses; citations
  may be post ids **or** external URLs (Claude's web research).
- `insights(id, report_id FK NULL, topic_id FK NULL, status DEFAULT 'pending', title, body,
  rationale, source_refs json, created_at, approved_at, rejected_at, acted_at, action_result)`.
- `leads(id, note, topic_id FK NULL, created_at, consumed_at)` — Claude's breadcrumbs for its
  future self ("threads to pull next loop").
- `events(id, kind, post_id, topic_id, insight_id, entity_id, created_at)` — append-only, never
  pruned.

**Verify:** entity surfaces across multiple posts/time via `mentions`; a dossier round-trips and
updates in place; a report links to entities + a topic.

---

## Step 4 — Extensible capability layer via MCP (read · memory · hands · jobs)

**Goal:** expose pragyan to Claude Code as a *registry* of typed tools that can grow toward
capabilities beyond Claude's reach. No internal agent — Claude drives.

### Capability registry (`api/capabilities.ts`, new)
A registry where each capability = `{ name, kind: 'read'|'memory'|'actuator'|'job', schema,
handler }`. **Both the MCP tool list and the REST endpoints derive from it**, so adding a future
tool is one registry entry + a handler — not a rearchitecture. This is the seam for "more tools
beyond Claude's limits."

### `api/mcp.ts` (new) — stdio MCP server spawned by Claude Code
A **thin client over the REST API on 127.0.0.1:8787** (only the API process writes SQLite;
`busy_timeout` covers reads). Generated from the registry. Initial capabilities:

- **read/research** — `search_feed`, `recent_feed`, `search_summaries` (existing `runTool`),
  `get_signals` (markets/news/uptime via `getSnapshot`), `get_trending` (high-velocity /
  recurring posts from Step 2 — what's *moving*, not just what's recent).
- **memory** — `query_memory({entity?, topic?, author?, since?, kind?})` over the Step 2/3
  history, `get_dossier(topic)`, `get_reports`/`get_insights` (Claude reads its own prior output),
  and **`get_changes(since)`** — the structured diff of what's new/changed since the last loop
  (new entities, velocity spikes, topics heating up, flagged authors active). This change feed is
  the always-on payoff and lets Claude skip a deep pass when nothing moved.
- **hands** — `request_harvest({query?, profile?, thread_id?})`. Because pragyan persists and runs
  between loops, hands are **async jobs**: the tool returns a `job_id` into a new
  `jobs(id, kind, params, status, result, created_at, finished_at)` table; pragyan does the work
  (possibly over minutes, **while Claude is asleep**) and Claude polls `get_job(id)` next loop.
  v1 harvest = a targeted Google-News pull + topic flag; follow-on = the extension command channel
  (extension polls `/commands`) to drive the authenticated X session (expand thread / scrape
  profile). New actuators (other authenticated sessions, local access, notifications) register the
  same way.
- **write** — `submit_report`, `submit_insight`, `submit_lead`, `update_dossier`.

### `api/server.ts` — REST backing
`GET /signals|/trending|/changes|/dossier/:topic|/reports|/insights`, `GET /memory` (query),
`POST /reports|/insights|/leads|/harvest-request`, `GET /jobs/:id` (NaN-tolerant parsing;
validate bodies). `package.json`: `"mcp": "tsx api/mcp.ts"`; add `.mcp.json` + connect docs.

**Verify:** Claude lists the tools; `get_changes` reflects fresh velocity/entities;
`request_harvest` returns a job id that completes asynchronously; `submit_report`/`update_dossier`
persist and read back.

---

## Step 5 — Single-approval-then-act surface (human gate) + TUI

**Goal:** the one place a human enters the loop — Claude proposes, one approval acts.

- **`api/server.ts`** — `POST /insights/:id/approve` (flip status, stamp, append `approve` event,
  `action(insight)`); `/reject`.
- **`api/action.ts`** (new) — notify/log-only to start; never auto-acts; fails closed on bad
  output / unknown `source_refs`.
- **TUI** — add `insights` + `reports` to `TABS` (`TopBar.tsx:4`); `InsightsView.tsx` lists pending
  insights with cited posts/URLs + approve/reject keys (`App.tsx`, via new `tui/api.ts` helpers
  mirroring `postDismiss`); a dossier/report view renders Claude's living memory.

**Verify:** Claude's pending insight → TUI → approve runs notify-only action + event; reject works.

---

## Step 6 — Hardening (retrieval, durability, docs, tests)

- **Retrieval:** FTS5 over `posts` **and** `reports/insights/topic_dossiers` (Claude searches its
  own memory); index `created_at`, `post_metrics(post_id, observed_at)`.
- **Durability = preserve the moat:** tiered retention, **not** blanket pruning. Prune only raw
  firehose noise (dropped / never-promoted / low-engagement); **preserve the longitudinal record
  for KB-linked posts, entities, dossiers, and metric history.** Compact old `post_metrics` rather
  than delete; VACUUM only the noise. Losing history destroys the moat.
- **Ranking:** extract `compositeScoreSql(weights)` (reuse db.ts:301 + 375), add recency decay +
  velocity term, normalize, bind/validate weights.
- **Multi-process:** confirm `busy_timeout` + WAL handle the API-writer / MCP-reader split; MCP
  opens no second write handle.
- **Config/docs:** validate `config.json` at load; apply/remove dead `gates.*`; rewrite PRD for
  the two-tier model + moat framing; sync `.env`/`.env.example`.
- **Tests:** `node:test` over in-memory sqlite — prefilter, `queryFeed` ordering + `min_score`,
  metric-history append + velocity, budget windows, `scoreBatchSafe` fallback, entity/mention
  linking, report/dossier round-trip, `get_changes` diff.

---

## Step 7 — Additional authenticated sources (only after the loop is proven on X)

**Goal:** widen the sensor once depth is proven — each new authenticated stream is fresh moat
(data Claude can't reach), and cross-source correlation (a topic moving on X *and* LinkedIn *and*
Reddit at once) is signal no single-source tool has.

**Gate:** do not start until the full loop (capture → score → memory → Claude report → one good
insight) works end-to-end on X. Adding sources earlier multiplies firehose + scraper fragility
against a pipeline that can't yet use what it has.

**Prioritize by Claude-inaccessibility** (the moat metric — how unreachable the source is to
Claude's own web tools):
1. **LinkedIn — highest moat.** Hard login wall, professional/economic signal (directly serves
   "how to capitalize"), genuinely unreachable by Claude. **Highest account/ToS risk** — it
   aggressively detects scrapers; throttle hard, harvest passively (no automated actions), accept
   it may break often. Worth it for the signal, but treat as the careful step.
2. **Reddit — lowest moat of the three; optional/last.** Content is largely public, so Claude can
   already reach a subreddit via web/API; only your *personalized* home feed is authenticated, so
   it adds the least unique data. Consider its public API over DOM scraping if added.

**Build:** each source = one `HarvestAdapter` (Step 2 seam) + per-source extension selectors +
its `PostSource` union member. Everything downstream (prefilter, scorer, velocity, memory, MCP,
Claude) is already source-blind, so a new source lights up the whole pipeline for free. Add a
`source` facet to `query_memory`/`get_changes` so Claude can ask cross-source questions.

---

## Files

- **New:** `api/budget.ts`, `api/scorer.ts`, `api/capabilities.ts`, `api/mcp.ts`, `api/action.ts`,
  `tui/InsightsView.tsx`, `.mcp.json`, a `node:test` suite.
- **Edit:** `api/llm.ts`, `api/server.ts`, `api/db.ts`, `api/news.ts`, `api/tools.ts`,
  `api/summaryGenerator.ts`, `api/config.json`, `api/config.ts`, `package.json`,
  `extension/content.js`, `extension/selectors.js`, `tui/api.ts`, `tui/TopBar.tsx`, `tui/App.tsx`,
  `.env`, `.env.example`, `docs/PRD.md`.
- **Reused:** `api/dummyScorer.ts` (fallback), `shared/post.ts` (`Scores`), the
  `idx_posts_scoring` queue, `markets.ts` `getSnapshot`, the `summaries` coerce pattern.
- **Not built:** an internal Cerebras agent (the loop is Claude's).

## Risks

- **Eroding the moat by pruning** — the longitudinal record IS the value; Step 6 retention must
  preserve KB-linked history and metric trajectories, never blanket-VACUUM.
- **Capture brittleness** — the authenticated harvester is the single point of failure; ship the
  heartbeat (Step 2) so silent zero-yield is caught.
- **Two-process SQLite writes** — route MCP through the REST API (single writer) + `busy_timeout`;
  no second write handle from `api/mcp.ts`.
- **Cerebras drifting into cognition** — keep the scorer coarse and the digest a heads-up; deep
  analysis is Claude's. Over-investing here rebuilds a worse brain.
- **Acting on the world** — `action()` notify-only + per-insight approval until trust is earned;
  fail closed.
- **Provenance integrity** — reports/insights/dossiers must carry real `source_refs` (post ids +
  URLs) or "learn more" degrades to ungrounded text.
- **Loop deadlock** — Step 0's client timeout lands before anything runs on intervals.
- **Doc drift** — fix PRD (Step 6) so the build isn't misdirected by the never-built phase 5.
```
