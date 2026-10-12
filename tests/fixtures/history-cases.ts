import { FormaError } from '@forma/core';
import type { FormaService, WorkoutHistoryInput, WorkoutStatistics } from '@forma/core';

export interface HistoryCase {
  readonly name: string;
  readonly ids?: readonly string[];
  run(service: FormaService): Promise<void>;
}
function equal(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('The history fixture result does not match its expected value.');
}
function check(condition: unknown): asserts condition {
  if (!condition) throw new Error('The history fixture assertion failed.');
}
async function rejects(run: () => Promise<unknown>, code: FormaError['code'], field?: string): Promise<void> {
  try { await run(); }
  catch (error) {
    if (error instanceof FormaError && error.code === code && (field === undefined || error.field === field)) return;
    throw new Error('The history fixture received an unexpected error.');
  }
  throw new Error('The history fixture expected an error.');
}
async function records(service: FormaService) {
  const early = await service.workouts.create({ requestId: 'early', date: '2026-10-01' });
  const middle = await service.workouts.create({ requestId: 'middle', date: '2026-10-05' });
  const late = await service.workouts.create({ requestId: 'late', date: '2026-10-10' });
  const live = await service.workouts.start({ requestId: 'live', date: '2026-10-12' });
  const a = await service.workouts.addSet({ requestId: 'a', workoutId: early.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20, loadConvention: 'entered' });
  const b = await service.workouts.addSet({ requestId: 'b', workoutId: middle.id, exerciseId: 'leg-curls', reps: 10, weightKg: 20, loadConvention: 'entered' });
  const c = await service.workouts.addSet({ requestId: 'c', workoutId: late.id, exerciseId: 'leg-curls', reps: 6, weightKg: 25, loadConvention: 'entered' });
  await service.workouts.addSet({ requestId: 'other', workoutId: middle.id, exerciseId: 'leg-extensions', reps: 8, weightKg: 30, loadConvention: 'entered' });
  await service.workouts.addSet({ requestId: 'live-set', workoutId: live.id, exerciseId: 'leg-curls', reps: 10, weightKg: 100, loadConvention: 'entered' });
  return { early, middle, late, live, a, b, c };
}
const stats = { exerciseId: 'leg-curls', dateFrom: '2026-10-01', dateTo: '2026-10-12' };
function countSources(result: WorkoutStatistics): void {
  equal(result.workoutCount.unit, 'workouts'); equal(result.setCount.unit, 'sets');
  equal(result.workoutCount.sources.length, result.workoutCount.value);
  equal(result.setCount.sources.length, result.setCount.value);
  for (const source of [...result.workoutCount.sources, ...result.setCount.sources]) {
    equal(source.module, 'workouts'); equal(source.historyRevision, result.revision);
    check(source.workoutId.length > 0); check(source.date >= result.dateContext.dateFrom && source.date <= result.dateContext.dateTo);
    check(source.workoutUpdatedAt.endsWith('Z'));
  }
}

export const HISTORY_CASES: readonly HistoryCase[] = [
  { name: 'empty history and explicit no-data facts', async run(service) {
    const page = await service.workouts.history(); equal(page.items, []); equal(page.nextCursor, null);
    const previous = await service.workouts.previousSets({ exerciseId: 'leg-curls', beforeDate: '2026-10-12' });
    equal(previous.workout, null); equal(previous.sets, []);
    const result = await service.workouts.statistics(stats);
    equal(result.groups, []); equal(result.workoutCount.value, 0); equal(result.setCount.value, 0); countSources(result);
  } },
  { name: 'bounded pages, date and exercise filters, finished default', async run(service) {
    const r = await records(service);
    const first = await service.workouts.history({ limit: 1 }); equal(first.items.map((w) => w.id), [r.late.id]); check(first.nextCursor);
    const second = await service.workouts.history({ limit: 2, cursor: first.nextCursor });
    equal(second.items.map((w) => w.id), [r.middle.id, r.early.id]); equal(second.nextCursor, null);
    equal((await service.workouts.history({ status: 'in-progress' })).items.map((w) => w.id), [r.live.id]);
    equal((await service.workouts.history({ status: 'all' })).items.map((w) => w.id), [r.live.id, r.late.id, r.middle.id, r.early.id]);
    equal((await service.workouts.history({ dateFrom: '2026-10-05', dateTo: '2026-10-10' })).items.map((w) => w.id), [r.late.id, r.middle.id]);
    const filtered = await service.workouts.history({ exerciseId: 'leg-extensions' });
    equal(filtered.items.map((w) => w.id), [r.middle.id]); equal(filtered.items[0]?.sets.length, 2);
  } },
  { name: 'Unicode ID tie order has no duplicate or missing page records', ids: ['𐀀', '\ue000', 'a', 'A', 'é', 'z'], async run(service) {
    for (let index = 0; index < 6; index++) await service.workouts.create({ requestId: 'tie-' + index, date: '2026-10-12' });
    const ids: string[] = []; let cursor: string | undefined;
    do {
      const page = await service.workouts.history({ limit: 1, ...(cursor === undefined ? {} : { cursor }) });
      ids.push(...page.items.map((w) => w.id)); cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    equal(ids, ['A', 'a', 'z', 'é', '\ue000', '𐀀']);
  } },
  { name: 'previous sets exclude same-date and live workouts', async run(service) {
    const r = await records(service);
    const previous = await service.workouts.previousSets({ exerciseId: 'leg-curls', beforeDate: '2026-10-10' });
    equal(previous.workout?.id, r.middle.id); equal(previous.sets.map((s) => s.id), [r.b.id]);
    equal((await service.workouts.previousSets({ exerciseId: 'leg-curls', beforeDate: '0001-01-01' })).workout, null);
  } },
  { name: 'counts, volume, best load and best reps have exact sources and units', async run(service) {
    const r = await records(service); const result = await service.workouts.statistics(stats); countSources(result);
    equal(result.dateContext, { dateFrom: stats.dateFrom, dateTo: stats.dateTo, semantics: 'saved-workout-date' });
    equal(result.workoutCount.value, 3); equal(result.setCount.value, 3); equal(result.groups.length, 1);
    const group = result.groups[0]; check(group); equal(group.convention, 'entered');
    equal(group.volume.value, 510); equal(group.volume.unit, 'kg·rep');
    equal(group.volume.sources.map((s) => s.setId), [r.c.id, r.b.id, r.a.id]);
    equal(group.bestLoad.value, 25); equal(group.bestLoad.unit, 'kg'); equal(group.bestLoad.sources.map((s) => s.setId), [r.c.id]);
    equal(group.bestReps.map((fact) => [fact.loadKg, fact.value, fact.unit]), [[25, 6, 'reps'], [20, 10, 'reps']]);
    equal(group.bestReps[1]?.sources.map((s) => s.setId), [r.b.id]);
  } },
  { name: 'compatible per-hand conversion, separated totals and explicit exclusions', async run(service) {
    const workout = await service.workouts.create({ requestId: 'create', date: '2026-10-12' });
    const cases = [
      ['entered', null, 20, 8], ['combined', null, 40, 8], ['per-hand', 2, 20, 10],
      ['unknown', null, 1000, 10], ['body-weight', null, 10, 10],
    ] as const;
    for (const [index, [loadConvention, implementCount, weightKg, reps]] of cases.entries()) {
      await service.workouts.addSet({ requestId: 'set-' + index, workoutId: workout.id, exerciseId: 'leg-curls', reps, weightKg, loadConvention, implementCount });
    }
    const result = await service.workouts.statistics(stats); countSources(result);
    equal(result.setCount.value, 5); equal(result.groups.map((g) => [g.convention, g.volume.value]), [['combined', 720], ['entered', 160]]);
    equal(result.groups[0]?.bestLoad.value, 40); equal(result.groups[0]?.bestLoad.sources.length, 2);
    equal(result.groups[0]?.bestReps[0]?.value, 10);
    equal(result.excluded.map((x) => [x.reason, x.count.value, x.count.unit]), [['unknown', 1, 'sets'], ['body-weight', 1, 'sets']]);
    for (const exclusion of result.excluded) equal(exclusion.count.sources.length, exclusion.count.value);
  } },
  { name: 'tied personal-best sources and genuine zero loads are retained', async run(service) {
    const workout = await service.workouts.create({ requestId: 'create', date: '2026-10-12' });
    for (let index = 0; index < 2; index++) await service.workouts.addSet({ requestId: 'set-' + index,
      workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 0, loadConvention: 'entered' });
    const result = await service.workouts.statistics(stats); const group = result.groups[0]; check(group);
    equal(group.volume.value, 0); equal(group.bestLoad.value, 0); equal(group.bestLoad.sources.length, 2);
    equal(group.bestReps[0]?.value, 8); equal(group.bestReps[0]?.sources.length, 2);
  } },
  { name: 'unknown-only records have no invented zero-load best', async run(service) {
    const workout = await service.workouts.create({ requestId: 'create', date: '2026-10-12' });
    await service.workouts.addSet({ requestId: 'set', workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: 20 });
    const result = await service.workouts.statistics(stats); equal(result.groups, []); equal(result.excluded[0]?.count.value, 1);
  } },
  { name: 'set edits, convention confirmation and deletion update new facts', async run(service) {
    const r = await records(service);
    await service.workouts.updateSet({ requestId: 'edit', workoutId: r.late.id, setId: r.c.id, weightKg: 30 });
    equal((await service.workouts.statistics(stats)).groups[0]?.bestLoad.value, 30);
    await service.workouts.updateSet({ requestId: 'unknown', workoutId: r.late.id, setId: r.c.id, loadConvention: 'unknown' });
    equal((await service.workouts.statistics(stats)).groups[0]?.bestLoad.value, 20);
    await service.workouts.delete({ requestId: 'delete', workoutId: r.middle.id });
    const result = await service.workouts.statistics(stats); equal(result.workoutCount.value, 2);
    equal(result.groups[0]?.volume.value, 160); equal(result.excluded[0]?.count.value, 1);
    equal((await service.workouts.previousSets({ exerciseId: 'leg-curls', beforeDate: '2026-10-10' })).workout?.id, r.early.id);
  } },
  { name: 'date edits update history and selected-range statistics', async run(service) {
    const r = await records(service);
    await service.workouts.update({ requestId: 'date-edit', workoutId: r.late.id, date: '2026-09-30' });
    equal((await service.workouts.history()).items.map((w) => w.id), [r.middle.id, r.early.id, r.late.id]);
    equal((await service.workouts.statistics(stats)).setCount.value, 2);
  } },
  { name: 'record changes reject stale cursors while receipt replay does not', async run(service) {
    const r = await records(service); const page = await service.workouts.history({ limit: 1 }); check(page.nextCursor);
    await service.workouts.create({ requestId: 'late', date: '2026-10-10' });
    equal((await service.workouts.history({ cursor: page.nextCursor })).revision, page.revision);
    await service.workouts.resume(r.live.id);
    equal((await service.workouts.history({ cursor: page.nextCursor })).revision, page.revision);
    await rejects(() => service.workouts.update({ requestId: 'bad', workoutId: r.early.id, splitDayId: 'missing' }), 'NOT_FOUND', 'splitDayId');
    equal((await service.workouts.history({ cursor: page.nextCursor })).revision, page.revision);
    await service.workouts.update({ requestId: 'edit', workoutId: r.early.id, notes: 'Updated' });
    await rejects(() => service.workouts.history({ cursor: page.nextCursor! }), 'CONFLICT', 'cursor');
  } },
  { name: 'cursors are bound to normalized filters', async run(service) {
    await records(service); const page = await service.workouts.history({ exerciseId: 'leg-curls', limit: 1 }); check(page.nextCursor);
    await rejects(() => service.workouts.history({ cursor: page.nextCursor! }), 'INVALID_INPUT', 'cursor');
    await rejects(() => service.workouts.history({ cursor: page.nextCursor!, exerciseId: 'leg-curls', status: 'all' }), 'INVALID_INPUT', 'cursor');
    check((await service.workouts.history({ cursor: page.nextCursor, exerciseId: 'leg-curls', status: 'finished' })).items.length > 0);
  } },
  { name: 'overflow returns a typed error rather than a false total', async run(service) {
    const workout = await service.workouts.create({ requestId: 'create', date: '2026-10-12' });
    await service.workouts.addSet({ requestId: 'set', workoutId: workout.id, exerciseId: 'leg-curls', reps: 8, weightKg: Number.MAX_VALUE, loadConvention: 'entered' });
    await rejects(() => service.workouts.statistics(stats), 'INVALID_INPUT', 'volume');
  } },
  { name: 'all queries reject unknown exercises with typed errors', async run(service) {
    await rejects(() => service.workouts.history({ exerciseId: 'missing' }), 'NOT_FOUND', 'exerciseId');
    await rejects(() => service.workouts.previousSets({ exerciseId: 'missing', beforeDate: '2026-10-12' }), 'NOT_FOUND', 'exerciseId');
    await rejects(() => service.workouts.statistics({ ...stats, exerciseId: 'missing' }), 'NOT_FOUND', 'exerciseId');
  } },
  { name: 'queries validate dates, page limits and cursor syntax', async run(service) {
    for (const limit of [0, -1, 101, 1.5, NaN, Infinity]) await rejects(() => service.workouts.history({ limit }), 'INVALID_INPUT', 'limit');
    await rejects(() => service.workouts.history({ status: 'paused' } as unknown as WorkoutHistoryInput), 'INVALID_INPUT', 'status');
    await rejects(() => service.workouts.history({ dateFrom: '2026-10-12', dateTo: '2026-10-11' }), 'INVALID_INPUT', 'dateTo');
    await rejects(() => service.workouts.previousSets({ exerciseId: 'leg-curls', beforeDate: '2026-02-29' }), 'INVALID_INPUT', 'beforeDate');
    await rejects(() => service.workouts.statistics({ ...stats, dateTo: '2026-02-29' }), 'INVALID_INPUT', 'dateTo');
    for (const cursor of ['', 'not-a-cursor', 'forma-history-v1:%GG', 'forma-history-v1:%7B%7D']) {
      await rejects(() => service.workouts.history({ cursor }), 'INVALID_INPUT', 'cursor');
    }
  } },
  { name: 'queries reject operations after service close', async run(service) {
    await service.close();
    await rejects(() => service.workouts.history(), 'SERVICE_CLOSED');
    await rejects(() => service.workouts.previousSets({ exerciseId: 'leg-curls', beforeDate: '2026-10-12' }), 'SERVICE_CLOSED');
    await rejects(() => service.workouts.statistics(stats), 'SERVICE_CLOSED');
  } },
];
