/** History changes invalidate pagination cursors; rollbacks restore the prior revision. */
export const SCHEMA_V5: readonly string[] = Object.freeze([
  `CREATE TABLE workout_history_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL CHECK (revision >= 0 AND revision <= 9007199254740991)
  ) STRICT`,
  'INSERT INTO workout_history_state (id, revision) VALUES (1, 0)',
  ...['workouts', 'sets'].flatMap((table) => ['INSERT', 'UPDATE', 'DELETE'].map((operation) =>
    `CREATE TRIGGER history_${table}_${operation.toLowerCase()} AFTER ${operation} ON ${table}
      BEGIN UPDATE workout_history_state SET revision = revision + 1 WHERE id = 1; END`)),
  'CREATE INDEX workouts_history ON workouts(status, date DESC, created_at DESC, id)',
]);
