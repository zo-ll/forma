# Forma — workout UI handoff

## Final verification state

The user resumed the session and authorized the final phone checks and merge.
The large-dataset UI check completed in 107 seconds on the unmodified `9810004` feature APK.
All 12 large-dataset assertions passed. All four restoration assertions also passed.
History advanced correctly, Progress showed exact counts and volumes, and the 1,000-workout source list opened an owned fixture.

The scale cleanup deleted all 1,000 owned workouts in 1,933 ms through the reviewed service harness.
It confirmed zero remaining owned records, exact preservation of all 21 baseline records, and unchanged active-session identity.
The marker now contains a `cleaned` tombstone, not a pending seed.
The final feature APK replaced the temporary APK without a data reset.
Its installed hash matched `1915d63000991b39323c1bc8bf22bf5028e261c0156ddd112280ea0bcfc32aa0`.
At restoration, Home was ready, the system theme remained selected, and no active workout existed.
The phone returned to the user. No further phone operation is scheduled.

Scoped frame evidence recorded 3,498 frames, 66 janky frames (1.89%), and a 14 ms frame p95.
The legacy counter recorded 774 janky frames (22.13%). These counters use different definitions.
The memory snapshot recorded 276,517 KiB PSS and 380,508 KiB RSS.
The current process had no error-level log entries in the captured sample.
These observations are not an official performance threshold or proof for larger datasets.

The source code still equals reviewed code head `9810004`. Only this handoff changed after that head.
The documentation tip needs an independent delta check before merge, not another APK build or full test run.
Gate #14 remains unapproved. Archive restore, physical full-workout acceptance, and screen-reader focus remain outside this merge.
The temporary harness stays on its separate local branch and must not merge.

Final evidence: `~/.local/state/forma/ui-scale-9810004/` and the existing `~/.local/state/forma/scale/` run results.
The private continuation note now records cleanup and restoration.
After the feature merge, stop. Do not start another feature.

## Historical pause snapshot

The sections below record the earlier pause. The final state above supersedes their pending actions and phone state.

### Stop state

The user paused the session and authorized only a branch push and this handoff.
Do not operate the phone until the user resumes.
Do not merge now. No test driver remains active.

The feature branch is `issue/10-workout-record-screens`.
The reviewed and device-tested code head is `9810004b9ade890ef58222a2c8ba03d598bf6fff`.
The branch was pushed to `origin` at that exact head before this handoff was added.
The handoff commit is a later documentation-only change. It has no exact-head review yet.

**Warning: the test phone still has the temporary scale APK and 1,000 owned fixture workouts.**
Do not reset the package, start a new fixture run, or use the normal native gate modes before scale cleanup.
The original 21 synthetic records must remain intact.

## Resume first

1. Read the private continuation note at `~/.local/state/forma/RESUME-WORKOUT-UI.md` on the current host.
2. Ask the user for the current main Wireless debugging address.
3. Reuse the existing authorized ADB identity and private Unix socket.
4. Confirm the installed APK and the saved fixture run before any mutation.
5. Continue the large-dataset UI check, or perform safe cleanup if the user abandons that check.
6. Remove only the owned fixtures through the same run's `scale-cleanup` mode.
7. Verify the exact 21 baseline records and the absence of an active session.
8. Restore the final feature APK without a data reset.
9. Obtain an exact-head review for the documentation delta or any later code change.
10. Merge only after the remaining checks and the user's resumed authorization permit it.
11. Stop after the merge. Do not start another feature.

The earlier instruction was to stop after this work merged.
The latest instruction paused the work and requested a push instead. No merge occurred.

## What the branch implements

The baseline is `26eaf9463e9f34ebd2a1af2330acfe3bf55ba1d8` on `master`.
The code delta has 26 files, 2,627 added lines, and 55 removed lines before this handoff.

- Home, split selection, supplied exercise order, start, and resume.
- Sectioned workout entry, explicit loads, reps, optional RPE, and previous sets.
- Set corrections, metadata corrections, summary, finish, discard, and whole-workout deletion.
- History with bounded pages, status/date/exercise filters, typed failures, and exact details.
- Progress with comparable groups, exclusions, exact units, and source links.
- System/light/dark appearance and confirmed local-service close.
- Host-lifetime draft recovery and retained write request identity.

The design source was the approved Phase 1 board from Claude Design.
`docs/design-board-phase1.md` records the mapping and decisions.
The design uses layout 1a, no reorder control, Monday week start, core periods, and custom dates.
Finish remains valid with zero sets.

The branch relates to issues #10 and #11. Neither issue nor gate #14 received completion approval in this session.

## Ownership

| Owner | Responsibility |
| --- | --- |
| `packages/core/src/` | Domain rules, dates, load meaning, write commands, and numerical facts. |
| `packages/adapters/src/sqlite/` | Shared SQL, migrations, transactions, receipts, and resource lifetime. |
| `packages/adapters/src/android/` | Native database binding and one-owner guard. |
| `packages/mobile-host/src/host.ts:90` | Host lifetime, preferences, and calendar context. |
| `apps/mobile/src/root.ts:12` | One mobile composition root per React instance. |
| `apps/mobile/src/root.ts:34` | Host-lifetime forms and command state. |
| `apps/mobile/src/forms/index.ts:58` | Accepted/unconfirmed command identity and retries. |
| `apps/mobile/src/forms/index.ts:121` | In-memory draft store. |
| `apps/mobile/src/screens/` | Presentation and service calls. No SQL or independent domain calculations. |
| `apps/mobile/App.tsx:49` | Navigation, visible lifecycle state, and close confirmation. |

Progress still reads the device platform and calls the core calendar resolver.
This documented exception remains in `apps/mobile/src/screens/Progress.tsx:32`.

## Important flows

### Entry and write identity

`Entry.tsx:88` reads the current workout through the service.
`Entry.tsx:30` keeps the supplied split order, then adds other selected or recorded exercises.
`Entry.tsx:194` renders the current set form.
`forms/index.ts:11` gives each workout/exercise pair a separate add-set slot.
A navigation change must not discard an accepted or unconfirmed command.

`Entry.tsx:59` reads previous sets through `workouts.previousSets`.
The panel uses the current exercise and an earlier finished workout, before the saved workout date.
It shows raw saved values and opens the exact source workout.
It does not replace the current draft.

### Clear

The original Clear handler stored committed defaults as an unsaved draft.
The restored notice therefore returned after another Home/resume cycle.

Commit `659c234` corrected the handler at `Entry.tsx:230`.
It resets local fields and deletes only the stored form draft.
It keeps the command ledger and request identity unchanged.

### Date drafts

Commit `aff38d4` separated typed dates from applied filters.
History uses `history:typedDates`; Progress uses `progress:typedDates`.
Applied filters retain their existing keys.

History restores the typed draft at `History.tsx:38`.
Progress restores it at `Progress.tsx:66`.
An explicit apply action or another filter change uses the visible dates.
History Clear filters clears both the applied dates and the typed draft.
Typed dates alone do not change the query.

The first correction merged text from a stale render closure.
Two From/To events before another render could lose the first field.
Commit `9810004` corrected both writers with functional state updates.
See `History.tsx:61` and `Progress.tsx:75`.
Two regression tests call both handlers from one render without an intervening render.

### History and facts

`History.tsx:35` calls bounded history with a page size of 20.
Filters remain separate from typed input. A filter change resets the cursor stack.
The UI reports a stale cursor as a typed conflict and offers a restart.

`Progress.tsx:90` reads statistics from the service.
Entered and combined loads remain separate.
Unknown and body-weight sets remain excluded from comparable best-load facts.
`Progress.tsx:43` displays source controls and opens the exact workout.

### Close and restart

`App.tsx:117` closes the local host after confirmation.
A background resume does not reopen an explicitly closed host.
A new process creates a new runtime.
Committed records and preferences survive. In-memory drafts do not survive process death.

## Verification history

| Artifact | Source and native results |
| --- | --- |
| `686e0cd` | 638 source tests; build and typechecks passed; 177 native assertions: 174 pass, three fail. |
| `aff38d4` | 646 source tests; build and typechecks passed; 26 native assertions passed, including all three previous failures. |
| `9810004` | 648 source tests; build and typechecks passed; 26 native assertions passed. |

The assertion count includes fixture checks. It is not a feature count.
The complete 177-assertion suite did not run again at the later heads.
The later native units targeted the corrected behavior and preservation of the original records.

At `9810004`, the checks proved:

- Clear remains clear after navigation and retains committed defaults.
- History and Progress restore unapplied dates without an unintended query change.
- Background resume retains those dates in the same process.
- Explicit apply and another filter change use the visible dates.
- Clear filters removes applied and typed History dates.
- Relative ranges still use the core calendar.
- Corrected progress remains exactly 528 kg·rep for the remaining combined-load group.
- The original 21 records still produce the exact partial second history page.

The two same-render date tests failed before the fix and passed afterward.
The critic independently reproduced those failures against `aff38d4`.

## Independent review

The user-selected critic was `opencode-go/deepseek-v4.1-flash`.
The final code review targeted `9810004` exactly.
Fresh coverage was 3/3 files. Union coverage was 26/26 files.
It reported no critical, high, medium, or new low findings in that delta.
Existing low findings remain. The verdict is not a zero-findings approval.

The critic ran all 648 source tests, both typechecks, and both diff checks.
It confirmed a clean worktree and unchanged code head.
Its report saw only the first six rows of the concurrent native run.
The coordinator later observed all 26 native passes. Keep these evidence owners distinct.

The review applies to the code head, not automatically to this later handoff commit.
Do not substitute this verdict for a later code head.

## Known source limits

- Hardware back retains drafts where some visible cancel/back controls clear them.
- Fast Older taps can append a duplicate cursor. Three native attempts did not reproduce the source race.
- Progress source controls deduplicate by workout and omit set-level identity. Same-date source labels can be identical.
- Expanded source lists are not virtualized.
- A null per-hand count has an imprecise sentence fallback in the load picker.
- Some older tests remain helper-level; the small hook runtime is not the real React scheduler.
- `CommandLedger.forget` has no app caller.
- `PreviousSets` re-reads after a current workout update that cannot change the earlier workout.
- Progress retains its documented platform access.
- The critic noted a pre-existing same-render merge risk in numeric/detail drafts outside the date-fix scope.
- Draft writes inside the functional date updater are idempotent. The critic recorded a React purity note, not a confirmed failure.

No physical full-workout acceptance or screen-reader focus check completed.
Archive export/restore is not implemented. Gate #14 remains unapproved.
Do not start nutrition, independent notes, the assistant, or another feature after this merge.

## Scale experiment — separate from the feature branch

The temporary harness is on local branch `experiment/native-ui-scale-aff38d4`.
Its frozen head is `c08e76832ad4a4abd2b04fd0eb9d9ef185fb4d71`.
It is not merged into the feature branch and was not pushed with this branch.
Its worktree and artifacts remain in `~/.local/state/forma/scale/` on the current host.

The harness adds guarded seed/query/cleanup modes for the isolated hostgate build only.
It uses the real service methods, not raw SQL or a database reset.
A durable native marker stores baseline records, ownership, pending intent, and the previous marker.
The Node suite passed 656 tests, including a 1,000-workout SQLite case and interrupted-write recovery.
A separate independent review covered all six changed files and returned `SAFE TO RUN` at `c08e768`.

**Warning: the scale marker shares the normal gate snapshot key.**
Do not run `fixtures`, normal `seed`, normal `verify`, or `node scripts/mobile-host-device.mjs run` before scale cleanup.
A normal seed can overwrite ownership and prevent safe cleanup.
This is a medium operational constraint in the temporary harness, not a shipped feature change.

## Completed native scale results

The phone completed `scale-seed` and `scale-query` under one saved run ID.
The result came from the real Android OP-SQLite adapter.

| Observation | Actual value |
| --- | --- |
| Owned finished workouts | 1,000 |
| Owned sets | 5,000 |
| Fixture date | `2026-09-01` |
| Entered volume | 400,000 kg·rep |
| Combined volume | 800,000 kg·rep |
| Unknown exclusions | 1,000 |
| Original records preserved exactly | 21 of 21 |
| Total finished records | 1,021 |
| History pages at size 20 | 52 |
| Last page | One item, partial |
| Seed elapsed time | 5,709 ms |
| Marker size | 38,577 characters, below the 65,536-character limit |

Each fixture has five Incline Dumbbell Press sets.
Two use Entered load. Two use Per hand with two implements. One uses Unknown load.
All use 10 reps and 20 kg.

Each measured operation had one warm-up and 20 round-robin samples.

| Native service operation | Median | p95 | Maximum |
| --- | --- | --- | --- |
| First history page | 0.669 ms | 0.759 ms | 0.837 ms |
| Last history page | 0.488 ms | 0.571 ms | 1.990 ms |
| Exercise statistics | 66.359 ms | 67.597 ms | 70.948 ms |

These are service measurements, not UI render times.
No official performance threshold exists. Do not declare a UI performance pass from them.
The actual feature UI has not yet run against this large dataset.

## Phone state at pause

Only `dev.forma.mobile.hostgate` was installed or operated.
Other apps and real Forma records were not changed.
The phone currently has the temporary scale APK from `c08e768`, not the final feature APK from `9810004`.
The scale marker remains `seeded`. Cleanup has not run.
There are 1,021 finished synthetic records and no active session.

The endpoint is temporary and stays in the private handoff, not this public file.
The existing pairing identity remains valid. Do not print, replace, or commit its private key.
Ask for the current endpoint after the user returns.

| APK | SHA256 |
| --- | --- |
| Final feature, `9810004` | `1915d63000991b39323c1bc8bf22bf5028e261c0156ddd112280ea0bcfc32aa0` |
| Temporary scale, `c08e768` | `8d8bc1e76dc16d5799bd7ccc710c11dd001e76b4dce219e80f0cf4c87462335a` |

Both artifacts remain on the current host.
The installed scale APK hash was read from the phone and matched the reviewed harness.

## Remaining work

1. Measure the final feature UI against the existing 1,000-workout dataset.
2. Check history, custom-range progress, exact totals, source navigation, scroll, memory, frames, and scoped errors.
3. Keep service time, UI time, and driver overhead separate.
4. Return to the scale harness with the same saved run ID.
5. Run only `scale-cleanup`.
6. Verify all owned fixtures are gone and all 21 baseline records remain exact.
7. Restore the final feature APK with `install -r`, not a data reset.
8. Verify ready Home, the system theme, no active session, and retained baseline records.
9. Review any new code or the documentation-only tip at its exact head.
10. Create or update the PR, merge the approved state if authorized, and stop.

Do not close issues #10, #11, or #14 solely from the service timing result.
Do not push the local experiment branch unless the user asks.

## Evidence on the current host

- `~/.local/state/forma/ui-checks-686e0cd/`: failed-before native results, original screenshots, and the 177-assertion report.
- `~/.local/state/forma/ui-checks-aff38d4/`: 26 native passes, the installed APK hash, and the source review.
- `~/.local/state/forma/ui-checks-9810004/`: final code build, APK, 26 native passes, date-race proofs, and final code review.
- `~/.local/state/forma/scale/`: frozen harness, APK, safety verdict, saved run identity, results, and the mode runner.
- `~/.local/state/forma/RESUME-WORKOUT-UI.md`: private operational handoff and exact commands.

Raw device evidence, endpoints, logs, and APKs stay outside the public repository.
Temporary copies under `/tmp` are not the only evidence copies.

## Source checks and build commands

Use Node 24 or later.

```sh
npm ci
npm test
npm run typecheck
npm ci --prefix apps/mobile
npm run typecheck --prefix apps/mobile
node scripts/mobile-host-device.mjs build
```

The `build` command does not run native gate modes.
Do not use the runner's `run` command while the scale marker exists.
A source change requires a new build and an exact-head review before merge.
The canonical Windows Gradle wrapper uses CRLF. Use the CRLF-aware diff check:

```sh
git -c core.whitespace=cr-at-eol diff --check BASE HEAD
```

## Resume workflow preferences

Use `claudep` in a new window of the existing tmux session when a worker is necessary.
Use the requested DeepSeek critic model for independent reviews.
Require a completion notification. Do not poll the worker or critic.
Pane IDs can change. Confirm the coordinator pane before a notification.
A completion notification can append to text in the editor; distinguish it from a new user instruction.
Do not use Filo for this project.

The old `p:claude` window is idle. Later tasks used separately named windows.
All workers and critics for the work described here completed. No phone driver remains active.
