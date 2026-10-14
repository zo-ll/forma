# Forma

Forma is a local-first fitness app with a portable TypeScript service.
The Android app records workouts and supports local backup and atomic restore.
The core also supplies a portable notes module. Notes storage and screens are not integrated yet.
The active plan excludes nutrition, meal photos, and nutrition-specific assistant tools.

## Status

The workout core and a SQLite adapter for Node exist.
The injected Android adapter passed all 143 native storage cases on the Nothing Phone (2a).
Exact record and receipt persistence also passed across a process restart.
Issues #9–13 added the Android host, workout screens, history/progress screens, local archives, and continuous checks.
The accepted workout source `1c48410` passed 711 tests. The cold CI build produced the standalone ARM64 APK.
The archive device pass preserved all original records and receipts exactly.
The workout device gate #14 passed its written checklist. See [the acceptance record](docs/verification/android-workout-1c48410.md).
See [the mobile host](apps/mobile/README.md) and [continuous checks](docs/ci.md) for commands.
See [docs/android-storage-tests.md](docs/android-storage-tests.md) for commands and remaining checks.
The approved Android v1 plan includes workouts, notes, local history questions, and local backup and restore.
Nutrition #15–17 and meal photos #34 remain open but deferred.
Catalog management, voice notes, and iOS remain authorized after the first Android release.
[ROADMAP.md](ROADMAP.md) separates that plan from current capabilities and defines each phase gate.

The service can:

- List your 19 exercises and three split days.
- Resolve exercise names and explicit aliases.
- Create finished historical workouts with an explicit calendar date.
- Start, resume, finish, and discard one saved in-progress workout.
- Edit workout date, split day, notes, and duration.
- Delete a whole workout with its sets.
- Add, edit, and delete sets.
- Retrieve workouts and filter history by date.
- Preserve records after the database closes and reopens.
- Replay successful write commands without duplicate changes, including after restart.
- Save explicit set load conventions without assuming the meaning of old weights.
- Export, inspect, and atomically restore versioned local archives.

The core also resolves calendar ranges from an explicit UTC instant and device timezone.
It supplies source-linked load facts and rejects incompatible load comparisons.
It also returns bounded history pages, previous sets, and source-linked finished-workout statistics.
Statistics keep incompatible load conventions separate and report excluded sets.

The portable notes module supports create, detail, revision-checked edits, deletion, and bounded history.
It uses the shared receipt mechanism and requires no model.
See [the notes contract](docs/notes-contract.md) for its storage port and current limits.

The core does not use React, Expo, a SQLite driver, or a model.

## Start

Use Node 24 or later. The Node SQLite API still has experimental status.

1. Install the dependencies.

   ```sh
   npm ci
   ```

2. Run the tests.

   ```sh
   npm test
   ```

3. Run the example.

   ```sh
   npm run demo
   ```

The example creates fictional records in a temporary SQLite file.
It edits and deletes sets, closes the service, and verifies the records and request replay after reopen.
It removes the temporary database after the check.

Use `npm run typecheck` to check the types.
This command also emits the libraries and their type declarations.

## Repeated writes

Every write requires a `requestId`.
Before a write, save its `requestId` and input.
Reuse both values for every retry of that command.
A new command requires a new `requestId`.

A repeated command returns its original result, not the current record.
A different input with the same key produces `CONFLICT`.
The client must retrieve the record if it needs the current state.

## Packages

- [`@forma/core`](packages/core/src/index.ts) owns the domain rules and public API.
- [`@forma/adapters/sqlite`](packages/adapters/src/sqlite/index.ts) exports shared migrations and the synchronous driver contract.
- [`@forma/adapters/node`](packages/adapters/src/node/index.ts) implements the storage port and constructs the Node service.
- [`@forma/adapters/android`](packages/adapters/src/android/index.ts) binds injected native OP-SQLite to the same storage contract.
- [`@forma/mobile-host`](packages/mobile-host/src/index.ts) owns portable host lifetime, preferences, and calendar context.
- [`apps/mobile/`](apps/mobile/README.md) constructs the Android host and renders workout, history, progress, and archive screens.
- [`examples/workouts.ts`](examples/workouts.ts) acts as a client of the service.
- [`tests/`](tests/) checks the same behavior with memory and SQLite adapters.

Each host constructs its adapters and injects them into the core.
The Node entry point remains separate from the mobile adapter and bundle.

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the API contracts.
Read [SPEC.md](SPEC.md) for the current scope and exercise catalog.
Read [ROADMAP.md](ROADMAP.md) for the full app contracts and unresolved decisions.

## Limits

The Android host has workout entry, history, progress, preferences, and archive screens.
The workout gate passed with [documented limits](docs/verification/android-workout-1c48410.md).
Notes currently have core and memory-test support only. SQLite storage, archive integration, and screens remain planned.
Inference remains unimplemented.
Nutrition and meal photos are outside the active scope.
The catalog has no edit API.
Use `workouts.history()` for bounded pages. The legacy `workouts.list()` remains unbounded for compatibility.
A record change invalidates earlier page cursors. Restart the query after a cursor conflict.
History queries and facts have explicit limits in [docs/history-contract.md](docs/history-contract.md).
The mobile host supplies the current device timezone through its native adapter.
Per-hand volume uses reps per implement, not an alternating total across both hands.
Body-weight sets store added external load only. Total body-weight load calculations are not supported.
Request receipts have no automatic expiration.
They can retain input and result data from deleted sets.
SQLite files contain unencrypted data.

## Separate validation app

The private validation repo is:
https://github.com/zo-ll/on-device-validation

It owns the test UI, native inference module, model import, and device checks.
Forma has no runtime dependency on it.

The intended mobile client uses React Native and TypeScript.
Android uses the physically verified OP-SQLite adapter.
The initial inference candidates remain EmbeddingGemma 2 Text 270M on CPU
and Gemma 4 E2B on GPU through LiteRT-LM.
These models do not form part of this milestone.

The separate validation app's device tests do not prove Forma's service on Android.
Forma's own storage and thin-host tests now supply that evidence.
They do not prove simultaneous model memory use.
A future Telegram client requires a separate privacy decision.
Telegram messages pass through its servers.
