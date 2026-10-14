# Note fields contract — issue #19

## Approved decisions

The user approved this contract before #19 implementation.
Body parts are neck, shoulder, upper arm, elbow, forearm, wrist, hand, upper back, lower back, hip, thigh, knee, calf, ankle, foot, and other.
Side is left, right, bilateral, or unspecified. General arm, leg, and back mentions do not select a narrower body part.
Pain state is present, absent, or uncertain.
Severity is an explicitly supplied finite number from 0 through 10. It is not inferred from adjectives.
Present pain permits null or a value greater than zero. Absent pain permits null or zero.
Uncertain pain requires null severity. Contradictory states and scores require correction.

Sleep has duration in minutes and optional poor, fair, or good quality.
Missing values stay null. Duration accepts finite values from 0 through 1,440, including fractions.
The bound covers one reported sleep duration, not a calculated daily total.
A personal-best field stores a user-confirmed claim. It never replaces code-derived workout facts.

English rules produce suggestions only. Other text stays usable through manual confirmation.
All suggestions require explicit user confirmation. A note kind never confirms a field.
Every later note edit invalidates prior confirmation, including date-only, kind-only, and unchanged-value edits.

## API and data

`notes.fields(noteId)` returns a coherent `NoteFieldsView`.
It has the exact current note source, overall state, current confirmation or null, and freshly computed suggestions.
Overall state is confirmed, uncertain, pending, or missing.
Suggestions are not persisted primary facts. Reading fields does not write or use the clock.
The service reads the saved primary note before it computes suggestions.

`notes.confirmFields({ requestId, noteId, expectedRevision, fields })` accepts an explicit complete field replacement.
`fields` has required keys `pain`, `sleep`, and `personalBest`.
An empty pain array does not assert absence. Null sleep or personal best means no confirmed value.
Confirmation can correct a suggestion or supply manual values without a suggestion.
The host must obtain an explicit user action before it sends this command.

Each pain entry has `bodyPart`, `otherBodyPart`, `side`, `state`, and `severity`.
Body-part identifiers use hyphens, for example `upper-arm` and `lower-back`.
Other requires a nonempty bounded description. Known body parts require null `otherBodyPart`.
There are at most 32 pain entries. Repeated or overlapping locations are rejected.
Left and right for one location may coexist. Bilateral or unspecified overlaps either side.
Core sorts pain entries into a stable order before it makes a request signature.
Sleep is null or `{ durationMin, quality }`. Either value can be null, but not both.
Personal best is null or `{ claimText }`, with nonempty valid Unicode and at most 1,024 UTF-16 code units.
Other body-part descriptions have at most 128 UTF-16 code units.
These strings reject NUL and unpaired surrogates and preserve entered text.

A `NoteFieldConfirmation` has format version 1, source, confirmed UTC timestamp, and validated fields.
Confirmation advances the note revision and audit timestamp without changing text, date, kind, ID, or creation time.
The confirmation source identifies that new revision.
A second confirmation requires that revision, so concurrent confirmations cannot overwrite each other.
A later note edit clears confirmation atomically. Deletion clears it atomically.
Old note receipt DTOs stay unchanged. Fields use separate DTOs and a new `notes.confirmFields` operation.
Receipt replay returns the original confirmation even after edit or deletion. It never restores old facts.
A stale expected revision produces CONFLICT. Invalid inputs fail before storage.

## Suggestions and evidence

`suggestNoteFields({ source, text })` is a pure exported helper.
The service supplies its source from a saved note. The helper alone does not prove a stored source exists.
Results identify the source, rules version 1, and rules language en.
Pain, sleep, and personal-best groups each have state, items, and a truncation flag.
Each item has pending or uncertain status, a proposed value or null, a reason, and exact text evidence.
Evidence uses UTF-16 offsets into the original note. Text is not normalized or rewritten.
Each group returns at most 32 suggestions and explicitly reports omitted suggestions.

Rules use fixed keywords, aliases, sentence boundaries, and contrast clauses.
Pain needs both a body-part mention and a pain or explicit absence cue.
A bare body-part mention stays uncertain.
Clear phrases such as “left knee felt fine” and “no left knee pain” propose absence, never positive pain.
Conflicting cues, complex negation, uncertainty, hypothetical or historical phrasing, quoted text, and multiple locations in one clause remain uncertain.
Severity needs an explicit score out of 10. Rules do not map “mild” or “bad” to numbers.
Sleep duration needs an explicit supported hours or minutes phrase.
Rules do not sum sleep episodes, guess a duration, or turn several different values into one fact.
Personal-best suggestions retain a textual claim, not a computed record.
Unsupported phrasing can produce missing or uncertain results. This is a conservative rule set, not a language model or clinical interpretation.

Only user-confirmed pain entries with state present can later support positive pain filters.
Confirmed absence and confirmed uncertainty stay distinct.
Later tools must read current primary fields and source revisions, not suggestions or old receipt snapshots.

## Storage, compatibility, and remaining work

The notes storage port adds confirmation reads, writes, and clearing.
Primary revision, confirmation, history revision, and request receipt share one atomic transaction.
Adapters must enforce current note identity and revision when they save confirmation.
A failed operation preserves all original state.
Current read views suppress a valid stale confirmation rather than publish it for a different revision.
Malformed stored confirmations fail with STORAGE_FAILURE.

Memory tests prove core behavior only.
The [issue #20 storage checkpoint](notes-storage-contract.md) now adds SQLite tables, FTS5, durable reopen, and shared service composition.
Archive extensions and native Android checks remain incomplete.
Issue #21 owns the confirmation UI. Inference remains absent.
The rule corrections retain explicit confirmation. Hedge, third-person, and future phrasing stays uncertain.
Coordinated left/right phrases preserve both sides as bilateral.
Known body-part aliases in `otherBodyPart` cannot bypass location overlap checks.
The archive format remains workout-only. Archive operations fail closed when reserved note IDs exist.
