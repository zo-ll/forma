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

## Source and device evidence

Typed adapter tests use fake native DTOs.
They prove the contract, not SDK execution.
The native implementation and actual APK checks form separate verification units.
No device result exists for issue #25 yet.
Issues #24 and #25 remain open until their physical acceptance checks pass.
