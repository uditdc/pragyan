---
code: DIR-000
title: Untitled directive
state: empty
phase:
objectives:
step:
session:
branch:
commits:
---

# Direction

{{DIRECTION}}

## Objectives

<!-- High-level, mirrored in the `objectives:` frontmatter list (what the TUI shows). -->

## Plan

<!--
The detailed reference plan agents read: approach, key files, sequencing, risks,
and open questions. The frontmatter `objectives` are the concise checklist; this
is the depth behind them.
-->

## Verification

<!-- How to confirm the work is correct — acceptance criteria, gathered from the user. -->

## Context

Constraints and code to reuse. Work happens on a dedicated git worktree on the
directive's branch ({{BRANCH}}). Sessions must reference this code ({{CODE}}) in
their opening prompt to be discovered.

## Steering

<!--
User steers are appended below, newest last, each as:  - [pending] <input>
An agent addresses each pending steer and rewrites it as its steering memory:
  - [addressed] <input>
    ↳ <note on what the agent did to address it>
-->
