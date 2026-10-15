import {FormaError, embeddingProfilesCompatible} from '@forma/core';
import {ANDROID_EMBEDDING_PROFILE, ANDROID_GENERATION_PROFILE} from '@forma/adapters/android';
import type {MobileHost} from '@forma/mobile-host';
import type {Note} from '@forma/core';
import {deviceAdapters} from './adapters/device';
import type {InferenceGateMode} from './adapters/inference';
import metadata from '../mobile-build.json';

/** Read-only diagnostic. The operator creates any synthetic source separately, with explicit permission. */
export async function runInferenceGate(host: MobileHost, mode: InferenceGateMode, runId: string): Promise<void> {
  if (!deviceAdapters.isHostGate()) return;
  let checks = 0;
  let ok = false;
  let code: string | null = null;
  let primaryAfterFailure = false;
  const results: Record<string, unknown>[] = [];
  const check = (value: unknown) => { if (!value) throw new Error('Inference gate assertion failed.'); checks++; };
  try {
    check(/^[A-Za-z0-9-]{1,80}$/.test(runId));
    await host.start();
    const service = host.service();
    const before = JSON.stringify(await service.workouts.list());
    const caps = service.inference.capabilities();
    check(caps.embedding.state === (mode === 'inference-generation' ? 'missing' : 'ready'));
    check(caps.generation.state === (mode === 'inference-embedding' ? 'missing' : 'ready'));
    async function during<T>(run: () => Promise<T>): Promise<{value: T; roundTripMs: number; recordReadDuringWait: boolean}> {
      const start = Date.now();
      let settled = false;
      const work = run();
      void work.then(() => {settled = true;}, () => {settled = true;});
      // An overlap observation does not identify the current SDK execution stage.
      const records = JSON.stringify(await service.workouts.list());
      const recordReadDuringWait = !settled;
      check(records === before);
      const value = await work;
      return {value, roundTripMs: Date.now() - start, recordReadDuringWait};
    }
    async function embed(task: 'query' | 'document') {
      const {value, roundTripMs, recordReadDuringWait} = await during(() => service.inference.embed({text: 'Synthetic local inference check.', task}));
      check(embeddingProfilesCompatible(value.profile, ANDROID_EMBEDDING_PROFILE) && value.task === task);
      const norm = Math.hypot(...value.vector);
      check(value.vector.length === 256 && value.vector.every(v => Number.isFinite(v) && Math.fround(v) === v));
      check(norm > 0 && Math.abs(norm - 1) <= 0.0001);
      results.push({kind: 'embedding', task, dimensions: value.vector.length, norm,
        configuredBackend: value.profile.runtime.backend, roundTripMs, recordReadDuringWait});
    }
    if (mode !== 'inference-generation') {await embed('query'); await embed('document');}
    if (mode !== 'inference-embedding') {
      const sourceText = 'Forma inference synthetic source. Run ' + runId;
      const notes: Note[] = [];
      let cursor: string | undefined;
      do {
        const page = await service.notes.searchText({query: sourceText, ...(cursor === undefined ? {} : {cursor})});
        notes.push(...page.items.filter(note => note.text === sourceText));
        check(notes.length <= 1);
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      check(notes.length === 1);
      const note = notes[0]!;
      const {value, roundTripMs, recordReadDuringWait} = await during(() => service.inference.generateNote({source: note.source,
        instruction: 'Summarize this synthetic note in one short sentence. Do not use tools.', maxOutputCharacters: 256}));
      check(value.profile.id === ANDROID_GENERATION_PROFILE.id && value.profile.runtime.backend === 'gpu'
        && value.profile.runtimePrecision === 'float32' && value.profile.artifact.sha256 === ANDROID_GENERATION_PROFILE.artifact.sha256);
      check(value.text.length > 0 && value.text.length <= 256 && JSON.stringify(value.source) === JSON.stringify(note.source));
      check(JSON.stringify(await service.notes.get(note.id)) === JSON.stringify(note));
      // Never log input text, output text, source IDs, archives, or native paths.
      results.push({kind: 'generation', characters: value.text.length, configuredBackend: 'gpu', roundTripMs, recordReadDuringWait});
    }
    if (mode === 'inference-sequential') await embed('query');
    check(JSON.stringify(await service.workouts.list()) === before);
    ok = true;
  } catch (error) {
    code = error instanceof FormaError ? error.code : 'GATE_FAILED';
    try {await host.service().workouts.list(); primaryAfterFailure = true;} catch { /* Startup can fail independently. */ }
  } finally {
    try {await host.close();} catch {ok = false; code = 'INFERENCE_CLOSE_FAILED';}
  }
  console.info('FORMA_INFERENCE_RESULT ' + JSON.stringify({...metadata, mode, runId, ok, code, checks, primaryAfterFailure, results}));
}
