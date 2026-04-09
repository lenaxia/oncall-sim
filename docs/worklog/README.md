# docs/worklog

Session progress entries, handoffs, and architectural decisions.

## Rules

- Create an entry after completing a phase or significant story
- Create an entry before ending a session with unfinished work
- Create an entry when documenting a blocker or non-obvious decision
- Entries are append-only — never edit a past entry

## Naming

`NNNN_YYYY-MM-DD_description.md`

Examples:

- `0000_2026-04-07_phase1-shared-types-complete.md`
- `0001_2026-04-08_phase2-metric-generator-in-progress.md`

## Next Entry

`0017_YYYY-MM-DD_description.md`

## Entry Format

```markdown
# NNNN — Description

**Date:** YYYY-MM-DD
**Phase:** N — Phase Name
**Status:** Complete | In Progress | Blocked

## What Was Done

## Test Results

- Pass rate: X/Y
- Known failures: (none | description)

## Known Issues

## What Comes Next
```
