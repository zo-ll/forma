# Forma — non-nutrition plan

## Status and scope

This document defines the approved product and its phase gates.
It does not claim that planned capabilities exist.
[Issue #1](https://github.com/zo-ll/forma/issues/1) tracks implementation and dependencies.

The workout core, Android screens, shared SQLite adapters, local archive, and continuous checks exist.
The accepted workout runtime is `1c48410`, with 711 passing tests and the cold Android CI build.
The workout device gate #14 passed its [written checklist](docs/verification/android-workout-1c48410.md).
Independent notes have portable core and memory-test support.
Notes storage, confirmed fields, screens, and the local assistant remain unimplemented.

The user authorized every remaining non-nutrition issue on 2026-10-14.
Nutrition #15–17, meal photos #34, and nutrition-specific assistant tools remain outside the current scope.
Keep those issues open as deferred work. Do not mark them complete or add placeholder capabilities.
Android v1 includes workouts, notes, local history questions, and explicit local backup and restore.
The target device is the Nothing Phone (2a) with 8 GB RAM.
The client uses React Native and TypeScript.
The release uses a signed standalone APK with an embedded JavaScript bundle.
It requires no backend, accounts, cloud sync, hosted inference, or Metro.

Catalog management #33, voice notes #35, and iOS #36 are authorized after the first Android release.
They do not block that first release. iOS requires a named device and a supported native build environment.
Meal photos, Telegram, and a reference knowledge base remain outside the current scope.
The separate [validation app](https://github.com/zo-ll/on-device-validation) supplies experimental evidence only.
Its device results do not prove Forma behavior or simultaneous model memory use.
No gate requires an airplane-mode test.

## Shared ownership and contracts

`@forma/core` owns domain validation, record behavior, date rules, and numerical facts.
Adapters own SQL, files, native runtimes, and platform access.
The mobile host constructs adapters and owns their lifetime.
Screens use the service rather than database drivers or native handles.
Add a port only when an active feature needs it.

Every domain write requires a saved `requestId` and input.
A retry returns the original result snapshot rather than current record state.
Each client must retrieve the current record when it needs that state.
Each module uses the shared receipt mechanism and an atomic transaction.
API changes must preserve supported receipt formats or provide an explicit upgrade.

Public data uses plain DTOs, promises, stable IDs, explicit units, and typed errors.
A source reference identifies a module, a record, and the relevant revision when one exists.
History tools read primary records rather than request receipts.
Models must not calculate or generate numerical facts.
Record features must work when models are absent or fail.

The following method names describe proposed contracts, not available exports.
[ARCHITECTURE.md](ARCHITECTURE.md) defines the current workout API.
Each implementation issue must finalize its input and result DTOs before code changes.
The decision register below identifies contracts that still need approval.

## Phase 1 — Complete workouts on Android

Issues: #2 through #14 in the [workout milestone](https://github.com/zo-ll/forma/milestone/1).
The existing catalog and order in [SPEC.md](SPEC.md#4-exercise-catalog) remain unchanged.

### Public contracts

- Current: `exercises`, `splitDays`, and the workout create, set, detail, and date-history APIs.
- Current: calendar context, explicit load conventions, and compatible set-load facts.
- Current: workout metadata edits and whole-workout deletion.
- Current: explicit persisted start, resume, finish, and discard behavior.
- Current on memory, Node SQLite, and native Android OP-SQLite: paged history with date and exercise filters, previous sets, selected-range best facts, and supported volume totals.
- Verified: shared Android query cases, storage diagnostics, and exact process-restart persistence. See [evidence](docs/android-storage-tests.md).
- Current: versioned archive export, validation, and atomic restore through platform adapters. See [the archive contract](docs/archive-contract.md).

A history page carries an opaque cursor and stable record order.
Each numerical result carries units, date context, load convention, and source record IDs.
Unknown or incompatible load conventions must not produce misleading comparisons.
Existing records keep an unknown convention until the user confirms it.
The approved persisted session contract below governs the current resume controls.

### Device gate — issue #14

1. Use the standalone Forma APK on the target phone.
2. Verify the exact catalog and all three ordered split days.
3. Create, edit, resume, finish, inspect, and delete workouts.
4. Verify duplicate taps, background, process stop, reopen, and upgrade.
5. Export and restore the saved records exactly.
6. Record latency, memory use, failures, and results.

The Node tests do not satisfy this device gate.
Issue [#14](https://github.com/zo-ll/forma/issues/14) passed with [documented evidence and limits](docs/verification/android-workout-1c48410.md).
The next active feature batch is notes #18–21.

## Deferred phase — Nutrition

Issues: [#15](https://github.com/zo-ll/forma/issues/15), [#16](https://github.com/zo-ll/forma/issues/16), and [#17](https://github.com/zo-ll/forma/issues/17).
These issues and their contracts remain outside the current authorization, even after the workout gate passes.
They require new permission. Their absence must not block notes, assistant tools, privacy checks, or the Android release.

### Public contracts

| Proposed capability | Contract |
| --- | --- |
| `foods` | Create, edit, delete, retrieve, and list local foods with nutrient sources |
| `meals` | Create, edit, delete, retrieve, and page meals with quantities in grams |
| `nutrition.totals` | Return code-derived calories, protein, carbohydrates, and fat for an explicit date range |

Foods carry manual values or supplied label values with their quantity basis and source metadata.
Meals carry food references, quantities, meal types, calendar dates, and audit timestamps.
Missing nutrients remain unknown rather than zero.
The contract must define food edits and their effect on saved meals before implementation.
Numerical precision and the rule to round values remain explicit decisions.
No model estimates food nutrients, portion mass, or totals.

### Acceptance gate

1. Pass shared nutrition contracts on Node and Android.
2. Test invalid values, duplicate requests, edits, deletions, and date totals.
3. Preserve workouts during schema upgrades.
4. Preserve exact quantities, source values, IDs, and timestamps after reopen.
5. Include foods and meals in archive export and restore.
6. Verify meal entry and source-backed totals on the target phone.

## Phase 3 — Notes and confirmed fields

Issues: [#18](https://github.com/zo-ll/forma/issues/18) through [#21](https://github.com/zo-ll/forma/issues/21).
Notes must work without inference.
The core-only #18 implementation and its limits are in [the notes contract](docs/notes-contract.md).
It is not yet composed into the SQLite service or Android host.

### Public contracts

| Proposed capability | Contract |
| --- | --- |
| `notes` | Create, edit, delete, retrieve, and page independent notes |
| `notes.confirmFields` | Save explicit confirmation for typed pain, sleep, and personal-best fields |
| `notes.searchText` | Return paged FTS5 matches with exact source references |

Notes carry stable IDs, date context, text, kinds, source references, and revisions.
Save the primary note before any extraction or text vector request.
A derived job must identify the note revision that it uses.
An edit or delete must invalidate obsolete derived data.
The UI must distinguish confirmed, uncertain, and pending states.

Pain fields require explicit confirmation before they become confirmed facts.
A body-part mention does not prove pain.
A statement such as “left knee felt fine” must not become a positive pain fact.
Missing or uncertain values remain explicit.
Rules and keyword lists precede model extraction.
A personal-best claim in note text does not replace code-derived workout facts.

### Acceptance gate

1. Test negation, ambiguity, multiple body parts, and no-match text.
2. Save and edit notes without a model.
3. Keep text, confirmed fields, and FTS5 consistent after edits and deletes.
4. Verify FTS5 in the actual Forma build.
5. Preserve exact text, revisions, and confirmation state after restart and restore.
6. Open the exact source note from each search result on the phone.

## Phase 4 — Local history assistant

Issues: [#22](https://github.com/zo-ll/forma/issues/22) through [#30](https://github.com/zo-ll/forma/issues/30).
Resolve artifact precision and device limits in [#23](https://github.com/zo-ll/forma/issues/23) before production inference.

### Public contracts

| Proposed capability | Contract |
| --- | --- |
| Inference capabilities | Report missing, ready, and failed states through plain DTOs |
| Model import | Validate approved local artifacts before activation without a remote download |
| Note index | Bind vectors to note revision and vector profile with durable pending jobs |
| Fixed history tools | Return verified workout and note facts with units, date context, and sources |
| `history.ask` | Return an answer, clarification, no-data result, unsupported intent, or unavailable capability |

Each vector profile identifies its artifact, runtime, precision, dimensions, task prefixes, and normalization rules.
Query and document vectors must use the same compatible profile.
A model or profile change must invalidate or rebuild affected vectors.
A restart must recover pending jobs without loss of primary notes.
The service must report partial index coverage.

The rule router selects fixed read tools first.
A read tool must not edit or delete records.
Keep nutrition tools absent. Nutrition questions return unsupported or unavailable, not invented facts or zero totals.
The service must not accept model-written SQL.
Treat note text as data rather than instructions.
Pain questions require confirmed typed filters rather than vector similarity alone.
Ambiguous exercises, dates, and matches require clarification.

Code renders numerical facts and exact source links from tool results.
The local generator can supply only permitted narrative.
Reject unsupported values, dates, units, or source IDs.
Use a deterministic answer if the generator fails or returns invalid output.
Never convert missing data into an invented answer.
Do not use a remote assistant fallback.

Local model import must verify artifact identity and hash before activation.
A failure or cancellation must remove partial files and preserve the active model.
Native adapters must serialize unsafe operations and release resources.
They must not silently change a backend after failure.
Report configured backends without an unsupported effective-delegate claim.
Primary record operations must not wait for inference.

### Assistant gate — issue #30

1. Use fixed fixtures for workout, note, negation, ambiguity, no-data, and unsupported nutrition questions.
2. Verify every numerical answer against the expected code result.
3. Verify exact source links.
4. Report retrieval quality separately from answer quality.
5. Measure cold load, query latency, text rate, and peak memory in Forma.
6. Verify sequential and joint model residency against approved device limits.
7. Verify record flows during inference and after failure.
8. Test prompt injection, malformed output, unrelated text, and cancellation.

Gallery results and validation-app results do not satisfy this gate.

## Phase 5 — Complete Android v1 release

Issues: [#31](https://github.com/zo-ll/forma/issues/31) and [#32](https://github.com/zo-ll/forma/issues/32).
The release must include workouts, notes, and history questions with exact source navigation.
Nutrition and meal photos are not release dependencies. Their exclusion does not count as acceptance.

### Operational contracts

- No feature sends records, prompts, vectors, or media to remote services.
- Remove automatic telemetry and remote assistant calls.
- Disable automatic cloud backup of personal records unless the user explicitly approves it.
- Keep diagnostic logs free of personal record text.
- Document storage protection and export risks without an unsupported encryption claim.
- Keep signature keys, personal fixtures, model binaries, and APK files outside source commits.

Archive export must capture a coherent view rather than copy an active SQLite file without its WAL state.
The archive must include primary records, stable IDs, audit timestamps, and request receipts.
Its active extension contract must cover notes and later voice media.
Foods, meals, and meal photos remain future extensions. Do not archive placeholder data for absent modules.
Model binaries and rebuildable vectors remain outside normal archives by default.
A failed restore must preserve the current database.
Warn before personal data leaves private app storage.

### Release gate — issue #32

1. Use the signed standalone release APK without a server or Metro.
2. Verify workouts, notes, and history questions on the target phone.
3. Verify fresh install, upgrade, process restart, export, and full restore.
4. Verify record use without installed models.
5. Verify record preservation after failed operations and upgrades.
6. Check release permissions, requests, logs, and native SDK behavior.
7. Record the app version, artifact hash, device results, known limits, and install instructions.

A private release channel is enough.
Store publication does not form part of the gate.
The first Android release requires #14 and #18–32, including each applicable device gate.
The complete authorized roadmap also requires #33, #35, and #36.
Close the roadmap only after all authorized issues pass. Keep excluded nutrition issues open.

## Approved calendar and load contract — issue #5

The user approved these rules when work resumed on 2026-10-12.

- The host supplies the current device timezone as an IANA timezone name.
- Today is the calendar day at an explicit UTC instant in that timezone.
- Weeks start on Monday. This week includes the complete Monday-to-Sunday week.
- Last week is the previous complete Monday-to-Sunday week.
- Saved workout dates never change after a timezone change.
- `resolveCalendarRange({ nowUtc, timeZone, period })` returns inclusive `dateFrom` and `dateTo`, the timezone, and the week start.
- Periods are `today`, `this-week`, and `last-week`. The core never reads the device timezone or clock itself.
- Each set carries `loadConvention` and `implementCount`. Add commands default to `unknown` and `null` when omitted.
- Conventions are `unknown`, `entered`, `per-hand`, `combined`, and `body-weight`.
- `weightKg` always remains the entered value. A per-hand convention requires an explicit implement count of 1 or 2.
- Other conventions require a null implement count. A metadata update supplies the complete convention and count together.
- A body-weight set stores added external load only. Use 0 for an unweighted set. No total-body-weight calculation or load comparison is supported.
- Existing sets stay unknown until an explicit set update confirms them. Neither migration nor exercise names supply a convention.
- `calculateSetLoad(set)` returns a source-linked kilogram fact. It converts per-hand load to combined load with the explicit count.
- `compareSetLoads(left, right)` compares only the same exercise and compatible facts. Entered load remains separate from combined load.
- Unknown and body-weight sets cannot supply comparable load facts. Invalid or overflowing calculations fail with a typed error.
- Old receipt signatures remain valid. Legacy result snapshots gain only `unknown` and `null` metadata on replay. Stored receipts remain unchanged.

These contracts do not implement aggregate statistics, a confirmation screen, or device timezone access.
Those features remain later issues.

## Approved workout session contract — issue #6

The user approved these rules when work resumed on 2026-10-12.

- A workout has `status: 'in-progress' | 'finished'` and `finishedAt: string | null`.
- `workouts.create(input)` saves a finished historical record. Existing records migrate to finished with no invented finish timestamp.
- `workouts.start(input)` accepts the same fields as create and saves an in-progress workout. Only one in-progress workout can exist.
- Every set command saves immediately. App background, shutdown, and process stop do not change session state.
- `workouts.inProgress()` returns the saved in-progress workout or null. `workouts.resume(workoutId)` reads it without mutation.
- `workouts.finish({ requestId, workoutId })` saves finished state and a UTC finish timestamp. It never estimates duration or changes the workout date.
- Finishing an already finished record with a new request key returns the current record without changing its audit or finish timestamps.
- `workouts.update({ requestId, workoutId, date?, splitDayId?, notes?, durationMin? })` edits metadata. Null clears optional split day or duration.
- `workouts.delete({ requestId, workoutId })` deletes any workout with its sets.
- `workouts.discard({ requestId, workoutId })` deletes only an in-progress workout. The UI must confirm discard and deletion before sending the command.
- Finished workouts remain editable. Edits do not reopen sessions. No persisted paused state or reopening API exists.
- All new writes use atomic request receipts. A replay returns its original snapshot even after finish or deletion.
- New commands against deleted records return `NOT_FOUND`. Invalid state transitions return `CONFLICT`.
- Old workout result snapshots gain finished state with a null finish timestamp on replay. Their stored receipts and signatures remain unchanged.

The host cancels an unsubmitted operation by sending no command.
An aborted UI wait does not prove rollback after submission. The host retries the saved command key and retrieves current state.

## Approved history and numerical-fact contract — issue #7

The user approved finished-workout facts and the rules in [docs/history-contract.md](docs/history-contract.md).
Best facts mean highest comparable load and most reps at each exact comparable load within an explicit date range.
No one-rep maximum is estimated. Volume is comparable kilograms multiplied by reps, in kg·rep.
Per-hand reps count reps per implement, not an alternating total.
Groups stay separate by exercise and entered/combined convention. Unknown and body-weight records are explicitly excluded.
History defaults to finished workouts. Previous sets come from the latest finished workout strictly before the supplied date.
Record changes invalidate pagination cursors. The client restarts instead of accepting gaps or duplicates.
The contract document fixes public DTOs, ties, sources, units, and query limits.
Its Android acceptance check passed through the disposable native storage host.

## Decision register

| Decision | Required before |
| --- | --- |
| Calendar context and load conventions | Approved above for #5; preserve in statistics and screens |
| Persisted session states and record operations | Approved above for #6; preserve in workout screens |
| History, best facts, supported volume, and pagination semantics | Approved above for #7; Android query tests passed |
| Nutrient quantity basis, precision, the rule to round values, and food-edit effects on saved meals | Deferred; new nutrition authorization before #15 |
| Body-part vocabulary, typed field definitions, and user confirmation rules | #19 and exact pain questions |
| Approved weight quantization, runtime precision, and output precision | #23 and production inference |
| Artifact URLs, hashes, licenses, tokenizer requirements, and runtime compatibility | #23 and model activation |
| Memory, latency, context, and quality limits for the 8 GB phone | #23 and default model enablement |
| Storage protection, export risks, and historical receipt retention after deletion | #31 and release approval |
| Forma package identity, signature keys, and private artifact delivery | #9, #13, and #32 |

The earlier requirement for the text vector model requested BF16 or float32.
Validation used an INT4 QAT artifact for EmbeddingGemma 2 Text 270M.
Weight quantization and runtime or output precision are separate properties.
This evidence does not approve a new precision policy.
Do not use float16 for the text vector model.

The initial candidates remain EmbeddingGemma 2 Text 270M on CPU and Gemma 4 E2B on an approved configured backend through LiteRT-LM.
They remain candidates rather than default production capabilities.
No numerical budget follows from Gallery throughput or the phone's nominal RAM alone.

## Authorized enhancements after Android v1

- [#33](https://github.com/zo-ll/forma/issues/33): exercise and split day management.
- [#35](https://github.com/zo-ll/forma/issues/35): private voice notes and local transcription.
- [#36](https://github.com/zo-ll/forma/issues/36): iOS adapters after Android v1 and native validation.

[#34](https://github.com/zo-ll/forma/issues/34), local meal photos and photo retrieval, remains deferred with nutrition.

A Telegram client requires separate approval and a different privacy statement.
Telegram messages pass through its servers.
The authorized enhancements follow the first Android release. Telegram remains outside scope.
