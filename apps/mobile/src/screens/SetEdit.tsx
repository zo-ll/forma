import React, {useState} from 'react';
import {Text, View} from 'react-native';
import {FormaError} from '@forma/core';
import type {Exercise, LoadConvention, UpdateSetInput, Workout, WorkoutSet} from '@forma/core';
import {parseSetDraft} from '../forms/index';
import type {FieldProblem, SetDraft} from '../forms/index';
import {Button, ConfirmSheet, ErrorNotice, Muted, ScreenHeader, describeError} from '../ui/controls';
import {LoadPicker, LoadTrigger, loadLabel, loadSentence} from '../ui/LoadPicker';
import {shared} from '../ui/theme';
import type {ScreenContext} from './context';
import {useCommand, useServiceRead} from './context';
import {Field, draftFromSet, setSummary} from './Entry';

interface SetEditData {
  readonly workout: Workout;
  readonly set: WorkoutSet;
  readonly index: number;
  readonly exercise: Exercise;
}

/** Design brief §6.4. The exercise of a set does not change in issue #10. */
export function SetEdit({ctx, workoutId, setId}: {ctx: ScreenContext; workoutId: string; setId: string}) {
  const {palette} = ctx;
  const {loaded, reload} = useServiceRead<SetEditData>(ctx.host, `set:${setId}`, async service => {
    const workout = await service.workouts.get(workoutId);
    const set = workout.sets.find(item => item.id === setId);
    if (!set) throw new FormaError('NOT_FOUND', 'The set does not exist.', {field: 'setId'});
    const exercise = await service.exercises.get(set.exerciseId);
    const index = workout.sets.filter(item => item.exerciseId === set.exerciseId).findIndex(item => item.id === setId) + 1;
    return {workout, set, index, exercise};
  });
  const back = {label: 'Workout', onPress: ctx.pop};
  if (loaded.state === 'loading') return <View style={{gap: 18}}><ScreenHeader palette={palette} title="Edit set" back={back}/>
    <Muted palette={palette}>Loading set…</Muted></View>;
  if (loaded.state === 'error') return <View style={{gap: 18}}><ScreenHeader palette={palette} title="Edit set" back={back}/>
    <ErrorNotice palette={palette} error={loaded.error}/><Button palette={palette} label="Reload" onPress={reload}/></View>;
  return <SetEditForm ctx={ctx} data={loaded.value}/>;
}

function SetEditForm({ctx, data}: {ctx: ScreenContext; data: SetEditData}) {
  const {palette, forms} = ctx;
  const {workout, set, index, exercise} = data;
  const draftKey = `setEdit:${set.id}`;
  const stored = forms.drafts.get<SetDraft>(draftKey);
  const [draft, setDraft] = useState<SetDraft>(() => stored ?? draftFromSet(set));
  const [restored] = useState(stored !== null);
  const [problems, setProblems] = useState<readonly FieldProblem[]>([]);
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const leave = () => {forms.drafts.clear(draftKey); ctx.pop();};
  const save = useCommand<Omit<UpdateSetInput, 'requestId'>, WorkoutSet>(ctx, `set.update:${set.id}`,
    (service, requestId, input) => service.workouts.updateSet({requestId, ...input}), leave);
  const remove = useCommand<{workoutId: string; setId: string}, void>(ctx, `set.delete:${set.id}`,
    (service, requestId, input) => service.workouts.deleteSet({requestId, ...input}), () => {setConfirming(false); leave();});
  const live = ctx.snapshot.phase === 'ready' || ctx.snapshot.phase === 'background';
  const closed = live ? null : 'The local service is closed.';
  const busy = save.busy || remove.busy;

  const change = (patch: Partial<SetDraft>) => {
    const next = {...draft, ...patch};
    setDraft(next);
    forms.drafts.set(draftKey, next);
    setProblems([]);
    save.clearFailure();
  };
  const submit = () => {
    const parsed = parseSetDraft(draft);
    if (!parsed.ok) {setProblems(parsed.problems); return;}
    const {reps, weightKg, rpe, loadConvention, implementCount} = parsed.value;
    const loadChanged = loadConvention !== set.loadConvention || implementCount !== set.implementCount;
    // Omitted fields stay unchanged. A load change supplies the convention and count together.
    const input: Omit<UpdateSetInput, 'requestId'> = {
      workoutId: workout.id, setId: set.id,
      ...(reps !== set.reps ? {reps} : {}),
      ...(weightKg !== set.weightKg ? {weightKg} : {}),
      ...(rpe !== set.rpe ? {rpe} : {}),
      ...(loadChanged ? {loadConvention: loadConvention as LoadConvention, implementCount} : {}),
    };
    if (Object.keys(input).length === 2) {leave(); return;}
    save.run(input);
  };
  const failure = describeError(save.failure);
  const problemFor = (field: string) => problems.find(problem => problem.field === field)?.message
    ?? (save.failure != null && failure.field === field ? `${failure.message} (${failure.code})` : undefined);
  const choice = {loadConvention: draft.loadConvention as LoadConvention, implementCount: draft.implementCount};
  const rpeText = set.rpe === null ? 'RPE not set' : `RPE ${set.rpe}`;
  return <View style={{gap: 14}}>
    <ScreenHeader palette={palette} title={`Edit set ${index}`} subtitle={exercise.name}
      back={{label: 'Workout', onPress: () => {forms.drafts.clear(draftKey); ctx.pop();}}}/>
    <View style={[shared.row, {flexWrap: 'wrap', alignItems: 'flex-start'}]}>
      <Field palette={palette} label="Reps" value={draft.reps} onChange={reps => change({reps})} problem={problemFor('reps')}
        keyboard="number-pad" editable={!busy} restored={restored} accessibilityLabel={`Reps for ${exercise.name}, set ${index}`}/>
      <Field palette={palette} label="RPE · optional" value={draft.rpe} onChange={rpe => change({rpe})} problem={problemFor('rpe')}
        keyboard="decimal-pad" editable={!busy} restored={restored} accessibilityLabel="RPE, optional, 1 to 10"/>
    </View>
    <Field palette={palette} label="Weight · kg" value={draft.weight} onChange={weight => change({weight})} problem={problemFor('weightKg')}
      keyboard="decimal-pad" editable={!busy} restored={restored} accessibilityLabel={`Weight in kilograms, load ${loadLabel(choice)}`}>
      <LoadTrigger palette={palette} choice={choice} disabled={busy} onPress={() => setPicking(true)}/>
    </Field>
    <Muted palette={palette}>{loadSentence(draft.weight.trim() || '—', choice)}</Muted>
    {problemFor('loadConvention') && <Text style={{color: palette.text}}>▲ {problemFor('loadConvention')}</Text>}
    {problemFor('implementCount') && <Text style={{color: palette.text}}>▲ {problemFor('implementCount')}</Text>}
    {save.failure != null && failure.field === null && <ErrorNotice palette={palette} error={save.failure}/>}
    {save.failure != null && failure.field !== null && <Text style={[shared.code, {color: palette.muted}]}>{failure.code}</Text>}
    {remove.failure != null && <ErrorNotice palette={palette} error={remove.failure}/>}
    {save.unconfirmed && <Muted palette={palette}>The last save is unconfirmed. Save again sends the same request.</Muted>}
    <Button palette={palette} primary label="Save" busyLabel={save.busy ? 'Saving…' : null} disabledReason={closed} onPress={submit}/>
    <Button palette={palette} label="Delete set" disabledReason={closed ?? (save.busy ? 'A save is running.' : null)} onPress={() => setConfirming(true)}/>
    <LoadPicker palette={palette} visible={picking} title={draft.weight.trim() ? `How is ${draft.weight.trim()} kg measured?` : 'How is the weight measured?'}
      initial={choice} onCancel={() => setPicking(false)} onDone={next => {setPicking(false); change(next);}}/>
    <ConfirmSheet palette={palette} visible={confirming} busy={remove.busy} title={`Delete set ${index}?`}
      body={`${setSummary(set)}, ${rpeText}. This cannot be undone.`} confirmLabel="Delete set" keepLabel="Keep set"
      onConfirm={() => remove.run({workoutId: workout.id, setId: set.id})} onKeep={() => setConfirming(false)}/>
  </View>;
}
