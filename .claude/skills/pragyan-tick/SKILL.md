---
name: pragyan-tick
description: Run one tick of pragyan's workflow — pull what arrived since the last pass, fold what's genuinely new into the living day report, and when (and only when) a topic is running hot, go deep on it — research, update its dossier, and propose an approval-gated insight. Use when asked to "run pragyan", "review the feed", "run the loop", "update the day report", or on a recurring /loop or schedule.
---

# pragyan tick (one pass)

You are the **external brain**. pragyan is the eyes/ears/hands/memory: its MCP tools are named
`mcp__pragyan__<tool>` and require `npm start` to be running (`http://127.0.0.1:8787`). Analysis
is yours — pragyan only senses, remembers, and (after a human approves) acts.

One tick has two products, at different cadences:

- **Every tick:** the **living day report** — one markdown document per day (`.kb/daily/`)
  rewritten as the day unfolds. The day's final revision *is* the daily record; the dashboard
  always shows the latest revision.
- **Only when warranted:** a **deep pass** on 1–2 hot topics — dossier updates, and (rarely)
  an approval-gated insight. Most ticks skip this; that's correct, not lazy.

Run **one** tick per invocation. Do not loop internally; the user (or `/loop` / a schedule)
re-runs you.

## Procedure

1. **Orient.** `mcp__pragyan__get_report` ({}) → today's report, if any: its `markdown` is the
   document you'll be revising and `window_end` is the high-water mark of posts already covered.
   This tick's **cutoff** is whichever is more recent: `window_end` or today 00:00 (local) —
   the delta never reaches back into a previous day. (First tick of the day: no report yet, so
   cutoff = today 00:00 and you're starting today's document; `mcp__pragyan__list_reports` shows
   recent days for continuity.) Then `mcp__pragyan__get_changes` ({ since: cutoff }). If nothing
   meaningful is new, say so and **stop — no rewrite, no deep pass**. This is the whole point of
   an always-on sensor: skip when idle.

2. **Pull the delta.** `mcp__pragyan__recent_feed` / `mcp__pragyan__search_feed` for posts since
   the cutoff (x + news, up to ~200). `mcp__pragyan__get_trending` shows what's accelerating
   right now.

3. **Upsert into the day report.** Decide what from the delta is *genuinely new and
   interesting* for the reader — new information over rehash, consequence over engagement bait —
   and merge it into the existing document. The document takes up to ~23 hourly revisions a day,
   so every pass is an upsert, not a rewrite from scratch:
   - Each worthy item is **one bullet** under its section. New development on an existing story →
     rewrite that bullet in place; genuinely new item → add a bullet; new theme → new section.
   - Re-rank sections so the day's biggest story leads; within a section, order bullets by
     significance. Faded items simply sink — a bullet is already its compressed form.
   - Merge related bullets when a story consolidates. Never add a bullet that restates one
     already there.

   Then submit the full revised document:
   - `tldr`: 2–3 sentences — the shape of the *whole day so far*, not just this window.
   - `markdown`: 2–6 sections ordered by importance, each `## KICKER — headline` (KICKER is one
     uppercase word: MACRO, INCIDENT, DEV, MARKET, SCIENCE, …). Section bodies are **bullets
     only** — each bullet 1–2 self-contained sentences, citing inline only handles/outlets
     present in pragyan's posts (`@handle`, outlet name). No prose paragraphs, no `## VOICES`,
     no `## EARLIER`.

   Submit via `mcp__pragyan__submit_report` with `{ tldr, markdown, source_refs }` —
   `source_refs` = post ids for everything newly cited (required; fails closed if ungrounded).
   pragyan bumps the revision, unions provenance, and advances `window_end` itself.

4. **Decide whether to go deep.** `mcp__pragyan__get_top_topics` + what you just saw in the
   delta. Go deep only if a topic clearly earns it: a velocity spike, a pending lead pointing at
   it, or a top topic whose dossier is stale or silent on today's development. Pick **1–2 topics
   at most** — depth over breadth. Nothing earns it → skip to step 6.

5. **Deep pass (per chosen topic).**
   - **Recall first:** `mcp__pragyan__list_dossiers` — the dossiers that already exist. If the
     story has one under *any* name, use that exact topic string from here on; a near-duplicate
     name ("Iran-Hormuz" vs "Iran-Hormuz crisis") forks the memory into two files. Then
     `mcp__pragyan__get_dossier` — your prior accumulated understanding. Build on it; never
     re-research a topic from scratch if the dossier already covers it.
   - **Research:** `mcp__pragyan__query_memory` (by topic/entity/author/since),
     `mcp__pragyan__search_feed`, `mcp__pragyan__get_signals` to correlate against markets/news,
     and your **own** `WebSearch`/`WebFetch` for external depth and verification. Need more raw
     material? `mcp__pragyan__request_harvest` ({ query }) returns a `job_id`; poll
     `mcp__pragyan__get_job` (it runs while you work). v1 = targeted news only.
   - **Propose, don't act.** If (and only if) there's a high-conviction, *actionable* move,
     first check `mcp__pragyan__get_insights` ({ status: "pending" }) — a pending insight on the
     same story means you **revise it** (call `mcp__pragyan__submit_insight` with its `id`: new
     content replaces old, provenance unions) rather than filing a duplicate for the human to
     wade through. Otherwise call `mcp__pragyan__submit_insight` with
     `{ topic, title, body, rationale, source_refs }` (`source_refs` = post ids or URLs —
     required, or it fails closed at approval). It enters the queue as **pending**; a human
     approves it in the TUI insights tab. **Never act on the world yourself.** No actionable
     conclusion → no insight; that's fine.
   - **Update memory:** `mcp__pragyan__update_dossier` ({ topic, state }) with your refreshed
     understanding — this is the durable, compounding artifact, so fold your synthesis (findings,
     your take, the citations that ground them) into it. The response says `created: true` when
     it made a brand-new file — if you meant to update an existing dossier, you picked the wrong
     topic string; recheck `list_dossiers` and fix it now, not next tick.

6. **Leave breadcrumbs.** A thread that deserves a deep pass next tick →
   `mcp__pragyan__submit_lead` ({ note, topic }). Check pending leads when deciding step 4.

## Discipline

- **Terse and grounded.** Every claim and section traces to cited posts or URLs; cite only
  what's in the input. Ungrounded submissions fail closed — that's by design.
- **The document converges.** Each upsert should make the day *clearer*, not longer — bullets
  get rewritten and merged as stories develop, so a reader returning after 8 hours reads one
  coherent bullet list per section, not a changelog.
- **Quiet tick → no output.** An untouched document beats a padded one; a skipped deep pass
  beats a thin dossier note.
- **Don't pad the deep pass.** Depth on one topic beats thin notes on three. A tick that
  produces a report revision and zero insights is the normal case.
- **End with a one-line summary** — rev N submitted (or "quiet window"), dossiers touched, any
  insight proposed, leads dropped — so a `/loop` history is skimmable.
