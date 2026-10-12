/** A historical record is finished, but its actual finish instant is not known. */
export const SCHEMA_V4: readonly string[] = Object.freeze([
  `ALTER TABLE workouts ADD COLUMN status TEXT NOT NULL DEFAULT 'finished'
    CHECK (status IN ('in-progress', 'finished'))`,
  `ALTER TABLE workouts ADD COLUMN finished_at TEXT
    CHECK (status = 'finished' OR finished_at IS NULL)`,
  `CREATE UNIQUE INDEX workouts_one_in_progress ON workouts(status) WHERE status = 'in-progress'`,
]);
