# Android inference contract — issue #25

## Authority and default

The [model policy](model-policy.md) controls artifacts, precision, backends, and budgets.
The [portable contract](inference-contract.md) controls the public API, cancellation, and source checks.

`createAndroidInferenceRuntime` implements the portable runtime through an injected `AndroidInferenceBinding`.
Both capabilities are missing unless the caller explicitly enables them.
The normal mobile root does not inject this runtime.
Import does not enable inference.
Issue #30 still controls default enablement.

A ready profile is a software declaration, not evidence of a successful model load.
The native configuration requests float32 activations explicitly.
The generator candidate must pass the float32 GPU check on the target phone.
A failed float32 GPU load must fail inference, without a float16 or CPU retry.

## Profiles and DTOs

The adapter declares the exact approved artifacts and LiteRT-LM `0.18.0`.
The embedding profile requests CPU, float32, 256 dimensions, and L2 normalization.
The core adds the task prefix once.
The adapter passes the fully prefixed text without a second prefix.
The core validates vector norm and nonzero output.
The adapter rejects non-float32 components and mismatched native metadata.

The generation profile requests GPU and float32 activations.
The native configuration limits context to 2048 tokens and output to 256 tokens.
The portable character limit is an additional limit, not a token count.
No model output writes a record or a receipt.

`AndroidInferenceBinding` has four methods:

| Method | Contract |
| --- | --- |
| `openInference(ownerId)` | Acquire one exclusive process lease without a model load. |
| `runInference(ownerId, sequence, request)` | Run one JSON request on the inference worker. |
| `cancelInference(ownerId, sequence)` | Request cancellation of the matching operation. |
| `closeInference(ownerId)` | Drain accepted work and release native resources and the lease. |

Sequences start at one and increase by one for each native request.
An early cancel can target only the next sequence.
A stale cancel cannot affect a later request.
Native paths and SDK handles never cross the bridge.
Errors contain fixed messages, not SDK exception text or note content.

Requests contain one of these DTOs:

- `{ kind: 'embedding', task, text }`
- `{ kind: 'generation', text, instruction, maxOutputCharacters }`

Successful responses contain `kind`, `artifactId`, `sha256`, `runtimeVersion`, `backend`, and `runtimePrecision`.
An embedding response also contains `task` and `vector`.
A generation response also contains `text`.
The adapter rejects unknown response fields.
`backend` means the configured backend, not an effective delegate.

## Lifetime and cancellation

One binding has one adapter owner.
A failed close retains ownership because native resources can remain live.
The adapter does not admit concurrent native work.
The core owns its bounded queue outside the record queue.

Cancellation can end a portable wait before native work stops.
The adapter retains its slot until the original native promise settles.
Close requests cancellation and waits for that promise before native close.
A cancellation acknowledgement does not prove resource release.

## Native ownership and memory

`FormaInferenceModule` delegates to `InferenceCoordinator` on a dedicated serial worker.
`SerialModelRuntime` retains at most one model handle.
A role change closes the current model before the next model load.
A failed resource release retains the handle and the process lease.
A second React instance cannot acquire that lease.

The worker rechecks file size and SHA-256 before each model load.
The inference reader does not delete import temporary files.
Models and compiled caches stay under `noBackupFilesDir`.
Native SDK diagnostics are disabled because they can contain private input or paths.

The generator creates a new conversation for each request.
It disables tools, automatic tool execution, speculative decode, and thought output.
The packaged model supplies the chat template.
The native response respects the requested UTF-16 character limit without a split surrogate pair.

Cancellation cannot preempt file verification, engine initialization, or synchronous embedding.
Generation requests SDK cancellation when a live conversation exists.
The worker discards a cancelled result only after the SDK call returns.
A detached cancellation hook cannot access a closed conversation.

Memory pressure cancels active work and queues model release after the current SDK call.
It rejects further inference until process restart.
It does not reload a model automatically.
Module invalidation follows the same serial resource-release path.
Neither path accesses the record store.

The build pins LiteRT-LM `0.18.0` and Kotlin `2.4.0`.
The SDK publishes Kotlin metadata `2.4.0`; the build does not bypass metadata checks.
JVM tests use Java 21 because the SDK publishes Java 21 class files.
`LiteRtInferenceConfigTest` inspects actual SDK configuration objects without a JNI load.
The SDK [configuration source](https://github.com/google-ai-edge/LiteRT-LM/blob/b2f686e2ed4718fb84ec398a61dd59ca0f0aff27/kotlin/java/com/google/ai/edge/litertlm/Config.kt) documents explicit activation precision.
It states that unsupported precision causes initialization failure.
This is an API contract, not target-phone proof.

## Isolated acceptance modes

Only the `hostgate` flavor accepts an explicit inference launch mode.
The app requires a cold process start because its composition root has one lifetime.
Normal launch and the existing `fixtures`, `seed`, and `verify` modes do not enable inference.

| `formaMode` | Capabilities |
| --- | --- |
| `inference-embedding` | CPU embedding only; query and document checks. |
| `inference-generation` | GPU generation only; exact saved synthetic source. |
| `inference-sequential` | Query, document, generation, then query; no joint residency. |

`formaRunId` must contain 1–80 ASCII letters, digits, or hyphens.
Generation requires exactly one saved note with this exact text:

```text
Forma inference synthetic source. Run RUN_ID
```

Replace `RUN_ID` with the same `formaRunId` value.
The diagnostic never creates, edits, or deletes this note.
It checks every search page before it accepts one exact source.
It fails if the note is absent or ambiguous, including a duplicate on a later page.
The operator controls any fixture creation and later removal.

Warning: Obtain a new exclusive phone window before any install, restart, import, fixture, or inference operation.
Do not run the normal fixture modes against an existing dataset without separate permission.
Preserve the complete current records and receipts before any authorized fixture change.

The diagnostic starts a record read for each portable inference call.
Each result reports `recordReadDuringWait`.
A false value means that the run does not prove a record read during an inference wait.
A fast inference reply does not fail the functional check.
A record change still fails the check.
The observation does not identify a specific SDK execution stage.
It reports wall-clock round-trip durations, vector dimensions and norm, output length, and configured backends.
It does not log note text, generated text, source IDs, or paths.
It closes the host before it emits `FORMA_INFERENCE_RESULT`.
A failed native close prevents a successful result.

These modes do not prove memory budgets, first-token latency, throughput, interruption behavior, or an effective delegate.
The sequential mode does not prove the #30 joint-residency budget.
The phone checklist must also cover native cancellation, memory pressure, React invalidation, and file-check latency.

## Source and device evidence

Typed adapter tests use fake native DTOs.
Native ownership tests use fake engines and real serial workers.
They prove contracts and resource order, not SDK execution.
The native binding compiles against the actual pinned SDK.
Actual APK execution remains a separate verification unit.
No device result exists for issue #25 yet.
Issues #24 and #25 remain open until their physical acceptance checks pass.
