import React, {useEffect, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import type {Exercise, SplitDay, Workout} from '@forma/core';
import {FormaError} from '@forma/core';
import {Button, Card, ErrorNotice, Muted, ScreenHeader} from '../ui/controls';
import {shared} from '../ui/theme';
import type {ScreenContext} from './context';
import {useServiceRead} from './context';

export const START_SLOT = 'workout.start';

/** Design brief §6.2: three split days in catalog order, with exercise counts. */
export function SplitPicker({ctx}: {ctx: ScreenContext}) {
  const {palette} = ctx;
  const {loaded, reload} = useServiceRead<readonly SplitDay[]>(ctx.host, 'split-days', service => service.splitDays.list());
  return <View style={{gap: 18}}>
    <ScreenHeader palette={palette} title="Choose a split day" back={{label: 'Home', onPress: ctx.pop}}
      subtitle={loaded.state === 'loading' ? 'Loading split days…' : 'A split day suggests exercises. You can still log others.'}/>
    {loaded.state === 'error' && <>
      <ErrorNotice palette={palette} error={loaded.error}/>
      <Button palette={palette} label="Reload split days" onPress={reload}/>
    </>}
    {loaded.state === 'ready' && loaded.value.map(day => {
      const count = `${day.exerciseIds.length} ${day.exerciseIds.length === 1 ? 'exercise' : 'exercises'}`;
      return <Pressable key={day.id} accessibilityRole="button" accessibilityLabel={`${day.name}, ${count}`}
        onPress={() => ctx.push({name: 'ExerciseOrder', splitDayId: day.id})}>
        <Card palette={palette} style={[shared.row, {minHeight: 88, justifyContent: 'space-between'}]}>
          <View><Text style={[shared.title, {color: palette.text}]}>{day.name}</Text><Muted palette={palette}>{count}</Muted></View>
          <Text style={{color: palette.accent, fontSize: 22}}>→</Text>
        </Card>
      </Pressable>;
    })}
  </View>;
}

interface OrderData {
  readonly splitDay: SplitDay;
  readonly exercises: readonly Exercise[];
  readonly inProgress: Workout | null;
}

/** The supplied order, read-only (decision C5). Start saves the one in-progress workout. */
export function ExerciseOrder({ctx, splitDayId}: {ctx: ScreenContext; splitDayId: string}) {
  const {palette, snapshot, forms} = ctx;
  const {loaded, reload} = useServiceRead<OrderData>(ctx.host, `order:${splitDayId}`, async service => {
    const [splitDay, exercises, inProgress] = await Promise.all([
      service.splitDays.get(splitDayId), service.exercises.list(), service.workouts.inProgress(),
    ]);
    return {splitDay, exercises, inProgress};
  });
  const [busy, setBusy] = useState(() => forms.commands.busy(START_SLOT));
  const [failure, setFailure] = useState<unknown>(null);
  const today = snapshot.calendar?.dateFrom ?? null;

  const attach = (attempt: Promise<Workout>) => {
    setBusy(true);
    setFailure(null);
    attempt.then(workout => ctx.reset([{name: 'Entry', workoutId: workout.id}]))
      .catch(error => {setFailure(error); setBusy(false); reload();});
  };
  const start = () => {
    if (today === null) return;
    attach(forms.commands.run(START_SLOT, {date: today, splitDayId},
      (requestId, input) => ctx.host.service().workouts.start({requestId, ...input})));
  };

  // A start sent before navigation still runs; attach to it instead of a second command.
  useEffect(() => {
    const running = forms.commands.current<Workout>(START_SLOT);
    if (running) attach(running);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const names = loaded.state === 'ready'
    ? new Map(loaded.value.exercises.map(exercise => [exercise.id, exercise.name])) : new Map<string, string>();
  const other = loaded.state === 'ready' ? loaded.value.inProgress : null;
  const conflict = failure instanceof FormaError && failure.code === 'CONFLICT' && failure.field === 'status';
  return <View style={{gap: 18}}>
    <ScreenHeader palette={palette} title={loaded.state === 'ready' ? loaded.value.splitDay.name : 'Exercise order'}
      back={{label: 'Split days', onPress: ctx.pop}} subtitle={`Workout date ${today ?? 'unknown'}. The supplied order for this split day.`}/>
    {loaded.state === 'loading' && <Muted palette={palette}>Loading exercises…</Muted>}
    {loaded.state === 'error' && <><ErrorNotice palette={palette} error={loaded.error}/>
      <Button palette={palette} label="Reload" onPress={reload}/></>}
    {loaded.state === 'ready' && <Card palette={palette} style={{gap: 0, paddingVertical: 6}}>
      {loaded.value.splitDay.exerciseIds.map((id, index) => <View key={id} accessible
        accessibilityLabel={`${index + 1}. ${names.get(id) ?? id}`} style={[shared.row, {minHeight: 48}]}>
        <Text style={[shared.code, {color: palette.muted, width: 24}]}>{index + 1}</Text>
        <Text style={{color: palette.text, flexShrink: 1}}>{names.get(id) ?? id}</Text>
      </View>)}
    </Card>}
    {failure != null && <ErrorNotice palette={palette} error={failure}/>}
    {other && <Card palette={palette}>
      <Text style={{color: palette.text}}>A workout is already in progress ({other.date}). Only one can be in progress.</Text>
      <Button palette={palette} label="Resume that workout" onPress={() => ctx.reset([{name: 'Entry', workoutId: other.id}])}/>
    </Card>}
    {loaded.state === 'ready' && <Button palette={palette} primary label="Start workout" busyLabel={busy ? 'Starting workout…' : null}
      disabledReason={today === null ? 'The device date is not known.' : other || conflict ? 'A workout is already in progress.' : null}
      onPress={start}/>}
  </View>;
}
