// Pure functions for prefix, truncation, normalization, validation, and cosine
// ranking. These functions do not touch the network or the native layer.
import type { RetrievedNote } from './types';

/** Prefix for a note that is stored as a search result. */
export const NOTE_PREFIX = 'task: search result | text: ';
/** Prefix for a search query. */
export const QUERY_PREFIX = 'task: search query | text: ';
/** The app stores 256 values per vector. */
export const TARGET_DIMENSION = 256;

export class EmbeddingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingValidationError';
  }
}

/** Trim the text, then add the note prefix. */
export function noteInput(text: string): string {
  return `${NOTE_PREFIX}${text.trim()}`;
}

/** Trim the text, then add the query prefix. */
export function queryInput(query: string): string {
  return `${QUERY_PREFIX}${query.trim()}`;
}

/** Keep the first `dimension` values. Reject a short vector. */
export function truncateVector(vector: readonly number[], dimension = TARGET_DIMENSION): number[] {
  if (!Number.isInteger(dimension) || dimension <= 0) {
    throw new EmbeddingValidationError(`The dimension must be a positive integer. Got ${dimension}.`);
  }
  if (vector.length < dimension) {
    throw new EmbeddingValidationError(
      `The vector has ${vector.length} values. The app needs at least ${dimension}.`,
    );
  }
  return vector.slice(0, dimension);
}

/** Reject NaN, infinity, and a zero or invalid norm. Return a unit vector. */
export function normalizeVector(vector: readonly number[]): number[] {
  let sumSquares = 0;
  for (const value of vector) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new EmbeddingValidationError('The vector contains a non-finite value.');
    }
    sumSquares += value * value;
  }
  const norm = Math.sqrt(sumSquares);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new EmbeddingValidationError('The vector has zero or invalid norm.');
  }
  return vector.map((value) => value / norm);
}

/** Truncate a raw vector to the target dimension, then normalize it. */
export function makeUnitVector(
  raw: readonly number[],
  dimension = TARGET_DIMENSION,
): number[] {
  return normalizeVector(truncateVector(raw, dimension));
}

/** Both vectors must be unit vectors with the same length. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new EmbeddingValidationError(
      `The two vectors have different lengths: ${a.length} and ${b.length}.`,
    );
  }
  let dot = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
  }
  return dot;
}

export type NoteVector = {
  id: string;
  text: string;
  vector: number[];
};

/** Rank notes by cosine score, then by ID. The order is deterministic. */
export function rankNotes(queryVector: readonly number[], notes: readonly NoteVector[]): RetrievedNote[] {
  const scored: RetrievedNote[] = notes.map((note) => ({
    id: note.id,
    text: note.text,
    score: cosineSimilarity(queryVector, note.vector),
  }));
  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.id.localeCompare(right.id);
  });
  return scored;
}

/** Return true when every expected ID is in the result list. */
export function expectedIdsCovered(top: readonly RetrievedNote[], expectedIds: readonly string[]): boolean {
  if (expectedIds.length === 0) {
    return true;
  }
  return expectedIds.every((id) => top.some((note) => note.id === id));
}
