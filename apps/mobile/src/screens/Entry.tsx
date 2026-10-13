import React, {useEffect, useState} from 'react';
import {Modal, Pressable, ScrollView, Text, TextInput, View} from 'react-native';
import type {AddSetInput, Exercise, LoadConvention, PreviousSetsResult, SplitDay, Workout, WorkoutSet} from '@forma/core';
import {EMPTY_SET_DRAFT, addSetSlot, draftHasValues, parseSetDraft} from '../forms/index';
import type {FieldProblem, SetDraft} from '../forms/index';
import {Button, Card, ConfirmSheet, ErrorNotice, Muted, ScreenHeader, describeError} from '../ui/controls';
import {LoadPicker, LoadTrigger, loadLabel} from '../ui/LoadPicker';
import type {Palette} from '../ui/theme';
import {shared} from '../ui/theme';
import type {ScreenContext} from './context';
import {useCommand, useServiceRead} from './context';
import {finishSlot, useRemoveWorkout} from './workoutCommands';
import {setCountText, splitName} from './Home';

interface EntryData {
  readonly workout: Workout;
  readonly splitDays: readonly SplitDay[];
  readonly exercises: readonly Exercise[];
}

export interface ExerciseSection {
  readonly exerciseId: string;
  readonly sets: readonly WorkoutSet[];
}

/**
 * The split day order first, then any other exercise that has saved sets or
 * that the user chose. A split day suggests exercises; it does not restrict them.
 */
export function exerciseSections(workout: Workout, splitDays: readonly SplitDay[], extra: readonly string[] = []): readonly ExerciseSection[] {
  const suggested = splitDays.find(day => day.id === workout.splitDayId)?.exerciseIds ?? [];
  const order = [...suggested];
  for (const id of [...workout.sets.map(set => set.exerciseId), ...extra]) if (!order.includes(id)) order.push(id);
  return order.map(exerciseId => ({exerciseId, sets: workout.sets.filter(set => set.exerciseId === exerciseId)}));
}

function rpeText(rpe: number | null): string {
  return rpe === null ? 'RPE —' : `RPE ${rpe}`;
}

/** "reps × weight kg · convention". Stored values print as saved, never rounded. */
export function setSummary(set: Pick<WorkoutSet, 'reps' | 'weightKg' | 'loadConvention' | 'implementCount'>): string {
  const convention = set.loadConvention === 'unknown' ? 'Unknown load' : loadLabel(set);
  return `${set.reps} × ${set.weightKg} kg · ${convention}`;
}

/** The whole row opens Set edit when `onPress` is given. */
export function SetRow({palette, index, set, note, onPress}: {palette: Palette; index: number; set: WorkoutSet; note?: string | undefined; onPress?: (() => void) | undefined}) {
  return <Pressable accessible accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress}
    accessibilityLabel={`Set ${index}, ${set.reps} reps, ${set.weightKg} kilograms, ${loadLabel(set)}, ${set.rpe === null ? 'RPE not set' : 'RPE ' + set.rpe}${onPress ? '. Edit' : ''}`}
    style={[shared.row, {minHeight: 48, flexWrap: 'wrap'}]}>
    <Text style={[shared.code, {color: palette.muted, width: 20}]}>{index}</Text>
    <Text style={{color: palette.text, flex: 1, minWidth: 160}}>{setSummary(set)}</Text>
    <Text style={{color: palette.muted}}>{note ?? rpeText(set.rpe)}</Text>
  </Pressable>;
}

/** Read earlier finished sets without changing the current form or workout. */
export function PreviousSets({ctx, exerciseId, beforeDate, refreshKey}: {
  ctx: ScreenContext; exerciseId: string; beforeDate: string; refreshKey: string;
}) {
  const {palette} = ctx;
  const {loaded, reload} = useServiceRead<PreviousSetsResult>(ctx.host,
    JSON.stringify(['previousSets', exerciseId, beforeDate, refreshKey]),
    service => service.workouts.previousSets({exerciseId, beforeDate}));
  return <View style={{gap: 6}}>
    <Text accessibilityRole="header" style={[shared.label, {color: palette.muted}]}>Previous sets</Text>
    {loaded.state === 'loading' && <Muted palette={palette}>Loading previous sets…</Muted>}
    {loaded.state === 'error' && <>
      <ErrorNotice palette={palette} error={loaded.error}/>
      <Button palette={palette} label="Reload previous sets" onPress={reload}/>
    </>}
    {loaded.state === 'ready' && (loaded.value.workout === null
      ? <Muted palette={palette}>No earlier finished workout has sets for this exercise.</Muted>
      : <>
        <Muted palette={palette}>Latest finished workout before {beforeDate}: {loaded.value.workout.date}</Muted>
        {loaded.value.sets.map((set, index) => <SetRow key={set.id} palette={palette} index={index + 1} set={set}/>)}
        <Button palette={palette} label={`Open previous workout: ${loaded.value.workout.date}`}
          onPress={() => {
            const source = loaded.value.workout;
            if (source !== null) ctx.push({name: 'Summary', workoutId: source.id});
          }}/>
      </>)}
  </View>;
}

/** Design brief §6.3, layout 1a. Resume is a read; it never writes. */
export function Entry({ctx, workoutId}: {ctx: ScreenContext; workoutId: string}) {
  const {palette, forms} = ctx;
  const {loaded, reload} = useServiceRead<EntryData>(ctx.host, `entry:${workoutId}`, async service => {
    const [workout, splitDays, exercises] = await Promise.all([
      service.workouts.resume(workoutId), service.splitDays.list(), service.exercises.list(),
    ]);
    return {workout, splitDays, exercises};
  });
  const currentKey = `entry:${workoutId}:current`;
  const [view, setView] = useState(() => forms.drafts.get<{current: string | null; extra: readonly string[]}>(currentKey)
    ?? {current: null, extra: []});
  const [savedSetId, setSavedSetId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const workoutValue = loaded.state === 'ready' ? loaded.value.workout : null;
  const finish = useCommand<{workoutId: string}, Workout>(ctx, finishSlot(workoutId),
    (service, requestId, input) => service.workouts.finish({requestId, ...input}),
    () => ctx.reset([{name: 'Summary', workoutId}]));
  const discard = useRemoveWorkout(ctx, workoutValue, () => {setConfirming(false); ctx.reset([]);});
  const live = ctx.snapshot.phase === 'ready' || ctx.snapshot.phase === 'background';
  const closed = live ? null : 'The local service is closed.';
  const remember = (next: {current: string | null; extra: readonly string[]}) => {setView(next); forms.drafts.set(currentKey, next);};
  const back = {label: 'Home', onPress: () => ctx.reset([])};

  if (loaded.state === 'loading') return <View style={{gap: 18}}><ScreenHeader palette={palette} title="Workout" back={back}/>
    <Muted palette={palette}>Loading workout…</Muted></View>;
  if (loaded.state === 'error') return <View style={{gap: 18}}><ScreenHeader palette={palette} title="Workout" back={back}/>
    <ErrorNotice palette={palette} error={loaded.error}/><Button palette={palette} label="Reload workout" onPress={reload}/>
    <Button palette={palette} label="Open workout summary" onPress={() => ctx.reset([{name: 'Summary', workoutId}])}/></View>;

  const {workout, splitDays, exercises} = loaded.value;
  const names = new Map(exercises.map(exercise => [exercise.id, exercise.name]));
  const sections = exerciseSections(workout, splitDays, view.extra);
  const current = view.current ?? sections[0]?.exerciseId ?? null;
  return <View style={{gap: 14}}>
    <ScreenHeader palette={palette} title={splitName(splitDays, workout.splitDayId)} back={back}
      subtitle={`${workout.date} · ${setCountText(workout.sets.length)} saved`}/>
    <Button palette={palette} label="Edit details" disabledReason={closed} onPress={() => ctx.push({name: 'EditDetails', workoutId})}/>
    {sections.map((section, index) => {
      const isCurrent = section.exerciseId === current;
      const name = names.get(section.exerciseId) ?? section.exerciseId;
      return <Card key={section.exerciseId} palette={palette} style={{gap: 6, borderWidth: isCurrent ? 2 : 0, borderColor: palette.accent}}>
        <Pressable accessibilityRole="button" accessibilityState={{selected: isCurrent}}
          accessibilityLabel={`${name}, ${section.sets.length ? setCountText(section.sets.length) : 'no sets'}${isCurrent ? ', current' : ', make current'}`}
          disabled={isCurrent} onPress={() => remember({...view, current: section.exerciseId})}
          style={[shared.row, {justifyContent: 'space-between', minHeight: 48}]}>
          <Text style={{color: palette.text, fontWeight: '600', flexShrink: 1}}>{index + 1}  {name}</Text>
          <Text style={[shared.label, {color: isCurrent ? palette.accent : palette.muted}]}>
            {isCurrent ? 'CURRENT' : section.sets.length ? setCountText(section.sets.length) : 'no sets'}</Text>
        </Pressable>
        {section.sets.map((set, setIndex) => <SetRow key={set.id} palette={palette} index={setIndex + 1} set={set}
          note={set.id === savedSetId ? '✓ saved' : undefined}
          onPress={live ? () => ctx.push({name: 'SetEdit', workoutId, setId: set.id}) : undefined}/>)}
        {isCurrent && <SetForm ctx={ctx} workout={workout} exerciseId={section.exerciseId} exerciseName={name}
          previous={section.sets[section.sets.length - 1] ?? null} nextIndex={section.sets.length + 1}
          onSettled={setId => {setSavedSetId(setId); reload();}}/>}
      </Card>;
    })}
    <Button palette={palette} label="Log another exercise" onPress={() => setChoosing(true)}/>
    {finish.failure != null && <ErrorNotice palette={palette} error={finish.failure}/>}
    {discard.command.failure != null && <ErrorNotice palette={palette} error={discard.command.failure}/>}
    {finish.unconfirmed && <Muted palette={palette}>The last finish is unconfirmed. Finish again sends the same request.</Muted>}
    <View style={shared.row}>
      <Button palette={palette} style={{flex: 1}} label="Discard" accessibilityLabel="Discard workout" disabledReason={closed}
        onPress={() => setConfirming(true)}/>
      <Button palette={palette} style={{flex: 1}} label="Finish" accessibilityLabel="Finish workout"
        busyLabel={finish.busy ? 'Finishing…' : null} disabledReason={closed} onPress={() => finish.run({workoutId})}/>
    </View>
    <ConfirmSheet palette={palette} visible={confirming} busy={discard.command.busy} title="Discard this workout?"
      body={`The in-progress ${splitName(splitDays, workout.splitDayId)} workout and its ${setCountText(workout.sets.length)} will be removed from this phone. This cannot be undone.`}
      confirmLabel="Discard workout" keepLabel="Keep workout" onConfirm={discard.run} onKeep={() => setConfirming(false)}/>
    <Modal visible={choosing} animationType="slide" onRequestClose={() => setChoosing(false)}>
      <ScrollView style={{flex: 1, backgroundColor: palette.background}} contentContainerStyle={{padding: 20, gap: 8}}>
        <ScreenHeader palette={palette} title="Choose an exercise" back={{label: 'Workout', onPress: () => setChoosing(false)}}/>
        {exercises.filter(exercise => !sections.some(section => section.exerciseId === exercise.id)).map(exercise =>
          <Button key={exercise.id} palette={palette} label={exercise.name} onPress={() => {
            remember({current: exercise.id, extra: [...view.extra, exercise.id]});
            setChoosing(false);
          }}/>)}
      </ScrollView>
    </Modal>
  </View>;
}

export function Field({palette, label, value, onChange, problem, keyboard, editable, restored, accessibilityLabel, children}: {
  palette: Palette; label: string; value: string; onChange: (text: string) => void; problem: string | undefined;
  keyboard: 'number-pad' | 'decimal-pad'; editable: boolean; restored: boolean; accessibilityLabel: string; children?: React.ReactNode;
}) {
  return <View style={{gap: 4, flexGrow: 1, flexBasis: 120}}>
    <Text style={[shared.label, {color: problem ? palette.text : palette.muted}]}>{label}{restored ? ' · restored' : ''}</Text>
    <View style={[shared.row, {flexWrap: 'nowrap'}]}>
      <TextInput accessibilityLabel={accessibilityLabel} value={value} onChangeText={onChange} editable={editable}
        keyboardType={keyboard} maxLength={12} placeholder="—" placeholderTextColor={palette.muted}
        style={[shared.input, {flex: 1, color: palette.text, fontSize: 22, borderColor: problem ? palette.text : palette.muted,
          borderWidth: problem ? 2 : 1, borderStyle: restored ? 'dashed' : 'solid'}]}/>
      {children}
    </View>
    {problem && <Text accessibilityLiveRegion="polite" style={{color: palette.text}}>▲ {problem}</Text>}
  </View>;
}

export function draftFromSet(set: WorkoutSet): SetDraft {
  return {reps: String(set.reps), weight: String(set.weightKg), rpe: set.rpe === null ? '' : String(set.rpe),
    loadConvention: set.loadConvention, implementCount: set.implementCount};
}

export function SetForm({ctx, workout, exerciseId, exerciseName, previous, nextIndex, onSettled}: {
  ctx: ScreenContext; workout: Workout; exerciseId: string; exerciseName: string; previous: WorkoutSet | null;
  nextIndex: number; onSettled: (setId: string | null) => void;
}) {
  const {palette, forms} = ctx;
  const draftKey = `set:${workout.id}:${exerciseId}`;
  const slot = addSetSlot(workout.id, exerciseId);
  const [restored, setRestored] = useState(() => {
    const saved = forms.drafts.get<SetDraft>(draftKey);
    return saved !== null && draftHasValues(saved);
  });
  // A new exercise defaults to unknown load; a later set starts from the previous set of this exercise.
  const [draft, setDraft] = useState<SetDraft>(() => forms.drafts.get<SetDraft>(draftKey) ?? (previous ? draftFromSet(previous) : EMPTY_SET_DRAFT));
  const [problems, setProblems] = useState<readonly FieldProblem[]>([]);
  const [failure, setFailure] = useState<unknown>(null);
  type SetCommand = Omit<AddSetInput, 'requestId'>;
  const [pending, setPending] = useState<SetCommand | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const busy = pending !== null;
  const live = ctx.snapshot.phase === 'ready' || ctx.snapshot.phase === 'background';
  const unconfirmed = forms.commands.pending(slot)?.unconfirmed === true;

  const show = (next: SetDraft) => {
    setDraft(next);
    setProblems([]);
    setFailure(null);
    setNotice(null);
  };
  const change = (patch: Partial<SetDraft>) => {
    const next = {...draft, ...patch};
    show(next);
    forms.drafts.set(draftKey, next);
  };
  // Clear returns to the defaults of a new form. A stored copy of them would restore the notice later.
  // The pending command for this slot stays in the ledger.
  const clear = () => {
    setRestored(false);
    show(previous ? draftFromSet(previous) : EMPTY_SET_DRAFT);
    forms.drafts.clear(draftKey);
  };
  const problemFor = (field: string): string | undefined => {
    const local = problems.find(problem => problem.field === field)?.message;
    if (local) return local;
    const error = describeError(failure);
    return failure != null && error.field === field ? `${error.message} (${error.code})` : undefined;
  };

  const attach = (attempt: Promise<WorkoutSet>, sent: SetCommand) => {
    setPending(sent);
    attempt.then(set => {
      setPending(null);
      setRestored(false);
      // The saved set now holds these values; the next form starts from it.
      forms.drafts.clear(draftKey);
      setNotice(`✓ Set ${nextIndex} saved on this phone.`);
      onSettled(set.id);
    }, error => {
      setPending(null);
      setFailure(error);
      onSettled(null);
    });
  };
  // A save sent before navigation still runs; attach to it instead of a second command.
  useEffect(() => {
    const running = forms.commands.current<WorkoutSet>(slot);
    const sent = forms.commands.pending(slot)?.input as SetCommand | undefined;
    if (running && sent?.exerciseId === exerciseId) attach(running, sent);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    // Attach to this exercise's accepted command instead of another save.
    if (forms.commands.busy(slot)) {setNotice('This set is still saving. Try again when it finishes.'); return;}
    setFailure(null);
    setNotice(null);
    const parsed = parseSetDraft(draft);
    if (!parsed.ok) {setProblems(parsed.problems); return;}
    const {rpe, loadConvention, implementCount, ...numbers} = parsed.value;
    const input: SetCommand = {
      workoutId: workout.id, exerciseId, ...numbers, loadConvention: loadConvention as LoadConvention, implementCount,
      ...(rpe === null ? {} : {rpe}),
    };
    attach(forms.commands.run(slot, input, (requestId, saved) => ctx.host.service().workouts.addSet({requestId, ...saved})), input);
  };

  const choice = {loadConvention: draft.loadConvention as LoadConvention, implementCount: draft.implementCount};
  const localOnly = failure != null && describeError(failure).field !== null
    && ['reps', 'weightKg', 'rpe'].includes(describeError(failure).field ?? '');
  return <View style={{gap: 10, marginTop: 6}}>
    <PreviousSets ctx={ctx} exerciseId={exerciseId} beforeDate={workout.date} refreshKey={workout.updatedAt}/>
    {restored && <View style={[shared.notice, {borderColor: palette.accent, borderStyle: 'dashed'}]}>
      <Text style={{color: palette.text, fontWeight: '600'}}>↺ Unsaved values restored</Text>
      <Muted palette={palette}>Not saved yet. Review, then save.</Muted>
      <Button palette={palette} label="Clear" onPress={clear}/>
    </View>}
    {pending && <View style={[shared.row, {borderWidth: 1, borderStyle: 'dashed', borderColor: palette.muted, borderRadius: 10, padding: 8}]}>
      <Text style={[shared.code, {color: palette.muted, width: 20}]}>{nextIndex}</Text>
      <Text style={{color: palette.text, flex: 1}}>{setSummary({reps: pending.reps, weightKg: pending.weightKg,
        loadConvention: pending.loadConvention ?? 'unknown', implementCount: pending.implementCount ?? null})}</Text>
      <Muted palette={palette}>saving…</Muted>
    </View>}
    <View style={[shared.row, {flexWrap: 'wrap', alignItems: 'flex-start'}]}>
      <Field palette={palette} label="Reps" value={draft.reps} onChange={reps => change({reps})} problem={problemFor('reps')}
        keyboard="number-pad" editable={!busy} restored={restored} accessibilityLabel={`Reps for ${exerciseName}, set ${nextIndex}`}/>
      <Field palette={palette} label="RPE · optional" value={draft.rpe} onChange={rpe => change({rpe})} problem={problemFor('rpe')}
        keyboard="decimal-pad" editable={!busy} restored={restored} accessibilityLabel="RPE, optional, 1 to 10"/>
    </View>
    <Field palette={palette} label="Weight · kg" value={draft.weight} onChange={weight => change({weight})} problem={problemFor('weightKg')}
      keyboard="decimal-pad" editable={!busy} restored={restored} accessibilityLabel={`Weight in kilograms, load ${loadLabel(choice)}`}>
      <LoadTrigger palette={palette} choice={choice} disabled={busy} onPress={() => setPicking(true)}/>
    </Field>
    {failure != null && !localOnly && <ErrorNotice palette={palette} error={failure}/>}
    {failure != null && localOnly && <Text style={[shared.code, {color: palette.muted}]}>{describeError(failure).code}</Text>}
    {unconfirmed && !busy && <Muted palette={palette}>The last save is unconfirmed. Save set again sends the same request, so it cannot add the set twice.</Muted>}
    {notice && <Text accessibilityLiveRegion="polite" style={{color: palette.accent}}>{notice}</Text>}
    <Button palette={palette} primary label="Save set" busyLabel={busy ? 'Saving set…' : null}
      disabledReason={live ? null : 'The local service is closed. Restart the app to add more.'} onPress={save}/>
    <LoadPicker palette={palette} visible={picking} title={draft.weight.trim() ? `How is ${draft.weight.trim()} kg measured?` : 'How is the weight measured?'} initial={choice}
      onCancel={() => setPicking(false)} onDone={next => {setPicking(false); change(next);}}/>
  </View>;
}
