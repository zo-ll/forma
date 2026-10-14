# Mobile host — issue #9

Issue #9 added the Android client foundation. Issues #10 and #11 add the workout screens on top of it.
Its package identities are `dev.forma.mobile` and the isolated `dev.forma.mobile.hostgate` test flavor.
It does not use the validation app's identity, records, or runtime dependencies.

## Contracts

The host injects the existing Android SQLite adapter into the core service.
The Android TurboModule generates cryptographically strong UUIDs and reads the device timezone.
It stores the bounded preference record in the app's private SharedPreferences.
No Node behavior polyfills are used for these platform functions.
Calendar ranges still come from `resolveCalendarRange()` in the core.
Saved dates never shift on resume or timezone changes.

A global symbol retains one composition root per React instance across Fast Refresh.
Components subscribe to snapshots. Component disposal only removes subscriptions.
Background keeps the service open. Resume refreshes date context without record writes.
Explicit close drains the service queue and prohibits reopening that host.
Startup failure closes any opened service. An unknown native close state retains database ownership.

Preference version 1 has only `dateContext: device`, `weightUnit: kg`, `weekStart: monday`, and appearance.
A missing record gets defaults. Corrupt or newer records remain intact and produce a typed failure.
Native `commit()` false means unconfirmed; it does not prove rollback.
The UI retains the last confirmed theme and reports this uncertainty.

## Issue #20 source extension — physical checks pending

The shared service now includes durable notes and literal FTS5 search.
Version-2 archives atomically replace workouts, notes, confirmations, reservations, and exact receipts.
The host records epoch invalidates note drafts and sources through the same existing records-replacement path.
The actual Forma hostgate has 22 fixture, 8 seed, and 13 verify assertions in source.
Added cases check FTS text/source identity, confirmation, deleted IDs, archive replacement, exact notes after reopen, and original receipts.
A local Node binding simulation checks the actual gate JavaScript and exact assertion counts.
That simulation is not physical Android or process-restart proof. No new device run occurred.
Earlier native evidence below applies only to its recorded source.

## Evidence and limits

- 614 root Node tests pass, including portable lifecycle/preferences and result-protocol regressions.
- App TypeScript check passes separately from the platform-free root build.
- Android ARM64 hostgate release builds with React Native 0.87.1, OP-SQLite 18.2.5, JDK 25, Gradle 9.4.1, SDK Platform 37.0, and NDK 27.1.12297006.
- The fresh embedded bundle graph excludes Node runtime modules and the Forma Node adapter.
- Clean source `b474f79` passed all 26 native host assertions on the Nothing Phone (2a): 12 fixtures, 6 seed, and 8 restart assertions.
- Seed and verify ran in distinct processes, PIDs 27751 and 27842. Seed included a real HOME/background/foreground cycle.
- All 26 thin-host UI checks passed: navigation and selection, accessible controls, device calendar display, typed invalid-date error, correction and empty history, saved history, all theme choices, close, disabled controls, and restart.
- A further 8-assertion verify run in PID 28658 confirmed unchanged exact records and receipts after the UI checks.
- The independent source review passed `b474f79`, covering all 55 files with zero actionable findings.
- [Sanitized evidence](verification/android-mobile-host-b474f79.json) identifies the tested APK and source. It contains no primary record snapshots or device connection details.
- Final evidence/documentation changes require exact-head approval before merge. These changes do not alter runtime code.

The gate runs only in the native hostgate flavor. Snapshot methods enforce that flag in Kotlin.
All records are synthetic. Verify reads exact primary records before it replays original receipts.
Every mode requires its exact assertion count. Seed and verify must have distinct process IDs.
Only this test package is installed, stopped, or inspected by the runner.
The separate workout gate #14 passed its [written checklist](verification/android-workout-1c48410.md).
Nutrition remains deferred and requires new authorization.

## Dependency audit

Root library dependencies audit clean. Babel pins were updated to remove their reported advisory.
The mobile framework toolchain still reports the unpatched `braces` DoS advisory and propagated dependency findings.
These build-time tools process project source. The app has no INTERNET permission and the standalone build starts no Metro server.
The 564-entry source map was checked explicitly. The affected `braces` package is absent from the mobile bundle.
Do not call the mobile dependency audit clean. Do not downgrade React Native or CLI major versions merely to silence it.
Production signing and release checks remain issue #32.

## Repeat the thin-host UI checks

Run the host gate first. Use only the isolated test app.

1. Open Home. Check the device date, timezone, and selected navigation button.
2. Open History. Enter `not-a-date` and load history. Check the `INVALID_INPUT` message on `dateFrom`.
3. Correct the date to a future valid date. Check the empty result and cleared error.
4. Clear the date and load history. Check the synthetic finished records.
5. Open Settings. Select dark, system, then light. Check the selected control after each confirmed save.
6. Close the local service. Check the closed message and disabled service controls.
7. Restart only the test app. Check readiness and the saved light theme.
8. Run verify with the seed run ID in a new process. Confirm exact primary records before receipt replay.

The device checks inspected native accessibility labels, button roles, selected states, enabled states, and error text.
They did not change system appearance settings, other apps, or real records.
They do not prove the complete workout workflow, screen-reader interaction, or gate #14.

## Primary platform sources

The implementation was checked against the installed 0.87.1 codegen and Gradle plugin, not newer repository HEAD.

- [React Native 0.87 TurboModules](https://reactnative.dev/docs/0.87/turbo-native-modules-introduction)
- [Fast Refresh](https://reactnative.dev/docs/0.87/fast-refresh)
- [SharedPreferences](https://developer.android.com/reference/android/content/SharedPreferences)
- [SharedPreferences.Editor](https://developer.android.com/reference/android/content/SharedPreferences.Editor)
- [Android build variants](https://developer.android.com/studio/build/build-variants)
- [Java UUID](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/UUID.html)
- [Java TimeZone](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/TimeZone.html)

See [the app commands](../apps/mobile/README.md) for build, run, and sandbox details.
