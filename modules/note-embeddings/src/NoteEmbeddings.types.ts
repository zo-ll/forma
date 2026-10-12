// Types for the native NoteEmbeddings module.
// The native code in android/src/main/java implements these functions.

export type NativeBackendName = 'CPU' | 'GPU';

export type NativeImportedModel = {
  /** Absolute path inside the app-private files directory. */
  path: string;
  fileName: string;
  sizeBytes: number;
};

export type NativeModelFacts = {
  /** ModelInfo model type. Example: EMBEDDING. */
  modelType: string;
  /** Dimension that the model metadata declares. Null when the metadata is missing. */
  declaredDimension: number | null;
  /** Backends that the model metadata lists for text input. Example: CPU, GPU. */
  supportedTextBackends: string[];
};

export type NativeLoadResult = NativeModelFacts & {
  modelPath: string;
  /** The backend that the app asked for. */
  configuredBackend: NativeBackendName;
  /** The backend that the SDK reports. The SDK does not report the active delegate. */
  effectiveBackend: string;
  /** Time to initialize the native engine, in milliseconds. */
  loadTimeMs: number;
};

export interface NoteEmbeddingsNativeModule {
  importModel(sourceUri: string, fileName: string): Promise<NativeImportedModel>;
  loadModel(modelPath: string, backend: NativeBackendName): Promise<NativeLoadResult>;
  computeEmbedding(text: string): Promise<number[]>;
  unloadModel(): Promise<void>;
  isModelLoaded(): boolean;
}
