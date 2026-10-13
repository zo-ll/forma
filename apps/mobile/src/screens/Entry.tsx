import React from 'react';
import {Text, View} from 'react-native';
import type {Exercise, SplitDay, Workout, WorkoutSet} from '@forma/core';
import {Button, Card, ErrorNotice, Muted, ScreenHeader} from '../ui/controls';
import {shared} from '../ui/theme';
import type {ScreenContext} from './context';
import {useServiceRead} from './context';
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
 * The split day order first, then any other exercise that has saved sets in
 * this workout. A split day suggests exercises; it does not restrict them.
 */
export function exerciseSections(workout: Workout, splitDays: readonly SplitDay[]): readonly ExerciseSection[] {
  const suggested = splitDays.find(day => day.id === workout.splitDayId)?.exerciseIds ?? [];
  const order = [...suggested];
  for (const set of workout.sets) if (!order.includes(set.exerciseId)) order.push(set.exerciseId);
  return order.map(exerciseId => ({exerciseId, sets: workout.sets.filter(set => set.exerciseId === exerciseId)}));
}

/** Design brief §6.3. Resume is a read; it never writes. */
export function Entry({ctx, workoutId}: {ctx: ScreenContext; workoutId: string}) {
  const {palette} = ctx;
  const {loaded, reload} = useServiceRead<EntryData>(ctx.host, `entry:${workoutId}`, async service => {
    const [workout, splitDays, exercises] = await Promise.all([
      service.workouts.resume(workoutId), service.splitDays.list(), service.exercises.list(),
    ]);
    return {workout, splitDays, exercises};
  });
  const back = {label: 'Home', onPress: () => ctx.reset([])};
  if (loaded.state === 'loading') return <View style={{gap: 18}}><ScreenHeader palette={palette} title="Workout" back={back}/>
    <Muted palette={palette}>Loading workout…</Muted></View>;
  if (loaded.state === 'error') return <View style={{gap: 18}}><ScreenHeader palette={palette} title="Workout" back={back}/>
    <ErrorNotice palette={palette} error={loaded.error}/><Button palette={palette} label="Reload workout" onPress={reload}/></View>;

  const {workout, splitDays, exercises} = loaded.value;
  const names = new Map(exercises.map(exercise => [exercise.id, exercise.name]));
  return <View style={{gap: 18}}>
    <ScreenHeader palette={palette} title={splitName(splitDays, workout.splitDayId)} back={back}
      subtitle={`${workout.date} · ${setCountText(workout.sets.length)} saved`}/>
    {exerciseSections(workout, splitDays).map((section, index) => <Card key={section.exerciseId} palette={palette} style={{gap: 6}}>
      <View style={[shared.row, {justifyContent: 'space-between'}]}>
        <Text accessibilityRole="header" style={{color: palette.text, fontWeight: '600', flexShrink: 1}}>
          {index + 1}  {names.get(section.exerciseId) ?? section.exerciseId}</Text>
        <Muted palette={palette}>{section.sets.length ? setCountText(section.sets.length) : 'no sets'}</Muted>
      </View>
    </Card>)}
  </View>;
}
