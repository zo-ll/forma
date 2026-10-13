import React, {useState} from 'react';
import {Text, TextInput, View} from 'react-native';
import type {CalendarPeriod, Exercise, LoadStatisticsGroup, WorkoutSource, WorkoutStatistics} from '@forma/core';
import {resolveCalendarRange} from '@forma/core';
import {deviceAdapters} from '../adapters/device';
import {withTypedDates} from '../forms/index';
import type {DateDraft} from '../forms/index';
import {Button, Card, ErrorNotice, Muted, ScreenHeader} from '../ui/controls';
import {ExercisePicker} from '../ui/ExercisePicker';
import {shared} from '../ui/theme';
import type {Palette} from '../ui/theme';
import type {ScreenContext} from './context';
import {useServiceRead} from './context';

type RangeChoice = CalendarPeriod | 'custom';

interface ProgressFilters {
  readonly exerciseId: string | null;
  readonly range: RangeChoice;
  readonly dateFrom: string;
  readonly dateTo: string;
}

const FILTER_KEY = 'progress:filters';
// Typed custom dates that are not applied yet. The applied filters stay under FILTER_KEY.
const TYPED_KEY = 'progress:typedDates';
const RANGE_LABELS: Record<RangeChoice, string> = {today: 'Today', 'this-week': 'This week', 'last-week': 'Last week', custom: 'Custom dates'};
const GROUP_LABELS: Record<LoadStatisticsGroup['convention'], string> = {entered: 'Entered load', combined: 'Combined load'};
const EXCLUSION_LABELS = {unknown: 'Unknown load', 'body-weight': 'Body weight'} as const;

/** The core resolves relative ranges with the device timezone; the UI does no date arithmetic. */
function rangeFor(filters: ProgressFilters): {dateFrom: string; dateTo: string} | {error: unknown} {
  if (filters.range === 'custom') return {dateFrom: filters.dateFrom, dateTo: filters.dateTo};
  try {
    const range = resolveCalendarRange({nowUtc: deviceAdapters.platform.nowUtc(), timeZone: deviceAdapters.platform.timeZone(), period: filters.range});
    return {dateFrom: range.dateFrom, dateTo: range.dateTo};
  } catch (error) {
    return {error};
  }
}

/** One link per source workout. Set sources from the same workout open the same record. */
function Sources({ctx, sources}: {ctx: ScreenContext; sources: readonly WorkoutSource[]}) {
  const [open, setOpen] = useState(false);
  const workouts = [...new Map(sources.map(source => [source.workoutId, source])).values()];
  if (workouts.length === 0) return null;
  return <View style={{gap: 4}}>
    <Button palette={ctx.palette} label={open ? 'Hide sources' : `Show sources (${workouts.length} ${workouts.length === 1 ? 'workout' : 'workouts'})`}
      onPress={() => setOpen(!open)}/>
    {open && workouts.map(source => <Button key={source.workoutId} palette={ctx.palette} label={`Source: workout ${source.date} ›`}
      accessibilityLabel={`Source: workout on ${source.date}. Open`} onPress={() => ctx.push({name: 'Summary', workoutId: source.workoutId})}/>)}
  </View>;
}

function Fact({palette, label, value}: {palette: Palette; label: string; value: string}) {
  return <View style={[shared.row, {justifyContent: 'space-between', flexWrap: 'wrap'}]}>
    <Muted palette={palette}>{label}</Muted><Text style={{color: palette.text, fontWeight: '600', fontSize: 18}}>{value}</Text>
  </View>;
}

/** Design brief §6.7 and issue #11. Every value comes from `workouts.statistics`, unrounded. */
export function Progress({ctx}: {ctx: ScreenContext}) {
  const {palette, forms} = ctx;
  const [filters, setFilters] = useState<ProgressFilters>(() => forms.drafts.get<ProgressFilters>(FILTER_KEY)
    ?? {exerciseId: null, range: 'this-week', dateFrom: '', dateTo: ''});
  const [typed, setTyped] = useState<DateDraft>(() => forms.drafts.get<DateDraft>(TYPED_KEY) ?? {dateFrom: filters.dateFrom, dateTo: filters.dateTo});
  const [picking, setPicking] = useState(false);
  const apply = (next: ProgressFilters) => {
    const applied = withTypedDates(next, typed);
    setFilters(applied);
    setTyped({dateFrom: applied.dateFrom, dateTo: applied.dateTo});
    forms.drafts.set(FILTER_KEY, applied);
    forms.drafts.clear(TYPED_KEY);
  };
  const type = (key: keyof DateDraft, text: string) => {
    setTyped(current => {
      const next = {...current, [key]: text};
      forms.drafts.set(TYPED_KEY, next);
      return next;
    });
  };
  const catalog = useServiceRead<readonly Exercise[]>(ctx.host, 'exercises', service => service.exercises.list());
  const exercises = catalog.loaded.state === 'ready' ? catalog.loaded.value : [];
  const exerciseName = filters.exerciseId ? exercises.find(exercise => exercise.id === filters.exerciseId)?.name ?? filters.exerciseId : null;
  const range = rangeFor(filters);
  const queryKey = JSON.stringify({exerciseId: filters.exerciseId, range});
  const stats = useServiceRead<WorkoutStatistics | null>(ctx.host, queryKey, async service => {
    if (filters.exerciseId === null) return null;
    if ('error' in range) throw range.error;
    return service.workouts.statistics({exerciseId: filters.exerciseId, ...range});
  });

  return <View style={{gap: 14}}>
    <ScreenHeader palette={palette} title="Progress"/>
    <Button palette={palette} label={exerciseName ? `Exercise: ${exerciseName}` : 'Choose an exercise'}
      accessibilityLabel={`Exercise: ${exerciseName ?? 'none'}. Change`} onPress={() => setPicking(true)}/>
    <View accessibilityRole="radiogroup" style={[shared.row, {flexWrap: 'wrap'}]}>
      {(['today', 'this-week', 'last-week', 'custom'] as const).map(choice => <Button key={choice} palette={palette}
        label={RANGE_LABELS[choice]} selected={filters.range === choice} onPress={() => apply({...filters, range: choice})}/>)}
    </View>
    {filters.range === 'custom' && <View style={{gap: 8}}>
      <View style={[shared.row, {flexWrap: 'wrap'}]}>
        {(['dateFrom', 'dateTo'] as const).map(key => <TextInput key={key} accessibilityLabel={key === 'dateFrom' ? 'Progress start date' : 'Progress end date'}
          value={typed[key]} placeholder="YYYY-MM-DD" placeholderTextColor={palette.muted} autoCapitalize="none" autoCorrect={false} maxLength={32}
          onChangeText={text => type(key, text)}
          style={[shared.input, {flexGrow: 1, flexBasis: 140, color: palette.text, borderColor: palette.muted}]}/>)}
      </View>
      <Button palette={palette} label="Apply dates" onPress={() => apply(filters)}/>
    </View>}
    {!('error' in range) && <Muted palette={palette}>{range.dateFrom || '—'} to {range.dateTo || '—'} · saved workout dates · finished workouts only</Muted>}
    {filters.exerciseId === null && <Muted palette={palette}>Choose an exercise to see facts from its saved sets.</Muted>}
    {stats.loaded.state === 'loading' && filters.exerciseId !== null && <Muted palette={palette}>Calculating from saved sets…</Muted>}
    {stats.loaded.state === 'error' && <><ErrorNotice palette={palette} error={stats.loaded.error}/>
      <Button palette={palette} label="Try again" onPress={stats.reload}/></>}
    {stats.loaded.state === 'ready' && stats.loaded.value !== null && <StatisticsView ctx={ctx} stats={stats.loaded.value} exerciseName={exerciseName ?? ''}/>}
    <ExercisePicker palette={palette} visible={picking} exercises={exercises} selectedId={filters.exerciseId}
      onClose={() => setPicking(false)} onPick={exerciseId => {setPicking(false); apply({...filters, exerciseId});}}/>
  </View>;
}

function StatisticsView({ctx, stats, exerciseName}: {ctx: ScreenContext; stats: WorkoutStatistics; exerciseName: string}) {
  const {palette} = ctx;
  if (stats.setCount.value === 0) return <Card palette={palette}>
    <Text style={{color: palette.text, fontWeight: '600'}}>No sets in this range</Text>
    <Muted palette={palette}>{exerciseName} has no saved sets in finished workouts from {stats.dateContext.dateFrom} to {stats.dateContext.dateTo}.</Muted>
  </Card>;
  return <View style={{gap: 12}}>
    <Card palette={palette} style={{gap: 6}}>
      <Fact palette={palette} label="Workouts" value={`${stats.workoutCount.value} ${stats.workoutCount.unit}`}/>
      <Sources ctx={ctx} sources={stats.workoutCount.sources}/>
      <Fact palette={palette} label="Sets" value={`${stats.setCount.value} ${stats.setCount.unit}`}/>
      <Sources ctx={ctx} sources={stats.setCount.sources}/>
    </Card>
    {stats.groups.map(group => <Card key={group.convention} palette={palette} style={{gap: 6}}>
      <Text accessibilityRole="header" style={[shared.label, {color: palette.accent}]}>{GROUP_LABELS[group.convention].toUpperCase()}</Text>
      <Fact palette={palette} label="Supported volume" value={`${group.volume.value} ${group.volume.unit}`}/>
      <Sources ctx={ctx} sources={group.volume.sources}/>
      <Fact palette={palette} label="Best load in range" value={`${group.bestLoad.value} ${group.bestLoad.unit}`}/>
      <Sources ctx={ctx} sources={group.bestLoad.sources}/>
      <Text style={[shared.label, {color: palette.muted}]}>BEST REPS AT EACH LOAD</Text>
      {group.bestReps.map(best => <View key={best.loadKg} style={{gap: 4}}>
        <Fact palette={palette} label={`${best.loadKg} kg`} value={`${best.value} ${best.unit}`}/>
        <Sources ctx={ctx} sources={best.sources}/>
      </View>)}
    </Card>)}
    {stats.groups.length === 0 && <Muted palette={palette}>No comparable load in this range. No best load is shown.</Muted>}
    {stats.excluded.filter(item => item.count.value > 0).map(item => <Card key={item.reason} palette={palette} style={{gap: 6}}>
      <Text style={{color: palette.text, fontWeight: '600'}}>Excluded: {EXCLUSION_LABELS[item.reason]}</Text>
      <Muted palette={palette}>{item.count.value} {item.count.unit}. {item.reason === 'unknown'
        ? 'The load convention is unknown, so these sets are not compared.'
        : 'Body-weight sets store added load only, so they are not compared.'}</Muted>
      <Sources ctx={ctx} sources={item.count.sources}/>
    </Card>)}
  </View>;
}
