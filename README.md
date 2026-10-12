# Forma validation app

This app is one small Android validation build. It checks two claims on one
phone:

1. Local text-only note retrieval works with the official EmbeddingGemma 2 Text
   270M mobile artifact and LiteRT-LM.
2. OP-SQLite supports FTS5 and sqlite-vec in a real native build.

The app uses React Native and TypeScript for the app logic. A local Kotlin
module runs the inference. The app does not use the network.

This app is not the full Forma product. It has no workout forms, no cloud API,
no generator chat, no accounts, and no iOS adapter.

## Names

- Product: Forma.
- Mobile package: `forma-mobile`.
- Core package: `@forma/core` (planned).
- Adapter package: `@forma/adapters` (planned).

The repo directory remains `fitrag`.
The Android package is `com.forma.mobile`.
The new Android package uses separate app storage. The previous validation app
keeps its data. Import the model again after the new app install.

## What this app checks

- Model import from a local file picker into app-private storage.
- Model load and unload on the CPU backend and on the GPU backend.
- The declared model dimension and the model backend list.
- Text embedding retrieval over eight fictional notes.
- Task prefixes for notes and for queries.
- Truncation to 256 values and re-normalization in TypeScript.
- Cosine ranking in TypeScript.
- SQLite version, FTS5 match, sqlite-vec version, a 256-dimension nearest
  neighbor, an incompatible dimension, a transaction rollback, and close/reopen
  persistence.

## What this app does not check

- The user tested media search in Google AI Edge Gallery. That test used a
  multimodal model and image input. It did not validate text-only inference.
  This app tests text only.
- The user tested Gemma 4 E2B text generation in Gallery. That result does not
  prove embedding GPU support. The app records the configured backend. The
  LiteRT-LM SDK does not report the active delegate, so the app never claims
  that GPU is effective.
- The Gallery app falls back to CPU when a backend fails. It can also prefer CPU
  for older Mali GPU media work. This app does not fall back. A failed GPU load
  shows an error.
- Model weight size is not inference memory. The model file is about 165 MB. The
  LiteRT-LM card reports about 334 MB of CPU memory on an Android GPU test
  device. Free memory on the phone is the limit.
- This repository contains a successful arm64-v8a release compile. The compile
  ran on a Linux host with the Android SDK. The phone run, thermal stability,
  and the final device check still need the user's phone.

## Requirements

- Node.js 20 or later. The build used Node 24.
- JDK 21. The build used Temurin JDK 21.
- Android SDK Build-Tools 36.0.0, platform android-36, NDK 27.1.12297006, and
  CMake 3.22.1. Set `ANDROID_HOME`. The build test used the SDK in
  `/home/andrea/Android/Sdk`.
- A Nothing Phone (2a) with 8 GB RAM and Android 14 or later.

## Install and prepare

Run these commands in this directory.

```
npm ci
npm run typecheck
npm test
npx expo config --type public
npx expo prebuild --platform android --no-install
```

The `npm ci` command installs the exact versions in `package-lock.json`.

The `npm run typecheck` command runs the TypeScript check.

The `npm test` command runs the Jest tests one time. The tests cover the pure
TypeScript behavior and the database-test orchestration. The tests are not a
device check.

The `npx expo prebuild --platform android --no-install` command generates the
`android` directory. The command applies the local config plugin and the local
Kotlin module.

`npm run native:prepare` runs the same prebuild command.

## Build the standalone release APK

The final phone test does not need Metro. The release build embeds the
JavaScript bundle in the APK.

Set the Android environment, then run the release build.

```
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
bash android/gradlew -p android :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon
```

`npm run native:build:release` runs the same command.

The build writes the APK here:

```
android/app/build/outputs/apk/release/app-release.apk
```

The APK contains `assets/index.android.bundle`. The APK does not need Metro.
Install the APK with `adb install -r <path>`.

To build and install a debug development build, connect the phone with USB
debugging and run `npx expo run:android`. The `npx expo prebuild` step is
required. Expo Go does not work for this app. The app uses custom native code.

## Model card and download

Official model card:
https://huggingface.co/litert-community/embeddinggemma-2-text-270m-litert-lm

Download the CPU and GPU file. Do not download the original PyTorch weights and
do not download an NPU variant for this phone.

```
curl -L -o embeddinggemma-2-text-270m.litertlm \
  https://huggingface.co/litert-community/embeddinggemma-2-text-270m-litert-lm/resolve/main/embeddinggemma-2-text-270m.litertlm
```

Facts from the model card:

- Name: litert-community/embeddinggemma-2-text-270m-litert-lm.
- Modality: text only.
- Parameters: 270M. A 130M transformer and a 140M embedder.
- Weights: int4 per-channel QAT for the transformer and the embedder.
- Download size: about 165 MB.
- Output sizes: 128, 256, 512, and 768.
- The original google/embeddinggemma-2 card warns against float16 activations.
  That warning is about the original PyTorch model. The mobile artifact uses
  int4 QAT weights. Do not mix the two facts.

Do not commit the model file. The `.gitignore` file ignores `*.litertlm`.

## Import the model

1. Copy the `.litertlm` file to the phone storage.
2. Open the app.
3. Press **Import model**.
4. Select the `.litertlm` file in the Android file picker.
5. The app copies the file into app-private storage. The app shows the file name
   and the size.
6. The app stores the path. The next start reuses the path.

The app stores the model in the app `files/models` directory. No other app can
read that directory.

## CPU and GPU test procedure

1. Press **CPU**.
2. Press **Load model**. The app shows the model load time.
3. Press **Run note retrieval test**.
4. Read the four query blocks. Each block shows the top three note IDs, the note
   text, the cosine score, the expected IDs, the embedding time, and the rank
   time.
5. Press **Run database tests**.
6. Read every result line. Each line shows PASS or FAIL for one check.
7. Press **Unload model**.
8. Press **GPU**.
9. Press **Load model**.
10. If the load fails, read the error. The app does not fall back to CPU.
11. If the load succeeds, run the note retrieval test again.
12. Press **Unload model**.

A model change and a backend change clear the note-vector cache and the old
results. The app caches note vectors only while the imported model and the
backend do not change.

## Airplane-mode procedure

1. Install the app and import the model. The import needs no network.
2. Turn on airplane mode.
3. Open the app.
4. Run the CPU test set.
5. Run the GPU test set.
6. Run the database tests.
7. Confirm that every step works and that no error mentions the network.

The app does not request network data. The Android manifest still contains the
`INTERNET` permission in the debug build. The permission comes from Expo and
React Native. The app code makes no network call.

## Expected smoke-test results

The corpus is fictional. The expected IDs must appear in the top three.

| Query | Expected IDs |
| --- | --- |
| Which notes mention discomfort in my knee? | N1, N4 |
| When did I have interrupted sleep? | N2 |
| Did my shoulder bother me at the gym? | N6 |
| What did I eat for lunch? | N3 |

Note N5 can also rank high for the knee query. Note N5 says the knee felt fine.
Do not assert that the embedding handles pain negation. This test is a smoke
test. It is not a quality evaluation.

The database tests must report these lines:

```
PASS sqlite_version: SQLite <version>
PASS deterministic_sql_totals: COUNT=3 SUM=750
PASS fts5_match: MATCH knee returns N1
PASS sqlite_vec_version: sqlite-vec <version>
PASS vector_nearest_neighbor_256: nearest rowid 2 for a 256-dimension match
PASS vector_dimension_mismatch: 128-dimension insert rejected
PASS transaction_rollback: rollback kept 1 row
PASS close_reopen_persistence: the row survived close and reopen
```

A missing FTS5 or sqlite-vec feature makes one line fail. The other lines still
run.

## Database feature configuration

The `op-sqlite` section of `package.json` enables the features:

```
"op-sqlite": {
  "fts5": true,
  "sqliteVec": true
}
```

The OP-SQLite Gradle file reads this section at build time. The app uses real
compiled extensions. The app does not use a JavaScript substitute.

## Native module facts

- Maven coordinate: `com.google.ai.edge.litertlm:litertlm-android:0.18.0`.
- Version 0.18.0 supports EmbeddingGemma 2.
- The Kotlin API uses `EmbeddingEngineConfig`, `EmbeddingEngine.initialize()`,
  and `EmbeddingEngine.computeEmbedding()`.
- The app calls the engine on one worker thread. The calls are serialized. The
  UI thread stays free.
- The app requests raw vectors. TypeScript truncates to 256 values and
  re-normalizes.
- The app rejects NaN, infinity, a zero norm, and a vector shorter than 256.
- The GPU backend needs `libOpenCL.so`. The config plugin adds the Android
  manifest entry.
- The build targets `arm64-v8a`. The Nothing Phone (2a) uses that ABI.
- The app sets Kotlin 2.3.20 in `expo-build-properties`. LiteRT-LM 0.18.0
  classes carry Kotlin metadata version 2.4.0. A compiler before 2.3.20 rejects
  that metadata. Kotlin 2.3.20 reads metadata up to 2.4.0. The Expo pika
  compiler plugin has a build for 2.3.20 and none for 2.4.0, so 2.3.20 is the
  newest working version.
- The config plugin pins `org.jetbrains.kotlin:kotlin-gradle-plugin` to
  `android.kotlinVersion`. The React Native default is 2.1.20. The pin keeps the
  compiler and the stdlib on one version.

## Known limits

- The release APK compiled here and the JavaScript bundle is inside the APK.
  No physical phone was attached. The install, the model import, the CPU and
  GPU runs, the database tests, thermal stability, and the airplane-mode check
  still need the user's phone.
- The GPU delegate is not proven. The LiteRT-LM SDK reports no active delegate.
- The app does not test thermal stability. Run a long loop of note retrieval
  tests to check temperature and memory.
- The app does not test a release build. Check the release build on the phone.
- The app does not test NPU backends.
- The app does not test vision or audio. The model artifact is text only.
- The app does not prove that the GPU delegate is active. The SDK reports no
  delegate.

## Native build record

The release build ran on a Linux host. The host used Node.js 24, Temurin JDK 21,
and the Android SDK in `/home/andrea/Android/Sdk`.

The SDK components were:

- Build-Tools 36.0.0.
- Platform android-36.
- NDK 27.1.12297006.
- CMake 3.22.1.

Exact commands:

```
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME="/home/andrea/.jdks/jdk-21.0.12.1+1"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

npm ci
npm run typecheck
npm test
npx expo config --type public
npx expo prebuild --platform android --no-install
bash android/gradlew -p android :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon
```

Result: BUILD SUCCESSFUL. The APK path is
`android/app/build/outputs/apk/release/app-release.apk`. The APK is about 50 MB.
The APK is signed with the debug keystore. The APK holds only the arm64-v8a ABI.
These files are inside the APK:

- `assets/index.android.bundle` (the JavaScript bundle).
- `lib/arm64-v8a/liblitertlm_jni.so` (LiteRT-LM).
- `lib/arm64-v8a/libop-sqlite.so` (SQLite with FTS5).
- `lib/arm64-v8a/libsqlite_vec.so` (sqlite-vec).
- `lib/arm64-v8a/libreactnative.so` and `lib/arm64-v8a/libhermesvm.so`.

The OP-SQLite CMake step printed `FTS5 enabled` and `Sqlite-vec enabled`. The
compiled `libop-sqlite.so` contains the FTS5 strings. The app packages the real
`libsqlite_vec.so` file. These facts show the features are compiled in. Only the
phone run proves the runtime behavior.

No physical phone was attached. The install, the model import, the CPU and GPU
runs, the database tests, thermal stability, and the airplane-mode check were
not run here. Do not treat the compile as a device check.

The native build found and fixed one integration error. React Native resolves
Kotlin 2.1.20. LiteRT-LM 0.18.0 needs metadata 2.4.0. Kotlin 2.4.0 has no Expo
pika compiler plugin. Kotlin 2.3.20 reads metadata 2.4.0 and has a pika plugin.
The config plugin pins the Kotlin Gradle plugin to `android.kotlinVersion`.

## File layout

```
App.tsx                       The one screen.
src/embeddings.ts             Prefix, truncation, normalization, ranking.
src/noteRetrieval.ts          Note-retrieval orchestration and the cache.
src/dbTestCore.ts             Pure OP-SQLite test orchestration.
src/dbTest.ts                 Real OP-SQLite adapter.
src/noteEmbeddingsNative.ts   Typed adapter for the Kotlin module.
src/store.ts                  Model path persistence.
src/corpus.ts                 The eight notes and four queries.
modules/note-embeddings/      The local Expo Kotlin module.
plugins/withLiteRtLmAndroid.js The Android manifest and gradle plugin.
```
