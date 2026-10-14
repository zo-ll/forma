# Local archive contract — versions 1 and 2

## Ownership and format

Core owns DTOs, validation, SHA-256, budgets, replay, and restore exclusion.
Adapters own coherent reads and one atomic replacement transaction.
The host owns the restoring phase and records epoch. The app owns explicit confirmation, file selection, and draft reset.
Native file handles and URIs stay outside core. Preferences stay outside the archive.
No model, vector, media, nutrition, or inference module is supported.

Version 2 is a plaintext UTF-8 JSON file. It adds notes to the released version-1 workout archive.
The old future-media version-2 placeholder was speculative, not a released format. This contract replaces it.
Any future media container needs a separate format decision and reader.

The envelope has exactly `format: 'forma.archive'`, `formatVersion: 1 | 2`, `createdAt`, `modules`, and `integrity`.
`createdAt` is a UTC timestamp with milliseconds.
Version 1 requires exactly `catalog`, `requests`, and `workouts`.
Version 2 requires exactly `catalog`, `notes`, `requests`, and `workouts`.
Every module has `version: 1`.

- Catalog: `{ version, exercises: Exercise[], splitDays: SplitDay[] }`. Order is meaningful and must match the current catalog exactly.
- Workouts: `{ version, workouts: Workout[] }`. Primary workouts include current load and session DTO fields. Sets have consecutive positions and globally unique IDs.
- Requests: `{ version, receipts: RequestReceipt[] }`. Every original inputSignature and resultJson string stays exact, including deleted-record snapshots.
- Notes: `{ version, records: NoteRecord[], confirmations: NoteFieldConfirmation[], reservedIds: string[] }`. Records omit the computed public source.

Every note ID is unique and reserved. Reserved IDs are unique and include deleted IDs.
A confirmation has a unique note ID and the exact current primary source revision. Its confirmed timestamp equals the primary updated timestamp.
A missing note cannot have a current confirmation. Empty pain, unknown sleep, confirmed uncertainty, and confirmed absence remain distinct.
Receipts can refer to deleted notes. Such receipt note IDs must still be reserved in a version-2 archive.
Version-1 archives cannot contain notes operation receipts.
Primary records, IDs, timestamps, text, confirmation values, and receipt strings are never synthesized or rewritten.

Export uses canonical JSON: sorted object keys, no spaces, and no undefined values.
Notes use saved-date descending, creation-time descending, BINARY ID ascending order.
Reserved IDs and confirmations use BINARY note-ID order. Receipts use request-ID order.
Import validates identities and references, but does not require array order to be canonical.
Integrity is `{ algorithm: 'sha-256', digest }`. Digest is SHA-256 of canonical envelope JSON without integrity.
The checksum detects damage. It provides no authentication or encryption.

## Public API

`archive.export()` returns `{ text, byteLength, digest, createdAt, counts }`.
`archive.inspect({ text })` returns `{ digest, formatVersion, createdAt, byteLength, modules, missingModules, archive, current, currentHistoryRevision }`.
`archive.restore({ requestId, text, expectedDigest, expectedHistoryRevision })` returns `{ digest, counts }`.
Counts have `workouts`, `sets`, `receipts`, `inProgress`, `notes`, `noteConfirmations`, and `reservedNoteIds`.
The released four-field restore receipt result is upcast with three zero counts on replay. Stored JSON is not changed.

`missingModules` is `['notes']` for version 1 and `[]` for version 2.
Version-1 restore is FULL replacement: notes, confirmations, and reservations become empty.
Inspection and the existing archive screen show this warning. No old notes are retained or synthesized.
Version-2 restore also removes every current record absent from the archive.

`currentHistoryRevision` keeps its public name for compatibility. It is now an opaque global archive revision, not a workout cursor revision.
Always pass the value from the current inspection. Do not calculate it from another query.
Migration 8 initializes this persistent revision from both existing history revisions.
Triggers advance it for workout, set, note, confirmation, reservation, and receipt changes, including direct port writes.
The counter uses checked safe integers. Overflow rolls back the transaction.
Workout and notes query revisions remain separate. Unrelated module writes do not invalidate their cursors.
Receipt replay makes no write and changes no revision.

## Store and transactions

WorkoutReader adds `getArchiveRevision()` and `readArchiveNotes()`.
The latter returns `{ records, confirmations, reservedIds }` in one coherent read view.
ArchiveRecords has `workouts`, `receipts`, and optional `notes` with that shape.
An omitted internal notes member means empty replacement, for compatibility with older port callers.
The public archive parser always supplies explicit validated notes arrays.
All capabilities obey coherent-view, expired-view, read-only, FIFO, and close-drain contracts.

Export counts first and loads every module in the same read transaction. It never omits an unsupported record or receipt.
It validates its own output. Malformed stored content fails with STORAGE_FAILURE.
Restore validates the entire archive before it queues mutation.
It checks request replay, the global revision, and exact catalog equality inside one write transaction.
It deletes all replaceable records, imports every module, advances both query revisions and the global revision even for empty replacement, and saves the restore receipt.
Catalog rows remain unchanged, including Hammer Curls under Lower and distinct Preacher Curl variants.
FTS triggers rebuild the imported primary text index in that transaction. No vector rebuild is needed.
Any failure rolls back all modules, index changes, receipts, reservations, and revisions.
Restore never closes the database or swaps database files.

The service excludes every new operation during restore, including cached notes APIs and a second restore.
Previously accepted work drains first. Close rejects new work and drains the restore.
The exclusion ends after success or failure.

## Receipt compatibility

All released workout operations retain their existing signature validators and result codecs.
Legacy unknown-load and pre-session workout snapshots remain supported and are not rewritten.
`archive.restore` keeps signature `{ digest, expectedHistoryRevision }`. Earlier snapshots remain replayable after later writes.
Notes operations are `notes.create`, `notes.update`, `notes.delete`, and `notes.confirmFields`.
Signatures must use exact canonical normalized input. Results must pass their released codecs.
Confirmation receipt identity, next revision, timestamp type, and normalized fields must agree with the signature.
Create/update note snapshots must agree with their supplied signature fields and expected revision.
Request IDs are unique across all modules. Deletion results are null.

A narrow compatibility reader supports the released #19 cross-alias overlap behavior.
It accepts a known location and the same location through `otherBodyPart` only in a stored version-1 confirmation or receipt.
It still rejects every malformed field and overlap rejected by the released validator.
New confirmation writes use the strict corrected validator.
An exact old confirmation command can replay its matching original receipt through a replay-only path.
Without a matching receipt, the old overlapping command fails and writes nothing.
The compatibility reader never turns an old field into a new confirmation or weakens normal new-input validation.

## Limits and errors

The complete file is limited to 16,777,216 UTF-8 bytes.
Individual count budgets are 10,000 workouts, 100,000 sets, 100,000 receipts, 10,000 notes, 10,000 confirmations, and 100,000 reserved IDs.
A combined budget of 250,000 rows applies across all six groups.
These are declared source limits, not device-proven capacity.
Input length and UTF-8 size are checked before JSON parsing. Array counts are checked before mapping records.
Native reads stop at maxBytes + 1 and decode strict UTF-8. Native writes stream bytes and report partial-file removal separately.
No budget failure returns partial records.

Malformed envelopes use INVALID_INPUT on `archive` or `archive.modules`.
Unsupported versions use `archive.formatVersion`. Damage uses `archive.integrity`.
Invalid notes/source/reservations use `archive.notes`. Invalid receipts use `archive.requests`.
Invalid workout references use `archive.workouts`. Catalog mismatch uses `archive.catalog`.
Budget failures use `archive.size`.
A changed confirmed archive uses CONFLICT on `expectedDigest`.
Intervening records use CONFLICT on `expectedHistoryRevision`. Reinspect and confirm again.
Request reuse uses CONFLICT on `requestId`. Concurrent restore uses CONFLICT on `restore`.

## Host and file flow

Export requires the plaintext/privacy warning before file selection.
Restore requires inspection and explicit full-replacement confirmation. Recommend export of current records first.
A retry after an unconfirmed restore reuses the saved request ID, archive text, digest, and revision.
The restore command ledger stays separate from ordinary commands.
The host records epoch advances after successful restore or an unconfirmed failure.
The app clears all drafts, ordinary command ledgers, navigation sources, and query state when that epoch changes.
These rules include notes sources. A stale screen must not submit a new command against an old source.

Show that archives include workouts, notes, confirmed fields, reservations, and receipts in plain text.
Receipts can retain deleted text. Forma does not encrypt the file.
Show that full restore removes records absent from the archive, including an active workout.
For version 1, explicitly show that all notes, confirmations, and reserved note IDs become empty.

## Verification limits

Portable, Node, and Android-shim cases cover round trips, old formats, receipt compatibility, sources, rollback, and exclusion.
Build-only verifies the mobile module graph and APK assembly, not physical FTS5 or durable restart.
Actual Forma device FTS5, notes restart, and archive proof remain pending under separate authorization.
