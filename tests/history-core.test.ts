import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFormaService, compareHistoryPositions } from '@forma/core';
import type { HistoryStoreQuery, Workout, WorkoutHistoryInput, WorkoutReader } from '@forma/core';
import { errorCode, MemoryWorkoutStore, TEST_TIME } from './helpers.js';

function workout(id = 'w', count = 1): Workout {
  return { id, date: '2026-10-12', splitDayId: null, notes: '', durationMin: null,
    status: 'finished', finishedAt: null, createdAt: TEST_TIME, updatedAt: TEST_TIME,
    sets: Array.from({ length: count }, (_, position) => ({ id: id + '-s-' + position,
      exerciseId: 'leg-curls', reps: 1, weightKg: 1, rpe: null, position,
      loadConvention: 'entered', implementCount: null })) };
}
class ProbeStore extends MemoryWorkoutStore {
  queries: HistoryStoreQuery[] = [];
  constructor(private readonly page: (input: HistoryStoreQuery) => readonly Workout[]) { super(); }
  override read<T>(run: (reader: WorkoutReader) => Promise<T>): Promise<T> {
    return super.read((reader) => run({ ...reader,
      listWorkouts: async () => { assert.fail('History must not call the unbounded list port.'); },
      listHistoryWorkouts: async (input) => {
        this.queries.push(input); const items = this.page(input);
        return { items, hasMore: items.length === input.limit };
      },
    }));
  }
}
const statistics = { exerciseId: 'leg-curls', dateFrom: '2026-10-01', dateTo: '2026-10-12' };
function serviceFor(store: MemoryWorkoutStore) {
  return createFormaService({ store,
    clock: { nowUtc: () => { assert.fail('History cannot use the clock.'); } },
    ids: { next: () => { assert.fail('History cannot create IDs.'); } } });
}

test('history and statistics use bounded storage queries without writes or the clock', async (t) => {
  const row = workout();
  const store = new ProbeStore(({ after }) => after === null ? [row] : []);
  const service = serviceFor(store); t.after(() => service.close());
  assert.equal((await service.workouts.history({ limit: 4 })).items.length, 1);
  assert.equal(store.queries[0]?.limit, 4);
  assert.equal((await service.workouts.statistics(statistics)).groups[0]?.volume.value, 1);
  assert.equal(store.queries[1]?.limit, 100);
  assert.equal(store.writes, 0);
});

test('statistics rejects more than 5000 matching workouts without a partial result', async (t) => {
  const store = new ProbeStore(({ after, limit }) => {
    const first = after === null ? 0 : Number(after.id.slice(2)) + 1;
    return Array.from({ length: Math.min(limit, 5001 - first) }, (_, index) => workout('w-' + String(first + index).padStart(5, '0')));
  });
  const service = serviceFor(store); t.after(() => service.close());
  await assert.rejects(service.workouts.statistics(statistics), errorCode('INVALID_INPUT', 'dateRange'));
  assert(store.queries.every((query) => query.limit === 100));
});

test('statistics accepts the 10000-set boundary and rejects the next set', async (t) => {
  let count = 10000;
  const store = new ProbeStore(() => [workout('w', count)]);
  const service = serviceFor(store); t.after(() => service.close());
  const result = await service.workouts.statistics(statistics);
  assert.equal(result.setCount.value, 10000); assert.equal(result.groups[0]?.volume.value, 10000);
  count++;
  await assert.rejects(service.workouts.statistics(statistics), errorCode('INVALID_INPUT', 'dateRange'));
});

test('a non-advancing history adapter fails instead of looping or returning duplicate totals', async (t) => {
  const rows = Array.from({ length: 100 }, (_, index) => workout('w-' + String(index).padStart(4, '0')));
  const store = new ProbeStore(() => rows);
  const service = serviceFor(store); t.after(() => service.close());
  await assert.rejects(service.workouts.statistics(statistics), errorCode('STORAGE_FAILURE'));
  assert.equal(store.queries.length, 2);
});

test('cursor syntax rejects missing metadata, oversized payloads and unsupported fields', async (t) => {
  const store = new MemoryWorkoutStore(); const service = serviceFor(store); t.after(() => service.close());
  const filter = { dateFrom: null, dateTo: null, exerciseId: null, status: 'finished' };
  const valid = { version: 1, revision: 0, filter, after: { id: 'w', date: '2026-10-12', createdAt: TEST_TIME } };
  for (const value of [null, [], { ...valid, version: 2 }, { ...valid, revision: -1 }, { ...valid, revision: 1.5 },
    { ...valid, revision: Number.MAX_SAFE_INTEGER + 1 }, { ...valid, filter: { ...filter, unexpected: true } },
    { ...valid, after: { ...valid.after, createdAt: 'invalid' } }, { ...valid, after: { ...valid.after, id: '' } },
    { ...valid, after: { ...valid.after, date: '2026-02-29' } }]) {
    const cursor = 'forma-history-v1:' + encodeURIComponent(JSON.stringify(value));
    await assert.rejects(service.workouts.history({ cursor }), errorCode('INVALID_INPUT', 'cursor'));
  }
  await assert.rejects(service.workouts.history({ cursor: 'forma-history-v1:' + 'x'.repeat(8193) }), errorCode('INVALID_INPUT', 'cursor'));
  await assert.rejects(service.workouts.history({ cursor: 'forma-history-v1:' + encodeURIComponent(JSON.stringify(valid)) }), errorCode('INVALID_INPUT', 'cursor'));
});

test('history captures normalized input before it is queued', async (t) => {
  const store = new ProbeStore(() => []);
  const service = serviceFor(store); t.after(() => service.close());
  const input: { dateFrom: string; status: 'finished' | 'all' } = { dateFrom: '2026-10-01', status: 'finished' };
  const pending = service.workouts.history(input);
  input.dateFrom = 'invalid'; input.status = 'all';
  await pending;
  assert.equal(store.queries[0]?.filter.dateFrom, '2026-10-01'); assert.equal(store.queries[0]?.filter.status, 'finished');
});

test('query inputs reject null and unsupported fields', async (t) => {
  const store = new MemoryWorkoutStore(); const service = serviceFor(store); t.after(() => service.close());
  await assert.rejects(service.workouts.history(null as unknown as WorkoutHistoryInput), errorCode('INVALID_INPUT', 'input'));
  await assert.rejects(service.workouts.history({ arbitrarySql: 'SELECT 1' } as WorkoutHistoryInput), errorCode('INVALID_INPUT', 'arbitrarySql'));
  await assert.rejects(service.workouts.statistics({ ...statistics, dateFrom: '2026-10-13' }), errorCode('INVALID_INPUT', 'dateTo'));
});

test('history order matches code points rather than locale or UTF-16 order', () => {
  const base = { date: '2026-10-12', createdAt: TEST_TIME };
  assert(compareHistoryPositions({ ...base, id: '\ue000' }, { ...base, id: '𐀀' }) < 0);
  assert(compareHistoryPositions({ ...base, id: 'A' }, { ...base, id: 'a' }) < 0);
  assert(compareHistoryPositions({ ...base, id: 'a' }, { ...base, id: 'aa' }) < 0);
  assert(compareHistoryPositions({ ...base, id: 'z', date: '2026-10-13' }, { ...base, id: 'a' }) < 0);
  assert(compareHistoryPositions({ ...base, id: 'z', createdAt: '2026-10-12T10:00:00.000Z' }, { ...base, id: 'a' }) < 0);
});
