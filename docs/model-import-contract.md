# Local model import — issue #24

## Scope

The Android host imports the two exact files in [the model policy](model-policy.md).
It does not download a model, load an engine, or change personal records.
The #20/#21 phone checks are not prerequisites for this feature.
Issue #25 owns inference. A verified file does not make an inference capability ready.

## Ownership and DTOs

`@forma/mobile-host` owns the approved artifact catalog and the import controller.
The native Android adapter owns the picker, private files, streaming hash, and atomic file replacement.
The mobile root retains one controller across navigation and component disposal.
Screens receive snapshots and commands. Screens never receive a URI or file path.
Models remain outside the record database, receipts, and normal archives.

The catalog records the role, filename, exact byte count, SHA-256, download URL, license, and configured backend.
The catalog approves only the selected CPU embedding file and GPU generator candidate.
An arbitrary path, filename, expected hash, or byte limit cannot enter the native importer from JavaScript.

Native status returns one DTO per approved artifact: `{artifactId, state, byteLength}`.
States are `missing`, `verified`, and `failed`. Verified means the stored bytes pass the size and hash checks.
Failed means a stored file exists but cannot pass those checks or cannot be read.
The native status call verifies the actual file bytes. The record service does not wait for this call.

Import accepts an approved `artifactId` and an opaque `requestId` for cancellation correlation.
The result is `{status: 'imported' | 'cancelled', artifactId, byteLength}`.
Import success requires the exact catalog byte count and hash.
This is not a domain request receipt. A repeated import replaces only an identical approved artifact.

## Files and replacement

The system picker supplies a readable document. The URI stays native.
The app copies bytes into a fresh temporary file in its private no-backup directory.
The app hashes bytes as it copies them. Provider size metadata is not authoritative.
The copy has a fixed-size buffer. It rejects excess bytes before it writes them.
An exact size mismatch or hash mismatch leaves the current model unchanged.
After verification and file synchronization, one same-directory rename publishes the file.
A failed rename leaves the current model unchanged. Cancellation cannot cross the final commit boundary.
Temporary files never supply a model status or runtime path.
The importer removes temporary files after success, failure, or cancellation.
On the next native initialization, it removes temporary files from an interrupted process.
A cleanup failure must fail the operation rather than claim complete cleanup.

The approved files use separate SHA-256-based filenames. They cannot replace each other.
Both files reside below `noBackupFilesDir`, outside cloud backup and record archives.
Neither JavaScript nor an external file provider can choose a destination path.

## Controller and lifecycle

Only one model import can run at a time. Repeated taps share the active operation rather than open another picker.
A different concurrent artifact request fails with a conflict.
Cancel requests cooperative cancellation. The controller stays busy until the native import settles.
If the file commit already occurred, the result is imported, not cancelled.
No timeout or cancellation claim proves that an external provider stopped its operation.
Navigation does not start a second import or discard the active result.
Late status responses cannot replace a newer import result.
Malformed native results fail with a fixed error. Paths and provider messages do not enter the public snapshot.

The model I/O queue is separate from SQLite and the record service.
Default inference capabilities remain missing, even after successful import.
The screen explains this limit and keeps workouts, notes, and archive controls available.

## Source and device checks

Source checks cover catalog identity, size/hash failures, bounded copy, cancellation, atomic replacement, and process cleanup.
Controller checks cover repeated taps, stale reads, listeners, errors, and the missing-model state.
Screen checks cover metadata, status, import, cancel, and the separation from inference readiness.
A host build does not prove Android picker behavior or provider cleanup.
A new exclusive phone window must precede physical import and lifecycle checks.
The #25 window can include these checks before it loads the exact approved files.
