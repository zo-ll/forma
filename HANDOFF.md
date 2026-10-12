# Forma — session handoff

## Resume point

The implementation baseline is `66821f2` on `master`.
This handoff adds documentation only.
Product work remains paused at the user's request.
The next task is [#5: calendar context and load conventions](https://github.com/zo-ll/forma/issues/5) when the user resumes work.

Current checkout: `/home/andrea/personal/forma`.
The old `/home/andrea/personal/fitrag` path no longer exists.
Start a new session in the current checkout.

## Current state

Forma has a portable TypeScript workout service and real Node SQLite storage.
It does not have a usable Android app yet.

Complete:

- Exact catalog: 19 exercises and three ordered split days.
- Exercise names and explicit aliases.
- Workout creation, set add/edit/delete, detail, and date-filtered history.
- Atomic writes, rollback, shared migrations, and schema version checks.
- Persistent request receipts for all four workout write commands.
- Full app contracts, phase gates, and a decision register.

The last verification passed all 208 tests, type checks, and the persistence example.
All three completed issues passed an independent GLM 5.3 critic review before merge:

| Issue | Change | Merged PR |
| --- | --- | --- |
| #3 | Shared SQLite migrations and recovery checks | [#37](https://github.com/zo-ll/forma/pull/37) |
| #4 | Safe repeated write commands | [#38](https://github.com/zo-ll/forma/pull/38) |
| #2 | Full Android app contracts and phase gates | [#39](https://github.com/zo-ll/forma/pull/39) |

The roadmap has 28 required tasks left and four separate later enhancements at this baseline.
Android storage, screens, backup, statistics, nutrition, independent notes, and the assistant remain incomplete.

## Read first

- [README.md](README.md): current capabilities and commands.
- [SPEC.md](SPEC.md): exact catalog, current records, and storage rules.
- [ARCHITECTURE.md](ARCHITECTURE.md): current API, ports, lifecycle, and receipt behavior.
- [ROADMAP.md](ROADMAP.md): full product contracts, phase gates, and unresolved decisions.
- [Roadmap #1](https://github.com/zo-ll/forma/issues/1): task status and dependencies.

## Ownership and important files

- `packages/core/src/`: domain rules and plain DTOs; no platform imports or runtime dependencies.
- `packages/core/src/workouts/service.ts`: workout commands and queries.
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

## Next decisions

Before issue #5, confirm these rules with the user:

- User timezone and behavior after a timezone change.
- Week start and the meanings of today, this week, and last week.
- Entered, per-hand, combined, and body-weight load conventions.
- Explicit confirmation of existing records rather than an assumed load convention.
- Compatible calculations and comparisons.

`weightKg` currently stores the entered load in kilograms.
The service does not infer a combined dumbbell load or add body weight.
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

Previous reviews used GLM 5.3 through `opencode-go`.
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
