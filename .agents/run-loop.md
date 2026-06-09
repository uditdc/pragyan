# Directive run loop — design

How a directive is picked up, driven through its lifecycle, has its status updated,
and stays referenced across development. This is the spec for a future
`run-directive` skill; nothing here is built yet.

## Principles

- **The directive `.md` is the single source of truth.** `state` / `step` /
  `session` / `branch` / `commits` (frontmatter) and the `## Steering` log hold all
  lifecycle status. Every actor *writes* the file; the API/TUI only *read* it.
- **`DIR-NNN` is the join key.** It threads the directive file ↔ its branch
  `dir/DIR-NNN-…` ↔ every session's opening prompt ↔ the PR ↔ commit messages.
  Given any one, you can find the rest.
- **Phases run as real spawned `claude` sessions**, not in-process subagents — only
  sessions that exist as their own `~/.claude/projects/**/*.jsonl` transcript
  mentioning the code are discovered and shown under the directive in the TUI.

## Components

| component | role | status |
|---|---|---|
| `create-directive` skill | authors the `DIR-NNN` file | built |
| directive `.md` | the work-order **and** the status store | built |
| TUI / `api/projects.ts` | read-only view; discovers sessions by code | built |
| `run-directive` skill | the action loop / executor (this doc) | built |
| pickup routine / `/loop` | scans for `state: pending`, runs `run-directive` | future |

`run-directive` owns the flow. A routine is just the clock that calls it — keep the
flow in one place so auto-pickup and manual `/run-directive DIR-NNN` share it.

## Lifecycle

```
run-directive DIR-NNN
  0. read .agents/directives/DIR-NNN-*.md   (objectives, plan, verification, steers)
  1. worktree:  git worktree add <wt> -b dir/DIR-NNN-<slug>
  2. status:    state→active, session→<handle>, step→0          (write the .md)
  3. assessment session  → review plan/directive, surface issues to resolve
  4. work session        → implement objectives, push branch, open PR (title: DIR-NNN …)
  5. review loop         → review PR → fix → re-review until 0 critical/high issues
  6. status:    state→done, commits→<sha/PR>, steers→addressed   (write the .md)
```

Each phase is one spawned session, run so its transcript is discoverable and its
prompt opens with the code and phase, e.g. `[assessment] DIR-NNN — …`:

```bash
claude -p "[<phase>] DIR-NNN — <role instructions, pointer to the directive file>" \
  --append-system-prompt "<phase system prompt>"
# (spawn pattern already used in api/chat.ts)
```

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

## Decisions

1. **Session cwd vs. discovery path — RESOLVED (b).** Discovery now scans the project's
   main checkout *and every linked git worktree* (`sessionRoots` in `api/projects.ts`,
   via `git worktree list`). So phase sessions run with `cwd = <worktree>` — correct
   `gitBranch`, isolated checkout — and are still discovered and matched by code.
2. **Concurrency / phase locking — RESOLVED.** The `phase` field makes the lock
   phase-aware: a runner refuses to start (or restart) a phase that `state: active` +
   `phase` says is already running — no duplicate assessment or work. A `pending`
   directive is claimed by writing `state: active, phase: assessment` before spawning.
3. **Live steering — RESOLVED.** A steer added mid-phase is **not** a new session: each
   in-flight phase re-reads `## Steering` on every loop and addresses new `[pending]`
   steers before finishing (see the run-directive skill). Steers landing between phases
   are picked up by the next phase.
4. **Failure / handoff — RESOLVED.** A stalled or blocked phase records a `[pending]`
   steer, leaves `state: active` at its current `phase`, and hands back to the user; a
   dead owner (worktree session idle past `ACTIVE_MS`) is treated as a resume of that
   same phase.

## Open decisions (resolve when building further)

5. **Phase labelling in the TUI.** Sessions carry the `[assessment|work|review]` tag in
   their opening prompt; discovery could parse it and label the nested session under the
   directive — small `api/projects.ts` + UI addition, optional.

## Cross-references

- Directive authoring + template: `create-directive` skill, `.agents/directives/_template.md`.
- Discovery & status reading: `api/projects.ts` (`readDirectives`, code-matched `listSessions`).
- Spawn precedent: `api/chat.ts`.
