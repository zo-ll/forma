# OP-SQLite binding evidence

Research date: 2026-10-12. Versions: OP-SQLite 18.2.5, React Native 0.87.1, community CLI 20.2.0.
The isolated research worker checked published package sources and official documentation.
The coordinator then built a release test APK with those versions.
This document records API evidence, not Android execution approval.

## Binding

- [`open({ name })`](https://github.com/OP-Engineering/op-sqlite/blob/18.2.5/src/types.ts) returns the local native database synchronously. `openSync` is a different replica API; do not use it here.
- `executeSync(sql, params?)` returns `rows: Array<Record<string, Scalar>>`. Scalar values include strings, numbers, null, booleans, ArrayBuffer, and ArrayBufferView. Forma's migration parameters are a supported subset.
- `close()` closes the native connection synchronously.
- Native SQLite errors expose numeric `code` and `extendedCode`. [Native error construction](https://github.com/OP-Engineering/op-sqlite/blob/18.2.5/cpp/OPUtils.cpp) preserves these fields. Map only 1555/2067 to ID conflicts. CHECK and foreign-key constraints remain storage failures.
- [`db.transaction()`](https://github.com/OP-Engineering/op-sqlite/blob/18.2.5/src/functions.ts) uses a deferred transaction. Forma instead sends BEGIN IMMEDIATE/COMMIT/ROLLBACK through executeSync and its own serialized queue.
- [Foreign keys are off by default](https://op-engineering.github.io/op-sqlite/docs/gotchas). The adapter enables foreign keys, WAL, and a 5000 ms busy timeout before migration.
- [Synchronous execution blocks the JavaScript thread](https://op-engineering.github.io/op-sqlite/docs/api). Query budgets and the client write queue do not make it asynchronous.

## Platform boundary

The [package exports](https://www.npmjs.com/package/@op-engineering/op-sqlite/v/18.2.5) select different Node and React Native implementations.
The [maintainer's Node facade](https://op-engineering.github.io/op-sqlite/docs/installation) is not proof of native behavior.
Forma does not import that facade. The composition root passes the actual native `open` binding into `@forma/adapters/android`.
A structural interface lets the root Node build check adapter code without installing React Native.
Only the native test host imports OP-SQLite. SQL and native handles stay in adapters; facts stay in the core.

## Build evidence

The [0.87.1 template](https://www.npmjs.com/package/@react-native-community/template/v/0.87.1) pins React 19.2.3 and CLI 20.2.0.
It uses the new architecture, Gradle 9.4.1, AGP 9.2.1, Kotlin 2.2.0, NDK 27.1.12297006, and Build-Tools 37.0.0.
Node 24.15.0 satisfies its engine requirement.
[Gradle supports JDK 25 from 9.1](https://docs.gradle.org/current/userguide/compatibility.html).
This host built the template and OP-SQLite with JDK 25 successfully.
The SDK repository names the required platform package `platforms;android-37.0`, not `platforms;android-37`.
The exact release build command is in `scripts/android-test-host.mjs`.
The generated framework project, dependencies, APK, and device logs remain outside this repository.

The first build passed and contained 558 mobile source-map entries.
The graph contained OP-SQLite's `lib/module` native entry, not its Node entry.
It contained no Forma Node adapter or `node:sqlite` dependency.
Later builds must repeat this graph check after source changes.

## Limits

No phone or emulator has executed these fixtures yet.
The adapter's Node binding simulations are not Android verification.
Issues #7 and #8 remain open for native fixtures and process-restart checks.
A storage-only test host cannot approve workout UI/device gate #14.

The generated template's npm audit reports unpatched denial-of-service advisories in tooling dependencies:
[braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and [sprintf-js](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).
Neither package reached the mobile bundle. The test host does not start a Metro development server and has no INTERNET permission.
Do not claim that its tooling audit is clean. The root library project audit is clean.
Do not apply npm's proposed major-version downgrades without a separate compatibility check.
