# Portable notes contract — issue #18

## Scope

The core module saves independent text notes without inference.
Workout notes remain a separate workout field.
`createNotesModule({ store, clock, ids })` constructs the portable module.
The module exposes `notes` and `close()`.
It owns its injected store. Do not share a store between independent lifetime owners.

Issue #18 supplied a storage port and memory contract tests.
The [issue #20 storage extension](notes-storage-contract.md) adds shared SQLite storage and literal text search.
Issue #18 did not add confirmed fields.
The core-only [issue #19 extension](note-fields-contract.md) now adds suggestions and explicit field confirmation.
Those earlier slices did not add SQLite tables, FTS5, screens, or inference.
`FormaService.notes` now composes notes with the shared store, lifetime, receipts, and restore exclusion.
Both Node and Android factories expose it.
The [Notes screens](mobile-notes.md) now use these APIs in source. Inference remains absent.
Do not attach an independent notes owner to a live workout database.
Archive version 2 includes primary notes, current confirmations, all reserved IDs, and original receipts.
A legacy workout-only archive explicitly empties notes during full replacement. See [the archive contract](archive-contract.md).

## Records and sources

A `NoteRecord` has `id`, `date`, `text`, `kind`, `revision`, `createdAt`, and `updatedAt`.
A public `Note` also has `source: { module: 'notes', noteId, revision }`.
Core constructs that source from the record. It does not store paths or platform URIs.
The source identifies the exact note revision, not a current mutable snapshot.

The date is an explicit local calendar date from year 0001 through 9999.
The host chooses it. A timezone change never changes a saved date.
Audit timestamps use the injected UTC clock with milliseconds.
Text must contain a non-whitespace character. Core preserves it exactly.
Text permits line breaks and valid Unicode. It rejects NUL and unpaired surrogates.
The maximum is 16,384 UTF-16 code units. This is a bounded API limit, not a device performance claim.
Note IDs use valid Unicode, no NUL, no outer whitespace, and at most 256 UTF-16 code units.
Deleted IDs remain reserved. A new record cannot reuse an old source identity.

Kinds are `general`, `pain`, `sleep`, and `personal-best`. Creation defaults to `general`.
A kind is a user-selected label. It does not confirm a numerical or medical fact.
The [approved field contract](note-fields-contract.md) defines conservative English suggestions and explicit confirmation.
Suggestions never confirm pain or sleep facts.

## API

| Method | Result |
| --- | --- |
| `notes.create({ requestId, date, text, kind? })` | A note at revision 1 |
| `notes.get(noteId)` | The current note with its exact source |
| `notes.update({ requestId, noteId, expectedRevision, date?, text?, kind? })` | The edited note at the next revision |
| `notes.delete({ requestId, noteId, expectedRevision })` | No value |
| `notes.history({ dateFrom?, dateTo?, kind?, limit?, cursor? }?)` | A bounded history page |
| `notes.searchText({ query, dateFrom?, dateTo?, kind?, limit?, cursor? })` | A literal FTS5 phrase-search page with exact notes and sources |
| `notes.fields(noteId)` | Current confirmation and unconfirmed suggestions for the exact note revision |
| `notes.confirmFields({ requestId, noteId, expectedRevision, fields })` | Explicit confirmation at a new note revision |

Updates require at least one supplied record field.
Omitted fields stay unchanged. Null does not clear a required field.
Every accepted new edit advances revision, even if the supplied value is unchanged.
A retry does not advance revision.
Revisions are positive safe integers. Revision exhaustion fails without a write.
A stale `expectedRevision` produces `CONFLICT` on that field.
A missing primary record produces `NOT_FOUND` on `noteId`.
The host must confirm a destructive command before it submits deletion.

Derived work must retain the note ID and revision.
It must reject results for a missing or different revision.
This issue exposes the identity contract. It does not implement derived jobs.

## Receipts and transactions

Each write requires a saved request ID and input.
The module uses the released `withRequest()` mechanism and receipt format 1.
Operations are `notes.create`, `notes.update`, `notes.delete`, and `notes.confirmFields`.
Field confirmation uses a separate versioned result DTO. Released note result DTOs remain unchanged.
The note change, ID reservation, history revision, and receipt share one atomic write.
The integrated adapters use the same receipt namespace as workouts.
Backup and restore preserve deleted-ID reservations.
Restore invalidates notes cursors. A global archive revision protects confirmation against intervening notes writes.

Input validation precedes receipt lookup.
A retry returns the validated original result, even after a later edit or deletion.
It does not recreate a deleted note.
A different operation or normalized input with the same key produces `CONFLICT` on `requestId`.
Malformed saved results produce `STORAGE_FAILURE` without another mutation.
Failures roll back all transaction changes. The failed request ID remains available.
Receipts do not expire automatically. They can retain deleted note text.
History reads primary notes, never receipt snapshots.

## History

Pages default to 20 notes and accept 1 through 100.
Dates are inclusive. An optional kind filter matches the user label.
Order is date descending, creation timestamp descending, and Unicode code-point ID ascending.
This order must match SQLite BINARY collation in issue #20.

A page has `items`, normalized `filter`, `revision`, and `nextCursor`.
The cursor is opaque and limited to 8,192 characters.
It binds the filters, last record key, and persistent notes history revision.
A note create, edit, explicit field confirmation, or delete advances that history revision in the same transaction.
Adapters must reject history revision overflow and roll back the write.
Unchanged data and receipt replay preserve a cursor.
Changed data produces `CONFLICT` on `cursor`. Restart the query.
Malformed cursors, changed filters, and invalid anchors produce `INVALID_INPUT` on `cursor`.
Changing page size between pages is allowed.
Adapters perform bounded keyset queries with one lookahead record.
Core validates the page size, order, filters, and continuation shape.

## Storage and lifetime

`NotesReader` supplies primary reads, confirmation reads, ID reservation checks, history revision, and bounded pages.
Field writes and clearing share the primary note transaction. See [the field contract](note-fields-contract.md).
`NotesWriter` adds primary writes and the shared receipt writer.
`NotesStore.read()` supplies a coherent view.
`NotesStore.write()` supplies one atomic transaction.
A callback uses only its supplied view. It must not re-enter the store.
Views must expire after the callback. Read views must reject writes.
Store close drains accepted work and rejects new operations.
The module rejects new calls as soon as close starts. Repeated close calls share one promise.

Memory tests prove portable behavior only.
Node and Android-shim tests now cover durable reopen and actual Node FTS5.
Shared notes archive replacement has portable, Node, and Android-shim tests.
Durable notes, literal FTS5, version-2 archives, and mobile Notes screens exist in source.
Physical Forma FTS5, restart, and archive proof remain pending in issue #20. Physical notes UI acceptance remains pending in #21.
Older native harness and #14 workout evidence do not prove notes.
