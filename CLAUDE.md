# pragyan

A personal knowledge engine with a **two-tier intelligence model**:

- **You (Claude) are the external brain.** You run the agentic loop: pull context from
  pragyan, research and analyze (your own web research + pragyan's tools), and submit
  **reports** and **insights** back. You reach pragyan through its **MCP server** (tools are
  named `mcp__pragyan__<tool>`). Insights you submit wait for a **single human approval** —
  you never act on the world directly.
- **pragyan is the eyes, ears, hands & memory.** It harvests the user's authenticated X
  timeline + Google News, scores relevance cheaply, records longitudinal history (engagement
  velocity, recurrence, author track-record), and stores your reports/insights as durable,
  queryable memory. Run `npm start` and it serves everything on `127.0.0.1:8787`.

**Design rule:** invest in pragyan's *access, continuity, and memory* — never build cognition
into pragyan. Analysis is yours. The cheap Cerebras tier (scoring + digest) is deliberately
dumb triage; don't make it "smarter." Full design: `docs/plans/phase6.md`.

## Run

| Command | What |
|---------|------|
| `npm start` | API + scorer + rolling digest (binds `127.0.0.1:8787`). **Required for the MCP server.** |
| `npm run tui` | Terminal reader; the **insights** tab is where the human approves (`a`) / rejects (`x`). |
| `npm run typecheck` | `tsc --noEmit` — the gate before any commit. |
| `npm run test:api` / `npm run test:ext` | Unit tests (in-memory sqlite) / extension tests. |

The MCP server (`api/mcp.ts`) is registered in `.mcp.json`; Claude Code spawns it and it
proxies to the running API — so **`npm start` must be running** for the tools to work.

## Run the loop

Start the agentic analysis with the **`/pragyan-loop`** skill (one pass), or drive it on an
interval: `/loop 30m /pragyan-loop`. The skill is the playbook — read it before iterating.

## Conventions

- Self-documenting code; no comments that restate what the code does.
- One concern per file in `api/`; LLM calls go through `api/budget.ts` (`callLLM`) so the
  shared Cerebras free-tier budget is never exceeded.
- **Storage split:** the SQLite DB (`api/db.ts`) holds scraped / pre-processed **bulk** —
  posts, metrics, entities, topics, events. Your **prose artifacts** (reports, insights,
  dossiers, leads) are Markdown files under `.kb/` (`api/kbstore.ts`) that pragyan
  indexes and serves via tooling — they never live in the DB.
- Every insight/report must carry real provenance (`source_refs` / `citations` = post ids or
  URLs) — the approval action **fails closed** on ungrounded insights.
