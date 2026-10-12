# Workout history contract — issue #7

The user approved the fact and history rules on 2026-10-12.
This document fixes the DTOs before implementation.

## Queries

- `workouts.history({ dateFrom?, dateTo?, exerciseId?, status?, limit?, cursor? })` returns `{ items, nextCursor, filter, revision }`.
- The filter uses explicit saved calendar dates, not UTC audit dates. Bounds are inclusive.
- The default status is finished. Explicit alternatives are in-progress and all.
- Exercise filtering selects workouts that contain that exercise. Returned workouts retain all their sets.
- Page size defaults to 20 and accepts safe integers from 1 to 100.
- A page has a 10,000-set budget. Storage checks one extra workout metadata row for continuation but does not load its sets. Oversized pages fail on limit instead of truncating a workout. Reduce the page size or use the detail API for an oversized individual workout.
- Cursors have an 8,192-character limit. Oversized stored identifiers fail cursor creation rather than return an unusable token.
- Order is date descending, creation timestamp descending, and ID ascending by Unicode code point (SQLite BINARY order for valid Unicode).
- Cursors are opaque, versioned, and bound to normalized filters and a persistent history revision. Page size can change between calls.
- A primary record change makes earlier cursors stale. A stale cursor returns CONFLICT on cursor. The client restarts.
- Receipt writes, successful replays, failed transactions, and read-only resume do not invalidate cursors.
- An unchanged database preserves cursors after service reopen. Cursors are not secrets, authorization tokens, or portable archive references.
- Each page reads revision and records in one coherent view. The storage query uses a limit and keyset predicate, not an unbounded list or offset.

`workouts.previousSets({ exerciseId, beforeDate })` returns the requested exercise, before date, revision, source workout metadata (or null), and its matching sets.
Use finished workouts strictly before the date. Same-date workouts are excluded.
When several earlier workouts share a date, use the same creation timestamp and ID order as history.
Unknown and body-weight sets remain visible as raw records. Visibility does not make their loads comparable.

## Numerical facts

`workouts.statistics({ exerciseId, dateFrom, dateTo })` returns `{ exerciseId, dateContext, revision, workoutCount, setCount, groups, excluded }`.
It uses finished workouts only. Date bounds are required and inclusive.
Date context states `semantics: 'saved-workout-date'` and the explicit range.
The caller uses the calendar helper and current device timezone when it needs relative bounds.

Each count has a value, an explicit unit, and complete source references.
Each source identifies the workouts module, workout ID, date, audit revision timestamp, and history revision.
Set sources also carry a set ID.

- Groups remain separate for entered and combined load. Never sum incompatible groups or different exercises.
- Per-hand load converts only with the confirmed implement count of 1 or 2.
- Per-hand reps mean reps per implement. Alternating totals must not be entered as per-hand reps.
- Volume equals comparable kilograms multiplied by recorded reps. Its unit is kg·rep. Every included set supplies a source.
- Best load is the highest comparable load in the selected range. Return all tied sources.
- Best reps at each exact comparable load is the maximum recorded reps at that load. Return all tied sources.
- Do not estimate a one-rep maximum or call a selected-range best an all-time personal best.
- Unknown and body-weight sets do not contribute to load or volume facts. Report their counts and sources by exclusion reason.
- No compatible records means no group, not an invented zero-load best. Genuine confirmed zero load remains valid.
- Check finite results and safe integer counts. Do not round stored values or fact results. Binary floating-point precision applies.
- Scan bounded storage pages that load only matching exercise sets. Limit one statistics request to 5,000 matching workouts and 10,000 matching sets.
- Exceeding a limit fails with INVALID_INPUT on dateRange. Return no partial totals. The client narrows the date range.

Edits and deletions affect new queries immediately. Receipts never supply history data.
Schema version 5 adds a persistent history revision and primary-record triggers.
Released migrations, catalog values, primary records, and receipts stay unchanged.

## Acceptance status

Use shared query fixtures for memory, Node SQLite, and Android storage.
Node and memory evidence does not satisfy the Android acceptance check.
Issue #7 stays open until its query fixtures pass against real Android storage through issue #8.
