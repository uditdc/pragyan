# Plan: Phase 5 — real LLM scoring (OpenAI-compatible, async background queue)

## Context

Today the API "scores" posts with `dummyScore()` (engagement heuristic) **synchronously at
ingest** — `api/server.ts:44` calls it and stamps `scored_at` immediately, so there is no
work queue. Phase 5 replaces this with the design the PRD always intended (§4, Stage 2):
ingest only prefilters, and a **background loop** drains the
`kept=1 AND scored_at IS NULL` queue in batches through an LLM, persisting real
relevance / importance / clickbait / is_news scores.

Per the user's decisions, scoring uses an **OpenAI-compatible SDK** (the `openai` package
pointed at any OpenAI-compatible endpoint), with **model, base URL, and API key all read
from env vars** — not hardcoded to Claude. When scoring is unavailable (no key configured,
or an LLM batch errors), it **falls back to the existing heuristic** `dummyScore` so the
feed is never empty.

Everything downstream is already in place and needs no change: the `s_*`/`scored_at`
columns, the `idx_posts_scoring(kept, scored_at)` index, the query-time composite score and
`scored_at IS NULL` sort in `queryFeed`, and the `scoring` config block (`batch_size`,
`max_concurrent_batches`, `poll_interval_ms`).

## Approach

### 1. Dependency + env wiring
- Add `openai` to `package.json` dependencies. Initialize once in the scorer:
  `new OpenAI({ baseURL: process.env.XFEED_LLM_BASE_URL, apiKey: process.env.XFEED_LLM_API_KEY })`.
- Env vars (read in `api/scorer.ts`):
  - `XFEED_LLM_BASE_URL` — OpenAI-compatible base (e.g. `https://api.openai.com/v1`,
    `https://openrouter.ai/api/v1`, `http://localhost:11434/v1`).
  - `XFEED_LLM_API_KEY` — key.
  - `XFEED_LLM_MODEL` — model id; falls back to `config.scoring.model` if unset.
- A module-level `llmEnabled = Boolean(base URL && api key)`. If false, the loop logs a
  one-line warning and uses heuristic fallback (feed still fills).
- Load env via Node's native `--env-file-if-exists=.env` in the npm `dev`/`start`/`seed`
  scripts (Node ≥20.12, no new dep; tsx forwards node flags). Add a documented
  **`.env.example`**. (Fallback if the flag isn't honored: `import "dotenv/config"`.)

### 2. New file — `api/scorer.ts`
- `scoreBatch(posts: Post[]): Promise<Map<string, Scores>>`
  - System prompt: JSON-only ranking instruction + injected `config.interest_topics`,
    matching the PRD §4 contract (relevance / importance / clickbait / is_news /
    news_confidence, each `0..1`, is_news boolean).
  - User message: compact JSON array of `{ id, author_handle, text, is_repost }` per post
    (keep tokens low).
  - `client.chat.completions.create({ model, temperature: 0, response_format: { type: "json_object" }, messages })`,
    expecting `{ "scores": [{ id, ... }] }`.
  - Parse defensively: clamp each number to `0..1`, coerce `is_news`; any post id missing
    from the response is filled by heuristic fallback. Throws only on total failure
    (network / unparseable) so the caller can fall back for the whole batch.
- `scoreBatchSafe(posts)` — wraps `scoreBatch`; on throw (or when `!llmEnabled`) returns a
  heuristic map built from `dummyScore(post, post.clickbait_heuristic)`. Then writes results
  via `updatePostScores`, stamping `scored_at = now`.
- `startScorer()` — `setInterval(tick, config.scoring.poll_interval_ms)` with a `running`
  re-entrancy guard so slow batches don't overlap. Each `tick`:
  - `getUnscoredPosts(batch_size * max_concurrent_batches)`; if empty, return.
  - Chunk into `batch_size` groups and `Promise.all` them (the fetch size caps concurrency
    at `max_concurrent_batches`).
- Reuses the existing `api/dummyScorer.ts` (kept as the fallback scorer).

### 3. `api/db.ts` — two new exports
- `getUnscoredPosts(limit): Post[]` — `SELECT * FROM posts WHERE kept = 1 AND scored_at IS
  NULL ORDER BY harvested_at DESC LIMIT ?`, mapped through the existing `rowToPost`.
- `updatePostScores(updates: { id; scores: Scores; scored_at: string }[]): void` — prepared
  `UPDATE posts SET s_relevance=@r, s_importance=@i, s_clickbait=@c, s_is_news=@n,
  s_news_confidence=@nc, scored_at=@scored_at WHERE id=@id AND scored_at IS NULL`, run inside
  a `db.transaction` (mirrors the `runOverIds` pattern). The `scored_at IS NULL` guard
  enforces "never re-score".

### 4. `api/server.ts` — invert ingest + start the loop
- Ingest (lines 44–53): **stop scoring synchronously.** Kept posts now enter the queue —
  pass `scores: null, scored_at: null` to `upsertPost`. Drop the `dummyScore` import here
  (it now lives behind the scorer's fallback).
- Add `import { startScorer } from "./scorer.ts";` and call `startScorer();` next to the
  existing `startMarkets();` (before `app.listen`).

### 5. `api/config.json` (minor)
- Change the `scoring.model` default from `claude-haiku-4-5` to a neutral placeholder
  (e.g. `gpt-4o-mini`) since the endpoint is now OpenAI-compatible; the real value is
  expected via `XFEED_LLM_MODEL`. `config.ts` needs no type change.

### 6. Docs — `PRD.md`
- §4 Stage 2: scoring is async/background via an OpenAI-compatible client; model/base/key
  from env; heuristic fallback; ingest no longer scores synchronously.
- §6 config: document the three `XFEED_LLM_*` env vars and that `scoring.model` is only a
  default overridden by `XFEED_LLM_MODEL`.

## Files
- **New:** `api/scorer.ts`, `.env.example`
- **Edit:** `api/server.ts`, `api/db.ts`, `package.json`, `api/config.json`, `PRD.md`
- **Reused as-is:** `api/dummyScorer.ts` (fallback), `shared/post.ts` (`Scores` contract),
  the `s_*`/`scored_at` schema + `idx_posts_scoring` index.

## Verification
1. `npm install` (pulls `openai`); `npm run typecheck` clean; `npm run test:ext` still green
   (extension untouched).
2. **No key (heuristic fallback):** with `XFEED_LLM_*` unset, `npm start` (logs the
   "LLM disabled — using heuristic fallback" warning), `npm run seed`, then within one
   `poll_interval_ms` confirm seeded posts get `scored_at` set and `GET /feed?min_score=0.2`
   returns ranked posts. Feed is never empty.
3. **Live LLM:** set `XFEED_LLM_BASE_URL` / `XFEED_LLM_API_KEY` / `XFEED_LLM_MODEL` in
   `.env`, restart, seed fresh posts (`scored_at` NULL), and watch the loop populate real
   scores. Spot-check that values are plausible (e.g. clickbaity seed posts get high
   `clickbait`, off-topic ones low `relevance`) and differ from the heuristic.
4. **Never re-score:** note a post's `scored_at`, force another tick, confirm it is unchanged
   (the `scored_at IS NULL` guard skips already-scored rows).
5. **Batch error fallback:** point the base URL at an unreachable host; confirm the loop
   logs the error, falls back to heuristic for that batch, and still stamps `scored_at`
   (no infinite re-queueing).
