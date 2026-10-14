# Android workout acceptance — issue #14

## Verdict

Issue #14 passes its written acceptance checklist.
This verdict does not approve every possible device condition or the final Android release.

- Device: Nothing Phone (2a), model A142.
- Package: `dev.forma.mobile.hostgate`.
- Source: `1c4841089e871f5f5009c30ccb89c60ed4ce8358`.
- Standalone APK SHA-256: `1a438d183a49ca97392c50a88e3f02a10846149d11d59174f5dd2ae7659423ae`.
- [Exact-head CI](https://github.com/zo-ll/forma/actions/runs/38567527952): both jobs passed, including 711 tests and the cold Android build.
- Independent reviewer: `opencode-go/deepseek-v4.1-flash`.

## Acceptance evidence

| Requirement | Result |
| --- | --- |
| Create, edit, resume, finish, inspect, delete | Native observations passed across the identified sessions. The latest session also passed deletion and discard cancellation. |
| Repeated taps | Two taps saved one set. Explicit confirmation permitted an identical second set. Three taps saved only that second set and left Save disabled. |
| Background, process stop, reopen | The earlier session proved unchanged records and distinct restart PIDs. The latest restore also survived force-stop and relaunch. |
| Upgrade | The current APK preserved every original catalog record, primary DTO, and raw receipt exactly. |
| Catalog and three split days | The earlier native pass verified all 19 exercises and the three numbered split orders. Only `Entry.tsx` changed at runtime after that pass. |
| Backup and restore | Fresh backups preceded changes. Final restoration returned every original primary DTO, catalog record, and raw receipt, including the active workout. |
| Receipt preservation | Only one legitimate restore receipt remained beyond the original receipts. No test primary record or test receipt remained. |
| Measurements and failures | The records include scoped Save response bounds, memory samples, native failures, driver errors, and results. |
| Airplane mode | No test was required or claimed. |

The latest native pass also verified independent Progress facts, unknown-load exclusion, exact source links, and a History date filter.
It verified theme selection, restoration of the original preference, explicit service close, and recovery after restart.

## Evidence transfer

The earlier complete workout session used source `59114504aae7bd8a041d8048b14ae7a058e6f105`.
The runtime diff from that source to the accepted source changes only `apps/mobile/src/screens/Entry.tsx`.
The latest native pass covers the changed Save behavior.
Earlier catalog and lifecycle observations remain applicable to their unchanged paths.
Older UI and scale sessions supply additional observations, not new exact-head benchmarks.

The latest assertion ledger contains 83 pass rows and one initial driver-error row.
The driver first checked a discard header outside the viewport.
A bounded continuation verified the header, exact owned marker, confirmed discard, and protected primary records.
That failure does not identify an unresolved app defect.

## Measurements and limits

Two Save observations give conservative visible-result bounds of 1.023 seconds and 1.486 seconds.
The host recorded each interval from the native command start through all burst input, screenshots, and transfers.
The first result frame already shows the accepted set.
These intervals include driver overhead. They do not measure isolated app latency.
They do not define an official performance threshold or describe other operations.

The `window-1c48410/memory.txt` sample reported 251,355 KiB PSS and 379,332 KiB RSS.
The earlier `5911450` session reported 272,952 KiB PSS and 381,720 KiB RSS.
Neither sample measures peak memory.
The earlier frame sample reported p95 28 ms. Frame duration is not complete operation latency.

Each burst includes a screenshot after each tap.
The observations do not prove every possible input interval.
Same-frame native bounds and per-tap images place confirmation away from the repeated tap coordinates.

Screen-reader focus, large fonts, arbitrary dataset sizes, and comprehensive operation benchmarks remain unverified.
They do not form new requirements for this checklist.
This acceptance does not waive applicable privacy or release requirements in issues #31–32.

## Local proof

An independent Node comparison reproduced the Python archive comparisons directly against the protected local files.
It verified exact restored modules, original receipts, the single new restore receipt, deliberate set identities, and both upgrade snapshots.
It also hashed the installed APK and the CI APK against the clean source metadata.

Private evidence remains outside Git:

- `~/.local/state/forma/issue-14/window-1c48410/RESULT.md`
- `~/.local/state/forma/issue-14/approval/FINAL-VERDICT.md`
- `~/.local/state/forma/issue-14/approval/local-archive-verification.log`

The independent approval required authentic local comparisons and explicit acceptance of the scoped response bounds.
The separate local comparison passed. This document records the bounds and their limits without a broader latency claim.
No raw archive, personal record, screenshot, device endpoint, APK, or key forms part of this report.

The phone returned to usable Home with the exact original active workout and the original app preference.
The test driver exited. No further phone operation has authorization.
