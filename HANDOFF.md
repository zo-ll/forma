# Forma — session handoff

## Resume point

Issue #5 passed the critic at `93abccc` and merged in [PR #41](https://github.com/zo-ll/forma/pull/41).
Issue #6 passed the critic at `f2a0e99` and merged in [PR #42](https://github.com/zo-ll/forma/pull/42).
The merged implementation baseline is `3fa8558` on `master`.
PR #44 merged the core/Node slice of [#7](https://github.com/zo-ll/forma/issues/7) at approved HEAD `a0e5d5337a2a0ca19c8de006f963623d3f720df6`.
Both independent critics passed all 28 files and 418 tests. Master merge: `9e4c0373d8e091963c061e14672fcae9773d9822`.
PR #45 merged issue #8 at approved HEAD `73a9c5a207d2785d13f1f93e943ecbad9e3020e7`; master merge is `3fa8558ffcbaccda9638824614eb15321e7a9ee7`.
The critic covered 34/34 files with zero findings. The exact approved HEAD passed all 143 native cases and restart verification on the Nothing Phone (2a).
Issues #7 and #8 are closed. Node baseline: 582 passing tests.
Branch `issue/9-mobile-host` now adds the thin Android host, the portable host package, a native device bridge, local preferences, and an isolated hostgate flavor.
Its root suite passes 614 tests. App typecheck and ARM64 standalone build pass.
The critic passed clean source `b474f79338c83d0cbb1b85decdc53d554bca3059`: 55/55 files, zero actionable findings.
That exact source passed all 26 host assertions and 26 thin-host UI checks on the Nothing Phone (2a).
A further verify run passed all 8 restart assertions after the UI checks.
Only final evidence/documentation approval and the approved merge remain before #10.
See [the mobile host](docs/mobile-host.md) for ownership, commands, and limits.

The session interruption removed `/tmp` worktrees and artifacts. Committed work and the main checkout survived.
The unfinished gate harness was recovered from the worker session, then corrected to compare saved records before replay and require exact counts for every mode.
The critic window is restored using plain `pi` defaults and read-only tools. Request a new exact-head verdict for later changes.
The phone reconnected and completed the host and UI checks. Its endpoint remains temporary; ask for the main Wireless debugging address when needed.
Only `dev.forma.mobile.hostgate` is authorized for synthetic host tests. Do not update existing apps or records.

Current checkout: `/home/az/projects/forma`.
The old `/home/andrea/personal/forma` and `/home/andrea/personal/fitrag` paths belong to an earlier host.

## Current state

Forma has a portable TypeScript workout service and real Node SQLite storage.
It has a thin standalone Android host. Full workout entry screens are not implemented.

Complete:

- Exact catalog: 19 exercises and three ordered split days.
- Exercise names and explicit aliases.
- Historical workout creation, set add/edit/delete, detail, and date-filtered history.
- Calendar context and explicit load conventions.
- Persisted start, resume, finish, and discard, with one in-progress workout.
- Metadata edits and whole-workout deletion.
- Bounded history, previous sets, and source-linked statistics on memory, Node SQLite, and Android OP-SQLite.
- Native rollback, migrations, owner lifecycle, close/reopen, and exact process-restart persistence.
- Atomic writes, rollback, shared migrations, and schema version checks.
- Persistent request receipts for every workout write command.
- Full app contracts, phase gates, and a decision register.
- Thin Android identity, navigation, native UUID/timezone bridge, preferences, and read-only history form.
- Physical thin-host lifecycle, exact record/receipt persistence, typed form errors, theme, and explicit close/restart checks.

Schema version 3 preserves old sets as unknown. Version 4 preserves old workouts as finished historical records with no invented finish timestamp.
Both upgrades preserve request receipts. Committed in-progress sets survive an abrupt Node process stop.
Schema version 5 adds persistent history revisions. Record changes invalidate earlier cursors.
The current Node suite passes 614 tests, type checks, and the persistence example.
The merged issue #8 baseline passed 582 tests. Independent physical issue #9 evidence is in `docs/verification/android-mobile-host-b474f79.json`.
Keep Node simulation results separate from device results.
The earlier completed issues passed an independent GLM 5.3 critic review before merge:

| Issue | Change | Merged PR |
| --- | --- | --- |
| #3 | Shared SQLite migrations and recovery checks | [#37](https://github.com/zo-ll/forma/pull/37) |
| #4 | Safe repeated write commands | [#38](https://github.com/zo-ll/forma/pull/38) |
| #2 | Full Android app contracts and phase gates | [#39](https://github.com/zo-ll/forma/pull/39) |
| #5 | Calendar context and explicit load conventions | [#41](https://github.com/zo-ll/forma/pull/41) |
| #6 | Metadata, deletion, and persisted workout sessions | [#42](https://github.com/zo-ll/forma/pull/42) |
| #7 | Bounded history and source-linked statistics | [#44](https://github.com/zo-ll/forma/pull/44) |
| #8 | Injected Android SQLite adapter and native acceptance | [#45](https://github.com/zo-ll/forma/pull/45) |

Remaining tasks are tracked in roadmap #1. Four later enhancements remain separate.
Full workout screens, backup, nutrition, independent notes, and the assistant remain incomplete.
Android storage, statistics, and thin-host acceptance now pass. Next after the approved #9 merge: workout entry UI #10.

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
- `tests/fixtures/`: shared service/query cases and portable assertions.
- `packages/adapters/src/sqlite/workout-store.ts`: shared SQL, queue, transactions, and resource lifecycle.
- `packages/adapters/src/android/`: native binding, error mapping, and one-owner guard.
- `scripts/android-test-host.mjs`: standalone test-host setup, build, source checks, and device runner.
- `docs/android-storage-tests.md`: completed native storage checks.
- `packages/mobile-host/src/`: portable host lifetime and preference state.
- `apps/mobile/`: Android identity, native bridge, composition root, and screens.
- `scripts/mobile-host-device.mjs`: isolated hostgate build, source checks, and device runner.
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

The user's Nothing Phone (2a), model A142, is now connected through wireless ADB.
It runs Android 16/API 36 on ARM64. The connection endpoint is temporary; do not commit it or pairing codes.
The first run found two host-runner problems before installation: pm returns 1 for an absent package, and Gradle can reuse a stale bundle from external sources.
The runner accepts only the empty absent-package result and forces fresh bundles. The critic passed those fixes at `903b6b9e9f9b75283fd24e0f1be26d26ca572937`.
At that head the phone passed all 132 shared service/history cases plus three native diagnostics.
The next diagnostic exposed an error-field mismatch: the published 18.2.5 archive throws message-only errors, but research had described newer upstream structured fields.
The adapter now has a narrowly scoped known-column UNIQUE fallback. Diagnostics verify native message evidence as well as public codes.
The critic passed the compatibility fix at `90781dcd75e8b54fb82f5651dbb3e0525a19ae27`.
The APK update delay came from overlapping Android install requests, not a phone prompt. The retry succeeded after those requests finished.
The clean source build then passed all 143 native cases. Seed PID 21830 and verify PID 21887 proved a new process.
Sanitized evidence is in `docs/verification/android-storage-90781dc.json`. No other apps or real records were changed.
ADB commands now have timeouts so the host does not wait indefinitely.
SDK Platform 37.0, Build-Tools 37.0.0, and NDK 27.1.12297006 are now installed.
The external React Native 0.87.1 / OP-SQLite 18.2.5 test host built successfully with JDK 25.
Its release bundle used the native OP entry and excluded Forma's Node entry.
It has no INTERNET permission. Tooling audit limits are documented, not hidden.
Rebuild after source changes. The runner checks source fingerprints, expected counts, and a new PID for restart verification.
Storage-only tests, even on the target phone, cannot approve workout UI/device gate #14.

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

The current tmux session has a `critic` window running plain `pi` defaults.
The issue #9 source review used `opencode-go` / `deepseek-v4.1-flash`. Earlier reviews used GLM 5.3.
The critic reads the user's code-review skill before each exact-head review.
It sends the verdict and reviewed hash to coordinator pane `%0` when each requested review finishes.
Pane IDs apply only to the current tmux session.
Use the user's requested model selection. Do not substitute an earlier review for the current head.
Do not treat an old verdict as approval for a new head.

## Verification

Use Node 24 or later.

```sh
npm ci
npm run typecheck
npm test
npm run demo
git -c core.whitespace=cr-at-eol diff --check BASE HEAD
```

The canonical Windows Gradle wrapper uses CRLF. The `cr-at-eol` option prevents false whitespace findings for that file.

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
