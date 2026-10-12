# Forma

Forma is a local-first fitness app with a portable TypeScript service.
The current implementation includes workouts only.
Nutrition must wait for the workout device gate.

## Status

The workout core and a SQLite adapter for Node exist.
An injected Android adapter and a disposable native storage test host are in progress.
The APK builds, but its native fixture execution remains pending.
The production mobile app does not exist yet.
See [docs/android-storage-tests.md](docs/android-storage-tests.md) for commands and remaining checks.
The approved Android v1 plan includes workouts, nutrition, notes, local history questions, and local backup and restore.
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

The core also resolves calendar ranges from an explicit UTC instant and device timezone.
It supplies source-linked load facts and rejects incompatible load comparisons.
It also returns bounded history pages, previous sets, and source-linked finished-workout statistics.
Statistics keep incompatible load conventions separate and report excluded sets.

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
- [`examples/workouts.ts`](examples/workouts.ts) acts as a client of the service.
- [`tests/`](tests/) checks the same behavior with memory and SQLite adapters.

Each host constructs its adapters and injects them into the core.
The Node entry point remains separate from future mobile adapters.

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the API contracts.
Read [SPEC.md](SPEC.md) for the current scope and exercise catalog.
Read [ROADMAP.md](ROADMAP.md) for the full app contracts and unresolved decisions.

## Limits

This milestone has no mobile UI, Android adapter, nutrition module, or inference.
The catalog has no edit API.
Use `workouts.history()` for bounded pages. The legacy `workouts.list()` remains unbounded for compatibility.
A record change invalidates earlier page cursors. Restart the query after a cursor conflict.
History queries and facts have explicit limits in [docs/history-contract.md](docs/history-contract.md).
The mobile host must supply the current device timezone. No device timezone adapter exists yet.
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
Android is first, with OP-SQLite as the storage candidate.
The initial inference candidates remain EmbeddingGemma 2 Text 270M on CPU
and Gemma 4 E2B on GPU through LiteRT-LM.
These models do not form part of this milestone.

The earlier device tests do not prove this service on Android.
They do not prove simultaneous model memory use.
A future Telegram client requires a separate privacy decision.
Telegram messages pass through its servers.
