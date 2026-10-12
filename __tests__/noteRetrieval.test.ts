import type { NoteRecord, QueryRecord } from '../src/corpus';
import { noteInput, queryInput } from '../src/embeddings';
import {
  cacheKey,
  NoteEmbeddingCache,
  retrievalBlockedReason,
  runNoteRetrieval,
  runRetrievalWithBusyFlag,
  type EmbeddingPort,
} from '../src/noteRetrieval';

function makeVector(seed: number): number[] {
  return Array.from({ length: 768 }, (_, index) => Math.sin(seed * (index + 1) * 0.01));
}

const notes: NoteRecord[] = [
  { id: 'A', text: 'alpha note' },
  { id: 'B', text: 'beta note' },
  { id: 'C', text: 'gamma note' },
];

const queries: QueryRecord[] = [
  { text: 'alpha query', expectedIds: ['A'] },
  { text: 'beta query', expectedIds: ['B'] },
];

const seeds: Record<string, number> = {
  [noteInput('alpha note')]: 0.1,
  [noteInput('beta note')]: 0.2,
  [noteInput('gamma note')]: 0.5,
  [queryInput('alpha query')]: 0.1,
  [queryInput('beta query')]: 0.2,
};

function createPort(counter?: { calls: number }): EmbeddingPort {
  return {
    async compute(input: string) {
      if (counter) {
        counter.calls += 1;
      }
      const seed = seeds[input];
      if (seed === undefined) {
        throw new Error(`Unknown input: ${input}`);
      }
      return makeVector(seed);
    },
  };
}

function baseOptions() {
  return {
    modelPath: '/data/models/test.litertlm',
    configuredBackend: 'CPU' as const,
    effectiveBackend: 'not reported',
    declaredDimension: 768,
    supportedTextBackends: ['CPU', 'GPU'],
    modelLoadMs: 1234,
    notes,
    queries,
  };
}

describe('runNoteRetrieval', () => {
  it('ranks the matching note first and reports coverage', async () => {
    const report = await runNoteRetrieval(createPort(), baseOptions());
    expect(report.results).toHaveLength(2);
    expect(report.results[0].top[0].id).toBe('A');
    expect(report.results[0].expectedCovered).toBe(true);
    expect(report.results[1].top[0].id).toBe('B');
    expect(report.results[1].expectedCovered).toBe(true);
    expect(report.modelLoadMs).toBe(1234);
    expect(report.configuredBackend).toBe('CPU');
  });

  it('reuses cached note vectors for the same cache key', async () => {
    const cache = new NoteEmbeddingCache();
    const counter = { calls: 0 };
    const port = createPort(counter);
    const options = { ...baseOptions(), cache, cacheKey: 'import-1|CPU' };

    await runNoteRetrieval(port, options);
    expect(counter.calls).toBe(5);

    await runNoteRetrieval(port, options);
    expect(counter.calls).toBe(7);
  });

  it('recomputes note vectors for a new cache key', async () => {
    const cache = new NoteEmbeddingCache();
    const counter = { calls: 0 };
    const port = createPort(counter);

    await runNoteRetrieval(port, { ...baseOptions(), cache, cacheKey: 'import-1|CPU' });
    await runNoteRetrieval(port, { ...baseOptions(), cache, cacheKey: 'import-2|CPU' });
    expect(counter.calls).toBe(10);
  });

  it('recomputes note vectors after cache.clear', async () => {
    const cache = new NoteEmbeddingCache();
    const counter = { calls: 0 };
    const port = createPort(counter);
    const options = { ...baseOptions(), cache, cacheKey: 'import-1|GPU' };

    await runNoteRetrieval(port, options);
    cache.clear();
    await runNoteRetrieval(port, options);
    expect(counter.calls).toBe(10);
  });

  it('rejects when the port fails', async () => {
    const options = {
      ...baseOptions(),
      notes: [{ id: 'X', text: 'unknown note' }],
    };
    await expect(runNoteRetrieval(createPort(), options)).rejects.toThrow('Unknown input');
  });
});

describe('cacheKey', () => {
  it('is stable for one import and one backend', () => {
    const identity = { importId: 'import-1', backend: 'CPU' as const };
    expect(cacheKey(identity)).toBe(cacheKey({ ...identity }));
  });

  it('changes when the imported model changes', () => {
    expect(cacheKey({ importId: 'import-1', backend: 'CPU' })).not.toBe(
      cacheKey({ importId: 'import-2', backend: 'CPU' }),
    );
  });

  it('changes when the backend changes', () => {
    expect(cacheKey({ importId: 'import-1', backend: 'CPU' })).not.toBe(
      cacheKey({ importId: 'import-1', backend: 'GPU' }),
    );
  });

  it('is not a constant and includes both inputs', () => {
    const key = cacheKey({ importId: 'import-9', backend: 'GPU' });
    expect(key).toContain('import-9');
    expect(key).toContain('GPU');
  });
});

describe('retrievalBlockedReason', () => {
  it('blocks when no model is loaded', () => {
    expect(retrievalBlockedReason(null, { importId: 'import-1', backend: 'CPU' })).toBe(
      'Load the model first.',
    );
  });

  it('allows a matching import and backend', () => {
    const identity = { importId: 'import-1', backend: 'CPU' as const };
    expect(retrievalBlockedReason(cacheKey(identity), identity)).toBeNull();
  });

  it('blocks after an import change', () => {
    const loaded = cacheKey({ importId: 'import-1', backend: 'CPU' });
    expect(retrievalBlockedReason(loaded, { importId: 'import-2', backend: 'CPU' })).toContain(
      'changed',
    );
  });

  it('blocks after a backend change', () => {
    const loaded = cacheKey({ importId: 'import-1', backend: 'CPU' });
    expect(retrievalBlockedReason(loaded, { importId: 'import-1', backend: 'GPU' })).toContain(
      'changed',
    );
  });
});

describe('runRetrievalWithBusyFlag', () => {
  it('holds busy true during the run and restores it after a success', async () => {
    const states: boolean[] = [];
    let busyDuringRun: boolean | null = null;
    const result = await runRetrievalWithBusyFlag(async () => {
      busyDuringRun = states[states.length - 1];
      return 'ok';
    }, (busy) => states.push(busy));
    expect(result).toBe('ok');
    expect(busyDuringRun).toBe(true);
    expect(states).toEqual([true, false]);
  });

  it('restores busy false after a failure', async () => {
    const states: boolean[] = [];
    await expect(
      runRetrievalWithBusyFlag(async () => {
        throw new Error('inference failed');
      }, (busy) => states.push(busy)),
    ).rejects.toThrow('inference failed');
    expect(states).toEqual([true, false]);
  });
});
