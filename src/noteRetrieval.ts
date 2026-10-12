// Note-retrieval orchestration. The code is pure TypeScript. The caller
// injects the embedding port, so unit tests use a fake port.
import { NOTES, QUERIES, topThree, type NoteRecord, type QueryRecord } from './corpus';
import {
  expectedIdsCovered,
  makeUnitVector,
  noteInput,
  queryInput,
  rankNotes,
  TARGET_DIMENSION,
  type NoteVector,
} from './embeddings';
import type { BackendName, NoteRetrievalReport, QueryResult } from './types';

/** One call to the native adapter. Input already has the task prefix. */
export interface EmbeddingPort {
  compute(input: string): Promise<number[]>;
}

export type RetrievalIdentity = {
  importId: string;
  backend: BackendName;
};

export function cacheKey(identity: RetrievalIdentity): string {
  return `${identity.importId}|${identity.backend}`;
}

/**
 * Return a short error message when the loaded model does not match the
 * requested identity. Return null when the model is ready. A new import and a
 * new backend both change the identity, so both block the run.
 */
export function retrievalBlockedReason(
  loadedKey: string | null,
  identity: RetrievalIdentity,
): string | null {
  if (loadedKey === null) {
    return 'Load the model first.';
  }
  if (loadedKey !== cacheKey(identity)) {
    return 'Load the model again. The imported model or the backend changed.';
  }
  return null;
}

/**
 * Run one retrieval and hold the busy flag for the whole run. The busy flag
 * disables the import, model, and backend controls. The finally block restores
 * the controls after a success and after a failure.
 */
export async function runRetrievalWithBusyFlag<T>(
  run: () => Promise<T>,
  setBusy: (busy: boolean) => void,
): Promise<T> {
  setBusy(true);
  try {
    return await run();
  } finally {
    setBusy(false);
  }
}

/**
 * Holds note vectors for one imported model and one backend. A new import or a
 * new backend produces a new key, so the cache misses. The UI also calls
 * clear() on a model or backend change.
 */
export class NoteEmbeddingCache {
  private key: string | null = null;
  private vectors: NoteVector[] = [];

  get(key: string): NoteVector[] | null {
    return this.key === key ? this.vectors : null;
  }

  set(key: string, vectors: NoteVector[]): void {
    this.key = key;
    this.vectors = vectors;
  }

  clear(): void {
    this.key = null;
    this.vectors = [];
  }
}

export type NoteRetrievalOptions = {
  modelPath: string;
  configuredBackend: BackendName;
  effectiveBackend: string;
  declaredDimension: number | null;
  supportedTextBackends: string[];
  modelLoadMs: number;
  dimension?: number;
  notes?: NoteRecord[];
  queries?: QueryRecord[];
  cache?: NoteEmbeddingCache;
  cacheKey?: string;
};

export async function runNoteRetrieval(
  port: EmbeddingPort,
  options: NoteRetrievalOptions,
): Promise<NoteRetrievalReport> {
  const dimension = options.dimension ?? TARGET_DIMENSION;
  const notes = options.notes ?? NOTES;
  const queries = options.queries ?? QUERIES;
  const cache = options.cache;
  const key = options.cacheKey;

  let noteVectors = cache && key ? cache.get(key) : null;
  let noteEmbeddingMs = 0;
  if (!noteVectors) {
    const startedAt = Date.now();
    noteVectors = [];
    for (const note of notes) {
      const raw = await port.compute(noteInput(note.text));
      noteVectors.push({
        id: note.id,
        text: note.text,
        vector: makeUnitVector(raw, dimension),
      });
    }
    noteEmbeddingMs = Date.now() - startedAt;
    if (cache && key) {
      cache.set(key, noteVectors);
    }
  }

  const results: QueryResult[] = [];
  for (const query of queries) {
    const queryStartedAt = Date.now();
    const rawQuery = await port.compute(queryInput(query.text));
    const queryVector = makeUnitVector(rawQuery, dimension);
    const queryEmbeddingMs = Date.now() - queryStartedAt;

    const rankStartedAt = Date.now();
    const top = topThree(rankNotes(queryVector, noteVectors));
    const rankMs = Date.now() - rankStartedAt;

    results.push({
      query: query.text,
      expectedIds: query.expectedIds,
      top,
      expectedCovered: expectedIdsCovered(top, query.expectedIds),
      queryEmbeddingMs,
      rankMs,
    });
  }

  return {
    modelPath: options.modelPath,
    configuredBackend: options.configuredBackend,
    effectiveBackend: options.effectiveBackend,
    declaredDimension: options.declaredDimension,
    supportedTextBackends: options.supportedTextBackends,
    modelLoadMs: options.modelLoadMs,
    noteEmbeddingMs,
    results,
  };
}
