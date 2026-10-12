# OP-SQLite binding evidence

Research date: 2026-10-12. Versions: OP-SQLite 18.2.5, React Native 0.87.1, community CLI 20.2.0.
The isolated research worker checked published package sources and official documentation.
The coordinator then built a release test APK with those versions.
This document records API evidence and completed storage verification. It does not approve the production UI.

## Binding

- `open({ name })` (published archive `src/types.ts`) returns the local native database synchronously. `openSync` is a different replica API; do not use it here.
- `executeSync(sql, params?)` returns `rows: Array<Record<string, Scalar>>`. Scalar values include strings, numbers, null, booleans, ArrayBuffer, and ArrayBufferView. Forma's migration parameters are a supported subset.
- `close()` closes the native connection synchronously.
- **Correction from physical execution:** the published 18.2.5 archive has no structured SQLite error fields. Its `cpp/OPBridge.cpp` throws `std::runtime_error("[op-sqlite] statement execution error: " + sqlite3_errmsg(db))`. The initial research incorrectly attributed newer upstream HEAD code/types to the published package. The phone exposed this mismatch after all 132 service/history cases passed.
- The adapter accepts numeric 1555/2067 when a binding supplies them. For published 18.2.5, it recognizes only the exact vendor-prefixed UNIQUE message for known Forma unique columns. It never treats CHECK, foreign-key, unrelated, or unprefixed errors as ID conflicts. A supplied non-unique extended code overrides any message fallback.
- Published source evidence: [immutable npm archive](https://registry.npmjs.org/@op-engineering/op-sqlite/-/op-sqlite-18.2.5.tgz), `cpp/OPBridge.cpp`, execution failure branch. Do not use newer upstream declarations as evidence for this archive.
- `db.transaction()` (published archive `src/functions.ts`) uses a deferred transaction. Forma instead sends BEGIN IMMEDIATE/COMMIT/ROLLBACK through executeSync and its own serialized queue.
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

The Nothing Phone (2a), A142, Android 16/API 36, passed all 143 native cases after the message-only compatibility fix.
Exact records and request snapshots survived force-stop and restart in distinct processes.
[Sanitized evidence](../verification/android-storage-90781dc.json) identifies the tested source and APK.
The adapter's Node binding simulations alone are not Android verification.
The native acceptance checks for #7/#8 now pass. GitHub closure follows the approved merge.
A storage-only test host cannot approve workout UI/device gate #14.

The generated template's npm audit reports unpatched denial-of-service advisories in tooling dependencies:
[braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and [sprintf-js](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).
Neither package reached the mobile bundle. The test host does not start a Metro development server and has no INTERNET permission.
Do not claim that its tooling audit is clean. The root library project audit is clean.
Do not apply npm's proposed major-version downgrades without a separate compatibility check.
