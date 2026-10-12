import {
  EmbeddingValidationError,
  cosineSimilarity,
  expectedIdsCovered,
  makeUnitVector,
  normalizeVector,
  NOTE_PREFIX,
  noteInput,
  QUERY_PREFIX,
  queryInput,
  rankNotes,
  TARGET_DIMENSION,
  truncateVector,
} from '../src/embeddings';

function vectorOfLength(length: number, value: number): number[] {
  return Array.from({ length }, () => value);
}

describe('task prefixes', () => {
  it('adds the note prefix and trims whitespace', () => {
    expect(noteInput('  knee pain  ')).toBe(`${NOTE_PREFIX}knee pain`);
  });

  it('adds the query prefix and trims whitespace', () => {
    expect(queryInput('\n shoulder \n')).toBe(`${QUERY_PREFIX}shoulder`);
  });
});

describe('truncateVector', () => {
  it('keeps the first 256 values', () => {
    const input = Array.from({ length: 768 }, (_, index) => index);
    const result = truncateVector(input);
    expect(result).toHaveLength(TARGET_DIMENSION);
    expect(result[0]).toBe(0);
    expect(result[255]).toBe(255);
  });

  it('rejects an undersized vector', () => {
    expect(() => truncateVector(vectorOfLength(128, 1))).toThrow(EmbeddingValidationError);
  });
});

describe('normalizeVector', () => {
  it('returns a unit vector', () => {
    const result = normalizeVector([3, 4, 0]);
    expect(result[0]).toBeCloseTo(0.6, 6);
    expect(result[1]).toBeCloseTo(0.8, 6);
    expect(result[2]).toBe(0);
    const norm = Math.sqrt(result.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('rejects NaN', () => {
    expect(() => normalizeVector([1, Number.NaN])).toThrow(EmbeddingValidationError);
  });

  it('rejects infinity', () => {
    expect(() => normalizeVector([1, Number.POSITIVE_INFINITY])).toThrow(EmbeddingValidationError);
  });

  it('rejects a zero norm', () => {
    expect(() => normalizeVector([0, 0, 0])).toThrow(EmbeddingValidationError);
  });
});

describe('makeUnitVector', () => {
  it('truncates to 256 values and re-normalizes', () => {
    const raw = Array.from({ length: 768 }, (_, index) => (index % 5) + 1);
    const result = makeUnitVector(raw);
    expect(result).toHaveLength(TARGET_DIMENSION);
    const norm = Math.sqrt(result.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 6);
  });
});

describe('cosineSimilarity', () => {
  it('scores an identical unit vector as 1', () => {
    const unit = normalizeVector([1, 2, 3, 4]);
    expect(cosineSimilarity(unit, unit)).toBeCloseTo(1, 6);
  });

  it('scores orthogonal vectors as 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('rejects a length mismatch', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow(EmbeddingValidationError);
  });
});

describe('rankNotes', () => {
  it('orders by score and breaks ties by ID', () => {
    const query = [1, 0];
    const ranked = rankNotes(query, [
      { id: 'B', text: 'same', vector: [1, 0] },
      { id: 'A', text: 'same', vector: [1, 0] },
      { id: 'C', text: 'other', vector: [0, 1] },
    ]);
    expect(ranked.map((note) => note.id)).toEqual(['A', 'B', 'C']);
    expect(ranked[0].score).toBeCloseTo(1, 6);
  });
});

describe('expectedIdsCovered', () => {
  it('is true when every expected ID is present', () => {
    expect(expectedIdsCovered([{ id: 'N1', text: '', score: 1 }], ['N1'])).toBe(true);
  });

  it('is false when one expected ID is missing', () => {
    expect(expectedIdsCovered([{ id: 'N1', text: '', score: 1 }], ['N1', 'N4'])).toBe(false);
  });

  it('is true for an empty expectation', () => {
    expect(expectedIdsCovered([], [])).toBe(true);
  });
});
