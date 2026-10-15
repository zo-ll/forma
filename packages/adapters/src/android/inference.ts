import { FormaError, embeddingProfilesCompatible } from '@forma/core';
import type {
  EmbeddingProfile, GenerationProfile, InferenceCancellationToken, InferenceRuntime,
} from '@forma/core';

/** JSON DTOs only. The native side owns all paths, engines, and cancellation handles. */
export interface AndroidInferenceBinding {
  openInference(ownerId: string): Promise<void>;
  runInference(ownerId: string, sequence: number, request: string): Promise<string>;
  cancelInference(ownerId: string, sequence: number): Promise<boolean>;
  closeInference(ownerId: string): Promise<void>;
}
const runtime = (backend: 'cpu' | 'gpu') => Object.freeze({ id: 'litert-lm-android', version: '0.18.0', backend });
export const ANDROID_EMBEDDING_PROFILE: EmbeddingProfile = Object.freeze({
  id: 'embeddinggemma-2-text-270m-cpu-f32-mrl256-v1',
  artifact: Object.freeze({ id: 'embeddinggemma-2-text-270m', sha256: '2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb' }),
  runtime: runtime('cpu'), weightQuantization: 'int4-per-channel-qat', weightPrecision: 'float32', runtimePrecision: 'float32',
  outputPrecision: 'float32', dimensions: 256, queryPrefix: 'task: search query | text: ',
  documentPrefix: 'task: search result | text: ', normalization: 'l2',
});
export const ANDROID_GENERATION_PROFILE: GenerationProfile = Object.freeze({
  id: 'gemma-4-e2b-it-gpu-f32-2048-v1',
  artifact: Object.freeze({ id: 'gemma-4-e2b-it-gpu', sha256: 'a53a59001894c58e6bdb5b9b227709f91a2e3e556baa7d85acf9c55402ba5cf5' }),
  runtime: runtime('gpu'), weightQuantization: 'mixed-2-4-8-bit-qat', weightPrecision: 'float32', runtimePrecision: 'float32',
  outputPrecision: 'text',
});
const owners = new WeakSet<AndroidInferenceBinding>();
const missing = { state: 'missing', profile: null } as const;
const failure = () => new FormaError('INFERENCE_FAILURE', 'The Android inference adapter failed.', { field: 'inference' });
const cancelled = () => new FormaError('CANCELLED', 'The derived inference wait was cancelled.');
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw failure();
  return value as Record<string, unknown>;
}
function sameDto(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) || Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return Object.keys(a).length === Object.keys(b).length
    && Object.keys(b).every(key => Object.hasOwn(a, key) && sameDto(a[key], b[key]));
}
/** Explicit experimental composition only. Both capabilities are missing unless the caller opts in. */
export function createAndroidInferenceRuntime(options: {
  readonly native: AndroidInferenceBinding;
  readonly nextId: () => string;
  readonly embedding?: boolean;
  readonly generation?: boolean;
}): InferenceRuntime {
  const native = options.native;
  if (owners.has(native)) throw new FormaError('CONFLICT', 'The native inference binding already has an owner.', { field: 'inference' });
  const ownerId = options.nextId();
  if (!/^[A-Za-z0-9-]{1,128}$/.test(ownerId)) throw failure();
  const embedding = options.embedding === true;
  const generation = options.generation === true;
  owners.add(native);
  let opened = false;
  let opening: Promise<void> | undefined;
  let sequence = 0;
  let closing = false;
  let closePromise: Promise<void> | undefined;
  let active: { promise: Promise<unknown>; cancel(): void } | undefined;
  function open(): Promise<void> {
    return opening ??= Promise.resolve().then(() => native.openInference(ownerId)).then(() => { opened = true; });
  }
  function run(request: Record<string, unknown>, token: InferenceCancellationToken): Promise<Record<string, unknown>> {
    if (closing) return Promise.reject(new FormaError('SERVICE_CLOSED', 'The inference runtime is closed.'));
    if (active) return Promise.reject(new FormaError('CONFLICT', 'Another native inference operation is active.', { field: 'inference' }));
    let requested = token.cancelled;
    let dispatched = false;
    let current = 0;
    let unsubscribe = (): void => undefined;
    const cancel = () => {
      requested = true;
      if (dispatched) {
        // This is a request, not proof that native work stopped. The original promise must drain.
        void Promise.resolve().then(() => native.cancelInference(ownerId, current)).catch(() => undefined);
      }
    };
    const promise = Promise.resolve().then(async () => {
      if (requested || closing) throw cancelled();
      await open();
      if (requested || closing || token.cancelled) throw cancelled();
      unsubscribe = token.subscribe(cancel);
      if (requested || closing || token.cancelled) throw cancelled();
      current = ++sequence;
      dispatched = true;
      const serialized = await native.runInference(ownerId, current, JSON.stringify(request));
      if (requested || closing || token.cancelled) throw cancelled();
      if (typeof serialized !== 'string' || serialized.length > 32768) throw failure();
      const value: unknown = JSON.parse(serialized);
      const kind = request.kind;
      const v = object(value, ['kind', 'artifactId', 'sha256', 'runtimeVersion', 'backend', 'runtimePrecision',
        ...(kind === 'embedding' ? ['task', 'vector'] : ['text'])]);
      const p = kind === 'embedding' ? ANDROID_EMBEDDING_PROFILE : ANDROID_GENERATION_PROFILE;
      if (v.kind !== kind || v.artifactId !== p.artifact.id || v.sha256 !== p.artifact.sha256
        || v.runtimeVersion !== p.runtime.version || v.backend !== p.runtime.backend || v.runtimePrecision !== p.runtimePrecision) throw failure();
      return v;
    }).catch(() => { throw requested || closing || token.cancelled ? cancelled() : failure(); }).finally(() => {
      try { unsubscribe(); } catch { /* Listener cleanup cannot preserve a native slot. */ }
      active = undefined;
    });
    active = { promise, cancel };
    return promise;
  }
  return {
    capabilities: () => ({
      embedding: embedding && !closing ? { state: 'ready', profile: copy(ANDROID_EMBEDDING_PROFILE) } : missing,
      generation: generation && !closing ? { state: 'ready', profile: copy(ANDROID_GENERATION_PROFILE) } : missing,
    }),
    async embed(input, token) {
      if (!embedding || !embeddingProfilesCompatible(input.profile, ANDROID_EMBEDDING_PROFILE)
        || (input.task !== 'query' && input.task !== 'document')) throw failure();
      const prefix = input.task === 'query' ? ANDROID_EMBEDDING_PROFILE.queryPrefix : ANDROID_EMBEDDING_PROFILE.documentPrefix;
      if (typeof input.text !== 'string' || !input.text.startsWith(prefix) || !input.text.slice(prefix.length).trim()) throw failure();
      const result = await run({ kind: 'embedding', task: input.task, text: input.text }, token);
      if (result.task !== input.task || !Array.isArray(result.vector) || result.vector.length !== 256
        || result.vector.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.fround(v) !== v)) throw failure();
      return { profile: copy(ANDROID_EMBEDDING_PROFILE), task: input.task, vector: [...result.vector] as number[] };
    },
    async generate(input, token) {
      if (!generation || !sameDto(input.profile, ANDROID_GENERATION_PROFILE)) throw failure();
      const result = await run({ kind: 'generation', text: input.text, instruction: input.instruction,
        maxOutputCharacters: input.maxOutputCharacters }, token);
      if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > input.maxOutputCharacters) throw failure();
      return { profile: copy(ANDROID_GENERATION_PROFILE), text: result.text };
    },
    close() {
      if (!closePromise) {
        closing = true;
        // Publish the promise before cancellation can invoke another close.
        closePromise = Promise.resolve().then(async () => {
          active?.cancel();
          await active?.promise.catch(() => undefined);
          if (opened) await native.closeInference(ownerId);
          owners.delete(native);
        }).catch(() => { throw failure(); });
      }
      return closePromise;
    },
  };
}
