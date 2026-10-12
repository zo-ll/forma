# Mobile host — issue #9

The branch adds an Android client foundation, not the full workout flow.
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

## Evidence and limits

- 614 root Node tests pass, including portable lifecycle/preferences and result-protocol regressions.
- App TypeScript check passes separately from the platform-free root build.
- Android ARM64 hostgate release builds with React Native 0.87.1, OP-SQLite 18.2.5, JDK 25, Gradle 9.4.1, SDK Platform 37.0, and NDK 27.1.12297006.
- The fresh embedded bundle graph excludes Node runtime modules and the Forma Node adapter.
- Physical host-gate completion remains pending after the phone became unreachable over Wi-Fi.
- Source review remains pending. Issue #9 is not approved or merged.

The gate runs only in the native hostgate flavor. Snapshot methods enforce that flag in Kotlin.
All records are synthetic. Verify reads exact primary records before it replays original receipts.
Every mode requires its exact assertion count. Seed and verify must have distinct process IDs.
Only this test package is installed, stopped, or inspected by the runner.
The complete workout UI/device gate #14 remains separate. Nutrition still waits for that gate.

## Dependency audit

Root library dependencies audit clean. Babel pins were updated to remove their reported advisory.
The mobile framework toolchain still reports the unpatched `braces` DoS advisory and propagated dependency findings.
These build-time tools process project source. The app has no INTERNET permission and the standalone build starts no Metro server.
A source-map check must confirm that the affected tool is absent from the mobile bundle.
Do not call the mobile dependency audit clean. Do not downgrade React Native or CLI major versions merely to silence it.
Production signing and release checks remain issue #32.

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
