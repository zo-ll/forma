import React, {useState} from 'react';
import {Pressable, Text, TextInput, View} from 'react-native';
import type {Exercise, SplitDay, WorkoutHistoryInput, WorkoutHistoryPage, WorkoutStatus} from '@forma/core';
import {FormaError} from '@forma/core';
import {Button, Card, ErrorNotice, Muted, ScreenHeader} from '../ui/controls';
import {ExercisePicker} from '../ui/ExercisePicker';
import {shared} from '../ui/theme';
import type {ScreenContext} from './context';
import {useServiceRead} from './context';
import {setCountText, splitName} from './Home';

type StatusFilter = WorkoutStatus | 'all';

interface HistoryFilters {
  readonly status: StatusFilter;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly exerciseId: string | null;
}

const EMPTY_FILTERS: HistoryFilters = {status: 'finished', dateFrom: '', dateTo: '', exerciseId: null};
const STATUS_LABELS: Record<StatusFilter, string> = {finished: 'Finished', 'in-progress': 'In progress', all: 'All'};
const FILTER_KEY = 'history:filters';
const PAGE_SIZE = 20;

export function isStaleCursor(error: unknown): boolean {
  return error instanceof FormaError && error.code === 'CONFLICT' && error.field === 'cursor';
}

/** Design brief §6.6 and issue #11. Pages come from the bounded history API only. */
export function History({ctx}: {ctx: ScreenContext}) {
  const {palette, forms} = ctx;
  const [filters, setFilters] = useState<HistoryFilters>(() => forms.drafts.get<HistoryFilters>(FILTER_KEY) ?? EMPTY_FILTERS);
  const [typed, setTyped] = useState({dateFrom: filters.dateFrom, dateTo: filters.dateTo});
  // Cursors of the pages already seen. Index 0 is the newest page.
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  const [picking, setPicking] = useState(false);
  const page = cursors.length - 1;
  const query: WorkoutHistoryInput = {
    status: filters.status, limit: PAGE_SIZE,
    ...(filters.dateFrom ? {dateFrom: filters.dateFrom} : {}),
    ...(filters.dateTo ? {dateTo: filters.dateTo} : {}),
    ...(filters.exerciseId ? {exerciseId: filters.exerciseId} : {}),
    ...(cursors[page] ? {cursor: cursors[page]} : {}),
  };
  const catalog = useServiceRead<{splitDays: readonly SplitDay[]; exercises: readonly Exercise[]}>(ctx.host, 'catalog',
    async service => ({splitDays: await service.splitDays.list(), exercises: await service.exercises.list()}));
  const {loaded, reload} = useServiceRead<WorkoutHistoryPage>(ctx.host, JSON.stringify(query), service => service.workouts.history(query));
  const apply = (next: HistoryFilters) => {
    setFilters(next);
    forms.drafts.set(FILTER_KEY, next);
    setCursors([undefined]);
  };
  const restart = () => setCursors([undefined]);
  const splitDays = catalog.loaded.state === 'ready' ? catalog.loaded.value.splitDays : [];
  const exercises = catalog.loaded.state === 'ready' ? catalog.loaded.value.exercises : [];
  const names = new Map(exercises.map(exercise => [exercise.id, exercise.name]));
  const exerciseLabel = filters.exerciseId ? names.get(filters.exerciseId) ?? filters.exerciseId : 'Any exercise';
  const filtered = filters.status !== 'finished' || filters.dateFrom || filters.dateTo || filters.exerciseId;

  const dateInput = (key: 'dateFrom' | 'dateTo', label: string) => <View style={{gap: 4, flexGrow: 1, flexBasis: 140}}>
    <Text style={[shared.label, {color: palette.muted}]}>{label}</Text>
    <TextInput accessibilityLabel={key === 'dateFrom' ? 'History start date' : 'History end date'} value={typed[key]} placeholder="YYYY-MM-DD"
      placeholderTextColor={palette.muted} autoCapitalize="none" autoCorrect={false} maxLength={32}
      onChangeText={text => setTyped(current => ({...current, [key]: text}))}
      style={[shared.input, {color: palette.text, borderColor: palette.muted}]}/>
  </View>;

  return <View style={{gap: 14}}>
    <ScreenHeader palette={palette} title="History"/>
    <View accessibilityRole="radiogroup" style={[shared.row, {flexWrap: 'wrap'}]}>
      {(['finished', 'in-progress', 'all'] as const).map(status => <Button key={status} palette={palette}
        label={STATUS_LABELS[status]} accessibilityLabel={`Status: ${STATUS_LABELS[status]}`} selected={filters.status === status}
        onPress={() => apply({...filters, status})}/>)}
    </View>
    <View style={[shared.row, {flexWrap: 'wrap', alignItems: 'flex-end'}]}>
      {dateInput('dateFrom', 'From')}
      {dateInput('dateTo', 'To')}
    </View>
    <Button palette={palette} label="Load history" onPress={() => apply({...filters, dateFrom: typed.dateFrom.trim(), dateTo: typed.dateTo.trim()})}/>
    <Button palette={palette} label={`Exercise: ${exerciseLabel}`} accessibilityLabel={`Exercise filter: ${exerciseLabel}. Change`}
      onPress={() => setPicking(true)}/>
    {loaded.state === 'loading' && <Muted palette={palette}>Loading workouts…</Muted>}
    {loaded.state === 'error' && isStaleCursor(loaded.error) && <View style={{gap: 8}}>
      <ErrorNotice palette={palette} error={loaded.error} title="CONFLICT"/>
      <Text style={{color: palette.text}}>The list changed while you were paging. Start again from the newest workouts.</Text>
      <Button palette={palette} primary label="Restart from newest" onPress={restart}/>
    </View>}
    {loaded.state === 'error' && !isStaleCursor(loaded.error) && <View style={{gap: 8}}>
      <ErrorNotice palette={palette} error={loaded.error}/>
      <Button palette={palette} label="Try again" onPress={reload}/>
    </View>}
    {loaded.state === 'ready' && loaded.value.items.length === 0 && <Card palette={palette}>
      <Text style={{color: palette.text, fontWeight: '600'}}>{filtered ? 'No workouts match' : 'No workouts yet'}</Text>
      <Muted palette={palette}>{filtered ? 'No saved workout matches these filters.' : 'Finished workouts appear here.'}</Muted>
      {filtered && <Button palette={palette} label="Clear filters" onPress={() => {setTyped({dateFrom: '', dateTo: ''}); apply(EMPTY_FILTERS);}}/>}
    </Card>}
    {loaded.state === 'ready' && loaded.value.items.map(workout => {
      const exerciseIds = [...new Set(workout.sets.map(set => set.exerciseId))];
      const listed = exerciseIds.slice(0, 2).map(id => names.get(id) ?? id).join(', ');
      const summary = exerciseIds.length > 2 ? `${listed}, and more` : listed || 'No sets';
      return <Pressable key={workout.id} accessibilityRole="button"
        accessibilityLabel={`${splitName(splitDays, workout.splitDayId)}, ${workout.date}, ${setCountText(workout.sets.length)}, ${workout.status === 'in-progress' ? 'in progress' : 'finished'}. Open`}
        onPress={() => ctx.push({name: 'Summary', workoutId: workout.id})}>
        <Card palette={palette} style={{gap: 2}}>
          <View style={[shared.row, {justifyContent: 'space-between'}]}>
            <Text style={{color: palette.text, fontWeight: '600'}}>{workout.status === 'in-progress' ? '● ' : ''}{splitName(splitDays, workout.splitDayId)}</Text>
            <Muted palette={palette}>{setCountText(workout.sets.length)}</Muted>
          </View>
          <Muted palette={palette}>{workout.date} · {summary}</Muted>
        </Card>
      </Pressable>;
    })}
    {loaded.state === 'ready' && (page > 0 || loaded.value.nextCursor) && <View style={shared.row}>
      <Button palette={palette} style={{flex: 1}} label="Newer" disabledReason={page === 0 ? 'This is the newest page.' : null}
        onPress={() => setCursors(current => current.slice(0, -1))}/>
      <Muted palette={palette}>Page {page + 1}</Muted>
      <Button palette={palette} style={{flex: 1}} label="Older" disabledReason={loaded.value.nextCursor ? null : 'No older workouts.'}
        onPress={() => {const next = loaded.value.nextCursor; if (next) setCursors(current => [...current, next]);}}/>
    </View>}
    <ExercisePicker palette={palette} visible={picking} exercises={exercises} selectedId={filters.exerciseId} anyLabel="Any exercise"
      onClose={() => setPicking(false)} onPick={exerciseId => {setPicking(false); apply({...filters, exerciseId});}}/>
  </View>;
}
