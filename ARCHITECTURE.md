# Workout architecture

## Ownership

`@forma/core` owns workout validation, exercise resolution, set order, and request replay.
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
| `workouts.create({ requestId, date, splitDayId?, notes?, durationMin? })` | A workout with no sets |
| `workouts.addSet({ requestId, workoutId, exerciseId, reps, weightKg, rpe? })` | The new set |
| `workouts.updateSet({ requestId, workoutId, setId, exerciseId?, reps?, weightKg?, rpe? })` | The updated set |
| `workouts.deleteSet({ requestId, workoutId, setId })` | No value |
| `workouts.get(workoutId)` | A workout with ordered sets |
| `workouts.list({ dateFrom?, dateTo? }?)` | Complete workouts, newest date first |
| `close()` | No value |

An unknown exercise, split day, workout, or set produces `NOT_FOUND`.
An alias can match a canonical name or an explicit alias.
The core converts aliases to lowercase and removes extra whitespace.
The core does not guess an exercise from a general word such as `bench`.

A split day suggests exercises. It does not restrict the exercises in a workout.
The catalog remains read-only in this milestone.

## Repeated writes

Every write requires a nonempty `requestId` with valid Unicode and no outer whitespace.
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

`weightKg` stores the load that the user enters.
The service does not convert a dumbbell load to a combined load.
It does not add body weight or a machine resistance estimate.
Future calculations must define their load convention before use.

## Storage port

The adapter keeps the version 1 names `workout_groups`, `workout_group_exercises`, and `group_id` for compatibility.
The adapter maps these names to `SplitDay` and `splitDayId`.

`@forma/adapters/sqlite` exports platform-independent migrations and a synchronous driver contract.
The Node adapter supplies the driver. A future Android adapter can use `executeSync` for the same contract.
The registry contains consecutive versions, starting at 1. Each item contains one complete SQL statement.

The runner applies every pending version in one transaction and rechecks the version after it acquires the write lock.
A failure rolls back both schema changes and the version marker.

The initial catalog belongs to version 1 only. Later versions must not seed or reset the catalog again.

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
