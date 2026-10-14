# Mobile notes source — issue #21

## Ownership

`App.tsx` adds the Notes tab and named stack routes.
`NoteCreate` has no source yet.
`NoteDetail`, `NoteEdit`, and `NoteFields` carry the exported `NoteSource` with the exact note ID and revision.
`src/screens/Notes.tsx` owns history, filters, literal search, primary text forms, detail, and delete confirmation.
`src/screens/NoteFields.tsx` owns structured confirmation controls.
`src/screens/noteHooks.ts` guards note reads and writes.
`src/forms/index.ts` owns typed drafts and keyboard parsing.
Core owns validation, records, suggestions, receipts, and numerical rules.
Screens use only `FormaService.notes`. They do not access SQL, storage, or models.

## Defaults and behavior

A new note uses the host's explicit current calendar date and `general` kind.
Primary text stays unchanged, including spaces, newlines, and negated pain.
Kind is only a label.
A primary save does not call extraction or a model.

Drafts and captured requests live for the host lifetime.
They survive navigation, component remount, and background.
They are not persistent unsaved drafts after process death.
Each write captures its input and request ID before submission.
A completed intent stays consumed across remount.
Completed update, confirmation, and deletion intents retain completion markers for the host lifetime, until process exit or restore.
Update and confirmation markers can retain full DTO snapshots, including note text or confirmed fields.
Deletion markers retain the completed result, even though deletion returns no DTO.
This is a non-blocking memory cleanup limit. There is no fixed cache-size bound.
These markers preserve queued-callback and remount protection; they are not a source of current facts.
A lost reply retains the captured request.
Retry settles that request before the form accepts different input.

Edits and confirmations use `expectedRevision`.
A stale draft stays visible and cannot overwrite a newer source.
The user can keep the draft and reload, or discard it and reload.
Detail reads compare the current note and fields with the route revision.
A mismatch requires explicit refresh to the current source.
The newer text is not shown as the old revision.
Deletion uses a separate explicit confirmation sheet.
Cancel sends no deletion, including a queued confirmation after cancellation.

Suggestions show evidence, group state, item state, and truncation separately.
They are not confirmed facts.
Copying a suggestion changes only the field draft.
Only `Confirm these fields` sends confirmation.
At the 32-entry pain cap, both Add pain entry and Copy pain suggestion show the same disabled reason.
Same-render callbacks also check the current intent before adding an entry.
The controls provide approved body parts, sides, and pain states.
Severity is optional and explicit.
Changing pain state retains severity visibly for correction.
Changing body part clears the other description with a visible explanation.
Sleep minutes and quality are optional.
Personal best stores a claim, not a computed record.
Empty optional values remain null.
Core rejects contradictions and invalid ranges without dropping draft input.

History and search request 20 notes per page.
Date filters are inclusive. Search uses the service's literal token phrase API.
Opaque cursor conflicts offer restart from newest.
Each result opens its exported exact source.
Version-2 archives preserve notes, confirmations, reserved IDs, workouts, and exact receipts atomically.
Settings shows all-module counts and requires the opaque global restore token.
Legacy version-1 restore warns that notes will become empty.
Restore uses the existing shell reset to clear drafts, saved attempts, completion markers, routes, query state, and cursors.
Late note callbacks cannot cross navigation disposal, service close, or records replacement.

## Verification limits

The integrated local suite passed 970 tests. The focused Notes/archive screen and host subset passed 33 tests.
Notes now have 19 focused tests, including the pain cap and a delayed write reply after real host restore.
The archive screen regression checks version-2 note, confirmation, and reserved-ID counts and exact restored DTOs.
These checks use local synthetic fixtures only.
Node tests exercise pure forms and actual screen callbacks through a small React hook harness.
They do not prove native layout, the real React scheduler, TalkBack, large fonts, or physical persistence.
No device operation was performed for this source slice.
Physical Android notes save, edit, delete, confirmation, search, background, and process-restart checks remain pending.
Saved text and confirmed fields must be checked after a real process restart.
The source is rebased onto merged #20 (`23a71b5`), which includes final source archive integration.
Final exact-head #21 CI and independent re-review remain coordinator work.
The #20 source review and CI do not prove physical notes behavior. Neither does historical #14 evidence.
The build-tool dependency exception remains unchanged.
Nutrition, photos, voice, inference, and a backend remain absent.
