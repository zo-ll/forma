# Model policy — issue #23

## Status and authority

The owner approved this policy on 2026-10-15.
This document resolves the model artifact, precision, and device budget questions for the local assistant phase.
It does not approve production inference. Issues #24, #25, and #30 remain responsible for import, the native adapter, and device proof.

The earlier BF16 or float32 requirement stays in force for runtime activations and output vectors.
That rule does not govern weight storage.
Weight quantization is a separate property. This policy approves specific quantized weight schemes.

Float16 remains forbidden for the embedding model, in weights, runtime, and output.
Float16 remains forbidden for every profile in `@forma/core`.

## Approved embedding artifact

| Field | Value |
| --- | --- |
| Repository | `litert-community/embeddinggemma-2-text-270m-litert-lm` |
| File | `embeddinggemma-2-text-270m.litertlm` |
| Size | 164,626,432 bytes |
| SHA-256 | `2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb` |
| Base model | `google/embeddinggemma-2` |
| License | Apache-2.0 |
| Weight quantization | int4 per-channel QAT, transformer and embeddings |
| Weight precision | float32 |
| Runtime precision | float32 |
| Output precision | float32 |
| Dimensions | 256, truncated from 768 with MRL |
| Normalization | L2 |
| Query prefix | `task: search query \| text: ` |
| Document prefix | `task: search result \| text: ` |
| Backend | cpu |
| Runtime | LiteRT-LM `com.google.ai.edge.litertlm:litertlm-android:0.18.0`, `EmbeddingEngine` |

The tokenizer is packaged inside the `.litertlm` file.
The adapter receives the fully prefixed text. The adapter must not add the prefix again.

The model card supports text token counts 128, 256, 512, 1024, 2048, and 8192, and output dimensions 128, 256, 512, and 768.
`@forma/core` keeps `maxDimensions` at 4096. The approved profile uses 256.

## Approved generator candidate

| Field | Value |
| --- | --- |
| Repository | `litert-community/gemma-4-E2B-it-litert-lm` |
| File | `gemma-4-E2B-it-gpu.litertlm` |
| Size | 2,008,432,640 bytes |
| SHA-256 | `a53a59001894c58e6bdb5b9b227709f91a2e3e556baa7d85acf9c55402ba5cf5` |
| Base model | `google/gemma-4-E2B-it` |
| License | Apache-2.0, with the Gemma 4 license link on the base card |
| Weight quantization | mixed 2-bit, 4-bit, and 8-bit QAT |
| Output precision | text |
| Context | 2048 tokens for the gate |
| Output limit | 256 tokens |
| Backend | gpu |
| Runtime | LiteRT-LM, version pinned in #25 |

The generator repository also supplies `chat_template.jinja` for the prompt format.
The generator is a candidate only. It is not a default capability.
The general file `gemma-4-E2B-it.litertlm` (2,588,147,712 bytes, SHA-256 `181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c`) remains an alternative.
The owner selected the GPU file.

Runtime precision for the generator stays `bf16` or `float32`. Float16 fails validation.
The adapter declares the real value. The policy does not invent it.

## Approved device budgets

The budgets are provisional. Issue #30 must measure the target Nothing Phone (2a) with 8 GB RAM.
Issue #30 confirms these numbers or replaces them with measured values.

| Measure | Budget |
| --- | --- |
| Embedding cold load | 2 s or less |
| Single query embedding | 300 ms or less |
| Eight-note batch | 2 s or less |
| Generator cold load | 15 s or less |
| Generator first token | 5 s or less |
| Generator speed | 5 tokens/s or more |
| Joint resident inference memory | 3.0 GB or less |
| Context | 2048 tokens |
| Output | 256 tokens or less |

If joint resident memory is more than 3.0 GB, the host loads one model at a time and unloads it on idle.
The host reports each measured value. The host does not report an effective delegate.

## Default enablement

No model is enabled by default before the #30 joint memory check passes.
A missing or failed model must not block records, notes, archive, or restore.
Ready adapter status is a software declaration. It is not production approval.

## Contract change for issue #23

`@forma/core` now accepts these `weightQuantization` values:

- `none`
- `int4-per-channel-qat`
- `mixed-2-4-8-bit-qat`

`weightPrecision` stays `bf16` or `float32`. `runtimePrecision` stays `bf16` or `float32`.
Float16, `int4`, and unknown values fail profile validation.
Weight quantization takes part in exact profile compatibility.
A profile with different quantization is not compatible, even with the same ID.

The approved profiles:

- Embedding: `weightQuantization: 'int4-per-channel-qat'`, `weightPrecision: 'float32'`, `runtimePrecision: 'float32'`.
- Generation: `weightQuantization: 'mixed-2-4-8-bit-qat'`, runtime precision `bf16` or `float32`.

## Evidence limits

The phone result comes from the separate validation app on a Nothing Phone (2a).
It covers the CPU embedding path only: load 818 ms, query 153–169 ms, and 4/4 query matches.
The GPU embedding path loaded in 5,452 ms and matched 4/4 queries.
The validation app does not prove the active GPU delegate.

The generator has no Forma runtime evidence and no target-phone evidence.
Card numbers come from a different phone (S26 Ultra). They do not transfer.

Gallery results and validation-app results do not prove Forma behavior or joint model memory use.
File size does not equal inference memory. Issue #30 must measure the real values.

## Non-goals

No artifact is downloaded automatically. Issue #24 owns local import and verification.
No vector is persisted. Issue #26 owns vectors and coverage.
Nutrition and meal photos stay absent.
No model computes a numerical fact, confirms a field, or writes SQL.
