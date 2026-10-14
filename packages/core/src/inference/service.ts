import { FormaError } from '../errors.js';
import type { NoteSource } from '../notes/types.js';
import { noteId, noteRevision } from '../notes/validation.js';
import type { WorkoutStore } from '../ports.js';
import { objectInput } from '../validation.js';
import { cancellation } from './cancellation.js';
import type {
  EmbeddingProfile, EmbeddingResult, GenerationProfile, GenerationResult, InferenceApi,
  InferenceCancellationToken, InferenceCapabilities, InferenceRuntime,
} from './types.js';
import { INFERENCE_LIMITS } from './types.js';
import { boundedText, capabilities, copy, embeddingProfile, generationProfile, integer, same, vector } from './validation.js';

const owners = new WeakSet<InferenceRuntime>();
const missing = { state: 'missing', profile: null } as const;
const failed = { state: 'failed', profile: null, reason: 'adapter-failure' } as const;
const cancelled = (): FormaError => new FormaError('CANCELLED', 'The derived inference wait was cancelled.');
const stale = (): FormaError => new FormaError('CONFLICT', 'The inference source is no longer current.', { field: 'source' });
interface Job {
  readonly signal: ReturnType<typeof cancellation>;
  run(): Promise<unknown>;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  cleanup(): void;
  settled: boolean;
}

/** Internal composed owner. No store callback waits for inference. */
export function createInferenceModule(
  runtime: InferenceRuntime | undefined, store: WorkoutStore, ensureOpen: () => void,
): { api: InferenceApi; invalidate(): void; close(): Promise<void> } {
  if (runtime && owners.has(runtime)) throw new FormaError('CONFLICT', 'The inference runtime already has an owner.', { field: 'inference' });
  if (runtime) owners.add(runtime);
  let status: InferenceCapabilities = { embedding: missing, generation: missing };
  if (runtime) {
    try {
      status = capabilities(runtime.capabilities());
      if ((status.embedding.state === 'ready' && typeof runtime.embed !== 'function')
        || (status.generation.state === 'ready' && typeof runtime.generate !== 'function')
        || typeof runtime.close !== 'function') throw new Error('Malformed runtime.');
    } catch { status = { embedding: failed, generation: failed }; }
  }
  const queue: Job[] = [];
  let active: Job | undefined;
  let activeDone: Promise<void> = Promise.resolve();
  let closing = false;
  let epoch = 0;
  let closePromise: Promise<void> | undefined;

  function cancelJob(job: Job, error: FormaError): void {
    if (job.settled) return;
    job.settled = true;
    const index = queue.indexOf(job);
    if (index !== -1) queue.splice(index, 1);
    job.cleanup();
    job.signal.cancel();
    job.signal.dispose();
    job.reject(error);
  }
  function pump(): void {
    if (active || closing) return;
    const job = queue.shift();
    if (!job) return;
    active = job;
    activeDone = Promise.resolve().then(() => job.settled ? undefined : job.run()).then(
      value => { if (!job.settled) { job.settled = true; job.resolve(value); } },
      error => { if (!job.settled) { job.settled = true; job.reject(error); } },
    ).then(() => {
      job.cleanup();
      job.signal.dispose();
      active = undefined;
      pump();
    });
  }
  function submit<T>(run: (token: InferenceCancellationToken) => Promise<T>, token?: InferenceCancellationToken): Promise<T> {
    ensureOpen();
    if (closing) return Promise.reject(new FormaError('SERVICE_CLOSED', 'The inference module is closed.'));
    if (token?.cancelled) return Promise.reject(cancelled());
    if (active && queue.length >= INFERENCE_LIMITS.maxQueued) {
      return Promise.reject(new FormaError('CONFLICT', 'The inference queue is full.', { field: 'inference.queue' }));
    }
    return new Promise<T>((resolve, reject) => {
      const signal = cancellation();
      let unsubscribe = (): void => undefined;
      const job: Job = {
        signal, settled: false, run: () => run(signal.token),
        resolve: value => resolve(value as T), reject,
        cleanup: () => { try { unsubscribe(); } catch { /* Cleanup cannot revive or block a settled wait. */ } },
      };
      queue.push(job);
      try {
        unsubscribe = token?.subscribe(() => cancelJob(job, cancelled())) ?? unsubscribe;
        // A token can cancel synchronously while subscribing.
        if (job.settled) unsubscribe();
        else if (token?.cancelled) cancelJob(job, cancelled());
      } catch {
        cancelJob(job, new FormaError('INVALID_INPUT', 'Invalid cancellation token.', { field: 'token' }));
      }
      pump();
    });
  }
  function check(token: InferenceCancellationToken): void {
    if (token.cancelled) throw cancelled();
  }
  function ready<K extends 'embedding' | 'generation'>(kind: K): NonNullable<InferenceCapabilities[K]['profile']> {
    ensureOpen();
    const c = status[kind];
    if (c.state !== 'ready') throw new FormaError('INFERENCE_UNAVAILABLE', 'The inference capability is not ready.', { field: kind });
    return copy(c.profile);
  }
  async function adapter<T>(kind: 'embedding' | 'generation', token: InferenceCancellationToken, run: () => Promise<T>): Promise<T> {
    check(token);
    // Queued jobs cannot bypass an earlier adapter failure.
    ready(kind);
    try { return await run(); }
    catch {
      check(token);
      status = { ...status, [kind]: { state: 'failed', profile: status[kind].profile, reason: 'adapter-failure' } };
      throw new FormaError('INFERENCE_FAILURE', 'The inference adapter failed.', { field: kind });
    }
  }
  function source(value: NoteSource): NoteSource {
    objectInput(value, ['module', 'noteId', 'revision']);
    if (value.module !== 'notes') throw new FormaError('INVALID_INPUT', 'Unsupported inference source.', { field: 'source' });
    return { module: 'notes', noteId: noteId(value.noteId), revision: noteRevision(value.revision) };
  }
  async function readSource(s: NoteSource): Promise<string> {
    return store.read(async reader => {
      const note = await reader.getNote(s.noteId);
      if (!note || note.revision !== s.revision) throw stale();
      return boundedText(note.text, 'text', INFERENCE_LIMITS.maxTextCharacters);
    });
  }
  async function linked<T>(s: NoteSource, token: InferenceCancellationToken, run: (text: string) => Promise<T>): Promise<T> {
    const startEpoch = epoch;
    const text = await readSource(s);
    check(token);
    const result = await run(text);
    check(token);
    await readSource(s);
    check(token);
    if (startEpoch !== epoch) throw stale();
    return result;
  }
  async function embed(text: string, task: 'query' | 'document', profile: EmbeddingProfile,
    token: InferenceCancellationToken): Promise<EmbeddingResult> {
    const prefixed = boundedText((task === 'query' ? profile.queryPrefix : profile.documentPrefix) + text,
      'text', INFERENCE_LIMITS.maxTextCharacters);
    return adapter('embedding', token, async () => {
      const result = await runtime!.embed!({ text: prefixed, task, profile: copy(profile) }, token);
      check(token);
      objectInput(result, ['profile', 'task', 'vector']);
      if (!same(embeddingProfile(result.profile), profile) || result.task !== task) throw new Error('Mismatched embedding result.');
      return { profile: copy(profile), task, vector: vector(result.vector, profile), source: null };
    });
  }
  const api: InferenceApi = {
    capabilities() { ensureOpen(); return copy(status); },
    async embed(input, token) {
      const profile = ready('embedding') as EmbeddingProfile;
      objectInput(input, ['text', 'task']);
      const text = boundedText(input.text, 'text', INFERENCE_LIMITS.maxTextCharacters);
      const task = input.task;
      if (task !== 'query' && task !== 'document') throw new FormaError('INVALID_INPUT', 'Invalid embedding task.', { field: 'task' });
      // Validate prefix expansion before admission, not as an adapter failure.
      boundedText((task === 'query' ? profile.queryPrefix : profile.documentPrefix) + text, 'text', INFERENCE_LIMITS.maxTextCharacters);
      return submit(t => embed(text, task, profile, t), token);
    },
    async embedNote(input, token) {
      const profile = ready('embedding') as EmbeddingProfile;
      objectInput(input, ['source']);
      const s = source(input.source);
      return submit(t => linked(s, t, async text => ({ ...await embed(text, 'document', profile, t), source: copy(s) })), token);
    },
    async generateNote(input, token) {
      const profile = ready('generation') as GenerationProfile;
      objectInput(input, ['source', 'instruction', 'maxOutputCharacters']);
      const s = source(input.source);
      const instruction = boundedText(input.instruction, 'instruction', INFERENCE_LIMITS.maxInstructionCharacters);
      const maximum = integer(input.maxOutputCharacters, 'maxOutputCharacters', INFERENCE_LIMITS.maxOutputCharacters);
      return submit(t => linked(s, t, text => adapter('generation', t, async (): Promise<GenerationResult> => {
        const result = await runtime!.generate!({ text, instruction, maxOutputCharacters: maximum, profile: copy(profile) }, t);
        check(t);
        objectInput(result, ['profile', 'text']);
        if (!same(generationProfile(result.profile), profile)) throw new Error('Mismatched generation result.');
        return { profile: copy(profile), text: boundedText(result.text, 'output', maximum), source: copy(s) };
      })), token);
    },
  };
  function invalidate(): void {
    epoch++;
    if (active) cancelJob(active, cancelled());
    for (const job of [...queue]) cancelJob(job, cancelled());
  }
  return {
    api, invalidate,
    close() {
      if (!closePromise) {
        closing = true;
        let resolve!: () => void;
        let reject!: (error: unknown) => void;
        closePromise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
        // Publish the shared promise before cancellation invokes adapter listeners.
        const drain = activeDone;
        invalidate();
        void drain.then(async () => {
          if (!runtime) return;
          try { await runtime.close(); owners.delete(runtime); }
          catch { throw new FormaError('INFERENCE_FAILURE', 'The inference runtime could not close.', { field: 'inference' }); }
        }).then(resolve, reject);
      }
      return closePromise;
    },
  };
}
