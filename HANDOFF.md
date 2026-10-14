# Forma — current development handoff

## Current scope

Issue #12 merged through [PR #49](https://github.com/zo-ll/forma/pull/49).
Its merge commit is `180d93e6cf878eec60e0e9cc6f65b2ed0cd9c16c`.
Issue #13 merged through [PR #50](https://github.com/zo-ll/forma/pull/50) at `bddc125`.
Its exact candidate `210b828` passed all 703 tests and the cold Android CI build.
See [the CI contract](docs/ci.md) and [the actual runs](https://github.com/zo-ll/forma/actions/workflows/ci.yml).
Match the run's source head before you use its result as proof.
The user authorized all remaining non-nutrition issues on 2026-10-14.
Issue #14 passed its written acceptance checklist at runtime source `1c48410`.
Next are notes #18–21, the local assistant #22–30, and privacy/release #31–32.
Catalog management #33, voice notes #35, and iOS #36 follow the first Android release.
Nutrition #15–17, meal photos #34, and nutrition-specific assistant tools remain deferred and open.
Do not add placeholder nutrition modules or treat their exclusion as acceptance.
Obtain an exclusive phone window before device operations. Native iOS proof requires a Mac and a named iOS device.

## Issue #12 result

Core owns versioned archive validation, integrity, receipt semantics, and restore exclusion.
The shared SQLite adapter performs atomic in-place replacement.
The host invalidates old views and drafts. Android owns document access; Settings owns warnings and confirmation.
Read [the archive contract](docs/archive-contract.md) before archive changes.

The reviewed and native-tested runtime head is `3dec80ca472c5cb22b5136dc28d610a5d904d2ab`.
Its installed APK hash is `77bcdfb346e0b52669270729c23685298e2e62c7db133600b23d9de2d92f2058`.
The full earlier source candidate passed 695 tests. The later layout correction passed 17 affected tests and both typechecks.
The source review covered 32/32 files. The correction review covered 2/2 fresh files.
One low notice-length/remount-key finding remains. No critical, high, or medium source finding remains.

The first native APK had overlapping archive controls after cancellation.
The corrected APK passed ordinary center taps and disjoint bounds after cancellation and invalid-file notices.
Real Android export produced a 3,503,954-byte file with 21 workouts, three sets, and 7,068 receipts.
Invalid integrity, UTF-8, and oversized documents left the complete dataset unchanged.
Restore removed one owned scratch workout and preserved every original primary DTO and raw receipt exactly.
Only one new durable restore receipt remained. Exact restored data survived process restart.
A real stale History draft cleared after restore.

At the #12 native check, the phone had 21 original workouts, three sets, 7,069 receipts, no active workout, and usable Home.
The user controls the phone. Recheck live state before any mutation.
The coordinator must obtain a new exclusive window before another phone operation.
One valid plaintext backup remains in local Downloads. It includes deleted-record command snapshots.
The temporary scale fixtures are gone. The scale marker is a cleaned tombstone.
Do not recreate scale fixtures or use normal gate seed modes without permission.

Private evidence on the original host:
- `~/.local/state/forma/issue-12/native/REPORT.md`
- `~/.local/state/forma/issue-12/VERDICT-3dec80c.md`
- `~/.local/state/forma/issue-12/artifacts/`
- `~/.local/state/forma/ui-scale-9810004/`

Keep raw archives, records, device addresses, keys, APKs, screenshots, and logs outside this public repository.

## Issue #14 history — superseded by the latest verdict

The native gate remained unapproved at this earlier stage.
The clean CI APK from source `5911450` passed actual upgrade preservation and all three catalog picker checks.
Its installed hash is `c7f2c7aa0943a8543f1ff908ff560c69d97b0cb6f488d1210c6180a3b8b36976`.
Background, real process restart, set correction, finish, and filtered History navigation preserved the expected records.
A pre-existing active workout blocked the first window. The user then authorized a temporary finish and exact restoration.
Final restoration preserved every original catalog record, primary DTO, and raw receipt, with only one legitimate new restore receipt.
The exact restored snapshot survived another real process restart. The original active workout returned unchanged.
The phone returned to usable Home. No further phone operation has authorization without a new exclusive window.

Two rapid Save taps created two identical sets with separate request IDs.
An independent DeepSeek review confirmed a medium defect in the screen's action intent.
The core correctly accepts deliberate identical sets. Do not add value-based deduplication to the core.
The focused correction requires new intent after success. A field change or explicit value confirmation permits the next Save.
The ledger shares an attempt for repeated pending commands. An unconfirmed retry reuses the original receipt.
The focused source candidate passed all 708 tests, the mobile typecheck, and the 64-file boundary check.
Three new regressions failed against the old screen. All five new cases passed against the correction.
The source at `92ea79d` passed independent 4/4 review and both CI jobs with 708 tests.
Its verified installed APK hash is `55932d6c9eafd85bf5b9fe6551de7b854e21a2ffb9971cb14b75258d86b03ed3`.
The later native subset passed two rapid Save taps and deliberate identical sets.
A three-tap burst left the next Save enabled without a deliberate new action. Its touch path remains unproven.
The independent critic recorded a medium evidence gap. The complete gate and the burst case remain unapproved.
Final restoration again preserved the complete fresh original snapshot and its active workout, with one new restore receipt.
That exact snapshot survived a process restart. The phone returned to usable Home.

The next source correction moves confirmation before the Previous sets panel, outside the Save section.
Its 18 affected screen tests, mobile typecheck, and boundary check passed.
New tests cover control order, the closed-service state, and two callbacks before settlement.
Source order does not prove native bounds. This candidate needs exact-head review, a fresh build, and native proof.
Driver failures prevented Progress, deletion/discard, theme, and service-close tests in the last window.
Correct and test the driver without phone operations before another request.
Progress facts and source navigation, the full History matrix, owned deletion/discard, themes, and accessibility remain incomplete.

Private evidence: `~/.local/state/forma/issue-14/NATIVE-RESULT.md`, `recheck-92ea79d/RESULT.md`, and `review-recheck-result.md`.
Do not treat the old #12 live counts as the current dataset.

## Latest #14 window — source `1c48410`

This section supersedes earlier next-action notes for #14.
Independent source review approved all five changed files. Both exact-head CI jobs passed, including 711 tests and the cold Android build.
The current session also passed all 711 local tests, the mobile typecheck, the 64-file boundary check, and the dated dependency check.

The user authorized a new exclusive phone window and temporary finish of the original active workout.
A fresh UI backup preceded all changes. The installed APK matched the reviewed CI artifact exactly.
Its SHA-256 is `1a438d183a49ca97392c50a88e3f02a10846149d11d59174f5dd2ae7659423ae`.
Upgrade preserved every original catalog record, primary DTO, and raw receipt exactly.

Two Save taps produced one set. Explicit confirmation permitted a deliberately identical second set.
Three Save taps produced only that second set and left Save disabled.
Per-tap screenshots and same-frame native bounds place confirmation away from the repeated tap coordinates.
The burst includes a screenshot after each tap. It does not prove every possible input interval.
Exact stored sets and receipts matched the two explicit intents.

Progress passed independent entered/combined facts, unknown-load exclusion, counts, and exact source navigation.
The History date filter opened the exact owned workout. Set correction, deletion, workout deletion, and discard passed.
All three app themes passed selection checks. The original preference returned.
Service close passed cancellation, disabled-control, and process-restart recovery checks.
One discard check first failed because its header was outside the viewport. A bounded continuation proved the exact owned session before discard.

Final restore preserved every exact original primary DTO, catalog record, and raw receipt.
Only one new legitimate restore receipt remained. The original active workout returned unchanged.
The restored modules stayed exact after force-stop and relaunch. The driver did not retain a before/after PID pair.
The phone returned to usable Home. The driver exited. No further phone operation has authorization.
One fresh plaintext baseline backup remains in Downloads. The new APK remains installed.

Independent DeepSeek evidence review approved #14 against its written checklist.
A separate Node comparison reproduced the exact archive and APK checks directly from the protected local files.
Scoped Save response bounds are 1.023 and 1.486 seconds, including native input, ADB, screenshots, and transfers.
These bounds are not isolated app latency or comprehensive benchmarks. Memory samples are not peak values.
Earlier catalog and lifecycle evidence remains applicable: only `Entry.tsx` changed at runtime after source `5911450`.
The latest pass covers that changed Save behavior. No further native rerun is required for #14.

The [public acceptance record](docs/verification/android-workout-1c48410.md) states the exact source, artifact, evidence transfer, and limits.
Screen-reader focus, large fonts, and comprehensive performance checks remain unverified. No release requirement is waived.
Large fonts and TalkBack require separate permission.
Private reports: `~/.local/state/forma/issue-14/window-1c48410/RESULT.md` and `~/.local/state/forma/issue-14/approval/FINAL-VERDICT.md`.

## Checks and build

The #13 local CI candidate passed 703 tests and the mobile typecheck.
The boundary checks, dependency policy, and workflow lint also passed.
The cold [GitHub run](https://github.com/zo-ll/forma/actions/runs/38539417810) passed both jobs at exact source `210b828`.
The downloaded APK hash matched clean metadata. The source review covered 11/11 files with one low artifact-rerun finding.

Use [docs/ci.md](docs/ci.md) for exact versions and fresh-checkout commands.
`npm test` compiles and runs all current source tests. `npm run typecheck --prefix apps/mobile` checks the mobile application.
`npm run check:boundaries` checks domain and mobile imports.
`npm run check:dependencies` verifies audits against the explicit dated risk policy.
The root audit is clean. The mobile audit still has 20 propagated high entries from one build-tool advisory.
The approval expires on 2026-11-13. Changed or new risks fail; do not silently refresh the baseline.

`node scripts/mobile-host-device.mjs build` builds only. Its separate `run` mode can create records.
Do not run device modes, reset data, uninstall, or replace the phone APK without explicit permission.
Only `dev.forma.mobile.hostgate` has device authorization.
The CI APK uses the public template debug key. Production signing remains issue #32.
A cold CI build proves the procedure, not byte-identical APKs or device behavior.

## Remaining acceptance limits

Gate #14 passed its written checklist. The Android v1 release still requires notes, the local assistant, privacy checks, and release acceptance.
Screen-reader focus and large-font behavior remain unverified; #14 approval does not claim those results.
The archive pass does not prove a valid full-limit 16 MiB file, maximum count budgets, or peak restore memory.
Activity recreation during selection, failing-provider cleanup, cloud providers, large fonts, and TalkBack focus remain unverified.
Node rollback and unconfirmed-retry tests do not substitute for native failure-injection proof.
The earlier scale measurements are observations, not an official performance threshold or arbitrary-size guarantee.

Keep domain and numerical rules in core. Keep SQL/files/native access in adapters and lifetime/exclusion in the host.
Screens own presentation. Preserve IDs, timestamps, catalog order, load meaning, request identity, and existing records.
