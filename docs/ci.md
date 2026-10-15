# Continuous checks — issue #13

[The CI workflow](../.github/workflows/ci.yml) verifies a fresh checkout on Ubuntu 24.04.
It runs for pull requests, pushes to `master`, and manual requests.
Pull requests use their exact source head, not GitHub's temporary merge commit.
Every job starts with empty dedicated npm and Gradle directories. No action restores dependency or build caches.
The runner can supply installed SDK tools. The workflow explicitly installs the required SDK packages.

## Jobs

`Source, contracts, and dependencies` installs both locks, checks source owners, and runs every current root test.
The root suite includes core, memory/Node/Android-shim adapters, archive, host, forms, and screen callbacks.
The job also checks mobile TypeScript and both dependency audits.
It does not replace native device checks.

`Cold Android ARM64 build` assembles `hostgateRelease` through the existing build command.
The command checks the actual source map, required native modules, source identity, and APK hash.
The job also runs `:app:testHostgateDebugUnitTest` for the native model file store.
These JVM tests cover byte verification, atomic replacement, cancellation, bounded copy, and interrupted-file cleanup.
The job never calls the device runner, ADB, fixture modes, or record APIs.
It uploads only its fresh APK and source/hash metadata. Artifact retention is seven days.
The APK uses the public template debug key. It is not a production-signed release.
Production credentials and release checks remain issue #32.

Actions use verified commit pins. Workflow permissions permit only repository reads.
Checkout does not retain its token. Concurrent requests cancel the older run for the same branch or pull request.

## Tool versions

| Tool | CI version |
| --- | --- |
| Node | 24.14.1 |
| npm | 11.11.0 |
| JDK | Temurin 21; the run log records the resolved patch |
| Gradle | 9.4.1; the wrapper verifies its distribution SHA-256 |
| Android command-line tools | 23.0, archive build 16111833 |
| Android platform package | `platforms;android-37.0` |
| Android compile / target / minimum API | 37 / 36 / 24 |
| Android build-tools | 37.0.0 |
| NDK | 27.1.12297006 |
| CMake | 3.22.1 |
| Kotlin | 2.2.0 |
| React Native | 0.87.1 |
| OP-SQLite | 18.2.5 |
| ABI | `arm64-v8a` |

The root package requires Node 24.0 or later. The mobile package requires Node 24.3 or later.
CI proves the pinned Node version, not every version that the engines permit.
JDK 21 is the supported CI build family. The earlier host experiment also used JDK 25.
This procedure does not promise byte-identical APKs. Source metadata and build timestamps can change the bytes.

## Fresh local checks

Use a fresh checkout. Configure Node, npm, JDK, and the Android SDK from the table first.
Do not remove another project's caches.

```sh
set -euo pipefail
export NPM_CONFIG_CACHE="$(mktemp -d)"
export GRADLE_USER_HOME="$(mktemp -d)"
export FORMA_CI_RESULTS="$(mktemp -d)"
npm ci
npm run build
npm ci --prefix apps/mobile
npm run check:boundaries
npm test
npm run typecheck --prefix apps/mobile
npm run check:dependencies
node scripts/mobile-host-device.mjs build
(cd apps/mobile/android && ./gradlew :app:testHostgateDebugUnitTest --no-daemon -PreactNativeArchitectures=arm64-v8a)
```

Set `ANDROID_HOME` to the SDK directory. Install these packages before the build:

```sh
sdkmanager 'platforms;android-37.0' 'build-tools;37.0.0' 'ndk;27.1.12297006' 'cmake;3.22.1'
```

The build command writes the marked external directory `/tmp/forma-mobile-host-results`.
It verifies that the source stays unchanged during the build.
Its `run` mode is separate and can create synthetic records. Do not use `run` on a phone without explicit permission.

## Source owners

`check:boundaries` parses TypeScript and JavaScript imports, exports, literal `require`, and dynamic/type imports.
Core imports must stay inside core. Computed module access fails the check.
Mobile, host, Android, and shared SQLite sources cannot import Node builtins or the Node adapter.
The native build also inspects resolved source-map paths, including transitive imports and Windows paths.
It rejects Node builtins, the Node adapter, and `braces` in the embedded bundle.
Negative tests prove that real forbidden source files fail the checker process.
These checks enforce module ownership. They are not a security sandbox for arbitrary JavaScript.

## Explicit dependency risk

The root audit is clean. The mobile audit reports 20 high entries from one existing advisory:
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), a stack-exhaustion DoS in `braces`.
The entries include dependent build tools. They are not 20 independent advisories.
The native bundle excludes `braces`, and the standalone APK starts no Metro server.
Untrusted source patterns can still affect build tools. Do not call the mobile audit clean.

[The dated baseline](../scripts/dependency-audit-baseline.json) records every accepted installed version, path, severity, and cause.
It expires on 2026-11-13. The check rejects changed or new findings, critical severity, and an expired approval.
A registry error or incomplete audit also fails. The check never treats an audit outage as a clean result.
Do not update the baseline automatically. Review each change and verify that the affected code stays outside the bundle.
Do not downgrade the framework or force an incompatible override merely to silence the advisory.

## Proof and remaining gates

Inspect the [actual workflow run](https://github.com/zo-ll/forma/actions/workflows/ci.yml) before merge.
Match its source head to the pull request. Download the APK and metadata when you need the artifact identity.
The source job preserves dependency verdicts, including the accepted risk.
The Android job must finish successfully before its artifact exists.
Gate #14 passed through separate [native acceptance](verification/android-workout-1c48410.md). CI alone does not approve a device gate.
