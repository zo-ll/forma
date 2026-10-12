# Android storage test host

This is a disposable storage test app, not the Forma mobile client.
Its package is `dev.forma.storage.fixturehost`.
It writes only synthetic records in its own sandbox.
It does not access existing app data, start a development server, or request INTERNET permission.

## Requirements

- Node 24.3 or later on the supported Node 24 line.
- Android SDK Platform 37.0, Build-Tools 37.0.0, and NDK 27.1.12297006.
- A JDK compatible with Gradle 9.4.1. This host successfully built with JDK 25.
- A connected ARM64 Android phone. The build currently targets only `arm64-v8a`.
- Accepted SDK licenses. Do not accept new license terms without user approval.

The pinned framework versions are React Native 0.87.1, React 19.2.3, community CLI 20.2.0, and OP-SQLite 18.2.5.
See [binding evidence](research/op-sqlite.md) for API sources and tooling audit limits.

## Commands

From the repository root:

```sh
node scripts/android-test-host.mjs build
adb devices -l
node scripts/android-test-host.mjs run
```

The build creates a marked framework project under `/tmp/forma-storage-fixture-host`.
Set `FORMA_ANDROID_TEST_HOST` to use another disposable directory.
The script refuses to overwrite an existing unmarked directory.
It installs native dependencies only in that external directory.
The root core and adapter packages remain usable without React Native dependencies.
The build embeds a production JavaScript bundle and checks its source map for forbidden Node entries.

Set `ANDROID_SERIAL` if multiple devices are connected.
The run command installs the separate test APK.
If that package already exists, inspect it before adding `--replace-test-host`.
That flag can update only the test package, not the production Forma app.
The script does not clear global device logs.
Results go to the external host's `device-results.json`.

## Expected checks

- The same 116 workout/request/load/session cases already used by memory and Node SQLite.
- The same 16 history-query cases used by memory and Node SQLite.
- Eleven storage diagnostics for native pragmas/version, errors, transaction rollback, serialized snapshots, ownership, close/reopen, migration recovery, and unsupported schemas.
- A separate process-restart check. Seed mode keeps the native connection open. The ADB host force-stops the test app. Verify mode must use a new PID and retrieve exact workout/set/session data and original request snapshots.

The current expectation is 143 fixture/diagnostic cases plus seed and restart verification.
A failed case stops that run and reports its error. It is not a partial PASS.
Only successful device results satisfy the native acceptance checks.
Node binding simulations and an APK build do not satisfy them.

## Current state

The release APK build passed. Its mobile graph had 558 source entries and used OP-SQLite's native `lib/module` entry.
The Nothing Phone (2a), A142, Android 16/API 36, passed all 143 cases at clean source HEAD `90781dcd75e8b54fb82f5651dbb3e0525a19ae27`.
Seed and verify each passed, with distinct PIDs 21830 and 21887.
[Sanitized device results](verification/android-storage-90781dc.json) include source fingerprints and the tested APK hash.
Earlier runs found a stale-bundle check, first-install probe, and message-only native error mismatch. All are fixed.
The APK update delay came from overlapping install requests. Wait for a pending request to finish before retrying; do not queue repeated updates.
Native acceptance for #7/#8 is satisfied. Their closure follows the final approved merge.
No workout UI/device gate #14 approval is implied.
Rebuild after any source change before recording final exact-head device evidence.

After testing, remove only this disposable app if the user wants cleanup:

```sh
adb uninstall dev.forma.storage.fixturehost
```
