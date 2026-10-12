// One statement permits the same migration through synchronous mobile bindings.
export const SCHEMA_V2 = `
CREATE TABLE request_receipts (
  request_id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  input_signature TEXT NOT NULL,
  result_json TEXT NOT NULL,
  format_version INTEGER NOT NULL CHECK (format_version = 1)
) STRICT
`;
