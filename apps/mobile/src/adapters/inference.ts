import {createAndroidInferenceRuntime} from '@forma/adapters/android';
import {FormaError} from '@forma/core';
import type {InferenceRuntime} from '@forma/core';
import NativeInference from '../native/NativeFormaInference';
import {deviceAdapters} from './device';

export type InferenceGateMode = 'inference-embedding' | 'inference-generation' | 'inference-sequential';
export function isInferenceGateMode(mode: string | undefined): mode is InferenceGateMode {
  return mode === 'inference-embedding' || mode === 'inference-generation' || mode === 'inference-sequential';
}
/** No normal launch enables a model. Only an explicit isolated gate launch composes this runtime. */
export function experimentalGateInference(mode: string | undefined): InferenceRuntime | undefined {
  if (!deviceAdapters.isHostGate() || !isInferenceGateMode(mode)) return undefined;
  if (!NativeInference) throw new FormaError('INFERENCE_UNAVAILABLE', 'The native inference module is not available.');
  return createAndroidInferenceRuntime({
    native: NativeInference, nextId: deviceAdapters.ids.next,
    embedding: mode !== 'inference-generation', generation: mode !== 'inference-embedding',
  });
}
