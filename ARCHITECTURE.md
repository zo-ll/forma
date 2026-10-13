# Workout architecture

This document describes the implemented workout service.
[ROADMAP.md](ROADMAP.md) describes future modules, contracts, and phase gates.

## Ownership

`@forma/core` owns workout validation, exercise resolution, set order, and request replay.
It also owns explicit calendar ranges, set load conventions, and compatible load calculations.
Its public API uses plain objects, strings, numbers, and promises.
The core has no runtime package dependencies.
Its compiler configuration has no Node or DOM types.

`@forma/adapters` owns SQL, schema changes, and database access.
The current adapter uses `node:sqlite`.
Only Node hosts import `@forma/adapters/node`.
A future mobile adapter will implement the same `WorkoutStore` port.

The host chooses the database path.
The host provides a clock and an ID generator.
The Node factory provides UTC timestamps and UUIDs by default.

## Composition

```ts
import { randomUUID } from 'node:crypto';
import { openNodeForma } from '@forma/adapters/node';

const service = openNodeForma({ databasePath: './workouts.sqlite' });

try {
  const exercise = await service.exercises.resolveAlias('Incline DB Press');
  const workout = await service.workouts.create({
    requestId: randomUUID(),
    date: '2026-10-12',
    splitDayId: 'upper',
  });

  await service.workouts.addSet({
    requestId: randomUUID(),
    workoutId: workout.id,
    exerciseId: exercise.id,
    reps: 8,
    weightKg: 20,
    rpe: 7.5,
  });

  const saved = await service.workouts.get(workout.id);
  console.log(saved);
} finally {
  await service.close();
}
```

The database directory must exist.
The factory creates the database file if it does not exist.
The adapter creates the initial schema and catalog in one transaction.
The adapter rejects a schema version newer than its own version.

For another host, use `createFormaService({ store, clock, ids })`.
The core does not need a server or an HTTP connection.

## Public API

| Method | Result |
| --- | --- |
| `exercises.list()` | All exercises, in catalog order |
| `exercises.get(exerciseId)` | One exercise |
| `exercises.resolveAlias(alias)` | One exercise |
| `splitDays.list()` | The three split days, in catalog order |
| `splitDays.get(splitDayId)` | One split day, with ordered exercise IDs |
| `workouts.create({ requestId, date, splitDayId?, notes?, durationMin? })` | A finished historical workout with no sets |
| `workouts.start({ requestId, date, splitDayId?, notes?, durationMin? })` | The one in-progress workout, initially with no sets |
| `workouts.inProgress()` | The in-progress workout, or null |
| `workouts.resume(workoutId)` | The saved in-progress workout, without a write |
| `workouts.finish({ requestId, workoutId })` | The finished workout |
| `workouts.update({ requestId, workoutId, date?, splitDayId?, notes?, durationMin? })` | The updated workout; null clears split day or duration |
| `workouts.delete({ requestId, workoutId })` | No value; deletes the workout and sets |
| `workouts.discard({ requestId, workoutId })` | No value; deletes only an in-progress workout |
| `workouts.addSet({ requestId, workoutId, exerciseId, reps, weightKg, rpe?, loadConvention?, implementCount? })` | The new set |
| `workouts.updateSet({ requestId, workoutId, setId, exerciseId?, reps?, weightKg?, rpe?, loadConvention?, implementCount? })` | The updated set |
| `workouts.deleteSet({ requestId, workoutId, setId })` | No value |
| `workouts.get(workoutId)` | A workout with ordered sets |
| `workouts.list({ dateFrom?, dateTo? }?)` | Legacy unbounded list; complete workouts, newest date first |
| `workouts.history({ dateFrom?, dateTo?, exerciseId?, status?, limit?, cursor? }?)` | A bounded page with an opaque continuation cursor |
| `workouts.previousSets({ exerciseId, beforeDate })` | Matching sets from the latest earlier finished workout |
| `workouts.statistics({ exerciseId, dateFrom, dateTo })` | Source-linked counts, volume, best loads, and best reps within the selected range |
| `close()` | No value |

An unknown exercise, split day, workout, or set produces `NOT_FOUND`.
An alias can match a canonical name or an explicit alias.
The core converts aliases to lowercase and removes extra whitespace.
The core does not guess an exercise from a general word such as `bench`.

A split day suggests exercises. It does not restrict the exercises in a workout.
The catalog remains read-only in this milestone.

## Repeated writes

Every write requires a nonempty `requestId` with valid Unicode, no NUL characters, and no outer whitespace.
Each client creates one `requestId` per intended command.
Before a write, save its `requestId` with the pending command.
Use the same `requestId` and input for every retry.
Use a new `requestId` for a new command.

The core compares normalized inputs, not object property order.
The receipt and record change share one transaction.
A repeated command returns its original result snapshot, not the current record.
Use `workouts.get()` for the current record.
A different input or operation with the same key produces `CONFLICT` with field `requestId`.
Input validation occurs before receipt lookup.

A failed transaction leaves no successful receipt.
Receipts survive close and reopen.
The store never expires receipts automatically.
Receipts retain input signatures and result snapshots, including data from deleted sets.
History APIs read primary records, not receipt snapshots.

`RequestReader` and `RequestWriter` define shared receipt capabilities.
`withRequest()` accepts each module's writer, normalized input, and synchronous result codec.
The core validates saved results before it returns them.
A malformed result produces `STORAGE_FAILURE` without another record change.
Future API changes must preserve supported receipt formats or provide an explicit upgrade.
Omitted load metadata in add commands retains the released unknown-load input signature.
An explicit unknown convention with a null count has the same signature.
Set updates without load metadata retain their released signatures.
Legacy set snapshots receive `loadConvention: 'unknown'` and `implementCount: null` on replay.
Neither replay nor migration rewrites saved receipts. Confirming a set does not change earlier replay results.
The released create signature is unchanged. Legacy workout snapshots gain finished state and a null finish timestamp.
New session-operation receipts must contain their state and finish time; missing metadata is not a legacy format.
Deleted workouts retain their request receipts. Replaying start, edit, or finish does not recreate a deleted record.

## Record rules

- `date` is an explicit local calendar date in `YYYY-MM-DD` format.
- The client chooses the date in the user's timezone.
- The core rejects impossible dates.
- `createdAt` and `updatedAt` are UTC timestamps with milliseconds.
- `reps` is a positive safe integer.
- `weightKg` is a finite, non-negative number.
- `rpe` is optional and accepts finite values from 1 to 10, including decimals.
- An omitted RPE becomes `null`.
- In a set update, `rpe: null` removes the RPE.
- `durationMin` is optional and accepts finite, non-negative values.
- An omitted duration becomes `null`.
- Notes remain unchanged.
- Set positions start at zero.
- A set delete makes the remaining positions consecutive.
- A set update preserves the set ID and position.
- A set belongs to exactly one workout.

`weightKg` stores the load that the user enters. The stored value is never converted.
`loadConvention` is `unknown`, `entered`, `per-hand`, `combined`, or `body-weight`.
Per-hand load requires an explicit `implementCount` of 1 or 2. Other conventions require null.
Add commands default to unknown and null. A metadata update supplies an explicit convention and its count.
Omitted metadata in ordinary set edits remains unchanged.
Use an ordinary set update with a new request key to confirm an old convention.
Exercise names and equipment never supply a convention.
Body-weight sets store only added external load. Zero means no added load.
The service never adds body mass or estimates machine resistance.

## Workout sessions and metadata

`workouts.create()` records a finished historical workout with `finishedAt: null`.
`workouts.start()` records `status: 'in-progress'` and `finishedAt: null`.
The core checks for the current in-progress workout inside the atomic write transaction.
The SQLite schema also enforces this limit with a partial unique index.
A second start with a different key produces `CONFLICT` on `status`.
A failed start leaves its request key available for a later retry.
Manual historical records remain available while a session is in progress.

Each set command saves immediately. App background and shutdown never finish a workout.
`inProgress()` and `resume()` read primary records without changing audit timestamps or writing receipts.
A finished workout cannot resume or be discarded. Those operations produce `CONFLICT` on `status`.
Finish saves the UTC finish instant and updates the audit timestamp. It does not calculate duration or change date.
Finishing an already finished record with a new key returns the current record without another timestamp change.
Finished records remain editable. Edits preserve session state and finish time.

Metadata updates preserve omitted fields. Null clears split day or duration. An empty string clears notes.
A metadata update needs at least one supplied field. Status and finish time are not editable metadata.
Deletion accepts either state. Discard accepts only in-progress state. Both delete the primary workout and its sets.
New commands against deleted records produce `NOT_FOUND`; successful request retries still return their saved snapshots.
The UI must confirm destructive commands before submission.
No cancellation API exists. Cancelling an unsubmitted command means not sending it.
After submission, an aborted wait does not prove rollback. Retry the saved request and retrieve current state.

## Calendar and load helpers

These synchronous functions are exported by `@forma/core`. They do not use storage or platform access.

`resolveCalendarRange({ nowUtc, timeZone, period })` accepts a UTC timestamp with milliseconds and an IANA timezone name.
The host supplies the current device timezone on each call. The core does not detect it.
Periods are `today`, `this-week`, and `last-week`.
The result has inclusive `dateFrom` and `dateTo`, `timeZone`, `weekStartsOn: 'monday'`, and `period`.
Pass only the two date fields to `workouts.list()`. Its strict input validation rejects the extra context fields.
Today is the local calendar day. This week is the complete Monday-to-Sunday week that contains today.
Last week is the previous complete calendar week.
Gregorian date arithmetic follows local calendar days, not elapsed 24-hour durations across DST.
Saved workout dates never change. Unsupported timezones and dates outside years 0001–9999 produce `INVALID_INPUT`.
The host runtime must provide `Intl.DateTimeFormat` and the requested timezone data.
Android runtime support still needs its own device checks.

`calculateSetLoad(set)` returns a kilogram fact with the set ID, exercise ID, entered value, recorded convention, and implement count.
Per-hand load becomes a combined-load fact through the explicit count. Other stored values stay unchanged.
`compareSetLoads(left, right)` returns -1, 0, or 1 for load only.
It requires the same exercise and compatible facts. Entered load stays separate from combined load.
Unknown and body-weight loads cannot supply comparable facts.
These functions reject invalid metadata and overflow with `INVALID_INPUT`.
They do not calculate volume, personal bests, or aggregate statistics. They do not compare machine resistance.

## Paged history and numerical facts

[docs/history-contract.md](docs/history-contract.md) defines the complete DTO and calculation contract.
The user approved finished-workout facts, explicit exclusions, and restart on stale cursors.
History defaults to finished records. It can filter inclusive saved dates, exercise, and status.
Its order is date descending, creation timestamp descending, and Unicode code-point ID ascending.
The Node adapter uses matching SQLite BINARY order, a keyset predicate, and a bounded SQL query.
A cursor binds normalized filters, the last record key, and a persistent history revision.
Primary workout and set triggers update the revision in the same transaction as the record change.
Stale cursors produce `CONFLICT` on `cursor`; malformed or mismatched cursors produce `INVALID_INPUT`.
An unchanged database preserves cursors after reopen. Replays and rolled-back writes do not invalidate them.

Previous sets require a date strictly before `beforeDate`. They exclude live and same-date workouts.
The result retains raw load metadata. An unknown previous weight does not become comparable.
Statistics read finished primary records in bounded pages, never request snapshots.
Each fact carries units and sources; the result carries the explicit saved-date range and history revision.
Source references carry workout IDs, dates, audit timestamps, revision, and set IDs when applicable.
Volume is compatible kilograms multiplied by reps, in kg·rep. Per-hand reps count repetitions per implement.
Entered and combined groups stay separate. Unknown and body-weight sets supply explicit exclusions rather than totals.
Best load and best reps refer only to the selected range. No one-rep maximum is estimated.
Ties retain all sources. No supported records means no best-load group, not an invented zero.
The core validates finite arithmetic and never rounds facts.

`WORKOUT_HISTORY_LIMITS` owns page and calculation limits in the core.
A page accepts 1–100 workouts (default 20) and up to 10,000 sets.
The adapter checks one metadata-only lookahead row without loading its sets.
Statistics cap matching records at 5,000 workouts and 10,000 sets; oversized requests fail without partial facts.
The client narrows the date range or reduces the page size.
The internal history port can load only matching exercise sets for analytics.
Those partial query rows must never be saved as complete workouts.
Shared fixtures in `tests/fixtures/history-cases.ts` have no Node imports and are ready for Android execution.
Memory, Node SQLite, and real Android OP-SQLite have passed the shared query fixtures.
The physical Android evidence is recorded in [the storage checks](docs/android-storage-tests.md).

## Android binding — issue #8

Node and Android share `sqlite/workout-store.ts`: row mapping, SQL, migrations, FIFO queue, coherent reads, writes, expired-view guards, and close drain.
The Node entry keeps its native constructor, path handling, and errcode translation.
The Android entry takes the actual OP-SQLite 18.2.5 `open` function from the React Native composition root.
It wraps executeSync in a synchronous connection interface. It does not import Node, React Native, or OP's Node facade.
The Android root supplies UTC audit time and opaque IDs. Native handles and paths stay outside the core.

Android filenames are bounded sandbox names, not paths.
A runtime-global name registry rejects duplicate owners and survives Fast Refresh/module copies.
Ownership ends only after accepted work drains and native close succeeds.
An unknown close state keeps ownership until runtime restart. Startup failures close the handle and release ownership when closure succeeds.
SQLite extended codes 1555/2067 map to CONFLICT when present.
Published OP-SQLite 18.2.5 provides message-only native errors, unlike newer upstream code.
For that binding, only exact vendor-prefixed UNIQUE messages for known Forma columns map to CONFLICT.
CHECK, foreign-key, unrelated, and unprefixed failures remain STORAGE_FAILURE. A non-unique extended code disables the fallback.
Existing FormaError values retain their codes.

Portable package exports have explicit React Native conditions.
The standalone ARM64 test host embeds a release bundle and verifies its module graph.
It reuses 116 service cases, 16 history cases, and eleven storage diagnostics.
Its seed/verify modes prove process restart only after execution with distinct PIDs.
The Nothing Phone (2a), A142, Android 16/API 36, passed all 143 native cases.
Seed and verify also passed in distinct processes, with exact records and original request snapshots.
This is storage acceptance, not workout UI gate #14 approval.
See [test commands](docs/android-storage-tests.md) and [binding evidence](docs/research/op-sqlite.md).

## Mobile host — issue #9

`@forma/mobile-host` owns the client service lifetime, preference state, and date context.
It imports only the core. The Android composition root injects the SQLite adapter, native UUIDs, timezone, and private preference storage.
A runtime-global symbol retains one host across component disposal and Fast Refresh.
Background keeps that host open. Resume calls the core calendar resolver without changing saved records.
Explicit close drains accepted work. Failed startup closes its opened service; unknown native close state retains ownership.

The UI owns navigation and presentation, not record rules or calculations.
Its read-only history form displays typed core errors with field names and accessible controls.
Appearance changes persist before publication. A native save failure is unconfirmed, not proof of unchanged disk state.
Corrupt or newer preferences remain intact and fail startup rather than silently reset.

The standalone hostgate flavor uses a separate sandbox with synthetic records.
Its expected snapshots live under a native test-only guard. Restart verification reads records before receipt replay.
Build checks exclude Node runtime modules. Physical host acceptance passed on the Nothing Phone (2a).
The device checks also cover accessible navigation, typed history errors, themes, and close/restart.
These thin-host checks do not approve the full workout UI gate #14.
See [mobile ownership and limits](docs/mobile-host.md).

## Local archive — issue #12

`service.archive` exports, inspects, and restores a versioned plaintext archive. See the [archive contract](docs/archive-contract.md).
Export reads one coherent view through the store. It does not copy the SQLite file.
Restore is full replacement in one write transaction. The user confirms the archive digest and the current history revision.
The core validates the whole archive before mutation, including receipt signatures and results with the released codecs.
A core exclusion rejects new operations through any API reference during a restore. Accepted operations drain first.
The SHA-256 digest detects damage. It is not authentication or encryption.
Settings shows the privacy and replacement warnings. Kotlin keeps document URIs native and counts bytes while it reads.

## Storage port

The adapter keeps the version 1 names `workout_groups`, `workout_group_exercises`, and `group_id` for compatibility.
The adapter maps these names to `SplitDay` and `splitDayId`.

`@forma/adapters/sqlite` exports platform-independent migrations and a synchronous driver contract.
The Node adapter supplies the driver. A future Android adapter can use `executeSync` for the same contract.
The registry contains consecutive versions, starting at 1. Each item contains one complete SQL statement.

The runner applies every pending version in one transaction and rechecks the version after it acquires the write lock.
A failure rolls back both schema changes and the version marker.

The initial catalog belongs to version 1 only. Later versions must not seed or reset the catalog again.
Version 3 adds `load_convention` and `implement_count` to sets, with SQL checks for valid metadata pairs.
Old records receive unknown metadata. Their weights, dates, catalog memberships, and receipts remain unchanged.
The Node adapter validates load metadata again when it reads stored sets.
Version 4 adds `status`, `finished_at`, and the one-in-progress index.
Old workouts receive finished state with no invented finish timestamp.
The adapter validates session metadata on reads and deletes sets through the released foreign-key cascade.
`WorkoutReader.getInProgressWorkout()` supplies the saved session. `WorkoutWriter.deleteWorkout()` deletes its primary record.
Both capabilities obey the same coherent-view, read-only, and expired-view rules as the existing port.
Version 5 adds a singleton history revision, six primary-record triggers, and a history index.
It preserves all existing records, receipts, and released migrations.
`getHistoryRevision()` and `listHistoryWorkouts()` run within the same coherent read view.

`WorkoutStore.read()` supplies a coherent read view.
`WorkoutStore.write()` supplies an atomic write transaction.
Each callback uses its supplied reader or writer.
A callback must not start another operation on the same store.

The Node adapter serializes operations on its connection.
Concurrent commands through one service cannot overwrite each other's sets.
A failed write rolls back the workout, its sets, and its request receipt.
The adapter prevents duplicate set IDs across workouts.
Transaction views expire after their callback returns.

Each host must use one live service per database within its process.
The current adapter does not coordinate several connections within one process.

The service owns its injected store and closes it with `close()`.
Do not share the same store between services with independent lifetimes.
A close waits for accepted operations.
After a close starts, the service rejects new operations.
Repeated calls to `close()` use the same promise.

## Errors

`FormaError` has a stable `code` and an optional `field`.

| Code | Meaning |
| --- | --- |
| `INVALID_INPUT` | The request violates a record rule |
| `NOT_FOUND` | A record or alias does not exist |
| `CONFLICT` | An ID already exists, or a request key identifies different input |
| `SERVICE_CLOSED` | The service or store no longer accepts operations |
| `STORAGE_FAILURE` | Storage cannot complete the operation |

The Node adapter converts native database errors to `FormaError`.
The error retains its original cause for local diagnostics.
Future adapters must use the same error codes.

Invalid values fail in the core before the storage write starts.
Unknown references fail within the transaction before the adapter saves a record.
Inputs contain no SQL.
The adapter binds every user value as a SQL parameter.

## Verification

The same contract tests run against a memory adapter and the SQLite adapter.
The tests check the catalog, validation, set operations, history, and lifecycle.

Additional SQLite tests check:

- Exact records and request receipts after close and reopen.
- Atomic rollback after a failed save or callback.
- Concurrent write commands and close.
- Duplicate IDs and expired transaction views.
- Schema version checks and migration failures.
- SQL-shaped input as data.

The tests do not establish Android behavior.
