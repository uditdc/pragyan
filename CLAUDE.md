# pragyan

A personal knowledge engine with a **two-tier intelligence model**:

- **You (Claude) are the external brain.** You run the agentic loop: pull context from
  pragyan, research and analyze (your own web research + pragyan's tools), and submit
  **reports** and **insights** back. You reach pragyan through its **MCP server** (tools are
  named `mcp__pragyan__<tool>`). Insights you submit wait for a **single human approval** —
  you never act on the world directly.
- **pragyan is the eyes, ears, hands & memory.** It harvests the user's authenticated X
  timeline + Google News, keeps a heuristic baseline rank on the feed, records longitudinal
  history (engagement velocity, recurrence, author track-record), and stores your day
  reports and insights as durable, queryable memory. Run `npm start` and it serves everything
  on `127.0.0.1:8787`.

**Design rule:** invest in pragyan's *access, continuity, and memory* — never build cognition
into pragyan. **pragyan makes zero LLM calls**: all intelligence runs as Claude Code skills
over MCP, and feed ranking inside pragyan is a plain heuristic (`api/dummyScorer.ts`). Full
design: `docs/plans/phase6.md`.

## Run

| Command | What |
|---------|------|
| `npm start` | API + harvest + heuristic scorer (binds `127.0.0.1:8787`). **Required for the MCP server.** |
| `npm run tui` | Terminal reader; the **insights** tab is where the human approves (`a`) / rejects (`x`). |
| `npm run typecheck` | `tsc --noEmit` — the gate before any commit. |
| `npm run test:api` / `npm run test:ext` | Unit tests (in-memory sqlite) / extension tests. |

The MCP server (`api/mcp.ts`) is registered in `.mcp.json`; Claude Code spawns it and it
proxies to the running API — so **`npm start` must be running** for the tools to work.

## Run the workflow

One skill, one pass per invocation, driven by Claude Code schedules/triggers
(`/loop`, or a cron/routine pinned to **sonnet**):

- **`/pragyan-tick`** — every tick maintains the living day report: pull posts since the
  report's last update, fold in what's new/interesting, rewrite the day's markdown
  (`submit_report` → `.kb/daily/YYYY-MM-DD.md`, rendered on the dashboard; ←/→ walks past
  days). Each day's final revision *is* the daily report. When a topic is running hot, the
  same tick goes deep: dossiers, approval-gated insights, leads. Cadence:
  `/loop 30m /pragyan-tick`.

The skill is its own playbook — read it before iterating.

For unattended runs, **`scripts/claude-loop.sh`** wraps headless passes (`claude -p "/<skill>"`)
with a pidfile: `start [skill] [minutes]` / `stop` / `status` / `once` / `logs`. State lives in
`.claude/run/` (gitignored). Headless passes need the pragyan MCP tools pre-allowed in
`.claude/settings.json` (`"permissions": { "allow": ["mcp__pragyan", "WebSearch", "WebFetch"] }`).

## Conventions

- Self-documenting code; no comments that restate what the code does.
- One concern per file in `api/`.
- **Storage split:** the SQLite DB (`api/db.ts`) holds scraped / pre-processed **bulk** —
  posts, metrics, entities, topics, events. Your **prose artifacts** (day reports, insights,
  dossiers, leads) are Markdown files under `.kb/` (`api/kbstore.ts`) that pragyan
  indexes and serves via tooling — they never live in the DB.
- Every insight/report must carry real provenance (`source_refs` / `citations` = post ids or
  URLs) — insight approval and `submit_report` both **fail closed** when ungrounded.
