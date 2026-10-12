# Forma — session handoff

## Resume point

Issue #5 passed the critic at `93abccc` and merged in [PR #41](https://github.com/zo-ll/forma/pull/41).
Issue #6 passed the critic at `f2a0e99` and merged in [PR #42](https://github.com/zo-ll/forma/pull/42).
The implementation baseline is `e10eb8d` on `master`.
The current branch implements [#7: paged history and deterministic statistics](https://github.com/zo-ll/forma/issues/7) for the core and Node SQLite.
The approved DTOs and rules are in [docs/history-contract.md](docs/history-contract.md).
Follow the exact-head critic gate before merge. Do not close #7 yet: its Android query tests have not run.
Next implement [#8: Android OP-SQLite storage](https://github.com/zo-ll/forma/issues/8) and run the same history fixtures there.

Current checkout: `/home/az/projects/forma`.
The old `/home/andrea/personal/forma` and `/home/andrea/personal/fitrag` paths belong to an earlier host.

## Current state

Forma has a portable TypeScript workout service and real Node SQLite storage.
It does not have a usable Android app yet.

Complete:

- Exact catalog: 19 exercises and three ordered split days.
- Exercise names and explicit aliases.
- Historical workout creation, set add/edit/delete, detail, and date-filtered history.
- Calendar context and explicit load conventions.
- Persisted start, resume, finish, and discard, with one in-progress workout.
- Metadata edits and whole-workout deletion.
- Bounded history, previous sets, and source-linked statistics on memory and Node SQLite.
- Atomic writes, rollback, shared migrations, and schema version checks.
- Persistent request receipts for every workout write command.
- Full app contracts, phase gates, and a decision register.

Schema version 3 preserves old sets as unknown. Version 4 preserves old workouts as finished historical records with no invented finish timestamp.
Both upgrades preserve request receipts. Committed in-progress sets survive an abrupt Node process stop.
Schema version 5 adds persistent history revisions. Record changes invalidate earlier cursors.
The last local verification passed all 418 tests, type checks, and the persistence example.
This is not a critic verdict or an Android device result.
The earlier completed issues passed an independent GLM 5.3 critic review before merge:

| Issue | Change | Merged PR |
| --- | --- | --- |
| #3 | Shared SQLite migrations and recovery checks | [#37](https://github.com/zo-ll/forma/pull/37) |
| #4 | Safe repeated write commands | [#38](https://github.com/zo-ll/forma/pull/38) |
| #2 | Full Android app contracts and phase gates | [#39](https://github.com/zo-ll/forma/pull/39) |
| #5 | Calendar context and explicit load conventions | [#41](https://github.com/zo-ll/forma/pull/41) |
| #6 | Metadata, deletion, and persisted workout sessions | [#42](https://github.com/zo-ll/forma/pull/42) |

The merged implementation baseline has 26 required tasks left and four separate later enhancements.
Android storage, screens, backup, nutrition, independent notes, and the assistant remain incomplete.
The Android statistics acceptance check also remains incomplete.

## Read first

- [README.md](README.md): current capabilities and commands.
- [SPEC.md](SPEC.md): exact catalog, current records, and storage rules.
- [ARCHITECTURE.md](ARCHITECTURE.md): current API, ports, lifecycle, and receipt behavior.
- [ROADMAP.md](ROADMAP.md): full product contracts, phase gates, and unresolved decisions.
- [Roadmap #1](https://github.com/zo-ll/forma/issues/1): task status and dependencies.

## Ownership and important files

- `packages/core/src/`: domain rules and plain DTOs; no platform imports or runtime dependencies.
- `packages/core/src/workouts/service.ts`: workout API composition and set commands.
- `packages/core/src/workouts/history.ts`: bounded queries and numerical facts.
- `tests/fixtures/history-cases.ts`: platform-independent query fixtures for Node and future Android execution.
- `packages/core/src/requests/service.ts`: shared request identity and replay.
- `packages/core/src/workouts/results.ts`: saved result validation.
- `packages/adapters/src/sqlite/`: shared migration registry and synchronous driver contract.
- `packages/adapters/src/node/`: SQLite access and Node composition.
- `tests/`: shared memory/SQLite contracts and recovery cases.
- `examples/workouts.ts`: a client that verifies persistence and replay after reopen.

The service is a library, not a server.
Hosts construct adapters and inject them into `createFormaService({ store, clock, ids })`.
Mobile screens must not own domain rules, numerical calculations, SQL, or native engine handles.

## Contracts to preserve

Every workout write requires a `requestId`.
Clients must save the key and input before the first attempt.
A retry returns the original result snapshot, not current record state.
Different normalized input or operation with the same key produces `CONFLICT`.
Input validation occurs before receipt lookup.

Receipts and record changes share one transaction.
Receipts survive reopen and have no automatic expiration.
They can retain data from deleted sets.
History APIs query primary records, not receipt snapshots.
Future API changes must preserve supported receipt formats or provide an explicit upgrade.

Schema version 2 adds receipts without a catalog reset.
Released version 1 SQL still uses `workout_groups`, `workout_group_exercises`, and `group_id`.
The adapter maps these names to `SplitDay` and `splitDayId`.
Do not rename those tables or rewrite released migration contents without an explicit compatibility plan.

Use one live service per database within a process.
Use the supplied transaction view inside each store callback.
Do not call the same store from inside its callback.
SQLite files currently contain unencrypted data.

## Approved issue #5 decisions and next decisions

The user approved the current device timezone, Monday week start, and complete calendar weeks.
Saved dates never change after a timezone change.
Per-set conventions are explicit. Old sets stay unknown until the user confirms them.
Per-hand conversion requires an explicit implement count of 1 or 2.
Entered and combined loads remain separate for comparisons.
Body-weight sets store added external load only. Their total load is not calculated or compared.
[ROADMAP.md](ROADMAP.md#approved-calendar-and-load-contract--issue-5) records the complete contract.

The user also approved the issue #6 session rules.
Create saves a finished historical record. Start saves the one in-progress session.
Sets save immediately. Resume is a read. Finish records its actual UTC instant without estimating duration.
Discard deletes an in-progress record. Finished records remain editable and deletable.
Old records migrate to finished with no invented finish time.
[ROADMAP.md](ROADMAP.md#approved-workout-session-contract--issue-6) records the full contract.

The user approved the issue #7 fact and history rules.
Use finished workouts, highest comparable load, and most reps at each exact comparable load.
Do not estimate a one-rep maximum. Volume uses reps per implement for per-hand sets.
Keep incompatible groups separate and report excluded records. Reject stale cursors and restart.
[docs/history-contract.md](docs/history-contract.md) records the finalized DTOs and limits.

No device is connected to this host. Android SDK 35 images and writable KVM are available for emulator checks.
Emulator checks can validate Android storage but cannot satisfy the Nothing Phone (2a) device gate.

`weightKg` stores the entered load in kilograms.
The service never infers combined load or adds body weight.
Use equipment only when the exercise name explicitly states it.
Keep unspecified equipment and muscle groups null.
Do not infer load convention from an exercise name.
Keep Hammer Curls in Lower and preserve every catalog membership and order.

## Review workflow

Do not use Filo.
Keep commits small and independently verifiable.

1. Read the current issue and its dependencies.
2. Implement one issue on its own branch.
3. Verify the change from a fresh dependency installation.
4. Request an independent critic review of the exact head.
5. If the review fails, correct the defects.
6. Request another review after each correction.
7. Merge only the exact head that passed review.

The current tmux session has a `critic` window running GLM 5.3 through `opencode-go`.
The critic reads the user's code-review skill before each exact-head review.
It sends the verdict and reviewed hash to coordinator pane `%0` when each requested review finishes.
Pane IDs apply only to the current tmux session.
Previous reviews used the same model and provider.
Do not treat an old verdict as approval for a new head.

## Verification

Use Node 24 or later.

```sh
npm ci
npm run typecheck
npm test
npm run demo
git diff --check
```

`typecheck` also emits the libraries and declarations.
Keep build files, databases, personal records, APK files, and model binaries outside Git.

## Phase limits

Do not start nutrition before the workout device gate [#14](https://github.com/zo-ll/forma/issues/14) passes.
Code must calculate numerical facts; models must not calculate or generate them.
Android v1 has no backend, accounts, cloud sync, Telegram, or hosted inference.
Record features must work without models.

The separate [validation app](https://github.com/zo-ll/on-device-validation) is not a Forma runtime dependency.
Its device tests do not prove the Forma app or joint model memory use.
Resolve the BF16/float32 requirement against the validated INT4 artifact in #23 before production inference.
Do not use float16 for the text vector model.
Do not require or claim an airplane-mode test.
