import { DEFAULT_EXERCISES, DEFAULT_SPLIT_DAYS, normalizeExerciseAlias } from '@forma/core';
import type { MigrationStatement, SqliteMigration } from './migrations.js';
import { SCHEMA_V1 } from './schema.js';
import { SCHEMA_V2 } from './schema-v2.js';
import { SCHEMA_V3 } from './schema-v3.js';
import { SCHEMA_V4 } from './schema-v4.js';
import { SCHEMA_V5 } from './schema-v5.js';

function initialCatalogStatements(): readonly MigrationStatement[] {
  const statements: MigrationStatement[] = [];
  DEFAULT_EXERCISES.forEach((exercise, position) => {
    statements.push({
      sql: 'INSERT INTO exercises (id, name, muscle_group, equipment, catalog_position) VALUES (?, ?, ?, ?, ?)',
      parameters: [exercise.id, exercise.name, exercise.muscleGroup, exercise.equipment, position],
    });
    const names = new Map([exercise.name, ...exercise.aliases].map((name) => [normalizeExerciseAlias(name), name]));
    for (const [normalized, name] of names) {
      statements.push({
        sql: 'INSERT INTO exercise_aliases (normalized_alias, alias, exercise_id) VALUES (?, ?, ?)',
        parameters: [normalized, name, exercise.id],
      });
    }
  });
  DEFAULT_SPLIT_DAYS.forEach((splitDay, position) => {
    statements.push({
      sql: 'INSERT INTO workout_groups (id, name, catalog_position) VALUES (?, ?, ?)',
      parameters: [splitDay.id, splitDay.name, position],
    });
    splitDay.exerciseIds.forEach((exerciseId, exercisePosition) => {
      statements.push({
        sql: 'INSERT INTO workout_group_exercises (group_id, exercise_id, position) VALUES (?, ?, ?)',
        parameters: [splitDay.id, exerciseId, exercisePosition],
      });
    });
  });
  return statements;
}

// Released SQL and seed values remain unchanged. Append a version for each future schema change.
export const SQLITE_MIGRATIONS: readonly SqliteMigration[] = Object.freeze([
  Object.freeze({
    version: 1,
    name: 'Create the workout schema and initial catalog',
    // Version 1 contains DDL only. Future entries declare one complete SQL statement per item.
    statements: Object.freeze([
      ...SCHEMA_V1.split(';').map((sql) => sql.trim()).filter(Boolean).map((sql) => ({ sql })),
      ...initialCatalogStatements(),
    ].map((statement: MigrationStatement) => Object.freeze({
      ...statement,
      ...(statement.parameters === undefined ? {} : { parameters: Object.freeze([...statement.parameters]) }),
    }))),
  }),
  Object.freeze({
    version: 2,
    name: 'Add persistent command receipts',
    statements: Object.freeze([Object.freeze({ sql: SCHEMA_V2 })]),
  }),
  Object.freeze({
    version: 3,
    name: 'Add explicit set load conventions',
    statements: Object.freeze(SCHEMA_V3.map((sql) => Object.freeze({ sql }))),
  }),
  Object.freeze({
    version: 4,
    name: 'Add persisted workout session states',
    statements: Object.freeze(SCHEMA_V4.map((sql) => Object.freeze({ sql }))),
  }),
  Object.freeze({
    version: 5,
    name: 'Track primary history changes for stable pagination',
    statements: Object.freeze(SCHEMA_V5.map((sql) => Object.freeze({ sql }))),
  }),
]);

export const SCHEMA_VERSION = SQLITE_MIGRATIONS.length;
