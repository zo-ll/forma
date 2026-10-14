# Forma — Specification

Version 0.7. Current implementation: the Android workout app and local archive. Active plan: all remaining non-nutrition issues.

## 1. Purpose

Forma is a local-first fitness service for one user.
Android v1 includes workouts, notes, and local history questions.
The mobile app acts as a thin client of the service.
Workouts remain the Android record module.
Independent notes have portable core support. Notes persistence, screens, and inference remain planned.
The user excluded nutrition #15–17, meal photos #34, and nutrition-specific assistant tools on 2026-10-14.

## 2. Current scope

- Use the supplied exercise catalog.
- Preserve the supplied split days and exercise order.
- Create historical workout records and start saved workout sessions.
- Resume, finish, and discard the one in-progress workout.
- Edit metadata and delete whole workouts.
- Add, edit, and delete sets.
- Retrieve workout records and filter history by date, exercise, and status.
- Page history with stable order and reject stale cursors after record changes.
- Retrieve previous sets and code-derived finished-workout facts with exact sources.
- Store records locally in SQLite.
- Export and atomically restore local records with explicit confirmation.
- Use Android workout, history, progress, and Settings screens.
- Test the core without React Native.

The app has no nutrition module, integrated standalone notes, or models.
The core notes module supports create, detail, revision-checked edits, deletion, and bounded history.
See [the notes contract](docs/notes-contract.md). Its storage adapter and screens remain issues #20–21.
The workout device gate #14 passed its [written checklist](docs/verification/android-workout-1c48410.md).
Workout notes remain a field of a workout record.
The catalog has no edit API in this milestone.

## 3. Architecture

`@forma/core` defines domain rules and capability contracts in plain TypeScript.
The core does not import React, Expo, a SQLite driver, or native handles.

`@forma/adapters` implements the core ports.
The first adapter uses SQLite in Node.
The injected Android adapter uses OP-SQLite. Its shared contracts and restart checks passed on the target phone.
The Android client exists. The production-signed release and its complete device gate remain planned.

Each host constructs adapters and injects them into `createFormaService`.
Clients use the same public service API.
The service does not require a server.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the current API and port contracts.
See [ROADMAP.md](ROADMAP.md) for planned phase contracts, acceptance gates, and unresolved decisions.

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

Fields: `id`, `date`, `splitDayId`, `notes`, `durationMin`, `createdAt`, `updatedAt`, `sets`, `status`, `finishedAt`.

The client supplies the calendar date in the user's timezone.
The date has `YYYY-MM-DD` format.
The clock supplies UTC timestamps for the audit fields.
The host supplies the current device timezone for relative calendar queries.
Today is the local calendar day at the supplied UTC instant.
This week is the complete Monday-to-Sunday week that contains today.
Last week is the preceding complete Monday-to-Sunday week.
Saved workout dates never change after a timezone change.

The split day and duration are optional.
Notes default to an empty string.
A new workout has no sets.
`workouts.create()` saves a finished historical record with no invented finish timestamp.
`workouts.start()` saves an in-progress session. Only one can exist at once.
Every set saves immediately. App shutdown does not change the state.
Resume reads the saved session. Finish saves finished state and a UTC finish timestamp.
Finish never estimates duration or changes the workout date.
Finished records remain editable. Metadata edits never reopen a session.
Discard deletes only an in-progress workout. Whole-workout deletion accepts either state.
The mobile UI must confirm discard and deletion before it sends a command.

### Set

Fields: `id`, `exerciseId`, `reps`, `weightKg`, `rpe`, `position`, `loadConvention`, `implementCount`.

Reps must be positive safe integers.
Weight must be finite and non-negative.
RPE is optional.
If present, RPE must be finite and between 1 and 10.
Decimal RPE values are valid.
Set positions start at zero.

The service stores the entered load in kilograms.
It never infers a load convention from an exercise name or equipment.
The conventions are `unknown`, `entered`, `per-hand`, `combined`, and `body-weight`.
Per-hand sets require an explicit implement count of 1 or 2.
Other conventions require a null implement count.
An omitted convention defaults to unknown. Existing sets remain unknown until an explicit update confirms them.
A body-weight set stores added external load only, not body mass.
The core can convert per-hand load to combined load using the explicit count.
Load comparisons require the same exercise and compatible conventions.
Entered and combined loads remain separate. Unknown and body-weight loads cannot be compared.
Finished-workout statistics include counts, supported volume, best loads, and best reps at each exact load.
Per-hand reps count reps per implement. Do not enter an alternating total as per-hand reps.
Facts carry explicit units, saved-date context, and exact source references.
Best facts apply only to the selected range. The service does not estimate a one-rep maximum.
[docs/history-contract.md](docs/history-contract.md) defines limits, ties, exclusions, and cursor rules.
Android query-fixture acceptance passed on the Nothing Phone (2a). See [storage evidence](docs/android-storage-tests.md).

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
Version 3 adds load metadata to sets. Old sets receive `unknown` and a null implement count.
Version 4 adds persisted session state and enforces one in-progress workout.
Old workouts receive finished state and a null finish timestamp. Their audit timestamps stay unchanged.
Version 5 adds a persistent history revision and primary-record triggers for cursor invalidation.
Record and revision changes share the same transaction. Failed operations preserve both.
Released migrations and saved receipt contents remain unchanged.
Legacy set result snapshots receive unknown load metadata when replayed.
Legacy workout result snapshots receive finished state with no invented finish time.
Deletion removes primary records and their sets, not request receipts.

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
15. Start, resume, finish, update, discard, and delete through the public API.
16. Keep one in-progress workout, including during competing starts.
17. Resume committed sets after an abrupt Node process stop.
18. Preserve records and receipts after session-state upgrade and failed operations.

Run the same contract tests against memory and SQLite.
Run `npm test`, `npm run typecheck`, and `npm run demo`.

These checks do not prove Android behavior.
They do not include an airplane-mode test.

## 8. Approved full app plan

The planned product has these phases.
The workout core, Android client, local archive, and continuous checks exist today.
The planned contracts do not add placeholder APIs to the core.

| Phase | Public contract | Acceptance gate |
| --- | --- | --- |
| Workouts on Android | Current workout APIs plus metadata, sessions, paged history, statistics, and local archives | Complete workout flow on the target phone in #14 |
| Deferred nutrition | Future foods, meals, and code-derived totals; no active placeholders | New user authorization before implementation |
| Notes | Primary text, revisions, confirmed pain and sleep fields, and FTS5 search | Model-free records, negation checks, exact sources, and phone persistence |
| Local assistant | Optional local models, revision-bound vectors, fixed tools, deterministic facts, and source links | Correct facts, exact sources, latency, and joint memory checks in #30 |
| Android v1 release | Workouts, notes, history questions, privacy controls, and complete local restore | Signed standalone APK and complete device checks in #32 |

[ROADMAP.md](ROADMAP.md) defines each phase's public contracts and complete acceptance checks.
[Issue #1](https://github.com/zo-ll/forma/issues/1) tracks the required tasks and dependencies.
Nutrition remains excluded even after the workout device gate passes.
Catalog management #33, voice notes #35, and iOS #36 remain authorized after the first Android release.
Do not claim iOS parity before native validation.
Code must compute numerical facts.
A model must not generate numerical facts or free SQL.

The calendar rules and load conventions approved for #5 are recorded in [ROADMAP.md](ROADMAP.md#approved-calendar-and-load-contract--issue-5).
Existing records keep an unknown load convention unless the user confirms it.
The session-state rules approved for #6 are recorded in [ROADMAP.md](ROADMAP.md#approved-workout-session-contract--issue-6).
Note confirmation rules and model limits remain explicit decisions. Nutrient decisions remain deferred.
[The decision register](ROADMAP.md#decision-register) identifies their required approval points.

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
