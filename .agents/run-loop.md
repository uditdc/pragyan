# Directive run loop — design

How a directive is picked up, driven through its lifecycle, has its status updated,
and stays referenced across development. This is the spec for a future
`run-directive` skill; nothing here is built yet.

## Principles

- **The directive `.md` is the single source of truth.** `state` / `step` /
  `session` / `branch` / `commits` (frontmatter) and the `## Steering` log hold all
  lifecycle status. Every actor *writes* the file; the API/TUI only *read* it.
- **`DIR-NNN` is the join key.** It threads the directive file ↔ its branch
  `dir/DIR-NNN-…` ↔ every phase subagent's tag ↔ the PR ↔ commit messages.
  Given any one, you can find the rest.
- **Phases run as `Task` subagents of one orchestrator** (the "claiming session"),
  not separate `claude` processes. The TUI shows **the claiming session and its phase
  subagents** under the directive — not every session that mentions the code. A
  subagent is matched by its `[phase] DIR-NNN` description tag (read from its tiny
  `agent-*.meta.json`), so discovery is cheap.

## Components

| component | role | status |
|---|---|---|
| `create-directive` skill | authors the `DIR-NNN` file | built |
| directive `.md` | the work-order **and** the status store | built |
| TUI / `api/projects.ts` | read-only view; shows the claiming session + its subagents | built |
| `run-directive` skill | the action loop / executor (this doc) | built |
| pickup routine / `/loop` | scans for `state: pending`, runs `run-directive` | future |

`run-directive` owns the flow. A routine is just the clock that calls it — keep the
flow in one place so auto-pickup and manual `/run-directive DIR-NNN` share it.

## Lifecycle

```
run-directive DIR-NNN  (the orchestrator session = the claiming session)
  0. read .agents/directives/DIR-NNN-*.md   (objectives, plan, verification, steers)
  1. worktree:  git worktree add <wt> -b dir/DIR-NNN-<slug>
  2. status:    state→active, phase→assessment, step→0          (write the .md)
  3. assessment subagent → review plan/directive, surface issues to resolve
  4. work subagent       → implement in <wt>, push branch, open PR (title: DIR-NNN …)
  5. review loop         → review PR → fix → re-review until 0 critical/high issues
  6. status:    state→done, commits→<sha/PR>, steers→addressed   (write the .md)
```

Each phase is one `Task` subagent whose **`description` is `[<phase>] DIR-NNN — …`**.
That tag is the discovery key: `api/projects.ts` reads each subagent's
`agent-*.meta.json`, matches the code, and lists it (with its phase) under the
directive beneath the claiming session — no transcript scan needed.

## Status ownership

`state` + `phase` together are the lock. `phase` (`assessment` → `work` → `review`,
blank otherwise) is the sub-state of an `active` directive and tells a second runner
exactly what is already in flight, so no phase is ever duplicated.

| transition | written by | fields |
|---|---|---|
| pending → active | run-directive on claim | `state`, `phase: assessment`, `session`, `step` |
| assessment → work | after assessment | `phase: work` |
| objective progress | work session | `step` |
| work → review | when PR is opened | `phase: review` |
| steer addressed | the in-flight phase, each loop | `## Steering`: `[pending]`→`[addressed]` + `↳ note` |
| active → done | review loop when threshold clears | `state`, `phase` (blank), `commits` |

**Review threshold:** the loop exits (→ `done`) only when no **critical** or **high**
priority issues remain; medium/low may be deferred (note them as steers or follow-up
directives).

## Worktree, branch & PR

- Each directive owns one branch `dir/DIR-NNN-<slug>` (set at creation) on a dedicated
  git worktree, created at pickup and removed when `done`.
- The work session pushes the branch and opens a PR whose title/body carry `DIR-NNN`.
- The review loop operates on that PR; `commits` records the merged SHA / PR ref.

## Decisions (all resolved)

1. **Phases = subagents; UI = claiming session + its subagents.** Each phase is a `Task`
   subagent of the orchestrator, tagged `[phase] DIR-NNN` in its description. `api/projects.ts`
   reads each session's `subagents/agent-*.meta.json`, and a directive's run = the
   session(s) whose subagents reference its code, with those subagents nested under it —
   not every code-mentioning session. (`sessionRoots` still scans the worktree paths so a
   worktree-launched orchestrator is found.)
2. **Concurrency / phase locking.** The `phase` field makes the lock phase-aware: a runner
   refuses to start (or restart) a phase that `state: active` + `phase` says is already
   running. A `pending` directive is claimed by writing `state: active, phase: assessment`
   before spawning.
3. **Live steering.** A steer added mid-phase is absorbed by the in-flight subagent: each
   re-reads `## Steering` every loop and addresses new `[pending]` steers before finishing.
   Steers between phases are taken by the next phase.
4. **Failure / handoff.** A stalled or blocked phase records a `[pending]` steer, leaves
   `state: active` at its current `phase`, and hands back to the user; a dead owner (phase
   subagent idle past `ACTIVE_MS`) is treated as a resume of that same phase.
5. **Phase labelling in the TUI.** Each subagent shows its phase chip (`assess`/`work`/
   `review`), parsed from the description tag, in the nested session row.

## Cross-references

- Directive authoring + template: `create-directive` skill, `.agents/directives/_template.md`.
- Discovery & status reading: `api/projects.ts` (`readDirectives`, code-matched `listSessions`).
- Spawn precedent: `api/chat.ts`.
