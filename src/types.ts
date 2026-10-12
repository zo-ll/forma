// Shared types for the validation app.

export type BackendName = 'CPU' | 'GPU';

export type ImportedModel = {
  path: string;
  fileName: string;
  sizeBytes: number;
  /** A new value on every successful import. The cache uses this value. */
  importId: string;
};

export type RetrievedNote = {
  id: string;
  text: string;
  score: number;
};

export type QueryResult = {
  query: string;
  expectedIds: string[];
  top: RetrievedNote[];
  expectedCovered: boolean;
  queryEmbeddingMs: number;
  rankMs: number;
};

export type NoteRetrievalReport = {
  modelPath: string;
  configuredBackend: BackendName;
  effectiveBackend: string;
  declaredDimension: number | null;
  supportedTextBackends: string[];
  modelLoadMs: number;
  noteEmbeddingMs: number;
  results: QueryResult[];
};

export type TestStatus = 'idle' | 'running' | 'passed' | 'failed';
