# Forma mobile host

Issue #9 adds the client foundation. Issues #10 and #11 add the workout record, history, and progress screens.
Issue #21 adds notes entry, history, exact-source detail, editing, deletion confirmation, and structured field confirmation.
See [mobile notes ownership and limits](../../docs/mobile-notes.md).
The source is integrated onto merged #20 with durable notes, literal FTS5, and atomic version-2 archives.
Physical notes FTS5, restart, archive, and UI checks remain pending. Earlier native evidence does not prove notes.
See [the design board mapping](../../docs/design-board-phase1.md) for the approved screens and decisions.
The host uses React Native 0.87.1 and the tested OP-SQLite 18.2.5 adapter.

## Ownership

- `@forma/core`: domain rules, record commands, dates, and calculations.
- `@forma/mobile-host`: service lifetime, confirmed preference state, and date context.
- `src/root.ts`: one composition root per React instance, retained across component mounts and Fast Refresh.
- `src/adapters/device.ts` and the Android TurboModule: native UUIDs, device timezone, and private preferences.
- `App.tsx`: tab and stack navigation, theme, settings, and typed error display.
- `src/screens/`: Home, start, entry, set edit, summary, details, history, and progress screens. Screens use the service for records.
  Progress also reads the device adapter and calls the core calendar resolver for relative date ranges.
- `src/forms/`: saved request keys, host-lifetime drafts, and keyboard parsing. It has no runtime imports.
- Notes screens use `FormaService.notes`. Suggestions stay separate from confirmed fields. They do not call models.

Background keeps the service open. Resume recomputes today through the core.
It does not change saved workout dates. Explicit close drains accepted work.
An unknown close failure does not reopen the owner. Restart the app to create a new runtime.

## Build and checks

See [continuous checks](../../docs/ci.md) for the pinned tools, cold build, dependency policy, and CI artifacts.
CI builds the standalone ARM64 hostgate APK. It does not start a device or run fixture modes.

From the repository root:

```sh
npm ci
npm run build
npm ci --prefix apps/mobile
npm run typecheck --prefix apps/mobile
node scripts/mobile-host-device.mjs build
```

The device runner builds only `hostgateRelease`, package `dev.forma.mobile.hostgate`.
It embeds JavaScript and needs no Metro server, backend, accounts, or models.
It has no INTERNET permission. It stores only synthetic records in a separate sandbox.

```sh
adb devices -l
ANDROID_SERIAL=CONNECTED_DEVICE node scripts/mobile-host-device.mjs run
```

Inspect an existing hostgate installation before using `--replace-test-host`.
The runner never installs, stops, or clears `dev.forma.mobile` or other apps.
A timed-out install can remain pending in Android. Do not queue another update immediately.
Results go to the marked external directory `/tmp/forma-mobile-host-results`.
They include source fingerprints, APK hash, exact assertion counts, and process IDs.
Build again after any source change. `/tmp` results do not survive every host restart.

The development app identity is `dev.forma.mobile`. Its debug build can use Metro.
The standalone development release also uses the public template debug key.
Neither build is a production-signed release. Production signing remains issue #32.
The gate flavor has a distinct sandbox and native guard for test snapshot methods.

## Preferences

Version 1 stores device date context, kg, Monday week start, and system/light/dark appearance.
Unknown, corrupt, or newer records fail without being reset.
Native SharedPreferences uses synchronous `commit()` for this small bounded record.
It can block the JS thread. Android recommends DataStore for larger or frequent writes.
A false commit result is unconfirmed, not proof that disk values stayed unchanged.
The UI keeps its last confirmed value and asks for a restart to read stored state.

## Historical issue #9 verification

The original thin-host suite passed 614 Node tests.
The current CI runs every current contract and mobile test; it does not use that old count as a limit. App typecheck and the native ARM64 release build pass.
The native bundle graph has no Forma Node adapter or Node runtime imports.
The Nothing Phone (2a) passed all 12 fixture, 6 seed, and 8 restart assertions at clean source `b474f79`.
It also passed 26 thin-host UI checks. A further 8-assertion verify run confirmed unchanged records after UI checks.
See [sanitized evidence](../../docs/verification/android-mobile-host-b474f79.json).
The source review covered all 55 changed files with zero actionable findings.
Seed includes a real Android background/resume cycle. Verify reads exact records before replay.
Missing records cannot be recreated to disguise a failed restart.

This historical gate is separate from [workout acceptance #14](../../docs/verification/android-workout-1c48410.md), which passed its written checklist.
Nutrition remains deferred and requires new authorization.
The dependency audit reports 20 high entries from one unresolved build-tooling DoS advisory.
The affected `braces` package is absent from the embedded bundle. See [audit limits](../../docs/mobile-host.md).
