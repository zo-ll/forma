# Local archive contract — issue #12

Status: released. The coordinator approved this contract with corrections on 2026-10-13.

This contract defines a versioned local archive, export, inspection, and full-replacement restore.
It adds no server, account, cloud sync, nutrition, notes, or inference.
Restore is full replacement, not a merge. After explicit confirmation, restore removes current records that are not in the archive.

## 1. Ownership

| Layer | Owns | Does not own |
| --- | --- | --- |
| `@forma/core` | Archive DTOs, envelope, validation, digest, limits, version policy, restore exclusion, and archive meaning | SQL, files, URIs, pickers |
| `@forma/adapters` SQLite | One coherent read for export and one atomic transaction for replacement | Archive format or validation |
| `@forma/mobile-host` | The `restoring` presentation phase and the records epoch | Files or archive rules |
| `apps/mobile` | Warnings, confirmation, pickers, retry identity, and form reset after a records change | Record rules |
| Kotlin `FormaDeviceModule` | Storage Access Framework pickers and bounded reads and writes | JSON content or record meaning |

The core stays portable. It uses no Node, DOM, React Native, `TextEncoder`, or `crypto` types.
The core implements SHA-256 and UTF-8 encoding in plain TypeScript. It hashes the text incrementally, without a full byte array.
Native file handles and URIs stay in Kotlin. They do not enter JavaScript or the core.

## 2. Service API

`FormaService` gains `archive: ArchiveApi`.

```ts
export interface ArchiveCounts {
  readonly workouts: number;
  readonly sets: number;
  readonly receipts: number;
  readonly inProgress: number; // 0 or 1
}

export interface ArchiveExport {
  readonly text: string;        // The complete archive file content
  readonly byteLength: number;  // UTF-8 bytes of text
  readonly digest: string;      // 64 lowercase hex characters
  readonly createdAt: string;   // UTC timestamp from the injected clock
  readonly counts: ArchiveCounts;
}

export interface InspectArchiveInput { readonly text: string; }

export interface ArchiveInspection {
  readonly digest: string;
  readonly formatVersion: 1;
  readonly createdAt: string;
  readonly byteLength: number;
  readonly modules: readonly string[];       // ['catalog', 'requests', 'workouts']
  readonly archive: ArchiveCounts;
  readonly current: ArchiveCounts;           // The records that restore will replace
  readonly currentHistoryRevision: number;   // Same coherent read as current
}

export interface RestoreArchiveInput {
  readonly requestId: string;
  readonly text: string;
  readonly expectedDigest: string;           // The confirmed archive
  readonly expectedHistoryRevision: number;  // The confirmed current state
}

export interface ArchiveRestoreResult {
  readonly digest: string;
  readonly counts: ArchiveCounts;
}

export interface ArchiveApi {
  export(): Promise<ArchiveExport>;
  inspect(input: InspectArchiveInput): Promise<ArchiveInspection>;
  restore(input: RestoreArchiveInput): Promise<ArchiveRestoreResult>;
}
```

`export()` is a read. It writes no receipt and changes no record.
`inspect()` is a read. It validates the full archive and compares the catalog with the store.
It reads the current counts and `currentHistoryRevision` in one coherent read.
`restore()` is a write with a request receipt. It validates the full archive again. It does not trust an earlier inspection.
The core exports `ARCHIVE_LIMITS`, `ARCHIVE_FORMAT_VERSION`, and `sha256Utf8`.

## 3. Store capabilities

The port gains only these members:

```ts
interface WorkoutReader {
  listRequestReceipts(): Promise<readonly RequestReceipt[]>;  // ORDER BY request_id
  countArchiveRecords(): Promise<ArchiveCounts>;
}

interface ArchiveRecords {
  readonly workouts: readonly Workout[];
  readonly receipts: readonly RequestReceipt[];
}

interface WorkoutWriter {
  /** Delete all workouts, sets, and receipts. Insert the supplied rows. Advance the history revision. */
  replaceArchiveRecords(records: ArchiveRecords): Promise<void>;
}
```

The members obey the existing coherent-view, read-only, and expired-view rules.
`replaceArchiveRecords` runs only in the current `write()` transaction. It does not open a second connection.
The SQLite sequence is: delete sets, delete workouts, delete receipts, insert workouts and sets, insert receipts, then add 1 to the history revision.
The insert keeps `created_at`, `updated_at`, `finished_at`, IDs, dates, load metadata, session state, and set positions exactly.
The receipt insert keeps all four text columns exactly. It does not rewrite them.
The memory test store implements the same members with the same rollback.

The archive does not copy the SQLite file. Export reads rows through the store's one FIFO connection in one read transaction.
A WAL read transaction gives one coherent snapshot.
Restore does not swap files and does not close the database.

## 4. Archive envelope

The file is UTF-8 JSON. Its text is the canonical JSON form: sorted keys, no spaces, and no `undefined` values.
The app supplies the file name, for example `forma-archive-2026-10-13.json`.

```json
{
  "format": "forma.archive",
  "formatVersion": 1,
  "createdAt": "2026-10-13T09:00:00.000Z",
  "modules": {
    "catalog":  { "version": 1, "exercises": [Exercise], "splitDays": [SplitDay] },
    "workouts": { "version": 1, "workouts": [Workout] },
    "requests": { "version": 1, "receipts": [RequestReceipt] }
  },
  "integrity": { "algorithm": "sha-256", "digest": "<64 lowercase hex>" }
}
```

- `Exercise`, `SplitDay`, `Workout`, `WorkoutSet`, and `RequestReceipt` use the current public DTO fields exactly.
- Exercise and split-day order is meaningful. It is the catalog order. Split-day `exerciseIds` use member order.
- Workouts use the `listWorkouts` order. Sets use `position` order. Receipts use `requestId` order.
- Archive workouts and sets must contain `status`, `finishedAt`, `loadConvention`, and `implementCount`. The archive has no legacy DTO forms.
- Receipts keep their `inputSignature` and `resultJson` strings byte-exact. Legacy snapshots stay in their legacy form.

## 5. Version policy

- `format` must equal `forma.archive`.
- `formatVersion` describes the envelope and the container. Version 1 is one JSON file without binary attachments.
- Each module has its own `version`. Version 1 supports exactly the modules `catalog`, `workouts`, and `requests`, each at version 1.
- A reader rejects a newer `formatVersion`, a newer module version, an unknown module, or a missing required module.
- A reader never omits an unsupported module silently.
- A schema migration that changes an archived DTO must add a module version and a reader for the older version.

## 6. Integrity

`digest` is SHA-256 of the UTF-8 bytes of the canonical JSON of the envelope without `integrity`.
The digest detects accidental damage and truncation. It does not prove authenticity or the producer's identity.
Any person who edits the file can calculate a new digest. The archive has no encryption.
The digest is the stable identity of the archive in a restore.

## 7. Limits

```ts
export const ARCHIVE_LIMITS = Object.freeze({
  maxArchiveBytes: 16_777_216, // 16 MiB UTF-8, export and import
  maxWorkouts: 10_000,
  maxSets: 100_000,
  maxReceipts: 100_000,
});
```

These values are a declared initial limit. They are not a device-proven capacity.
The later native pass must measure a representative size and its time and memory.

- Export counts the records first in the same read. A count over a budget fails before it reads all records.
- Export then calculates the text. A text over the byte limit fails. No file is written.
- Import checks the text length and byte length before `JSON.parse`. It checks array lengths before it maps records.
- A limit failure rejects the whole archive. The core never omits records.
- There is no limit for one receipt field or one note. The service accepts notes of any length, so such a limit could reject valid records.
  The total byte limit bounds them.
- Kotlin counts bytes while it reads. It reads at most `maxBytes + 1` bytes with bounded buffers and rejects an overflow.
  It does not trust the size that a provider reports. It rejects a `maxBytes` value above its own native limit.

## 8. Validation before mutation

The core validates the complete archive before `store.write()` queues the restore:

1. Input object keys, `requestId`, `expectedDigest`, `expectedHistoryRevision`, text type, and size.
2. `JSON.parse`. A parse failure is `INVALID_INPUT` on `archive`.
3. Exact envelope keys, `format`, `formatVersion`, module names, and module versions.
4. The integrity digest.
5. Count budgets for workouts, sets, and receipts.
6. Workouts: a strict DTO parse with the released workout codec and field validators.
7. References: unique workout IDs, unique set IDs across all workouts, positions `0..n-1`, and set `exerciseId` and workout `splitDayId` values in the archive catalog.
8. Session rule: at most one `in-progress` workout. An `in-progress` workout has a null `finishedAt`.
9. Receipts: `requestId` and `operation` follow the `withRequest` identifier rules. `formatVersion` equals 1. `requestId` values are unique.
10. Receipts: each operation is a released operation. Its signature and result pass the checks in section 9.
11. `expectedDigest` must equal the digest. Otherwise the call fails with `CONFLICT` on `expectedDigest`.
12. The archive receipts must not contain the restore `requestId`. Otherwise the call fails with `CONFLICT` on `requestId`.

Inside the write transaction, the order is:

13. The existing receipt check for the restore `requestId`. A matching receipt replays its result and stops here.
14. The current history revision must equal `expectedHistoryRevision`. Otherwise the call fails with `CONFLICT` on `expectedHistoryRevision`.
15. The archive catalog must equal `listExercises()` and `listSplitDays()` exactly, including order.
16. Replacement, revision change, and the new restore receipt.

Catalog rows are read-only data from migration 1. Restore compares them and does not delete or seed them again.
Exact equality keeps Hammer Curls under Lower and keeps variants such as Preacher Curl and Preacher Curl Machine separate.
Exact equality also rejects a future catalog upgrade until an explicit reader for the older catalog version exists.

Error fields:

| Problem | Code | Field |
| --- | --- | --- |
| Text is not JSON, has wrong keys, or has wrong types | `INVALID_INPUT` | `archive` or `archive.<module>` |
| Size or count over a limit | `INVALID_INPUT` | `archive.size` |
| Unknown format, newer version, or unknown module | `INVALID_INPUT` | `archive.formatVersion` or `archive.modules` |
| Digest mismatch | `INVALID_INPUT` | `archive.integrity` |
| Duplicate ID, broken reference, or two active sessions | `INVALID_INPUT` | `archive.workouts` |
| Malformed receipt, signature, or result | `INVALID_INPUT` | `archive.requests` |
| Catalog mismatch | `INVALID_INPUT` | `archive.catalog` |
| Archive confirmation does not match | `CONFLICT` | `expectedDigest` |
| Current records changed after inspection | `CONFLICT` | `expectedHistoryRevision` |
| Request ID reused for another restore | `CONFLICT` | `requestId` |
| Another restore runs | `CONFLICT` | `restore` |

Export uses the same validator on the archive that it makes. A stored record or receipt that fails the validator fails the export with `STORAGE_FAILURE`.
Export never omits a receipt.

## 9. Receipt checks

The released operations and their result codecs are:

| Operation | Result codec | Signature fields |
| --- | --- | --- |
| `workouts.create` | `workoutResult` | `date`, `splitDayId`, `notes`, `durationMin` |
| `workouts.start` | `sessionWorkoutResult` | `date`, `splitDayId`, `notes`, `durationMin` |
| `workouts.finish` | `sessionWorkoutResult` | `workoutId` |
| `workouts.update` | `sessionWorkoutResult` | `workoutId`, and one or more of `date`, `splitDayId`, `notes`, `durationMin` |
| `workouts.delete` | `voidResult` | `workoutId` |
| `workouts.discard` | `voidResult` | `workoutId` |
| `workouts.addSet` | `setResult` | `workoutId`, `exerciseId`, `reps`, `weightKg`, `rpe`, and an optional `loadConvention` and `implementCount` pair |
| `workouts.updateSet` | `setResult` | `workoutId`, `setId`, and one or more of `exerciseId`, `reps`, `weightKg`, `rpe`, and the load pair |
| `workouts.deleteSet` | `voidResult` | `workoutId`, `setId` |
| `archive.restore` | archive restore codec | `digest`, `expectedHistoryRevision` |

The table uses the codecs that replay uses in the current code. `workouts.update` replays with `sessionWorkoutResult`.

- The signature must be a JSON object with only the listed fields and the released value types.
- The signature must be in canonical form. The core compares the canonical form of the parsed value with the stored string.
- A legacy `workouts.addSet` signature has no load pair. It stays valid.
- The result must pass its codec. Legacy result snapshots pass through the codec upcast. The core uses the parsed value only for the check.
- The core never writes the upcast value. It stores the original strings.
- Receipts can refer to deleted workouts and sets. The core does not check receipt IDs against primary records.
- A deletion receipt has the result `null`.

## 10. Restore receipt and retry

`restore()` uses `withRequest` with operation `archive.restore`.
The signature is `{ digest, expectedHistoryRevision }`. It does not contain archive content.
The result is the small `ArchiveRestoreResult`.

- A retry with the same `requestId`, archive, and confirmed revision replays the saved result. It does not replace again.
- The replay does not check the current revision again. A write after the restore does not block the replay.
- The same `requestId` with another archive or revision returns `CONFLICT` on `requestId`.
- The receipt check runs against the database before replacement.
- The new receipt is inserted after replacement, in the same transaction. It survives the restore.
- An export after a restore includes earlier `archive.restore` receipts. Each one is small. No archive contains another archive.

## 11. Rollback

One `write()` transaction contains the receipt check, revision check, catalog check, replacement, revision change, and new receipt.
Any failure rolls back all of it. The current database stays exactly as it was, including its history revision.
This includes a failure in replacement, a failure in receipt import, a constraint failure, and an injected storage failure.
A process stop during the transaction leaves the earlier database. SQLite rolls back the open transaction at the next open.
Integrity and validation failures occur before the transaction starts.

## 12. Restore exclusion and concurrent work

The core service owns the exclusion. A cached `service.workouts` or other API reference cannot bypass it.

- `restore()` validates the archive. Then it sets the exclusion in the same synchronous step that queues its write.
- While the exclusion is active, a new read or write through any service API fails with `CONFLICT` on `restore`.
- A second concurrent `restore()` fails with `CONFLICT` on `restore`.
- Operations accepted before the restore drain first in the store FIFO. The restore then runs once.
- The restore uses its internal store transaction. It does not call public APIs or nest store operations.
- The exclusion ends after success or failure.
- `close()` during a restore rejects new work and waits for accepted work, including the restore.

## 13. Host and app after a restore

- The host adds `replaceRecords(run)`, phase `restoring`, and `snapshot().recordsEpoch`.
- The phase controls presentation only. The core exclusion is the safety mechanism.
- While the phase is `restoring`, `host.service()` throws `CONFLICT` on `restore`.
- After a success, or after a failure that is not definitive, the host adds 1 to `recordsEpoch`.
- After `INVALID_INPUT`, `NOT_FOUND`, or `CONFLICT`, the epoch does not change. The database did not change.
- Restore adds 1 to the history revision, also for an empty archive. All earlier cursors return `CONFLICT` on `cursor`.
- When `recordsEpoch` changes, the app clears the command ledger and the draft store and clears the stack.
  Settings stays open to show the restore result. Any other route changes to Home.
- History and Progress remount with the epoch in their key. They drop old cursors and query state.
- The forms module adds `CommandLedger.clear()` and `DraftStore.clearAll()`.
- The restore command keeps its own saved `requestId` and input in a separate ledger (`MobileForms.restore`). A records change does not clear it.
  A retry after an unconfirmed failure reuses them, also after screen disposal.
- Screens call `host.service()` for each operation.

## 14. File flow

Kotlin adds two promise methods. Only one picker request can run at a time.

```ts
saveArchive(text: string, suggestedName: string): Promise<{status: string; byteLength: number; partialFileRemoved: boolean}>;
// status: 'saved' | 'cancelled' | 'failed'
openArchive(maxBytes: number): Promise<{status: string; text: string | null; byteLength: number}>;
// status: 'opened' | 'cancelled'
```

Export:

1. Settings shows the privacy warning in section 15. The user must confirm.
2. The app calls `service.archive.export()`.
3. Kotlin opens `ACTION_CREATE_DOCUMENT` and writes the UTF-8 bytes.
4. Cancel causes no record change. A document provider can still leave an empty document.
5. The app compares the written `byteLength` with the export value. A difference is a write failure.
6. On a write failure, Kotlin tries to delete the new document. This is best effort. The app reports a possible partial file.

Restore:

1. Kotlin opens `ACTION_OPEN_DOCUMENT`. It counts bytes while it reads and stops at `maxBytes + 1`.
2. Kotlin decodes strict UTF-8. Malformed bytes fail. Cancel returns `cancelled`.
3. The app calls `inspect()` and shows archive counts, current counts, and the active-workout replacement.
4. The user must confirm the replacement. The app recommends an export of the current records first.
5. The app calls `host.replaceRecords(service => service.archive.restore({ requestId, text, expectedDigest, expectedHistoryRevision }))`.
6. `CONFLICT` on `expectedHistoryRevision` returns the user to inspection and a new confirmation.
7. A retry after an unconfirmed failure reuses the saved `requestId`, text, and confirmed revision.

Kotlin encodes the text to the document as a stream and counts the bytes. It does not make a second full-size byte array for the write.
The device adapter maps native rejection codes:
`FORMA_ARCHIVE_BUSY` to `CONFLICT` on `archive.picker`, `FORMA_ARCHIVE_TOO_LARGE` to `INVALID_INPUT` on `archive.size`,
`FORMA_ARCHIVE_UNREADABLE` to `INVALID_INPUT` on `archive`, `FORMA_ARCHIVE_LIMIT` to `INVALID_INPUT` on `maxBytes`,
and every other code to `STORAGE_FAILURE`. A write failure resolves with status `failed` and `partialFileRemoved`.
If the process stops while a picker is open, the promise is lost. No record changes. Module invalidation rejects an open request.

## 15. Warnings and privacy

Show this text before export:

> The archive contains all your workout records in plain text.
> It also contains the saved command receipts. These receipts can contain data from deleted records.
> Forma does not encrypt the file. Any person or app with access to the file can read it.
> The checksum detects damage. It does not prove who made the file.

Show this text before restore:

> Restore replaces all workouts, sets, and saved command receipts on this phone.
> Records that are not in the archive will be removed, including an active workout.
> Export the current records first if you need them.

## 16. Excluded data

- Preferences are device settings, not workout records. The archive does not contain them. Restore does not change them.
- The hostgate `gateSnapshot` key and its cleaned scale tombstone are not archive data. Restore does not read or write them.
- The archive contains no model binaries and no vectors. Records rebuild vectors later.
- The current records have no local media. Version 1 contains no files.
- The Android manifest keeps `allowBackup="false"`.

## 17. Extension contract

- A new record module adds `modules.<id>` with its own `version`, DTO list, and validator in the core.
- Planned module IDs: `nutrition` for foods and meals, and `notes` for notes and revisions.
- Each module validates its references before mutation and replaces its tables in the same restore transaction.
- A newer reader can accept an older archive without a module only if that module's reader marks it as allowed to be absent.
  Inspection then lists the module as "will become empty". Restore does not keep its old records.
- Module records use the shared receipt mechanism. Their receipts stay in `requests` with their own operation checks.
- Media requires `formatVersion` 2 with a container and a file manifest: `{ fileId, mediaType, byteLength, sha256 }`.
  The core will read file bytes only through a bounded port by `fileId`. It never receives a URI or path.
- Models and vectors never become archive modules by default. An optional model file is a later, separate decision.

## 18. Verification

1. Core: SHA-256 against a Node crypto oracle in tests only: empty, `abc`, 55, 56, 63, 64, and 65 bytes, and non-ASCII text.
2. Core: one rejection case for each row of the error table. Each rejection shows zero store writes.
3. Receipts: legacy, deleted-record, null-result, and malformed-result cases.
4. Shared archive cases in `tests/fixtures/archive-cases.ts` with portable assert, on the memory store, Node SQLite, and the Android adapter shim.
5. SQLite only: injected failures on the last receipt insert and in the workout import. Check exact earlier rows, receipts, and revision.
6. Exclusion: a saved `service.workouts` reference, concurrent restores, writes accepted before restore, a failed restore, and close during restore.
7. Host and forms: phase, epoch, `service()` conflict, `clear()`, and `clearAll()`.
8. Device, after release only, in the hostgate sandbox: export, cancel, import, restore, exact records, an oversized file, and a damaged file.

The full source suite runs once at the final candidate. The 177-assertion UI suite does not run again.
