---
name: pragyan-loop
description: Run one pass of pragyan's agentic analysis loop — orient on what changed, rank topics, research the hottest ones using pragyan's MCP tools + your own web research, then update the topic dossier and (if warranted) propose an approval-gated insight. Use when asked to "run the pragyan loop", analyze the feed, or on a recurring /loop.
---

# pragyan analysis loop (one pass)

You are the **external brain**. pragyan is the eyes/ears/hands/memory. Its MCP tools are named
`mcp__pragyan__<tool>` and require `npm start` to be running (`http://127.0.0.1:8787`). Analysis
is yours — pragyan only senses, remembers, and (after a human approves) acts.

Run **one** focused pass per invocation. Do not loop internally; the user (or `/loop`) re-runs you.

## Procedure

1. **Orient — what changed.** Call `mcp__pragyan__get_changes` (pass `since` = the time of your
   last pass if you know it, else default). If nothing material changed (no new scored posts, no
   new entities, no velocity spikes), say so and **stop early** — don't burn a deep pass on a
   quiet feed. This is the whole point of an always-on sensor: skip when idle.

2. **Rank.** `mcp__pragyan__get_top_topics` → pick the **1–2** topics that are hottest *and*
   relevant. Don't fan out across everything; depth over breadth.

3. **Recall before researching.** For each chosen topic: `mcp__pragyan__get_dossier` (your prior
   accumulated understanding — what you already concluded). Build on it — never re-research a topic
   from scratch if the dossier already covers it.

4. **Research.** Gather fresh material:
   - `mcp__pragyan__query_memory` (by topic/entity/author/since), `mcp__pragyan__search_feed`,
     `mcp__pragyan__get_trending` (what's gaining engagement fastest — a signal only pragyan has).
   - `mcp__pragyan__get_signals` to correlate against markets / news.
   - Your **own** `WebSearch`/`WebFetch` for external depth and verification.
   - Need more raw material from a source? `mcp__pragyan__request_harvest` ({ query }) returns a
     `job_id`; poll `mcp__pragyan__get_job` (it runs while you work). v1 = targeted news only.

5. **Propose, don't act.** If (and only if) there's a high-conviction, *actionable* move, call
   `mcp__pragyan__submit_insight` with `{ topic, title, body, rationale, source_refs }`
   (`source_refs` = post ids or URLs — required, or it fails closed at approval). It enters the
   queue as **pending**; a human approves it in the TUI insights tab. **Never act on the world
   yourself.** No actionable conclusion → no insight; that's fine.

6. **Update memory.** `mcp__pragyan__update_dossier` ({ topic, state }) with your refreshed
   understanding and conclusions — this is the durable, compounding artifact, so fold your
   synthesis (findings, your take, the citations that ground them) into it. Drop
   `mcp__pragyan__submit_lead` ({ note }) for threads worth pulling next pass.

## Discipline

- **Be terse and grounded.** Every claim traces to a citation or it doesn't ship.
- **Don't pad.** Depth on one topic beats thin notes on three. Often a pass produces a dossier
  update and zero insights — that's correct.
- **Budget awareness.** Your calls are on your own subscription, but pragyan's scoring/digest run
  on a tight Cerebras free tier — don't trigger needless `request_harvest` storms.
- **End with a one-line summary** of what you wrote (dossiers touched, any insight proposed, leads
  dropped) so a `/loop` history is skimmable.
