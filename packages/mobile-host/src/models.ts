import { FormaError } from '@forma/core';

export type ModelArtifactId = 'embeddinggemma-2-text-270m' | 'gemma-4-e2b-it-gpu';
export interface ModelArtifact {
  readonly id: ModelArtifactId;
  readonly role: 'embedding' | 'generation';
  readonly name: string;
  readonly filename: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly url: string;
  readonly license: string;
  readonly licenseUrl: string;
  readonly backend: 'cpu' | 'gpu';
}
export const MODEL_ARTIFACTS: readonly ModelArtifact[] = Object.freeze([
  Object.freeze({
    id: 'embeddinggemma-2-text-270m', role: 'embedding', name: 'EmbeddingGemma 2 Text 270M',
    filename: 'embeddinggemma-2-text-270m.litertlm', byteLength: 164626432,
    sha256: '2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb',
    url: 'https://huggingface.co/litert-community/embeddinggemma-2-text-270m-litert-lm/resolve/main/embeddinggemma-2-text-270m.litertlm',
    license: 'Apache-2.0', licenseUrl: 'https://huggingface.co/google/embeddinggemma-2', backend: 'cpu',
  }),
  Object.freeze({
    id: 'gemma-4-e2b-it-gpu', role: 'generation', name: 'Gemma 4 E2B (GPU candidate)',
    filename: 'gemma-4-E2B-it-gpu.litertlm', byteLength: 2008432640,
    sha256: 'a53a59001894c58e6bdb5b9b227709f91a2e3e556baa7d85acf9c55402ba5cf5',
    url: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-gpu.litertlm',
    license: 'Apache-2.0', licenseUrl: 'https://ai.google.dev/gemma/docs/gemma_4_license', backend: 'gpu',
  }),
]);
export interface ModelFileStatus {
  readonly artifactId: ModelArtifactId;
  readonly state: 'missing' | 'verified' | 'failed';
  readonly byteLength: number;
}
export interface ModelImportResult {
  readonly status: 'imported' | 'cancelled';
  readonly artifactId: ModelArtifactId;
  readonly byteLength: number;
}
/** Native document and destination paths never cross this boundary. */
export interface ModelFiles {
  status(): Promise<unknown>;
  importFile(artifactId: ModelArtifactId, requestId: string): Promise<unknown>;
  cancel(requestId: string): Promise<boolean>;
}
export interface ModelImportSnapshot {
  readonly files: readonly ModelFileStatus[] | null;
  readonly checking: boolean;
  readonly active: ModelArtifactId | null;
  readonly cancelling: boolean;
  readonly notice: string | null;
  readonly error: FormaError | null;
}
export interface ModelImportFlow {
  snapshot(): ModelImportSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  importFile(artifactId: ModelArtifactId): Promise<void>;
  cancel(): Promise<void>;
}
function failure(): FormaError {
  return new FormaError('STORAGE_FAILURE', 'The model file operation failed. Check the files and try again.', { field: 'models' });
}
function artifact(id: unknown): ModelArtifact {
  const found = MODEL_ARTIFACTS.find(item => item.id === id);
  if (!found) throw new FormaError('INVALID_INPUT', 'The model artifact is not approved.', { field: 'artifactId' });
  return found;
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw failure();
  return value as Record<string, unknown>;
}
export function parseModelStatus(value: unknown): readonly ModelFileStatus[] {
  if (!Array.isArray(value) || value.length !== MODEL_ARTIFACTS.length) throw failure();
  const statuses = value.map(item => {
    const v = object(item, ['artifactId', 'state', 'byteLength']);
    const a = artifact(v.artifactId);
    if (!['missing', 'verified', 'failed'].includes(v.state as string)
      || !Number.isSafeInteger(v.byteLength) || (v.byteLength as number) < 0
      || (v.state === 'verified' && v.byteLength !== a.byteLength)
      || (v.state === 'missing' && v.byteLength !== 0)) throw failure();
    return { artifactId: a.id, state: v.state, byteLength: v.byteLength } as ModelFileStatus;
  });
  if (new Set(statuses.map(item => item.artifactId)).size !== MODEL_ARTIFACTS.length) throw failure();
  return MODEL_ARTIFACTS.map(a => statuses.find(item => item.artifactId === a.id)!);
}
function parseImport(value: unknown, a: ModelArtifact): ModelImportResult {
  const v = object(value, ['status', 'artifactId', 'byteLength']);
  if (v.artifactId !== a.id || (v.status !== 'imported' && v.status !== 'cancelled')
    || v.byteLength !== (v.status === 'imported' ? a.byteLength : 0)) throw failure();
  return { status: v.status, artifactId: a.id, byteLength: v.byteLength as number };
}
/** A host-lifetime controller. Its I/O never enters the record service queue. */
export function createModelImportFlow(deps: { files: ModelFiles; nextId(): string; available(): boolean }): ModelImportFlow {
  let files: readonly ModelFileStatus[] | null = null;
  let checking = false;
  let active: { artifact: ModelArtifact; requestId: string; promise: Promise<void> } | null = null;
  let cancelling = false;
  let notice: string | null = null;
  let error: FormaError | null = null;
  let epoch = 0;
  let refreshPromise: Promise<void> | null = null;
  let cancelPromise: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  function emit(): void { for (const listener of [...listeners]) { try { listener(); } catch { /* Listener isolation. */ } } }
  function snapshot(): ModelImportSnapshot {
    return { files: files?.map(item => ({ ...item })) ?? null, checking, active: active?.artifact.id ?? null, cancelling, notice, error };
  }
  function refresh(): Promise<void> {
    if (active) return active.promise;
    if (refreshPromise) return refreshPromise;
    const current = ++epoch;
    checking = true; error = null;
    const attempt = Promise.resolve().then(() => deps.files.status()).then(value => {
      const parsed = parseModelStatus(value);
      if (epoch === current) files = parsed;
    }).catch(() => { if (epoch === current) error = failure(); }).finally(() => {
      if (epoch === current) checking = false;
      if (refreshPromise === attempt) refreshPromise = null;
      emit();
    });
    refreshPromise = attempt; emit(); return attempt;
  }
  function importFile(id: ModelArtifactId): Promise<void> {
    const a = artifact(id);
    if (!deps.available()) return Promise.reject(new FormaError('SERVICE_CLOSED', 'The local service is not available.'));
    if (active) return active.artifact.id === id ? active.promise
      : Promise.reject(new FormaError('CONFLICT', 'Another model import is active.', { field: 'models' }));
    if (files === null) return Promise.reject(new FormaError('CONFLICT', 'Check model files before import.', { field: 'models' }));
    const requestId = deps.nextId();
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(requestId)) return Promise.reject(failure());
    ++epoch; refreshPromise = null; checking = false; error = null; notice = null; cancelling = false;
    const attempt = Promise.resolve().then(() => deps.files.importFile(id, requestId)).then(value => {
      const result = parseImport(value, a);
      if (result.status === 'imported') {
        const updated: ModelFileStatus = { artifactId: id, state: 'verified', byteLength: a.byteLength };
        files = files!.map(item => item.artifactId === id ? updated : item);
        notice = 'Model file verified and saved. Inference is not enabled.';
      } else notice = 'Model import cancelled. The current model did not change.';
    }).catch(() => { error = failure(); notice = null; }).finally(() => {
      active = null; cancelling = false; cancelPromise = null; emit();
    });
    active = { artifact: a, requestId, promise: attempt };
    emit(); return attempt;
  }
  function cancel(): Promise<void> {
    if (!active) return Promise.resolve();
    if (cancelPromise) return cancelPromise;
    const current = active;
    cancelling = true;
    const attempt = Promise.resolve().then(() => deps.files.cancel(current.requestId)).then(value => {
      if (typeof value !== 'boolean') throw failure();
    }).catch(() => {
      if (active === current) { error = failure(); cancelling = false; cancelPromise = null; }
    }).finally(emit);
    cancelPromise = attempt; emit(); return attempt;
  }
  return { snapshot, refresh, importFile, cancel, subscribe(listener) {
    listeners.add(listener); return () => { listeners.delete(listener); };
  } };
}
