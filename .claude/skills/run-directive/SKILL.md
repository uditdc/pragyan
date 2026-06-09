---
description: Run a directive (DIR-NNN) through its lifecycle — assessment → work → review loop → done — spawning Task subagents on the directive's git worktree and updating its status. Use when the user wants to start/run/execute/work a directive, or pick up the next pending one.
---

# Run a directive

You are the **orchestrator** (the "claiming session") for one directive. You drive it
through its phases by spawning **`Task` subagents** that operate on its git worktree, and
you write status back to the directive `.md` (the single source of truth). The TUI shows
you and your phase subagents under the directive. The full design is in
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
   - `state: active`, `phase` set → an orchestrator already owns this phase. **Do not
     start it (or any earlier phase) again.** Specifically: if `phase: assessment`,
     don't start another assessment; if `phase: work`, don't start assessment or a
     second work; if `phase: review`, don't restart work. Report "already at <phase>"
     and stop — *unless* the owner has clearly died (its phase subagent idle well past
     `ACTIVE_MS` with the phase incomplete), in which case treat it as a **resume** and
     continue that same phase.
   - `state: pending` (or a resume per above) → **claim it**: set `state: active`,
     `phase: assessment`, `session: @run`, `step: 0` in the frontmatter **before**
     spawning anything. That write is the lock a second runner will see.

Advance `phase` only when a phase finishes (§3), so the field always reflects exactly
what is running. One orchestrator owns a directive at a time; the phase subagents it
spawns run in sequence, so there is never duplicate assessment/work within a run, and
a second runner is bounced by the lock above.

## 1 · Worktree

Create a dedicated worktree on the directive's branch (outside the main checkout):

```bash
git worktree add ../.worktrees/DIR-NNN dir/DIR-NNN-<slug>   # add -b if the branch is new
```

You (the orchestrator) are the **claiming session**. Every phase subagent below
operates inside this worktree (edits, build, commit, push, PR all target it) so the
git work stays isolated on the directive's branch.

## 2 · Spawning a phase as a subagent

Each phase is one **`Task` subagent** you spawn — not a separate `claude` process.
**The subagent's `description` must be `[<phase>] DIR-NNN — <short summary>`.** That tag
is how the TUI finds this run: discovery reads each subagent's meta and lists it (with
its phase) under the directive, beneath you, the claiming session. So:

- `description`: `"[work] DIR-NNN — implement objectives 2–3"`
- `prompt`: the role + instructions, the **absolute worktree path** to operate in, a
  pointer to `.agents/directives/DIR-NNN-<slug>.md` (read objectives, `## Plan`,
  `## Verification`, `## Steering`), and the live-steering instruction below.

One phase subagent runs at a time; you advance `phase` between them, so there is never
duplicate assessment/work. Read each subagent's result to decide the next step.

## 3 · Phases

Set `phase` as each subagent starts (it is the lock §0 checks) and advance it only when
the phase finishes — so the field always reflects exactly what is running. Every phase
subagent is told to **re-read `## Steering` on each loop and fold in new steers** (see
"Live steering" below), so a steer added mid-flight is absorbed by the running subagent,
never by a duplicate.

1. **Assessment** (`phase: assessment`) — a subagent (`description: "[assessment]
   DIR-NNN — …"`) reviews the directive + `## Plan` against the codebase and lists
   issues/risks/ambiguities. If it finds a *blocking* problem, append a `[pending]`
   steer and pause — report to the user rather than guess. Otherwise set `phase: work`.

2. **Work** (`phase: work`) — a subagent (`description: "[work] DIR-NNN — …"`) implements
   the objectives **in the worktree**: makes the changes, satisfies `## Verification`,
   commits, pushes the branch, and opens a PR via `gh pr create` (title and body contain
   `DIR-NNN`). Update `step` as objectives complete. When the PR is open, set
   `phase: review`.

3. **Review loop** (`phase: review`) — repeat until clean (cap at ~5 iterations):
   - A review subagent (`description: "[review] DIR-NNN — …"`) reviews the PR for
     correctness/quality, emitting findings tagged by severity (**critical / high /
     medium / low**).
   - If any **critical or high** remain → spawn a fix subagent (still `phase: review`,
     `description: "[review] DIR-NNN — fix …"`) to address them, push, and re-review.
     Otherwise exit the loop. Defer medium/low as steers or a follow-up directive.

## Live steering (pick up steers during a phase)

A new `[pending]` steer can land while a phase runs. Do **not** spawn a separate subagent
for it — the in-flight phase absorbs it. Each assessment/work/review prompt must include:

> Before finishing, re-read the directive's `## Steering` section. For every `[pending]`
> steer, fold it into your current work, then rewrite it as `[addressed]` with a
> `↳ <note>`. New steers may arrive while you run, so check again at the end of each
> iteration; only finish once no `[pending]` steer remains.

If a steer lands after a phase has fully ended (no subagent running), the next phase
picks it up; if every phase is already `done`, the orchestrator spawns a short work
subagent to handle it.

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
