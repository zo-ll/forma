# Phase 1 design board — mapping and decisions

The Claude Design project "Design brief review" contains `Forma Phase 1 Board.dc.html`.
The board is a visual reference. The contracts and [SPEC.md](../SPEC.md) win where they differ.
The board shows the dark theme only, at 360 × 760 dp. Every number on it is sample data.

## Frame mapping

The board has 42 screen frames and four reference sections.
No frame shows a Phase 2 to 5 screen.

| Brief section | Frames | Status |
| --- | --- | --- |
| 6.1 Home | ready in progress, ready start, empty, loading, closed, failed | Approved |
| 6.2 Split-day picker | ready, loading, error | Approved |
| 6.2 Exercise order | exercise order | Approved. The reorder control is not built (C5). |
| 6.3 Workout entry | layouts 1a, 1b, 1c | Approved screen. Layout 1a is built. |
| 6.3 Entry states | empty, saving, saved, restored, load picker, validation, discard confirm, conflict, closed | Approved |
| 6.4 Set edit | ready, error, delete confirm | Approved |
| 6.5 Summary | finished, in progress, edit details, delete confirm | Approved |
| 6.6 History | ready, empty, loading, stale-cursor conflict | Approved, issue #11 |
| 6.7 Progress | ready, empty, loading | Approved, issue #11 |
| 6.8 Settings | ready, close confirm, closed | Approved |

The reference sections are component specs, accessibility notes, assumptions, and open questions.

## Conflicts with the contracts

| ID | Board | Contract | Implementation |
| --- | --- | --- | --- |
| C1 | A stale cursor shows `INVALID_INPUT` on `cursor` | A stale cursor gives `CONFLICT` on `cursor`. A malformed cursor gives `INVALID_INPUT`. | Follow the contract |
| C2 | Volume unit `kg` | Volume unit `kg·rep` | Show `kg·rep` |
| C3 | Progress range "Last 4 weeks" | `resolveCalendarRange` has `today`, `this-week`, and `last-week` only | Core periods plus explicit dates |
| C4 | Finish needs one saved set | The core accepts a finish with no sets | Finish stays enabled |
| C5 | Drag to reorder exercises | No API saves a custom order. Catalog changes are issue #33. | Read-only supplied order |
| C6 | Week start is a picker | Preference version 1 fixes Monday | Read-only |
| C7 | One source per fact | Ties keep all sources. Each statistic opens its exact source. | List every source |
| C8 | Error, disabled, and busy colors | Use only the brief tokens until a design review | Brief tokens, with glyphs and text |

Smaller differences:

- Home shows "sets saved", not "sets saved today". The in-progress workout can have an earlier date.
- Home shows the saved date without a weekday name. The UI does no date arithmetic.
- A failed host cannot start again. The failed state asks for an app restart, not "Try again".
- The app cannot restart itself after Close. The user restarts the app.

## Decisions

The user approved these decisions on 2026-10-13.

- Build entry layout 1a, the sectioned list with an inline form.
- Keep Finish enabled with zero sets, as the core does.
- Show the supplied exercise order as read-only.
- Use only the brief color tokens. Show state with glyphs, text, and dashed edges.
- Progress uses the three core periods plus explicit start and end dates.
- An in-progress workout shows Discard only. A finished workout shows Delete only.
- Combined load stays a second group on the Progress screen.
- Set edit does not change the exercise of a set in issue #10.

## Request identity in the UI

`apps/mobile/src/forms/` owns UI request keys and keyboard parsing. It has no imports.
Each command slot saves its `requestId` and input before the first attempt.
Each exercise has a separate add-set slot within the workout.
A repeated tap during an attempt returns that attempt.
A definitive `INVALID_INPUT`, `NOT_FOUND`, or `CONFLICT` frees the slot.
Any other failure keeps the key and input. A retry with the same input reuses the key.
The ledger and drafts live for the host lifetime. They do not survive a process restart.
