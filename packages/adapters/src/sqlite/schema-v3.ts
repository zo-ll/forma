/** Each entry is one statement. Old sets receive no assumed convention. */
export const SCHEMA_V3: readonly string[] = Object.freeze([
  `ALTER TABLE sets ADD COLUMN load_convention TEXT NOT NULL DEFAULT 'unknown'
    CHECK (load_convention IN ('unknown', 'entered', 'per-hand', 'combined', 'body-weight'))`,
  `ALTER TABLE sets ADD COLUMN implement_count INTEGER
    CHECK ((load_convention = 'per-hand' AND implement_count IS NOT NULL AND implement_count IN (1, 2))
      OR (load_convention <> 'per-hand' AND implement_count IS NULL))`,
]);
