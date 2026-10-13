import React, {useState} from 'react';
import {Text, View} from 'react-native';
import type {Exercise, SplitDay, Workout} from '@forma/core';
import {Button, Card, ConfirmSheet, ErrorNotice, Muted, ScreenHeader} from '../ui/controls';
import {shared} from '../ui/theme';
import type {ScreenContext} from './context';
import {useCommand, useServiceRead} from './context';
import {finishSlot, useRemoveWorkout} from './workoutCommands';
import {SetRow, exerciseSections} from './Entry';
import {setCountText, splitName} from './Home';

interface SummaryData {
  readonly workout: Workout;
  readonly splitDays: readonly SplitDay[];
  readonly exercises: readonly Exercise[];
}

/** Design brief §6.5. Actions change with the saved workout state. */
export function Summary({ctx, workoutId}: {ctx: ScreenContext; workoutId: string}) {
  const {palette} = ctx;
  const {loaded, reload} = useServiceRead<SummaryData>(ctx.host, `summary:${workoutId}`, async service => {
    const [workout, splitDays, exercises] = await Promise.all([
      service.workouts.get(workoutId), service.splitDays.list(), service.exercises.list(),
    ]);
    return {workout, splitDays, exercises};
  });
  const workout = loaded.state === 'ready' ? loaded.value.workout : null;
  const [confirming, setConfirming] = useState(false);
  const finish = useCommand<{workoutId: string}, Workout>(ctx, finishSlot(workoutId),
    (service, requestId, input) => service.workouts.finish({requestId, ...input}), () => reload());
  const removal = useRemoveWorkout(ctx, workout, () => {setConfirming(false); ctx.reset([]);});
  const live = ctx.snapshot.phase === 'ready' || ctx.snapshot.phase === 'background';
  const closed = live ? null : 'The local service is closed.';
  const back = {label: 'Back', onPress: ctx.pop};

  if (loaded.state === 'loading') return <View style={{gap: 18}}><ScreenHeader palette={palette} title="Workout" back={back}/>
    <Muted palette={palette}>Loading workout…</Muted></View>;
  if (loaded.state === 'error') return <View style={{gap: 18}}><ScreenHeader palette={palette} title="Workout" back={back}/>
    <ErrorNotice palette={palette} error={loaded.error}/><Button palette={palette} label="Reload" onPress={reload}/></View>;

  const {splitDays, exercises} = loaded.value;
  const saved = loaded.value.workout;
  const names = new Map(exercises.map(exercise => [exercise.id, exercise.name]));
  const inProgress = saved.status === 'in-progress';
  const title = `${splitName(splitDays, saved.splitDayId)} · ${saved.date}`;
  return <View style={{gap: 14}}>
    <ScreenHeader palette={palette} title={title} back={back}/>
    <Text style={[shared.label, {color: inProgress ? palette.accent : palette.text}]}>{inProgress ? '● IN PROGRESS' : '✓ FINISHED'}</Text>
    <Card palette={palette} style={{gap: 6}}>
      <Text style={{color: palette.text}}>Duration: {saved.durationMin === null ? 'Not set' : `${saved.durationMin} min`}</Text>
      <Text style={{color: palette.text}}>Sets: {saved.sets.length}</Text>
      <Text style={{color: palette.text}}>Notes: {saved.notes === '' ? 'None' : saved.notes}</Text>
      <Button palette={palette} label="Edit details" disabledReason={closed} onPress={() => ctx.push({name: 'EditDetails', workoutId})}/>
    </Card>
    {exerciseSections(saved, splitDays).filter(section => section.sets.length > 0).map(section => <Card key={section.exerciseId} palette={palette} style={{gap: 4}}>
      <Text accessibilityRole="header" style={{color: palette.text, fontWeight: '600'}}>{names.get(section.exerciseId) ?? section.exerciseId}</Text>
      {section.sets.map((set, index) => <SetRow key={set.id} palette={palette} index={index + 1} set={set}
        onPress={live ? () => ctx.push({name: 'SetEdit', workoutId, setId: set.id}) : undefined}/>)}
    </Card>)}
    {finish.failure != null && <ErrorNotice palette={palette} error={finish.failure}/>}
    {removal.command.failure != null && <ErrorNotice palette={palette} error={removal.command.failure}/>}
    {inProgress && <>
      <Button palette={palette} primary label="Resume" disabledReason={closed} onPress={() => ctx.reset([{name: 'Entry', workoutId}])}/>
      <Button palette={palette} label="Finish workout" busyLabel={finish.busy ? 'Finishing…' : null} disabledReason={closed}
        onPress={() => finish.run({workoutId})}/>
    </>}
    <Button palette={palette} label={inProgress ? 'Discard workout' : 'Delete workout'} disabledReason={closed}
      onPress={() => setConfirming(true)}/>
    <ConfirmSheet palette={palette} visible={confirming} busy={removal.command.busy}
      title={inProgress ? 'Discard this workout?' : 'Delete this workout?'}
      body={inProgress
        ? `The in-progress ${splitName(splitDays, saved.splitDayId)} workout and its ${setCountText(saved.sets.length)} will be removed from this phone. This cannot be undone.`
        : `${splitName(splitDays, saved.splitDayId)} on ${saved.date} and its ${setCountText(saved.sets.length)} will be removed. Progress facts from it will disappear. This cannot be undone.`}
      confirmLabel={inProgress ? 'Discard workout' : 'Delete workout'} keepLabel="Keep workout"
      onConfirm={removal.run} onKeep={() => setConfirming(false)}/>
  </View>;
}
