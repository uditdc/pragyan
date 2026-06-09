---
code: DIR-001
title: Polish projects-view directive card UI
state: active
phase: review
objectives:
  - Add a step-progress meter line for active directives (filled/empty cells + step n/N)
  - Polish lifecycle state badges and add compact session/steering count chips to the card header
  - Strengthen visual emphasis on the selected directive card vs. unselected ones
  - Tighten the nested SESSIONS and STEERING blocks (status dots, alignment, pending-steer emphasis)
  - Confirm layout holds across all states with many directives; tsc + lint clean
step: 5
session: @run
branch: dir/DIR-001-polish-directive-card-ui
commits: PR#2 8b6f9a6 (open)
---

# Direction

Make the directive cards in the projects view read at a glance: a clear progress
meter for in-flight work, crisper lifecycle badges with at-a-glance session and
steering counts, an obviously-selected card, and tighter session/steering blocks.
This is visual/status polish only — same cards, same sections, better legibility.

## Objectives

- Add a step-progress meter line for active directives (filled/empty cells + step n/N).
- Polish the lifecycle state badge and add compact session/steering count chips to the card header.
- Strengthen visual emphasis on the selected card vs. unselected ones.
- Tighten the nested SESSIONS and STEERING blocks (status dots, alignment, pending-steer emphasis).
- Verify layout across all states with many directives; tsc + lint clean.

## Plan

All work is in `tui/ProjectsView.tsx`, primarily the `DirCard` component
(~lines 341–490) plus its small helpers. No changes to data model
(`shared/project.ts`), API (`api/projects.ts`), or navigation/keybindings in
`tui/App.tsx`. Reuse the existing palette in `tui/theme.ts` (`P.*`), the
`DST`/`SS`/`STEER` status maps already defined at the top of the file, and
`relativeTime` from `tui/format.ts`. Do not introduce new dependencies.

Approach, in order:

1. **Step-progress meter (active directives).** Add a small inline meter
   rendered from `step`/`steps` (already on `Directive`; `steps` falls back to
   `objectives.length`, `step` to 0). Render a fixed-width bar of filled vs.
   empty cells (e.g. `▰`/`▱` or `█`/`░`) coloured `P.accent`/`P.faint`, followed
   by `step n/N`. Place it as its own line under the header for `state==="active"`
   (the "minor layout tweak" allowed). Keep the existing numbered objectives list;
   the meter summarizes it, it does not replace it. Guard against `steps===0`
   (render nothing or a 0/0-safe bar) to avoid divide-by-zero.

2. **State badge + count chips.** Polish the `[ label ]` badge (line ~379) using
   the `DST` glyph+colour for the state. Add compact chips to the header right
   side for non-zero counts: sessions (`◇ n` in `P.x`) and steering, with pending
   steers emphasised (e.g. `○ n` in `P.news` when any steer is pending, else
   `P.faint`). Derive counts from `directive.sessions.length` and
   `directive.steers` (count `status !== "addressed"` for the pending emphasis).
   Keep the header on one row with `wrap="truncate"` and `flexShrink={0}` chips so
   it degrades gracefully at narrow widths.

3. **Selected-card emphasis.** Today selected and active both resolve to
   `P.accent` border (line ~361), so the selected card is nearly invisible when an
   active card sits beside it. Differentiate: keep a coloured border but add an
   extra affordance for the selected card only — e.g. bolder/brighter title
   (`P.white` bold), a left accent gutter, or a subtle marker on the code. Ensure
   selected-but-not-active and active-but-not-selected are each distinguishable
   from a plain card. Reuse the accent-gutter pattern noted in the Ink quirks
   memory rather than nesting extra borders.

4. **Sessions / steering blocks.** In `NestedSessionRow` and the STEERING map
   (~lines 446–488): align status dots/labels, ensure consistent left padding,
   and make pending steers (`status==="pending"`) visually stronger than
   `addressed` ones (which should read as muted/done). Keep `wrap="truncate"` on
   all flexible text so nothing overflows the card.

5. **Verify** (see Verification) with a temporary set of seeded directives, then
   remove any seeding before finishing.

Risks / open questions:

- **Ink layout quirks** (see `memory/ink-layout-quirks.md`): bordered boxes at an
  x-offset mis-draw their right border, and `flexGrow` + over-tall `flexShrink={0}`
  content can paint a row too high. Prefer coloured `▌`/`▰` accent glyphs over
  nested borders; keep fixed rows `flexShrink={0}`. The directives list itself has
  **no** scroll viewport — adding meter/chip lines slightly increases card height,
  so confirm several tall cards still render without clipping sibling rows. (Adding
  scrolling is explicitly out of scope; if overflow becomes a problem, note it for
  a follow-up directive rather than solving it here.)
- Glyph width: prefer single-width characters for meter/chips so columns stay
  aligned in the terminal.

## Verification

- Render the projects view with **many directives in varied states** (empty,
  pending, active, done) and confirm: the progress meter shows only for active
  directives and matches `step/steps`; state badges and session/steering chips are
  correct; the selected card is unmistakably distinct from active and plain cards;
  sessions and steering blocks are aligned with pending steers emphasised.
- `tsc` type-check and the project lint both pass clean with no new errors in the
  touched files.

## Context

Scope is `tui/ProjectsView.tsx` only (plus reuse of `tui/theme.ts`,
`tui/format.ts`). Out of scope: expand/collapse, scrolling/viewport, surfacing the
`## Plan`/`## Verification` markdown body, and any change to the data model, API,
or keybindings. Reuse the existing `DST`/`SS`/`STEER` maps and `P.*` palette; add
no dependencies. Heed `memory/ink-layout-quirks.md` (avoid nested offset borders;
keep fixed rows `flexShrink={0}`).

Work happens on a dedicated git worktree on the directive's branch
(dir/DIR-001-polish-directive-card-ui). Sessions must reference this code
(DIR-001) in their opening prompt to be discovered.

## Steering

<!--
User steers are appended below, newest last, each as:  - [pending] <input>
An agent addresses each pending steer and rewrites it as its steering memory:
  - [addressed] <input>
    ↳ <note on what the agent did to address it>
-->
- [addressed] resolve merge conflicts with main @479970958df67e3116c654872516e7663c41dcbe
    ↳ Merged main into the branch; the only conflict was in tui/ProjectsView.tsx (DirCard). Reconciled all three hunks to keep both intents: kept the branch's UI polish (pendingSteers/sessionCount chips ◇/○, selected accent gutter ▌, white border/title, ProgressMeter) AND adopted main's `badge` (merged/committed/done) read from the new `Directive.merged` field in shared/project.ts. The badge glyph/color/label now drive the gutter and the bracket label so a done directive renders "merged"/"committed". ProjectRow auto-merged to main's directive-count + relativeAgo version. typecheck passes clean.
