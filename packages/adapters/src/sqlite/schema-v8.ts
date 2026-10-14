/** A separate persistent token protects archive confirmation across every module. */
export const SCHEMA_V8: readonly string[] = Object.freeze([
  `CREATE TABLE archive_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991)
  ) STRICT`,
  `INSERT INTO archive_state (id, revision) SELECT 1,
    (SELECT revision FROM workout_history_state WHERE id = 1) +
    (SELECT revision FROM notes_history_state WHERE id = 1)`,
  ...['workouts', 'sets', 'notes', 'note_ids', 'note_confirmations', 'request_receipts'].flatMap((table) =>
    ['INSERT', 'UPDATE', 'DELETE'].map((operation) =>
      `CREATE TRIGGER archive_${table}_${operation.toLowerCase()} AFTER ${operation} ON ${table}
      BEGIN UPDATE archive_state SET revision = revision + 1 WHERE id = 1; END`)),
]);
