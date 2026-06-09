---
description: Run a directive (DIR-NNN) through its lifecycle — assessment → work → review loop → done — spawning real Claude Code sessions on the directive's git worktree and updating its status. Use when the user wants to start/run/execute/work a directive, or pick up the next pending one.
---

# Run a directive

You are the **orchestrator** for one directive. You drive it through its phases by
spawning real `claude` sessions on its git worktree and writing status back to the
directive `.md` (the single source of truth). The full design is in
`.agents/run-loop.md` — follow it; this skill is its operational checklist.

Argument: a `DIR-NNN` code. If none is given, pick the oldest directive with
`state: pending`.

## 0 · Resolve & claim (phase-aware lock)

The frontmatter `state` + `phase` are the lock. `phase` is the current sub-state of
an `active` directive: `assessment` → `work` → `review` (blank when idle/pending/done).
A phase is in progress iff `state: active` and `phase` names it.

1. Read `.agents/directives/DIR-NNN-*.md`: `state`, `phase`, `step`, `objectives`,
   `## Plan`, `## Verification`, `branch`, and the `## Steering` list.
2. **Decide what to do — never duplicate a phase:**
   - `state: done` → nothing to do; report.
   - `state: active`, `phase` set → a session already owns this phase. **Do not start
     it (or any earlier phase) again.** Specifically: if `phase: assessment`, don't
     start another assessment; if `phase: work`, don't start assessment or a second
     work; if `phase: review`, don't restart work. Report "already at <phase>" and
     stop — *unless* the owning session has clearly died (its worktree session has
     been idle well past `ACTIVE_MS` with the phase incomplete), in which case treat
     it as a **resume** and continue that same phase.
   - `state: pending` (or a resume per above) → **claim it**: set `state: active`,
     `phase: assessment`, `session: @run`, `step: 0` in the frontmatter **before**
     spawning anything. That write is the lock a second runner will see.

Advance `phase` only when a phase finishes (§3), so the field always reflects exactly
what is running. One orchestrator owns a directive at a time; the phase sessions it
spawns run in sequence, so there is never duplicate assessment/work within a run, and
a second runner is bounced by the lock above.

## 1 · Worktree

Create a dedicated worktree on the directive's branch (outside the main checkout):

```bash
git worktree add ../.worktrees/DIR-NNN dir/DIR-NNN-<slug>   # add -b if the branch is new
```

All phase sessions run with `cwd` = this worktree. Discovery scans worktree paths,
so their transcripts are matched back to the directive by code (`api/projects.ts`).

## 2 · Spawning a phase session

Each phase is one spawned, non-interactive `claude` run. **The prompt must open with
`[<phase>] DIR-NNN`** so the session is discoverable (and phase-labelable) under the
directive. Run it from the worktree:

```bash
( cd ../.worktrees/DIR-NNN && claude -p "[<phase>] DIR-NNN — <role + instructions>. \
  Directive: .agents/directives/DIR-NNN-<slug>.md (read objectives, ## Plan, ## Verification, ## Steering)." \
  --permission-mode auto )
```

`--permission-mode auto` ("auto mode on") auto-approves all tool use — edits and Bash
(git/gh/npm) alike, with a background safety classifier — so phase sessions run
unattended without an allow-list. Capture stdout to decide the next step. Read-only
phases (assessment, review) may use `--permission-mode plan` instead.

## 3 · Phases

Set `phase` as each one starts (it is the lock §0 checks) and advance it only when the
phase finishes — so the field always reflects exactly what is running. Every phase
session is told to **re-read `## Steering` on each loop and fold in new steers** (see
"Live steering" below), so a steer added mid-flight is absorbed by the running session,
never by a duplicate.

1. **Assessment** (`phase: assessment`) — spawn a session to review the directive +
   `## Plan` against the codebase and list issues/risks/ambiguities. If it finds a
   *blocking* problem, append a `[pending]` steer and pause — report to the user rather
   than guess. Otherwise set `phase: work` and continue.

2. **Work** (`phase: work`) — spawn a session to implement the objectives on the
   worktree: make the changes, satisfy `## Verification`, commit, push the branch, and
   open a PR via `gh pr create` (title and body must contain `DIR-NNN`). Update `step`
   as objectives complete. When the PR is open, set `phase: review`.

3. **Review loop** (`phase: review`) — repeat until clean (cap at ~5 iterations):
   - Spawn a review session: review the PR for correctness/quality, emitting findings
     tagged by severity (**critical / high / medium / low**).
   - If any **critical or high** remain → spawn a fix session (still `phase: review`) to
     address them, push, and re-review. Otherwise exit the loop. Defer medium/low as
     steers or a follow-up directive (note them; don't block on them).

## Live steering (pick up steers during a phase)

A new `[pending]` steer can land while a phase runs. Do **not** start a separate session
for it — the in-flight phase absorbs it. Each assessment/work/review prompt must include:

> Before finishing, re-read the directive's `## Steering` section. For every `[pending]`
> steer, fold it into your current work, then rewrite it as `[addressed]` with a
> `↳ <note>`. New steers may arrive while you run, so check again at the end of each
> iteration; only finish once no `[pending]` steer remains.

If a steer lands after a phase has fully ended (no session running), the next phase
picks it up; if every phase is already `done`, the orchestrator starts a short work
session to handle it.

## 4 · Done

When the review loop clears the threshold:

1. Set `state: done`, clear `phase:`, and set `commits: <merged SHA / PR ref>`.
2. Ensure every steer is `[addressed]` (or explicitly deferred with a note).
3. Remove the worktree: `git worktree remove ../.worktrees/DIR-NNN`.
4. Report: the PR link, what shipped, and any deferred items.

## Status ownership (write to the `.md`)

| transition | when |
|---|---|
| `state: active`, `phase: assessment`, `session`, `step: 0` | at claim |
| `phase: work` | assessment finished |
| `step` | as objectives complete (work) |
| `phase: review` | PR opened |
| `[pending]` → `[addressed]` + `↳ note` | a steer is satisfied (any phase, each loop) |
| `state: done`, `phase:` blank, `commits` | review loop clears critical/high |

## Guardrails

- One orchestrator per directive — the `state: active` + `phase` claim is the lock; a
  second runner never restarts a phase that's already in progress (§0).
- A phase that stalls or hits a blocking decision → record a `[pending]` steer, leave
  `state: active` at its current `phase`, and hand back to the user. Don't force progress.
- Keep the worktree isolated; do not commit on `main`. The PR is the integration point.
