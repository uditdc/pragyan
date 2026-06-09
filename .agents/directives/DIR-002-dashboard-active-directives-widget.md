---
code: DIR-002
title: Dashboard active-directives widget replaces top posts
state: active
phase: work
objectives:
  - Thread the projects array into DashboardView so the rail can read directives
  - Add a WorkingWidget that lists the most relevant active directives across projects
  - Fall back to pending / most-recently-active directives when none are active
  - Replace PostsWidget with WorkingWidget in the rail and delete PostsWidget + CompactPost
  - Verify in the TUI that the new section renders and TOP POSTS is gone
step: 5
session: @run
branch: dir/DIR-002-dashboard-active-directives-widget
commits:
---

# Direction

The dashboard's right rail currently stacks MARKETS, TOP POSTS, and ALERTS &
LOGS. Top posts is the least useful panel for someone driving directives, so
replace it with a compact view of the active working directives (and their
sessions) across all projects — the work actually in flight — so the dashboard
doubles as an at-a-glance ops view.

## Objectives

- Thread the `projects` array into `DashboardView` so the rail can read directives.
- Add a `WorkingWidget` that lists the most relevant active directives across projects.
- Fall back to pending / most-recently-active directives when none are active.
- Replace `PostsWidget` with `WorkingWidget` in the rail and delete `PostsWidget` + `CompactPost`.
- Verify in the TUI that the new section renders and TOP POSTS is gone.

## Plan

**Approach.** The rail is narrow (32 cols at 78–100, 40 at ≥100) and shares its
column with MARKETS and ALERTS, so the new panel must stay to ~3 compact rows,
matching the existing widgets. Reuse the `Panel` wrapper and the directive-state
glyph vocabulary already established in `ProjectsView.tsx`.

**Data flow.**
- `tui/App.tsx` already holds `projects: Project[]` state (declared ~line 90,
  populated from `fetchProjects` ~line 163) and passes it to `ProjectsView`
  (~line 491). Pass the same `projects` into `DashboardView` at its render site
  (~line 457–469).
- `tui/DashboardView.tsx`: add `projects: Project[]` to the `DashboardView` prop
  type and destructure, then hand it to the new widget in the rail (replacing the
  `<PostsWidget posts={posts} … />` line ~295). The `posts` prop and its `Post`
  import become unused once `PostsWidget`/`CompactPost` are deleted — remove them
  too (and drop `posts={posts}` from the App call site).

**Selection / ranking (the widget's core logic).**
- Flatten directives across all projects, carrying the project name for context:
  `projects.flatMap(p => p.directives.map(d => ({ d, project: p.name })))`.
- Rank so the most live work surfaces first: `active` before `pending` before
  the rest; within a tier prefer the one whose claiming session is most recently
  active (directive `age`, or the directive's first `sessions[]` entry's
  `last_active`). Take the top 3.
- If nothing is `active`, the same ranking naturally falls through to `pending`
  and then most-recently-touched directives — satisfying the fallback objective
  without a separate code path. Only show the faint empty line when there are no
  directives at all.

**Row rendering (`WorkingWidget` + a `WorkingRow` helper).**
- Per row: directive-state glyph + color, the `DIR-NNN` code, the title
  (`wrap="truncate"`), and a faint right-aligned meta of step `N/M` (when
  `step`/`steps` present) and/or age.
- Reuse the directive-state glyph map from `ProjectsView.tsx` (`DST`: empty/
  pending/active/done → glyph + color). It is currently module-local to
  `ProjectsView.tsx`; lift it (and the `relativeAgo` usage) into a shared spot or
  re-declare a small local map in `DashboardView.tsx`. Prefer a tiny local map to
  avoid a refactor blast radius unless a shared `theme.ts` home is obviously
  cleaner.
- Panel header mirrors the others: `icon`, `title="WORKING"` (or "DIRECTIVES"),
  and a `meta` like `${activeCount} active`.

**Key files.**
- `tui/DashboardView.tsx` — remove `PostsWidget`/`CompactPost`, add
  `WorkingWidget`/`WorkingRow`, update `DashboardView` props + rail.
- `tui/App.tsx` — pass `projects` to `DashboardView`, drop `posts`.
- `shared/project.ts` — source of the `Project` / `Directive` / `Session` types
  to import.
- Reference only: `tui/ProjectsView.tsx` (`DST` map ~line 26, `relativeAgo`
  usage, `ProjectRow` active/pending counting ~line 156).

**Risks / open questions.**
- Width: `DIR-NNN` + title + age must fit 32 cols. Keep code short, truncate
  title, and let the meta shrink (`flexShrink`) — watch for the Ink wrap/overflow
  quirks noted in memory (`ink-layout-quirks`).
- If `projects` is empty (API offline / no projects), the widget should show the
  faint empty line, not crash on `flatMap`.
- Glyph map duplication vs. extraction — decide during implementation; keep it
  small either way.

## Verification

- Run the TUI, open the Dashboard tab, and confirm the new section renders in the
  right rail with real project data (active directives listed with code, title,
  and step/age), and that the old TOP POSTS panel is gone.

## Context

Replaces the `PostsWidget` ("TOP POSTS") panel in the dashboard right rail
(`tui/DashboardView.tsx`) with a directives view; the rail also holds
`MarketWidget` and `AlertsWidget`, whose compact style the new widget should
match. The `projects` data (with nested `directives` and `sessions`) already
flows from `App.tsx` to `ProjectsView`; reuse it rather than adding a new fetch.
Reuse the `Panel` wrapper and the directive-state glyph vocabulary (`DST`) from
`ProjectsView.tsx`. Mind the Ink v5 layout quirks recorded in project memory.

Work happens on a dedicated git worktree on the directive's branch
(dir/DIR-002-dashboard-active-directives-widget). Sessions must reference this
code (DIR-002) in their opening prompt to be discovered.

## Steering

<!--
User steers are appended below, newest last, each as:  - [pending] <input>
An agent addresses each pending steer and rewrites it as its steering memory:
  - [addressed] <input>
    ↳ <note on what the agent did to address it>
-->
