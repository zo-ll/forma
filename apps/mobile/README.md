# Forma mobile host

Issue #9 adds the client foundation. Workout entry screens remain future work.
The host uses React Native 0.87.1 and the tested OP-SQLite 18.2.5 adapter.

## Ownership

- `@forma/core`: domain rules, record commands, dates, and calculations.
- `@forma/mobile-host`: service lifetime, confirmed preference state, and date context.
- `src/root.ts`: one composition root per React instance, retained across component mounts and Fast Refresh.
- `src/adapters/device.ts` and the Android TurboModule: native UUIDs, device timezone, and private preferences.
- `App.tsx`: navigation, read-only history preview, accessible controls, and typed error display.

Background keeps the service open. Resume recomputes today through the core.
It does not change saved workout dates. Explicit close drains accepted work.
An unknown close failure does not reopen the owner. Restart the app to create a new runtime.

## Build and checks

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

## Verification status

The root suite passes 614 Node tests. App typecheck and the native ARM64 release build pass.
The native bundle graph has no Forma Node adapter or Node runtime imports.
The current host gate has not completed on the phone. Issue #9 stays open.
The gate expects 12 fixture assertions, 6 seed assertions, and 8 restart assertions.
Seed includes a real Android background/resume cycle. Verify reads exact records before replay.
Missing records cannot be recreated to disguise a failed restart.

This gate is not the complete workout UI/device gate #14. Nutrition still waits for #14.
The dependency audit has unresolved build-tooling DoS advisories. See `docs/mobile-host.md`.
