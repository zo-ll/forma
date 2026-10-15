import { canonicalJson } from '../requests/service.js';
import { invalid, objectInput } from '../validation.js';
import type { EmbeddingProfile, GenerationProfile, InferenceCapabilities, ModelProfile, WeightQuantization } from './types.js';
import { INFERENCE_LIMITS } from './types.js';

export function boundedText(value: unknown, field: string, max: number, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())
    || /[\u0000\uD800-\uDFFF]/u.test(value)) invalid(field, 'Expected bounded valid Unicode text without NUL.');
  return value;
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  objectInput(value, keys);
  return value as Record<string, unknown>;
}
export function integer(value: unknown, field: string, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
    invalid(field, 'Expected a positive bounded integer.');
  }
  return value;
}
function base(value: Record<string, unknown>): ModelProfile {
  const artifact = record(value.artifact, ['id', 'sha256']);
  const runtime = record(value.runtime, ['id', 'version', 'backend']);
  if (typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256)) invalid('profile', 'Invalid artifact hash.');
  if (runtime.backend !== 'cpu' && runtime.backend !== 'gpu') invalid('profile', 'Unsupported configured backend.');
  if (value.weightPrecision !== 'bf16' && value.weightPrecision !== 'float32') invalid('profile', 'Unsupported weight precision.');
  if (value.runtimePrecision !== 'bf16' && value.runtimePrecision !== 'float32') invalid('profile', 'Unsupported runtime precision.');
  return {
    id: boundedText(value.id, 'profile', 128),
    artifact: { id: boundedText(artifact.id, 'profile', 128), sha256: artifact.sha256 },
    runtime: { id: boundedText(runtime.id, 'profile', 128), version: boundedText(runtime.version, 'profile', 128), backend: runtime.backend },
    weightQuantization: weightQuantization(value.weightQuantization), weightPrecision: value.weightPrecision, runtimePrecision: value.runtimePrecision,
  };
}
function weightQuantization(value: unknown): WeightQuantization {
  if (value !== 'none' && value !== 'int4-per-channel-qat' && value !== 'mixed-2-4-8-bit-qat') {
    invalid('profile', 'Unsupported weight quantization.');
  }
  return value;
}
const baseKeys = ['id', 'artifact', 'runtime', 'weightQuantization', 'weightPrecision', 'runtimePrecision', 'outputPrecision'];
export function embeddingProfile(value: unknown): EmbeddingProfile {
  const r = record(value, [...baseKeys, 'dimensions', 'queryPrefix', 'documentPrefix', 'normalization']);
  if (r.outputPrecision !== 'float32' || (r.normalization !== 'none' && r.normalization !== 'l2')) invalid('profile', 'Unsupported embedding output.');
  return { ...base(r), outputPrecision: 'float32',
    dimensions: integer(r.dimensions, 'profile', INFERENCE_LIMITS.maxDimensions),
    queryPrefix: boundedText(r.queryPrefix, 'profile', 512, true),
    documentPrefix: boundedText(r.documentPrefix, 'profile', 512, true), normalization: r.normalization };
}
export function generationProfile(value: unknown): GenerationProfile {
  const r = record(value, baseKeys);
  if (r.outputPrecision !== 'text') invalid('profile', 'Unsupported generation output.');
  return { ...base(r), outputPrecision: 'text' };
}
export function embeddingProfilesCompatible(left: EmbeddingProfile, right: EmbeddingProfile): boolean {
  return canonicalJson(embeddingProfile(left)) === canonicalJson(embeddingProfile(right));
}
export function capabilities(value: unknown): InferenceCapabilities {
  const r = record(value, ['embedding', 'generation']);
  function capability<P>(value: unknown, parse: (value: unknown) => P) {
    const c = record(value, ['state', 'profile', 'reason']);
    if (c.state === 'missing' && c.profile === null && c.reason === undefined) return { state: 'missing' as const, profile: null };
    if (c.state === 'ready' && c.reason === undefined) return { state: 'ready' as const, profile: parse(c.profile) };
    if (c.state === 'failed' && c.reason === 'adapter-failure') return {
      state: 'failed' as const, profile: c.profile === null ? null : parse(c.profile), reason: 'adapter-failure' as const,
    };
    return invalid('capabilities', 'Malformed capability.');
  }
  return { embedding: capability(r.embedding, embeddingProfile), generation: capability(r.generation, generationProfile) };
}
export function vector(value: unknown, profile: EmbeddingProfile): readonly number[] {
  if (!Array.isArray(value) || value.length !== profile.dimensions) invalid('vector', 'Mismatched dimensions.');
  const result: number[] = [];
  let norm = 0;
  for (const component of value) {
    if (typeof component !== 'number' || !Number.isFinite(component) || !Number.isFinite(Math.fround(component))
      || (component !== 0 && Math.fround(component) === 0)) invalid('vector', 'Invalid float32 component.');
    result.push(component);
    norm = Math.hypot(norm, component);
  }
  if (!Number.isFinite(norm) || norm === 0 || (profile.normalization === 'l2' && Math.abs(norm - 1) > 0.0001)) {
    invalid('vector', 'Invalid vector norm.');
  }
  return result;
}
/** Copies JSON DTOs only. No SDK object crosses this boundary. */
export function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export function same(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }
