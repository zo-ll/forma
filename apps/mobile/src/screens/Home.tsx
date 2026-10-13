import React from 'react';
import {Text, View} from 'react-native';
import type {SplitDay, Workout} from '@forma/core';
import {Button, Card, ErrorNotice, Muted} from '../ui/controls';
import {shared} from '../ui/theme';
import type {ScreenContext} from './context';
import {useServiceRead} from './context';

interface HomeData {
  readonly inProgress: Workout | null;
  readonly recent: readonly Workout[];
  readonly splitDays: readonly SplitDay[];
}

export function splitName(splitDays: readonly SplitDay[], splitDayId: string | null): string {
  if (splitDayId === null) return 'No split day';
  return splitDays.find(day => day.id === splitDayId)?.name ?? splitDayId;
}

export function setCountText(count: number): string {
  return count === 1 ? '1 set' : `${count} sets`;
}

/** Design brief §6.1: today, the in-progress workout or a start action, recent records. */
export function Home({ctx, refreshKey}: {ctx: ScreenContext; refreshKey: string}) {
  const {palette, snapshot} = ctx;
  const live = snapshot.phase === 'ready' || snapshot.phase === 'background';
  const {loaded, reload} = useServiceRead<HomeData>(ctx.host, `${refreshKey}:${snapshot.phase}`, async service => {
    const [inProgress, page, splitDays] = await Promise.all([
      service.workouts.inProgress(), service.workouts.history({limit: 3}), service.splitDays.list(),
    ]);
    return {inProgress, recent: page.items, splitDays};
  });
  const today = <View style={{gap: 2}}>
    <Text style={[shared.brand, {color: palette.text}]}>Forma</Text>
    <Muted palette={palette}>{snapshot.calendar ? `${snapshot.calendar.dateFrom} · ${snapshot.calendar.timeZone}` : 'Opening records…'}</Muted>
  </View>;

  if (snapshot.phase === 'idle' || snapshot.phase === 'starting') {
    return <View style={{gap: 18}}>{today}<Muted palette={palette}>Opening records…</Muted></View>;
  }
  if (snapshot.phase === 'closed' || snapshot.phase === 'closing') {
    return <View style={{gap: 18}}>{today}
      <Card palette={palette}>
        <Text style={[shared.label, {color: palette.text}]}>■ SERVICE CLOSED</Text>
        <Text style={{color: palette.text}}>The local service is closed. Your records are kept. Restart the app to keep working.</Text>
        <Text style={[shared.code, {color: palette.muted}]}>SERVICE_CLOSED</Text>
      </Card>
      <Button palette={palette} primary label="Start workout" onPress={() => undefined} disabledReason="The local service is closed."/>
    </View>;
  }
  if (snapshot.phase === 'failed') {
    return <View style={{gap: 18}}>{today}
      <ErrorNotice palette={palette} error={snapshot.error} title="SERVICE FAILED"/>
      <Muted palette={palette}>Nothing was changed. Restart the app to try again.</Muted>
    </View>;
  }
  if (loaded.state === 'loading') return <View style={{gap: 18}}>{today}<Muted palette={palette}>Loading workouts…</Muted></View>;
  if (loaded.state === 'error') {
    return <View style={{gap: 18}}>{today}
      <ErrorNotice palette={palette} error={loaded.error}/>
      <Button palette={palette} label="Try again" onPress={reload}/>
    </View>;
  }
  const {inProgress, recent, splitDays} = loaded.value;
  return <View style={{gap: 18}}>
    {today}
    {inProgress
      ? <Card palette={palette}>
        <Text style={[shared.label, {color: palette.accent}]}>● IN PROGRESS</Text>
        <Text style={[shared.title, {color: palette.text}]}>{splitName(splitDays, inProgress.splitDayId)}</Text>
        <Muted palette={palette}>{inProgress.date} · {setCountText(inProgress.sets.length)} saved</Muted>
        <Button palette={palette} primary label="Resume workout"
          accessibilityLabel={`Resume ${splitName(splitDays, inProgress.splitDayId)} workout, ${setCountText(inProgress.sets.length)} saved`}
          disabledReason={live ? null : 'The local service is not ready.'}
          onPress={() => ctx.push({name: 'Entry', workoutId: inProgress.id})}/>
      </Card>
      : <Card palette={palette}>
        <Text style={{color: palette.text}}>{recent.length ? 'No workout in progress.' : 'No workouts yet'}</Text>
        {!recent.length && <Muted palette={palette}>Records stay on this phone. Start your first workout to see it here.</Muted>}
        <Button palette={palette} primary label="Start workout" disabledReason={live ? null : 'The local service is not ready.'}
          onPress={() => ctx.push({name: 'SplitPicker'})}/>
      </Card>}
    {recent.length > 0 && <View style={{gap: 8}}>
      <Text accessibilityRole="header" style={[shared.label, {color: palette.muted}]}>Recent workouts</Text>
      {recent.map(workout => <View key={workout.id} accessible
        accessibilityLabel={`${splitName(splitDays, workout.splitDayId)}, ${workout.date}, ${setCountText(workout.sets.length)}`}>
        <Card palette={palette} style={[shared.row, {justifyContent: 'space-between', paddingVertical: 14}]}>
          <View><Text style={{color: palette.text, fontWeight: '600'}}>{splitName(splitDays, workout.splitDayId)}</Text>
            <Muted palette={palette}>{workout.date}</Muted></View>
          <Muted palette={palette}>{setCountText(workout.sets.length)}</Muted>
        </Card>
      </View>)}
    </View>}
  </View>;
}
