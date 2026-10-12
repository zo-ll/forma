// Released version 1 SQL remains unchanged. Add later versions to the migration registry.
// SQL and schema changes belong to the storage adapter, not the core.
export const SCHEMA_V1 = `
CREATE TABLE exercises (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  muscle_group TEXT,
  equipment TEXT,
  catalog_position INTEGER NOT NULL UNIQUE CHECK (catalog_position >= 0)
) STRICT;

CREATE TABLE exercise_aliases (
  normalized_alias TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  exercise_id TEXT NOT NULL REFERENCES exercises(id)
) STRICT;

CREATE TABLE workout_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  catalog_position INTEGER NOT NULL UNIQUE CHECK (catalog_position >= 0)
) STRICT;

CREATE TABLE workout_group_exercises (
  group_id TEXT NOT NULL REFERENCES workout_groups(id),
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (group_id, position),
  UNIQUE (group_id, exercise_id)
) STRICT;

CREATE TABLE workouts (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  group_id TEXT REFERENCES workout_groups(id),
  notes TEXT NOT NULL,
  duration_min REAL CHECK (duration_min >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE sets (
  id TEXT PRIMARY KEY,
  workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  reps INTEGER NOT NULL CHECK (reps > 0),
  weight_kg REAL NOT NULL CHECK (weight_kg >= 0),
  rpe REAL CHECK (rpe >= 1 AND rpe <= 10),
  position INTEGER NOT NULL CHECK (position >= 0),
  UNIQUE (workout_id, position)
) STRICT;

CREATE INDEX workouts_date ON workouts(date DESC, created_at DESC, id);
CREATE INDEX sets_exercise ON sets(exercise_id, workout_id);
`;
