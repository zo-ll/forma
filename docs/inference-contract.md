# Portable inference contract — issue #22

## Scope and authority

This is an optional, injected, local inference boundary. It is not a history assistant.
Default services report missing embedding and generation capabilities.
A ready declaration describes configured software only. It is not device proof or production approval.
No artifact, hash, license, device budget, or quantized policy is approved here.
Issue #23 must resolve the earlier BF16/float32 requirement and real joint memory use.
Float16 embeddings and quantized embedding weights are unsupported in this slice.
Nutrition stays absent. Future question routing must return unsupported or unavailable for nutrition, never zero facts.
There is no question router, SQL tool, extraction, automatic confirmation, or inference UI here.

## Public API and DTOs

`FormaDependencies.inference` optionally accepts one `InferenceRuntime`.
Node and Android factories pass this option through. Existing calls need no change.
`FormaService.inference` always exists:

- `capabilities()` returns an independent `InferenceCapabilities` snapshot.
- `embed({ text, task }, token?)` embeds caller text as query or document.
- `embedNote({ source }, token?)` reads the exact saved NoteSource and embeds its text as document.
- `generateNote({ source, instruction, maxOutputCharacters }, token?)` generates untrusted text from that saved note.

NoteSource is the released `{ module: 'notes', noteId, revision }` shape.
No workout source port is needed by these consumers. WorkoutSource remains unchanged.
Embedding results contain the complete profile, task, vector, and source or null.
Generation results contain the complete profile, text, and exact source.
Results are derived output, not numerical facts or confirmed note fields.
They never write records, receipts, vectors, or jobs. Note saves never invoke inference.
A result is current only at its final coherent source check. Consumers must discard cached views when records change.
There is no persistent source identity across service lifetimes.
Callers must discard old NoteSource values on the host records epoch change.
The released NoteSource shape cannot distinguish a newly submitted stale value from an identical ID/revision after completed restore.
The private epoch protects already accepted jobs; it does not add a new persistent source token.

Capabilities have embedding and generation members. Each is missing, ready, or failed.
Missing has null profile. Ready has a validated profile. Failed has a profile or null and a fixed failure reason.
The runtime declares its initial capabilities synchronously once. Core never polls readiness or promotes failed state.
Malformed declarations fail both capabilities with null profiles. Operational errors fail the affected capability.
Errors do not expose adapter messages or private text in public DTOs.

## Profiles and validation

Both profiles include ID, artifact ID and SHA-256, runtime ID and version, configured backend (cpu or gpu), weightQuantization (none only), weightPrecision, and runtimePrecision.
Weight precision and runtime precision are separate BF16 or float32 fields.
Weight quantization is explicit and separate; this contract rejects every quantized claim.
Generation has output precision text. Embedding has output precision float32, dimensions, queryPrefix, documentPrefix, and normalization (none or l2).
All fields participate in exact compatibility, including profile ID and task-prefix rules.
Reusing an ID with different metadata does not make profiles compatible.
`embeddingProfilesCompatible` validates both profiles and compares every field deterministically.
The adapter receives the task and the fully prefixed text. It must not add the prefix again.
Results must echo the entire configured profile and task. Core validates independent adapter results, not just its own inputs.
No effective delegate, fallback backend, native handle, filesystem path, or runtime SDK enters core.
Unknown keys and unsupported precision/backend claims fail validation.
The portable backend vocabulary is cpu or gpu only; native delegate discovery is deferred.
Quantized generation profiles are also unsupported in this conservative slice.
Hash shape validation is not artifact verification.

Source limits (not device-proven budgets):

- Text: 16,384 UTF-16 code units, including the task prefix.
- Instruction: 1,024 code units. Prefix: 512. Identity strings: 128.
- Dimensions: 1–4,096. Output: 1–4,096 code units, within the requested maximum.
- One active runtime call and four waiting jobs per service, shared by both features.

Text rejects blank values, NUL, and unpaired surrogates. Prefixes can be empty.
Vectors must have the exact dimension, finite float32-representable components, and a nonzero finite norm.
L2 output must have norm within 0.0001 of one. Core does not silently normalize or truncate.
Inputs and profiles are copied before queuing. The adapter cannot mutate retained source or compatibility state.

## Errors and cancellation

Inference uses FormaError with INFERENCE_UNAVAILABLE, INFERENCE_FAILURE, CANCELLED, INVALID_INPUT, CONFLICT, or SERVICE_CLOSED.
Queue overflow is CONFLICT on inference.queue. Stale sources are CONFLICT on source.
Missing/failed capabilities are unavailable. Malformed results and adapter throws/rejections fail the capability.
No partial success is returned. Cancelled or invalidated late replies cannot change capability state.

`createInferenceCancellation()` supplies a token and an idempotent cancel method.
A token exposes cancelled and subscribe(listener), which returns an idempotent unsubscribe method.
Pre-cancel rejects before admission. Queued cancel removes the job. Active cancel rejects the wait immediately and signals the adapter.
Core retains the active slot until the adapter settles. Cancellation does not claim native work stopped.
Listeners are removed on completion, cancellation, restore invalidation, and close.
Adapter token listeners cannot break cancellation if they throw.
This is not a primary write cancellation or rollback API.
No timeout clock is added. Hosts can cancel explicitly; an ignored cancellation can occupy the runtime indefinitely.

## Sources, restore, and ownership

Source-linked work reads the exact revision before dispatch and checks it again after inference.
It never sends newer text under an older source. Edits, confirmation, or deletion prevent publication.
Restore begins a new private inference epoch and cancels all accepted derived waits, even on failed restore or replay.
The existing archive token, signatures, receipt replay, transaction atomicity, and host records epoch stay unchanged.
New inference calls fail during restore. Restore does not wait for cancelled native work.
The runtime call stays outside every store callback. Only bounded source reads enter the storage FIFO.
Thus a hung runtime does not block record reads/writes, archive export, or restore.

One service exclusively owns each injected runtime object. Concurrent ownership is rejected.
Adapters must not hide the same independently owned native runtime behind different wrapper objects.
The host must enforce underlying native identity across module copies and wrappers.
Close rejects new calls immediately and cancels all derived waits.
Storage close starts independently of runtime success, drains accepted records, and still runs if runtime cleanup fails.
Runtime close starts only after accepted runtime calls settle. Repeated service close shares one promise.
An uncooperative active call can keep the overall close promise pending, but cannot keep storage open.
A failed/unknown runtime close retains ownership. Only successful close releases the runtime object for reuse.
Core does not pretend that unknown native close released resources.

## Deferred boundaries

File import belongs to #24: the host will own bounded local file access, artifact verification, partial cleanup, and explicit activation.
Vector persistence/search belongs to #26: exact source revision and full profile metadata must bind every vector and coverage report.
These proposed boundaries publish no unused file/vector ports now.
Native adapters, model binaries/downloads, SDK dependencies, production policies, durable jobs, automatic indexing, fixed history tools, and #30 device acceptance remain deferred.
Build-only and fake-adapter tests do not prove native release, latency, memory, or quality.
Physical #20/#21 acceptance stays pending. Earlier #14 evidence proves neither notes nor models.
