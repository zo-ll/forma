# Forma — current development handoff

## Current scope

Issue #12 merged through [PR #49](https://github.com/zo-ll/forma/pull/49).
Its merge commit is `180d93e6cf878eec60e0e9cc6f65b2ed0cd9c16c`.
Issue #13 adds continuous checks and a reproducible Android build.
See [the CI contract](docs/ci.md) and [the actual runs](https://github.com/zo-ll/forma/actions/workflows/ci.yml).
Match the run's source head before you use its result as proof.
After issue #13 merges, stop. Do not start #14, nutrition, or another feature without new permission.

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

The final phone has 21 original workouts, three sets, 7,069 receipts, no active workout, and usable Home.
The user controls the phone. No phone operation is scheduled.
One valid plaintext backup remains in local Downloads. It includes deleted-record command snapshots.
The temporary scale fixtures are gone. The scale marker is a cleaned tombstone.
Do not recreate scale fixtures or use normal gate seed modes without permission.

Private evidence on the original host:
- `~/.local/state/forma/issue-12/native/REPORT.md`
- `~/.local/state/forma/issue-12/VERDICT-3dec80c.md`
- `~/.local/state/forma/issue-12/artifacts/`
- `~/.local/state/forma/ui-scale-9810004/`

Keep raw archives, records, device addresses, keys, APKs, screenshots, and logs outside this public repository.

## Checks and build

The complete local CI candidate passed 703 tests and the mobile typecheck.
The boundary checks, dependency policy, and workflow lint also passed.
The actual cold GitHub run is the required merge proof; inspect its exact source head.

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

Gate #14 remains unapproved. It still requires the complete physical workout UI acceptance and screen-reader checks.
The archive pass does not prove a valid full-limit 16 MiB file, maximum count budgets, or peak restore memory.
Activity recreation during selection, failing-provider cleanup, cloud providers, large fonts, and TalkBack focus remain unverified.
Node rollback and unconfirmed-retry tests do not substitute for native failure-injection proof.
The earlier scale measurements are observations, not an official performance threshold or arbitrary-size guarantee.

Keep domain and numerical rules in core. Keep SQL/files/native access in adapters and lifetime/exclusion in the host.
Screens own presentation. Preserve IDs, timestamps, catalog order, load meaning, request identity, and existing records.
