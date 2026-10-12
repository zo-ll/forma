# Forma — Specification

Version 0.2. Current milestone: the workout module.

## 1. Purpose

Forma is a local-first fitness service for one user.
The first milestone records workouts.
A mobile app will act as a thin client of the service.
Nutrition will follow later.

## 2. Current scope

- Use the supplied exercise catalog.
- Preserve the supplied split days and exercise order.
- Create workout records.
- Add, edit, and delete sets.
- Retrieve workout records and filter history by date.
- Store records locally in SQLite.
- Test the core without React Native.

This milestone has no mobile screens, nutrition module, standalone notes module, or models.
Workout notes remain a field of a workout record.
The catalog has no edit API in this milestone.

## 3. Architecture

`@forma/core` defines domain rules and capability contracts in plain TypeScript.
The core does not import React, Expo, a SQLite driver, or native handles.

`@forma/adapters` implements the core ports.
The first adapter uses SQLite in Node.
A future Android adapter will use OP-SQLite.

Each host constructs adapters and injects them into `createFormaService`.
Clients use the same public service API.
The service does not require a server.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the API and port contracts.

## 4. Exercise catalog

The catalog has 19 distinct exercises and 20 split day memberships.
Triceps Pushdowns uses one exercise ID in both split days.
Preacher Curl and Preacher Curl Machine remain separate exercises.
Lateral Raises and Cable Lateral Raises remain separate exercises.

### Upper

1. Incline Dumbbell Press
2. Lat Pulldown
3. Cable Row
4. Cable Pullover
5. Lateral Raises
6. Triceps Pushdowns
7. Preacher Curl Machine

### Lower

1. Hack Squat
2. Bulgarian Split Squat
3. Calf Raises
4. Hammer Curls
5. Leg Extensions
6. Leg Curls

### Arms & Shoulders

1. Preacher Curl
2. Dumbbell Overhead Triceps Extension
3. Cable Lateral Raises
4. Cable Biceps Curl
5. Triceps Pushdowns
6. Overhead Shoulder Press
7. Upright Row

The core preserves these names and this order.
Hammer Curls stays in Lower.
An exercise name states equipment only when it explicitly names that equipment.
Other equipment values remain `null`.
Muscle groups remain `null` until the user supplies them.

Canonical names and explicit aliases resolve to a single exercise ID.
Alias resolution ignores case and extra whitespace.
It does not use fuzzy search or a model.

## 5. Records

### Exercise

Fields: `id`, `name`, `muscleGroup`, `equipment`, `aliases`.

### Split day

Fields: `id`, `name`, `exerciseIds`.
Split day IDs are `upper`, `lower`, and `arms-shoulders`.
The exercise IDs preserve the supplied order.
Split days suggest exercises but do not restrict a workout.

### Workout

Fields: `id`, `date`, `splitDayId`, `notes`, `durationMin`, `createdAt`, `updatedAt`, `sets`.

The client supplies the calendar date in the user's timezone.
The date has `YYYY-MM-DD` format.
The clock supplies UTC timestamps for the audit fields.

The split day and duration are optional.
Notes default to an empty string.
A new workout has no sets.

### Set

Fields: `id`, `exerciseId`, `reps`, `weightKg`, `rpe`, `position`.

Reps must be positive safe integers.
Weight must be finite and non-negative.
RPE is optional.
If present, RPE must be finite and between 1 and 10.
Decimal RPE values are valid.
Set positions start at zero.

The service stores the entered load in kilograms.
It does not infer a combined dumbbell load, body weight, or machine resistance.
No workout statistics exist in this milestone.

## 6. Storage

The SQLite schema has these tables:

- `exercises`
- `exercise_aliases`
- `workout_groups`
- `workout_group_exercises`
- `workouts`
- `sets`
- `request_receipts`

The adapter owns table names, row conversion, and migrations.
The initial workout schema has version 1 in `PRAGMA user_version`.
Version 2 adds a shared table for command receipts.

The adapter keeps the original table names and the `group_id` column for compatibility.
The public API uses `SplitDay`, `splitDays`, and `splitDayId`.
The initial migration inserts the catalog once.
It does not reinsert the catalog on reopen.

The shared registry defines ordered schema versions for both storage hosts.
Each host supplies synchronous database operations to the migration runner.
The runner applies all pending versions in one transaction.
An upgrade failure preserves the previous schema, records, and version marker.

Each write is atomic.
A failed operation must preserve the previous record.
The adapter must serialize commands on its connection.
SQL parameters carry user values.
The service must not accept free SQL from a client or model.

The host chooses the database path.
SQLite files contain unencrypted data.
Every write requires a `requestId` that identifies one intended command.
A retry must use the same `requestId` and normalized input.
The core saves the receipt with the record change in one transaction.
A repeated command returns its original result, even after restart.
A different input or operation with the same key produces a typed `CONFLICT`.
Invalid input fails validation before receipt lookup.

A failed transaction leaves no successful receipt.
Receipts have no automatic expiration.
They retain historical input and result data.
History APIs read primary records rather than receipt snapshots.

## 7. Acceptance checks

1. Retrieve all 19 exercises and all three ordered split days.
2. Resolve canonical names and aliases to their exercise IDs.
3. Create a workout through the public API.
4. Add, edit, and delete sets through the public API.
5. Reject invalid dates, reps, weights, and RPE.
6. Reject unknown references without a partial record.
7. Preserve every set from concurrent commands through one service.
8. Close and reopen a real SQLite file.
9. Retrieve the exact previous records after reopen.
10. Reject new operations after service close.
11. Replay all write commands without duplicate changes.
12. Reject a request key with different input.
13. Preserve request receipts after reopen.
14. Roll back a record if its receipt fails.

Run the same contract tests against memory and SQLite.
Run `npm test`, `npm run typecheck`, and `npm run demo`.

These checks do not prove Android behavior.
They do not include an airplane-mode test.

## 8. Next phases

1. Define calendar context and load conventions.
2. Add a thin mobile client and an Android storage adapter.
3. Add workout history tools and numerical calculations.
4. Add nutrition after the workout device gate passes.

Later decisions can add notes, retrieval, and local inference.
Those features have no placeholder APIs in this milestone.
Code must compute numerical facts.
A model must not generate numerical facts or free SQL.

Android remains the first mobile target.
The initial test device is a Nothing Phone (2a) with 8 GB RAM.
The first mobile version requires no backend.

The separate validation repo records model and database experiments.
Forma has no runtime dependency on that repo.

Before model integration, resolve the earlier BF16/float32 requirement against the validated INT4 embedding artifact.
Do not use float16 for the embedding model.
Model memory and device behavior require separate acceptance checks.

A future Telegram client requires a separate privacy decision.
Telegram messages pass through its servers.
