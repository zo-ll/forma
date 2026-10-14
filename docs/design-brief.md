# Forma — design brief

This brief supplies a design tool with the approved Forma context.
The repository is the source of truth. This brief collects the parts a designer needs.
Read [SPEC.md](../SPEC.md), [ROADMAP.md](../ROADMAP.md), and [CONTEXT.md](../CONTEXT.md) with this file.

## 1. How to use this brief

The brief separates approved screens from speculative screens.
Phase 1 is approved. Phases 2 to 5 are planned, not approved for build.
Treat a speculative screen as a vision only. Do not present it as a build target.
Do not invent numbers, durations, or statistics. The code calculates every numerical fact.
Do not invent records, fields, or screens that the contracts do not define.

## 2. Product frame

- Forma records workouts and their explicitly confirmed meaning.
- Forma is local-first. It uses no server, no account, and no cloud sync.
- The first target is Android. The test device is a Nothing Phone (2a) with 8 GB RAM.
- One user owns the device and the records.
- Records live in a private SQLite file on the device. The file is not encrypted.
- The app works without a model. Nutrition, notes, and the assistant start later.
- A workout happens fast. The user holds the phone in one hand and rests between sets.

## 3. Design principles

- Show the primary action first.
- Keep one task per screen.
- Keep the touched values large and readable at arm's length.
- Make every control reachable with one thumb.
- Show the load convention beside the weight input. This rule comes from issue #10.
- Distinguish confirmed facts from unknown values.
- Never show a wrong or invented value. Show "unknown" instead.
- Keep destructive actions behind an explicit confirmation.
- Keep the service state visible. Show a closed service and a failed service.

## 4. Visual language

The current app uses a plain theme with two color sets.
Use these colors until a design review approves a change.

### Light theme

| Token | Value | Use |
| --- | --- | --- |
| background | `#f5f7f2` | screen background |
| card | `#ffffff` | panels and rows |
| text | `#17241c` | primary text |
| muted | `#506456` | secondary text |
| accent | `#185d38` | buttons, selection, links |

### Dark theme

| Token | Value | Use |
| --- | --- | --- |
| background | `#101815` | screen background |
| card | `#1b2923` | panels and rows |
| text | `#f0f5f1` | primary text |
| muted | `#b4c5ba` | secondary text |
| accent | `#b1efc2` | buttons, selection, links |

### Shape and size

- Cards have an 18 dp corner radius and 18 dp padding.
- Buttons have a 12 dp corner radius and a minimum height of 48 dp.
- Text inputs have a 10 dp corner radius, 12 dp padding, and a minimum height of 48 dp.
- The brand title is 32 sp. Screen titles are 22 sp. Body text uses the platform default size.

## 5. Navigation

The current shell has three routes: Home, History, and Settings.
The full workout flow adds entry routes. A proposed model is:

- Home: today, the in-progress workout or a start action, and recent records.
- Start workout: split-day choice, then exercise order.
- Workout entry: exercise list and set rows.
- Workout summary: finished record, metadata, and actions.
- History: date and exercise filters with paging.
- Progress: per-exercise facts and sources.
- Settings: preferences, export, and restore.
Use a stack for the entry flow and tabs or a top bar for the main areas.
Keep the working entry screen free of navigation clutter.

## 6. Phase 1 — approved workout screens

The workout module is implemented in `@forma/core` and `@forma/adapters`.
Issue #10 builds these screens. Issue #11 builds history and progress.

### 6.1 Home

- Show today's date from the device calendar context.
- Show the timezone name.
- If an in-progress workout exists, show Resume and today's set count.
- If no in-progress workout exists, show Start workout.
- Show the last few finished workouts with date and set count.
- States: loading, ready, closed service, failed service.

### 6.2 Split-day picker

- Show three choices: `Upper`, `Lower`, and `Arms & Shoulders`.
- Show the exercise count in each split day.
- Keep the order: Upper, Lower, Arms & Shoulders.
- Split day IDs are `upper`, `lower`, and `arms-shoulders`.
- Split days suggest exercises. They do not restrict the workout.

### 6.3 Workout entry

- Show the supplied exercise order for the chosen split day.
- Show one section per exercise. Show each set row under its exercise.
- A set row shows reps, weight in kilograms, and optional RPE.
- Show the load convention beside the weight input. Approved conventions:
  `unknown`, `entered`, `per-hand`, `combined`, and `body-weight`.
- A per-hand set shows an implement count of 1 or 2.
- Show `Save set` for the current exercise.
- After Save, require a field change or explicit confirmation before another Save.
- Keep the copied set values as defaults.
- Place confirmation before the Previous sets panel, outside the Save section.
- Show `Finish` and `Discard` controls.
- Show `Edit details` for date, notes, and duration.
- Show the number of saved sets. Saved sets are durable on the device.

### 6.4 Set edit

- Open one set for an edit.
- Change reps, weight, RPE, or the load convention.
- Show `Save` and `Delete set`.
- A load metadata change supplies the complete convention and count together.

### 6.5 Workout summary

- Show the saved record: date, split day, duration, notes, and all sets.
- Show `Resume` only for an in-progress workout.
- Show `Finish` only for an in-progress workout.
- Show `Edit details`, `Delete workout`, and `Discard` with the correct conditions.
- Discard applies to an in-progress workout only. Delete applies to either state.

### 6.6 History

- Show a date-descending list of finished workouts.
- Show date, split day, set count, and a short summary.
- Offer date and exercise filters and page controls.
- Default status is finished. Other options are in-progress and all.
- A stale cursor shows a conflict and asks for a restart.

### 6.7 Progress

- Select one exercise and a date range.
- Show code-derived facts: set count, supported volume, best comparable load, and best reps at each exact load.
- Show the source record for every fact.
- Keep entered and combined loads in separate groups.
- Show excluded unknown and body-weight sets with their reason.

### 6.8 Settings

- Show date context, week start, weight unit, and appearance.
- Appearance options: `system`, `light`, and `dark`.
- Show `Close local service`. Closing drains accepted work and keeps records.
- A later version adds archive export and restore. Mark that as future work.

## 7. Phase 2 to 5 — speculative screens

Mark every screen in this section as "planned, not approved".

### Nutrition (planned)

- Food list and food edit. Foods carry manual or label nutrient values and a source.
- Meal entry. Meals carry food references and quantities in grams.
- Nutrition day view with code-derived calories, protein, carbohydrates, and fat.
- Missing nutrients show as unknown, not zero.

### Notes (planned)

- Note list and note edit. Notes carry text, kinds, and revisions.
- Extraction confirmation for pain and sleep fields.
- Distinguish confirmed, uncertain, and pending states.
- A body-part mention does not prove pain. Negation matters.

### Assistant (planned)

- History question screen. Questions use fixed read tools.
- Show a deterministic answer with units, date context, and exact source links.
- Show a clarification request for ambiguous questions.
- Model import and status. Show missing, ready, and failed states.
- The generator supplies narrative only. The code supplies every number.

### Release (planned)

- Onboarding and a restore warning.
- Diagnostics with no personal record text.

## 8. Exact catalog data

Use this catalog. Do not rename, reorder, or merge an entry.

### Upper

1. Incline Dumbbell Press
2. Lat Pulldown
3. Cable Row
4. Cable Pullover
5. Lateral Raises
6. Triceps Pushdowns
7. Preacher Curl Machine

### Lower

1. Hack Squat
2. Bulgarian Split Squat
3. Calf Raises
4. Hammer Curls
5. Leg Extensions
6. Leg Curls

### Arms & Shoulders

1. Preacher Curl
2. Dumbbell Overhead Triceps Extension
3. Cable Lateral Raises
4. Cable Biceps Curl
5. Triceps Pushdowns
6. Overhead Shoulder Press
7. Upright Row

Keep Hammer Curls in Lower.
Keep Preacher Curl and Preacher Curl Machine separate.
Keep Lateral Raises and Cable Lateral Raises separate.
Triceps Pushdowns is one exercise in both Upper and Arms & Shoulders.

## 9. Field values on the screen

| Field | Display | Rules |
| --- | --- | --- |
| Date | saved workout date | `YYYY-MM-DD`. Never changes after a timezone change. |
| Reps | positive whole number | positive safe integer |
| Weight | kilograms | finite and not negative. The core stores the entered value. |
| RPE | optional effort | finite, from 1 to 10. Decimals are valid. |
| Duration | optional minutes | finite and not negative |
| Notes | free text | empty by default |
| Load convention | picker beside weight | one of the five approved values |
| Implement count | 1 or 2 | required for per-hand. Null for other conventions. |

## 10. Required screen states

Design each screen with these states:

- Loading: a short, calm placeholder. Do not show an empty record.
- Empty: a clear message and the next useful action.
- Ready: the real record.
- Error: a typed message. Keep the field name and the code.
- Disabled: a visible but inactive control.
- Closed: the local service is closed. Ask for an app restart.
- Conflict: the input changed under the user. Offer a reload.

## 11. Behaviour a mockup must show

- A repeated tap cannot save a workout or a set twice. The design must show one action result after a tap.
- Unsaved form values survive navigation and background. The design must show the restored values.
- The weight input shows its load convention beside it.
- Destructive actions show an explicit confirmation before the command.
- The UI shows validation messages. The UI does not own domain rules.

## 12. Accessibility

- Give every control a text label and a role.
- Use a minimum touch target of 48 dp.
- Keep text and background contrast strong.
- Support the system font scale without clipping.
- Do not use color alone to show state.
- Keep one clear heading per screen.

## 13. Out of scope for the design

- No backend, account, telemetry, or hosted model.
- No model-generated numbers, dates, units, or source IDs.
- No model-written SQL.
- No encryption claim for the SQLite file.
- No airplane-mode test claim.
- No production signing claim. Production signing is issue #32.
- No nutrition screen before the workout device gate #14 passes.

## 14. Delivery format

Ask the design tool for:

1. One frame per approved Phase 1 screen, in light and dark theme.
2. A set of states per frame: loading, empty, ready, error, disabled, conflict.
3. Component specs for the set row, the load-convention picker, the weight input, and the primary button.
4. Accessibility notes per control: label, role, and target size.
5. A list of assumptions and open questions.

Deliver the output as a reference. The implementation stays in React Native and the tested `@forma/mobile-host` shell.
