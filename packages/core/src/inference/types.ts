import type { NoteSource } from '../notes/types.js';

export const INFERENCE_LIMITS = Object.freeze({
  maxTextCharacters: 16384, maxInstructionCharacters: 1024, maxOutputCharacters: 4096,
  maxDimensions: 4096, maxQueued: 4,
});
export interface RuntimeIdentity {
  readonly id: string;
  readonly version: string;
  readonly backend: 'cpu' | 'gpu';
}
export interface ModelProfile {
  readonly id: string;
  readonly artifact: { readonly id: string; readonly sha256: string };
  readonly runtime: RuntimeIdentity;
  readonly weightQuantization: 'none';
  readonly weightPrecision: 'bf16' | 'float32';
  readonly runtimePrecision: 'bf16' | 'float32';
}
export interface EmbeddingProfile extends ModelProfile {
  readonly outputPrecision: 'float32';
  readonly dimensions: number;
  readonly queryPrefix: string;
  readonly documentPrefix: string;
  readonly normalization: 'none' | 'l2';
}
export interface GenerationProfile extends ModelProfile {
  readonly outputPrecision: 'text';
}
export type InferenceCapability<P> =
  | { readonly state: 'missing'; readonly profile: null }
  | { readonly state: 'ready'; readonly profile: P }
  | { readonly state: 'failed'; readonly profile: P | null; readonly reason: 'adapter-failure' };
export interface InferenceCapabilities {
  readonly embedding: InferenceCapability<EmbeddingProfile>;
  readonly generation: InferenceCapability<GenerationProfile>;
}
export interface InferenceCancellationToken {
  readonly cancelled: boolean;
  subscribe(listener: () => void): () => void;
}
export interface InferenceCancellation {
  readonly token: InferenceCancellationToken;
  cancel(): void;
}
export interface EmbedInput {
  readonly text: string;
  readonly task: 'query' | 'document';
}
export interface EmbedNoteInput { readonly source: NoteSource }
export interface GenerateNoteInput extends EmbedNoteInput {
  readonly instruction: string;
  readonly maxOutputCharacters: number;
}
export interface RuntimeEmbedding {
  readonly profile: EmbeddingProfile;
  readonly task: 'query' | 'document';
  readonly vector: readonly number[];
}
export interface RuntimeGeneration {
  readonly profile: GenerationProfile;
  readonly text: string;
}
/** One exclusive lifetime owner. Methods run outside the record store queue. */
export interface InferenceRuntime {
  capabilities(): InferenceCapabilities;
  embed?(input: EmbedInput & { readonly profile: EmbeddingProfile }, token: InferenceCancellationToken): Promise<RuntimeEmbedding>;
  generate?(input: { readonly text: string; readonly instruction: string; readonly maxOutputCharacters: number;
    readonly profile: GenerationProfile }, token: InferenceCancellationToken): Promise<RuntimeGeneration>;
  close(): Promise<void>;
}
export interface EmbeddingResult extends RuntimeEmbedding { readonly source: NoteSource | null }
export interface GenerationResult extends RuntimeGeneration { readonly source: NoteSource }
export interface InferenceApi {
  capabilities(): InferenceCapabilities;
  embed(input: EmbedInput, token?: InferenceCancellationToken): Promise<EmbeddingResult>;
  embedNote(input: EmbedNoteInput, token?: InferenceCancellationToken): Promise<EmbeddingResult>;
  generateNote(input: GenerateNoteInput, token?: InferenceCancellationToken): Promise<GenerationResult>;
}
