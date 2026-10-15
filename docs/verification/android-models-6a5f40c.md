# Android model checks — partial acceptance

## Exact artifact

- Runtime source: `6a5f40cf0402b400317e06e90fbf8b4bf410d604`.
- Source branch: `issue/25-android-inference`.
- Base: `243a5f55ed348bdb20413b78b77b218ec8f4cf5c`.
- APK SHA-256: `aa1bcd8757632e0df12d8c3a9d989588b408a1949e6cc348ec1cdc30ca845250`.
- Variant: ARM64 `hostgateRelease`, package `dev.forma.mobile.hostgate`.
- PR: [#61](https://github.com/zo-ll/forma/pull/61), open and unmerged at this checkpoint.

DeepSeek approved all 43 changed files after fresh inspection at this exact head.
The coordinator matched the full coverage list against Git, with no missing files, duplicates, or skips.
Both remote CI jobs passed at the same head.
Local and independent checks passed 1,131 source tests and 39 JVM tests.
The JVM tests use fake engines and actual SDK configuration objects without JNI.
They do not prove GPU execution or physical resource release.

This documentation branch changes no application code.
The source approval and phone evidence apply to the exact runtime head above, not a new documentation commit or rebuilt APK.
The CI APK uses the public template debug key, not a production key.

## Actual phone checks

| Check | Observation | Status |
| --- | --- | --- |
| Installed artifact | The installed APK matched the exact hash above. | pass |
| Approved local files | Both artifacts passed their catalog size and SHA-256 checks before import. | pass |
| Native import | The Android picker supplied local files. Forma stored both exact approved artifacts. | pass |
| Independent status | Full native size/hash checks verified both stored files after a process restart. | pass |
| Default behavior | Import and normal restart left inference disabled. | pass |
| Confirmation and picker cancel | Both actions settled without a file change. | pass |
| Invalid source | A wrong-size document failed import. A fresh native check still verified the original model. | pass |
| Pending picker interruption | A real Forma process restart cleared the old request. The existing model survived, and a new request settled. | pass |
| Import navigation | Home opened after an observed active generator import. Settings retained the completed result. | pass |
| Actual CPU SDK | Query and document tasks produced finite, nonzero, normalized vectors with 256 float32 components. | pass |
| Record access | Both record reads completed before their respective inference replies. | pass |
| Repeat CPU execution | The same diagnostic passed after invalid import and process interruption. | pass |
| Original data | The final UI archive matched every original catalog record, workout record, and raw receipt exactly. | pass |
| Archive separation | The archive contained record modules, not model files or caches. | pass |
| GPU execution | The conservative memory preflight stopped the test before any SDK call. | blocked |

The CPU diagnostic reported `ok: true` and 12 checks on both successful runs.
The first query/document round trips took 1,363/132 ms. The repeat took 1,045/194 ms.
The repeat used a cold process with an existing SDK disk cache.
These values include file verification, engine work, and bridge costs.
They do not isolate load time, first-token time, throughput, or peak memory.
The backend field states the configured backend. It does not identify an effective delegate.

The import navigation observation does not identify the native copy stage or prove record-read overlap with that stage.
The process interruption occurred with a pending picker, before file selection.
It does not prove cancellation during an active copy or React module invalidation.

## Defects and recovery

The first candidate lacked the native FTS5 build option. The notes migration failed.
The coordinator restored the prior APK without a reset and verified every original archive module and raw receipt.
Commit `8f542f7` enabled FTS5 and added an APK guard for the packaged native compile option.
The corrected upgrade and an empty literal FTS query passed on the phone.
This is not full notes acceptance for #20/#21.

The next attempt exposed an Activity whitelist omission. Android did not forward the inference modes.
Those attempts started the normal app, not the SDK diagnostic.
Their timeouts are not SDK failures or SDK latency measurements.
Commit `6a5f40c` corrected the native whitelist and added regression tests.
The actual CPU diagnostic then passed.

The Downloads provider initially did not list the new generator file after the ADB copy and rename.
A system scan of only that owned file made it visible.
The helper resumed the existing picker request. No second import request or app fix was necessary.

## Stop state and next checks

The user ended the phone window on 2026-10-15.
The last observed app screen was normal Home. No driver or inference job remains active.
Both approved model files remain in private no-backup storage. The source files and plaintext archives also remain on the phone.
The user explicitly approved the generator download and phone copy.
No test note exists, so no fixture deletion remains due.

The conservative GPU preflight required at least 3 GiB of available RAM.
A restart of only Forma did not meet that guard. The coordinator did not stop another app.
This guard is not a measured generator requirement or proof of the policy's separate 3 GB joint-memory budget.

Before another device action, obtain a new exclusive phone window.
Recheck the artifact, memory, battery, temperature, and current records.
Save a fresh UI archive before any update or fixture change.
Confirm permission before the one synthetic source note.
Use only the explicit read-only inference modes from the [Android contract](../android-inference-contract.md).
Delete only the owned test note after the tests. Preserve its internal command history.
Do not use seed, fixtures, reset, archive restore, or another app to bypass a block.
Do not retry with float16 or CPU after a float32 GPU failure.

The remaining checks include:

- Exact-size bad-SHA rejection and active-copy interruption/cleanup.
- Isolated full-rehash latency and record-read overlap with native file work.
- Actual GPU execution and sequential model switches.
- Actual SDK cancellation, memory pressure, and React module invalidation.
- Device budgets, including the separate joint-memory requirement.
- Complete notes acceptance for #20/#21.

Keep #24 and #25 open until their complete physical acceptance passes.
Default enablement remains #30. Nutrition and meal photos remain excluded.

## Private evidence

The original host retains private evidence under `~/.local/state/forma/issue-25/`.
The relevant files are:

- `native/RESUME.md` and `native/ACCEPTANCE.md`.
- `native/generator-download-authorization.json`.
- `native/generator-download-verification.json` and `native/generator-phone-verification.json`.
- `native/generator-import-result.json` and `native/invalid-model-rejection-result.json`.
- `native/picker-process-restart-result.json`.
- `native/cpu-first-success-6a5f40c/` and `native/inference-embedding-result.json`.
- `native/after-generator-import-comparison.json` and the protected UI archives.
- `native/gpu-memory-final-preflight-result.json` and the device-condition files.
- `review-coverage-6a5f40c.json` and `review-disposition-6a5f40c.md`.
- `checkpoint-2026-10-15/` for durable build metadata and verification logs.

The reports and session history remain under `~/.local/state/spawn-critic/review25.2suf12Uy/`.
`REPORT-6a5f40c.md` covers ten correction files. `REPORT-6a5f40c-fresh.md` completes fresh inspection of the other 33 files.
Keep those reports and both critic windows while their issues remain open.
Do not publish raw archives, personal records, device addresses, keys, model binaries, APKs, screenshots, or logs.
