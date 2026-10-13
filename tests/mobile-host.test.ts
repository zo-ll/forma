import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FormaError, createFormaService } from '@forma/core';
import type { WorkoutWriter } from '@forma/core';
import { DEFAULT_PREFERENCES, createMobileHost } from '@forma/mobile-host';
import type { MobilePlatform, PreferenceStorage } from '@forma/mobile-host';
import { MemoryWorkoutStore, TEST_TIME, errorCode } from './helpers.js';

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

class FakePlatform implements MobilePlatform {
  zone = 'Europe/Rome';
  instant = TEST_TIME;
  timeZone(): string { return this.zone; }
  nowUtc(): string { return this.instant; }
}

class FakeStorage implements PreferenceStorage {
  text: string | null = null;
  reads = 0;
  writes = 0;
  failRead: unknown;
  failWrite: unknown;
  read(): string | null {
    this.reads += 1;
    if (this.failRead !== undefined) throw this.failRead;
    return this.text;
  }
  write(serialized: string): void {
    this.writes += 1;
    if (this.failWrite !== undefined) throw this.failWrite;
    this.text = serialized;
  }
}

let idSequence = 0;

class GatedStore extends MemoryWorkoutStore {
  private gateValue: Promise<void> = Promise.resolve();
  setGate(gate: Promise<void>): void { this.gateValue = gate; }
  override write<T>(run: (writer: WorkoutWriter) => Promise<T>): Promise<T> {
    return super.write(async (writer) => {
      await this.gateValue;
      return run(writer);
    });
  }
}

class GatedCloseStore extends MemoryWorkoutStore {
  private closing: Promise<void> = Promise.resolve();
  delayClose(gate: Promise<void>): void { this.closing = gate; }
  override async close(): Promise<void> {
    await this.closing;
    return super.close();
  }
}

class FailingCloseStore extends MemoryWorkoutStore {
  closeAttempts = 0;
  override close(): Promise<void> {
    this.closeAttempts += 1;
    return Promise.reject(new Error('native close failed'));
  }
}

interface HostOptions {
  readonly store?: MemoryWorkoutStore;
  readonly storage?: FakeStorage;
  readonly platform?: FakePlatform;
  readonly openService?: () => ReturnType<typeof createFormaService>;
}

function buildHost(options: HostOptions = {}) {
  const store = options.store ?? new MemoryWorkoutStore();
  const storage = options.storage ?? new FakeStorage();
  const platform = options.platform ?? new FakePlatform();
  let opens = 0;
  const openService = options.openService ?? (() => {
    opens += 1;
    return createFormaService({
      store,
      clock: { nowUtc: () => platform.nowUtc() },
      ids: { next: () => 'id-' + ++idSequence },
    });
  });
  const host = createMobileHost({ openService, preferences: storage, platform });
  return { host, store, storage, platform, opens: () => opens };
}

test('an idle host reports defaults, no calendar, and no service', () => {
  const { host } = buildHost();
  const snapshot = host.snapshot();
  assert.equal(snapshot.phase, 'idle');
  assert.deepEqual(snapshot.preferences, DEFAULT_PREFERENCES);
  assert.equal(snapshot.calendar, null);
  assert.equal(snapshot.error, null);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.preferences), true);
  assert.throws(() => host.service(), errorCode('SERVICE_CLOSED'));
});

test('the host rejects invalid dependencies before startup', () => {
  assert.throws(() => createMobileHost(null as never), errorCode('INVALID_INPUT', 'input'));
  assert.throws(() => createMobileHost({} as never), errorCode('INVALID_INPUT', 'openService'));
  assert.throws(() => createMobileHost({
    openService: () => ({} as never), preferences: {}, platform: {},
  } as never), errorCode('INVALID_INPUT', 'preferences'));
  assert.throws(() => createMobileHost({
    openService: () => ({} as never), preferences: { read: () => null, write: () => {} }, platform: {},
  } as never), errorCode('INVALID_INPUT', 'platform'));
});

test('a missing preference record publishes the defaults on start', async () => {
  const storage = new FakeStorage();
  const { host } = buildHost({ storage });
  await host.start();
  assert.deepEqual(host.snapshot().preferences, DEFAULT_PREFERENCES);
  assert.equal(storage.reads, 1);
  await host.close();
});

test('start opens exactly one service, reads records, and computes today', async () => {
  const { host, store, opens } = buildHost();
  await host.start();
  assert.equal(opens(), 1);
  assert.equal(host.snapshot().phase, 'ready');
  assert.deepEqual(host.snapshot().calendar, {
    dateFrom: '2026-10-12', dateTo: '2026-10-12', timeZone: 'Europe/Rome',
    weekStartsOn: 'monday', period: 'today',
  });
  assert.equal((await host.service().exercises.list()).length, 19);
  const workout = await host.service().workouts.create({ requestId: 'r1', date: '2026-10-12' });
  assert.equal(workout.date, '2026-10-12');
  assert.equal(store.writes, 1);
  await host.start();
  assert.equal(opens(), 1);
  await host.close();
});

test('concurrent starts open one service and share the ready state', async () => {
  const { host, opens } = buildHost();
  await Promise.all([host.start(), host.start(), host.start()]);
  assert.equal(opens(), 1);
  assert.equal(host.snapshot().phase, 'ready');
  await host.close();
});

test('a corrupt preference record closes the opened service and keeps its bytes', async () => {
  const storage = new FakeStorage();
  storage.text = '{"version":2,"dateContext":"device"}';
  const { host, store } = buildHost({ storage });
  await assert.rejects(host.start(), errorCode('STORAGE_FAILURE', 'preferences'));
  assert.equal(store.closeCalls, 1);
  assert.equal(host.snapshot().phase, 'failed');
  assert.equal(host.snapshot().error?.code, 'STORAGE_FAILURE');
  assert.throws(() => host.service(), errorCode('STORAGE_FAILURE', 'preferences'));
  assert.equal(storage.text, '{"version":2,"dateContext":"device"}');
});

test('a storage read failure becomes a typed storage error', async () => {
  const storage = new FakeStorage();
  storage.failRead = new Error('read broke');
  const { host, store } = buildHost({ storage });
  await assert.rejects(host.start(), errorCode('STORAGE_FAILURE'));
  assert.equal(store.closeCalls, 1);
  assert.equal(host.snapshot().phase, 'failed');
});

test('a service open failure reports STORAGE_FAILURE with the original cause', async () => {
  const cause = new Error('native open failed');
  const { host, store } = buildHost({ openService: () => { throw cause; } });
  await assert.rejects(host.start(), (error: unknown) => error instanceof FormaError
    && error.code === 'STORAGE_FAILURE' && error.cause === cause);
  assert.equal(store.closeCalls, 0);
  assert.equal(host.snapshot().phase, 'failed');
});

test('an invalid device timezone fails startup and releases the service', async () => {
  const platform = new FakePlatform();
  platform.zone = 'Not/AZone';
  const { host, store, opens } = buildHost({ platform });
  await assert.rejects(host.start(), errorCode('INVALID_INPUT', 'timeZone'));
  assert.equal(opens(), 1);
  assert.equal(store.closeCalls, 1);
  assert.throws(() => host.service(), errorCode('INVALID_INPUT', 'timeZone'));
});

test('background keeps the service open for later reads', async () => {
  const { host, store } = buildHost();
  await host.start();
  host.background();
  assert.equal(host.snapshot().phase, 'background');
  assert.equal((await host.service().workouts.list()).length, 0);
  assert.equal(store.closeCalls, 0);
  await host.close();
  assert.equal(store.closeCalls, 1);
});

test('resume recomputes today and never shifts a saved date', async () => {
  const platform = new FakePlatform();
  const { host } = buildHost({ platform });
  await host.start();
  const workout = await host.service().workouts.create({ requestId: 'r1', date: '2026-10-12' });
  host.background();
  platform.zone = 'America/New_York';
  platform.instant = '2026-10-12T00:30:00.000Z';
  await host.resume();
  assert.equal(host.snapshot().phase, 'ready');
  assert.equal(host.snapshot().calendar?.dateFrom, '2026-10-11');
  assert.equal((await host.service().workouts.get(workout.id)).date, '2026-10-12');
  await host.close();
});

test('a start queued during close cannot move the host back to ready', async () => {
  const gate = deferred();
  const store = new GatedCloseStore();
  store.delayClose(gate.promise);
  const { host } = buildHost({ store });
  await host.start();
  const closing = host.close();
  await tick();
  const starting = host.start();
  const resuming = host.resume();
  gate.resolve();
  await closing;
  await assert.rejects(starting, errorCode('SERVICE_CLOSED'));
  await assert.rejects(resuming, errorCode('SERVICE_CLOSED'));
  assert.equal(host.snapshot().phase, 'closed');
  assert.throws(() => host.service(), errorCode('SERVICE_CLOSED'));
});

test('close drains accepted service work before it resolves', async () => {
  const gate = deferred();
  const store = new GatedStore();
  store.setGate(gate.promise);
  const { host } = buildHost({ store });
  await host.start();
  const pending = host.service().workouts.create({ requestId: 'r1', date: '2026-10-12' });
  const closing = host.close();
  gate.resolve();
  const workout = await pending;
  await closing;
  assert.equal(workout.date, '2026-10-12');
  assert.equal(store.closeCalls, 1);
  assert.equal(host.snapshot().phase, 'closed');
});

test('operations after close reject and the host never reopens', async () => {
  const { host, store } = buildHost();
  await host.start();
  await host.close();
  assert.equal(store.closeCalls, 1);
  assert.equal(host.snapshot().phase, 'closed');
  assert.throws(() => host.service(), errorCode('SERVICE_CLOSED'));
  await assert.rejects(host.start(), errorCode('SERVICE_CLOSED'));
  await assert.rejects(host.resume(), errorCode('SERVICE_CLOSED'));
  await assert.rejects(host.setTheme('dark'), errorCode('SERVICE_CLOSED'));
  await host.close();
  assert.equal(store.closeCalls, 1);
});

test('a failed close stays failed, keeps its cause, and never reopens', async () => {
  const store = new FailingCloseStore();
  const { host } = buildHost({ store });
  await host.start();
  const first = await host.close().then(() => null, (error: unknown) => error);
  assert(first instanceof FormaError);
  assert.equal((first as FormaError).code, 'STORAGE_FAILURE');
  assert((first as FormaError).cause instanceof Error);
  assert.equal(host.snapshot().phase, 'failed');
  assert.equal(store.closeAttempts, 1);
  const second = await host.close().then(() => null, (error: unknown) => error);
  assert.equal(second, first);
  assert.throws(() => host.service(), errorCode('STORAGE_FAILURE'));
  await assert.rejects(host.start(), errorCode('STORAGE_FAILURE'));
});

test('setTheme persists before it publishes and rolls back on a write failure', async () => {
  const storage = new FakeStorage();
  const { host } = buildHost({ storage });
  await host.start();
  assert.equal(host.snapshot().preferences.theme, 'system');
  await host.setTheme('dark');
  assert.equal(host.snapshot().preferences.theme, 'dark');
  assert.equal(storage.writes, 1);
  assert.equal((JSON.parse(storage.text ?? '{}') as { theme?: unknown }).theme, 'dark');
  storage.failWrite = new Error('disk full');
  await assert.rejects(host.setTheme('light'), errorCode('STORAGE_FAILURE'));
  assert.equal(host.snapshot().preferences.theme, 'dark');
  assert.equal(host.snapshot().phase, 'ready');
  assert.equal(storage.writes, 2);
  await assert.rejects(host.setTheme('midnight' as never), errorCode('INVALID_INPUT', 'theme'));
  await host.close();
});

test('a throwing listener cannot break host control flow or the queue', async () => {
  const { host } = buildHost();
  let throws = 0;
  host.subscribe(() => { throws += 1; throw new Error('listener boom'); });
  const seen: string[] = [];
  host.subscribe(() => { seen.push(host.snapshot().phase); });
  await host.start();
  assert(throws > 0);
  assert(seen.includes('ready'));
  await host.setTheme('dark');
  assert.equal(host.snapshot().preferences.theme, 'dark');
  await host.close();
  assert.equal(host.snapshot().phase, 'closed');
});

test('unsubscribe stops listener calls and is idempotent', async () => {
  const { host } = buildHost();
  const seen: string[] = [];
  const unsubscribe = host.subscribe(() => { seen.push(host.snapshot().phase); });
  assert.throws(() => host.subscribe(null as never), errorCode('INVALID_INPUT', 'listener'));
  await host.start();
  assert(seen.includes('ready'));
  unsubscribe();
  unsubscribe();
  const count = seen.length;
  host.background();
  assert.equal(seen.length, count);
  await host.close();
});

test('snapshot JSON exposes plain data and no native handles', async () => {
  const { host } = buildHost();
  await host.start();
  const json = JSON.stringify(host.snapshot());
  const parsed = JSON.parse(json) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed).sort(), ['calendar', 'error', 'phase', 'preferences', 'recordsEpoch']);
  assert.deepEqual(Object.keys(parsed.preferences as object).sort(),
    ['dateContext', 'theme', 'version', 'weekStart', 'weightUnit']);
  assert.equal('service' in parsed, false);
  assert.equal(json.includes('openService'), false);
  await host.close();
});

test('the mobile host source imports no platform, Node, or React module', async () => {
  const source = resolve('packages/mobile-host/src');
  async function check(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await check(path);
      else if (entry.name.endsWith('.ts')) {
        const text = await readFile(path, 'utf8');
        for (const match of text.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/gu)) {
          const target = match[1] ?? '';
          assert(target.startsWith('.') || target === '@forma/core',
            'The mobile host imports a platform module: ' + target);
        }
      }
    }
  }
  await check(source);
});
