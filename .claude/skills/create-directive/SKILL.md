---
description: Design and create a directive (a DIR-NNN work-order) for a project in .agents/directives. Use when the user wants to add/author/create a directive, capture a work-order, or turn an intent into a planned directive.
---

# Create a directive

A **directive** is a human direction an agent turns into a plan and implements.
It lives as a markdown file in `<project>/.agents/directives/` with a stable
`DIR-NNN` code, objectives, a detailed plan, verification criteria, and a
`## Steering` memory of user steers.

Your job is to **design** a precise directive from the user's intent and **author
the markdown file yourself** with the Write tool — there is no script. Read the
template, compute the next code, write the file, then verify the document.

## 1 · Clarify the outcome (Q&A first)

Do not draft until the exact outcome is clear. Ask the user focused questions
(prefer the AskUserQuestion tool for trade-offs). Cover whatever the initial
prompt did not already pin down:

- **Outcome / acceptance** — what does "done" look like?
- **Scope & non-goals** — what is explicitly in and out.
- **Constraints** — must-reuse code, libraries to avoid, perf/UX/compat limits.
- **Affected areas** — files, components, or systems likely touched.
- **Verification** — how the work will be confirmed correct. If the user did not
  specify verification steps up front, **ask for them** — do not invent generic
  checks. Capture them verbatim into the directive's `## Verification` section.

Stop once you can state the outcome in one sentence. Echo your understanding back
before writing.

## 2 · Locate the dir, code, and branch

- Directives live in `<project root>/.agents/directives/` (default: current repo).
- Read the template `.agents/directives/_template.md`. If missing, create it from
  the structure below first.
- **Next code**: list `DIR-*.md`, take the highest `DIR-NNN`, add 1, zero-pad to
  three digits (first is `DIR-001`). Codes are never reused.
- **Branch**: each directive owns one branch, worked on a dedicated git worktree.
  Name it `dir/DIR-NNN-<kebab-title>` and record it in the frontmatter `branch:`.
  (The worktree/branch is created later, when work begins — not now.)

## 3 · Author the file (Write tool)

Write `.agents/directives/DIR-NNN-<kebab-title>.md`, following `_template.md`. Fill
the frontmatter and every body section — leave no `{{…}}` placeholders:

- **frontmatter** — `code`, `title`, `state: pending`, the `objectives:` list, and
  `branch: dir/DIR-NNN-<slug>`. Leave `step`/`session`/`commits` blank.
- **# Direction** — 1–3 sentences of plain-language intent (the "what" and "why").
- **## Objectives** — the concise checklist (mirror of the `objectives:` list).
- **## Plan** — the *detailed* reference plan: approach, key files, sequencing,
  risks, and open questions. This is the depth behind the objectives.
- **## Verification** — the acceptance criteria from §1 (the user's own steps).
- **## Context** — constraints and code to reuse; note the worktree/branch and code.
- **## Steering** — keep the template comment; add no entries (those come from users).

`objectives` are 3–6 concise, ordered, verifiable items; the `## Plan` expands them.
Create the directive in `state: pending` (a plan is drafted).

## 4 · Verify the directive document

Before reporting done, confirm the file itself is well-formed — re-read it and check:

1. Frontmatter parses: every key present, `objectives:` is a proper list, `code`
   and `branch` are set.
2. The `DIR-NNN` code is unique and sequential; the branch follows `dir/DIR-NNN-…`.
3. No `{{…}}` placeholders remain; `## Plan` and `## Verification` are filled (not
   the template's comment stubs).
4. Report the code, title, branch, and path to the user.

## Execution workflow (for reference)

Once created, a directive is driven through **assessment → work → review → done**
by the run loop. That flow — phases, status writes, worktree/branch, and the review
threshold — is specified in **`.agents/run-loop.md`** (the source of truth; not yet
built). Author directives so they feed it: clear objectives, a detailed `## Plan`,
explicit `## Verification`, and the `branch:` set.

## Conventions

- One file per directive: `DIR-NNN-<slug>.md`; the `DIR-NNN` code is the identity.
- **Steering memory**: users append steers from the TUI as `- [pending] <input>`.
  An agent addresses each, rewrites it as `- [addressed] <input>` with a `  ↳ <note>`.
  Preserve that section.
- Lifecycle: `empty` → `pending` (plan set) → `active` (implementing) → `done`.
