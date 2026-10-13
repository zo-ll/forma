import React, {useState} from 'react';
import {Text, TextInput, View} from 'react-native';
import type {UpdateWorkoutInput, Workout} from '@forma/core';
import {parseOptionalDecimal} from '../forms/index';
import type {FieldProblem} from '../forms/index';
import {Button, ErrorNotice, Muted, ScreenHeader, describeError} from '../ui/controls';
import {shared} from '../ui/theme';
import type {ScreenContext} from './context';
import {useCommand, useServiceRead} from './context';

interface DetailsDraft {
  readonly date: string;
  readonly duration: string;
  readonly notes: string;
}

function draftFrom(workout: Workout): DetailsDraft {
  return {date: workout.date, duration: workout.durationMin === null ? '' : String(workout.durationMin), notes: workout.notes};
}

/** Design brief §6.3 and §6.5: date, notes, and duration. Status is not editable metadata. */
export function EditDetails({ctx, workoutId}: {ctx: ScreenContext; workoutId: string}) {
  const {palette} = ctx;
  const {loaded, reload} = useServiceRead<Workout>(ctx.host, `details:${workoutId}`, service => service.workouts.get(workoutId));
  const back = {label: 'Cancel', onPress: ctx.pop};
  if (loaded.state === 'loading') return <View style={{gap: 18}}><ScreenHeader palette={palette} title="Workout details" back={back}/>
    <Muted palette={palette}>Loading workout…</Muted></View>;
  if (loaded.state === 'error') return <View style={{gap: 18}}><ScreenHeader palette={palette} title="Workout details" back={back}/>
    <ErrorNotice palette={palette} error={loaded.error}/><Button palette={palette} label="Reload" onPress={reload}/></View>;
  return <DetailsForm ctx={ctx} workout={loaded.value}/>;
}

function DetailsForm({ctx, workout}: {ctx: ScreenContext; workout: Workout}) {
  const {palette, forms} = ctx;
  const draftKey = `details:${workout.id}`;
  const stored = forms.drafts.get<DetailsDraft>(draftKey);
  const [draft, setDraft] = useState<DetailsDraft>(() => stored ?? draftFrom(workout));
  const [restored] = useState(stored !== null);
  const [problems, setProblems] = useState<readonly FieldProblem[]>([]);
  const update = useCommand<Omit<UpdateWorkoutInput, 'requestId'>, Workout>(ctx, `workout.update:${workout.id}`,
    (service, requestId, input) => service.workouts.update({requestId, ...input}),
    () => {forms.drafts.clear(draftKey); ctx.pop();});
  const change = (patch: Partial<DetailsDraft>) => {
    const next = {...draft, ...patch};
    setDraft(next);
    forms.drafts.set(draftKey, next);
    setProblems([]);
    update.clearFailure();
  };
  const save = () => {
    const duration = parseOptionalDecimal(draft.duration, 'durationMin', 'duration');
    if (!duration.ok) {setProblems(duration.problems); return;}
    // Send only changed fields. An empty duration clears it; an empty note clears the notes.
    const input: Omit<UpdateWorkoutInput, 'requestId'> = {
      workoutId: workout.id,
      ...(draft.date.trim() !== workout.date ? {date: draft.date.trim()} : {}),
      ...(duration.value !== workout.durationMin ? {durationMin: duration.value} : {}),
      ...(draft.notes !== workout.notes ? {notes: draft.notes} : {}),
    };
    if (Object.keys(input).length === 1) {forms.drafts.clear(draftKey); ctx.pop(); return;}
    update.run(input);
  };
  const failure = describeError(update.failure);
  const problemFor = (field: string) => problems.find(problem => problem.field === field)?.message
    ?? (update.failure != null && failure.field === field ? `${failure.message} (${failure.code})` : undefined);
  const field = (label: string, key: keyof DetailsDraft, coreField: string, options: {multiline?: boolean; keyboard?: 'default' | 'decimal-pad'}) => {
    const problem = problemFor(coreField);
    return <View style={{gap: 4}}>
      <Text style={[shared.label, {color: problem ? palette.text : palette.muted}]}>{label}{restored ? ' · restored' : ''}</Text>
      <TextInput accessibilityLabel={label} value={draft[key]} onChangeText={text => change({[key]: text})} editable={!update.busy}
        multiline={options.multiline} keyboardType={options.keyboard ?? 'default'} autoCapitalize="none" autoCorrect={false}
        placeholder={key === 'notes' ? 'Add a note' : key === 'duration' ? 'Not set' : 'YYYY-MM-DD'} placeholderTextColor={palette.muted}
        style={[shared.input, {color: palette.text, borderColor: problem ? palette.text : palette.muted, borderWidth: problem ? 2 : 1,
          borderStyle: restored ? 'dashed' : 'solid', minHeight: options.multiline ? 96 : 48, textAlignVertical: options.multiline ? 'top' : 'center'}]}/>
      {problem && <Text accessibilityLiveRegion="polite" style={{color: palette.text}}>▲ {problem}</Text>}
    </View>;
  };
  return <View style={{gap: 14}}>
    <ScreenHeader palette={palette} title="Workout details" back={{label: 'Cancel', onPress: () => {forms.drafts.clear(draftKey); ctx.pop();}}}/>
    {field('Date', 'date', 'date', {})}
    <Muted palette={palette}>The saved date does not change if the phone's timezone changes.</Muted>
    {field('Duration · optional · min', 'duration', 'durationMin', {keyboard: 'decimal-pad'})}
    {field('Notes', 'notes', 'notes', {multiline: true})}
    {update.failure != null && failure.field === null && <ErrorNotice palette={palette} error={update.failure}/>}
    {update.failure != null && failure.field !== null && <Text style={[shared.code, {color: palette.muted}]}>{failure.code}</Text>}
    {update.unconfirmed && <Muted palette={palette}>The last save is unconfirmed. Save details again sends the same request.</Muted>}
    <Button palette={palette} primary label="Save details" busyLabel={update.busy ? 'Saving details…' : null} onPress={save}/>
  </View>;
}
