# Notes storage extension — issue #20

Status: implementation in progress. This contract does not claim source or native acceptance.

## Shared storage

Node and Android use the same SQLite implementation and migration registry.
Migration 6 adds primary notes, permanently reserved note IDs, current confirmations, and a persistent notes history revision.
Migration 7 adds an FTS5 index with the `unicode61` tokenizer and `remove_diacritics 0`.
An unavailable FTS5 module fails migration atomically. Startup must not silently disable search.
Primary note writes, confirmation invalidation, index updates, history revision, and receipts use one transaction.
Confirmations store the validated version-1 DTO as JSON. Null means no confirmation, not confirmed absence.
Pain `uncertain`, pain `absent`, null sleep, and an empty pain list retain their distinct meanings.
The adapter checks confirmation identity and revision before saving it.
Primary edits clear confirmation in the adapter, as well as in the core command.
Deleted IDs remain reserved. A direct insert cannot reuse a reserved deleted ID.
Existing workout rows, receipts, and catalog order do not change during these migrations.

## Literal text search

`notes.searchText({ query, dateFrom?, dateTo?, kind?, limit?, cursor? })` returns
`{ items: Note[], filter: { query, dateFrom, dateTo, kind }, revision, nextCursor }`.
Each item contains unchanged original text and its exact note source.
The query accepts 1–512 UTF-16 code units of nonblank valid Unicode without NUL.
Search is a literal FTS5 token phrase, not SQL, raw MATCH syntax, substring search, or semantic search.
The adapter doubles embedded double quotes and wraps the complete query in double quotes.
FTS operators, column names, prefixes, and punctuation have no command meaning.
Token matching uses the declared SQLite tokenizer. Text is never rewritten.
Queries with no searchable tokens return no results.
Date filters are inclusive. Kind matches the explicit user label.
Pages default to 20 and accept 1–100 items.
Order is date descending, creation time descending, and SQLite BINARY ID ascending.
The adapter uses a keyset predicate and at most one lookahead row.
Cursors bind the exact query, normalized filters, anchor, and persistent notes revision.
Edits, confirmation, deletion, and restore invalidate cursors. Receipt replay does not.
Changed revisions yield `CONFLICT` on `cursor`. Invalid cursors yield `INVALID_INPUT` on `cursor`.
Changing the page size is permitted. Search and history cursors are not interchangeable.

## Composition and remaining archive work

`FormaService.notes` uses the same store, receipt namespace, close owner, and restore exclusion as workouts.
Both host factories expose this API. Cached notes APIs cannot bypass close or restore exclusion.
`createNotesModule()` keeps its standalone API and lifetime behavior.
Portable standalone stores may omit the optional `searchNotes` capability. Search then fails with `STORAGE_FAILURE`.
Both durable SQLite adapters provide that capability.

Archive integration is NOT complete in this checkpoint.
The adapter rejects export, inspection, and replacement with `STORAGE_FAILURE` on `archive.notes` when any reserved note ID exists.
This includes an ID for a deleted note. It prevents silent omission and mixed receipt replacement.
A note-free database keeps the released workout-only archive behavior.
Remove this temporary guard only after the following atomic archive extension and its tests are complete.
Archive version 2 will add a notes module with records, current confirmations, and all reserved IDs.
A version-1 archive will explicitly empty notes and reservations during full replacement.
Inspection must warn about this loss. Counts must include notes, confirmations, and reserved IDs.
Restore preview confirmation must detect intervening notes writes.
Released receipt text must remain byte-exact, including legacy workout snapshots.
All modules must roll back together after a restore failure.
No model binaries or vectors belong in the archive.
These paragraphs define remaining work. They do not describe completed behavior.

## Verification limits

Portable fixtures and Node-backed Android binding tests do not prove physical Android behavior.
Real Forma FTS5, storage restart, and archive checks remain pending until a separately authorized device run.
No device operation is authorized for this implementation task.
