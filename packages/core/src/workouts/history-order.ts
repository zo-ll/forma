import type { HistoryPosition } from './history-types.js';

/** Valid Unicode code-point order matches UTF-8 SQLite BINARY collation. */
function compareIds(a: string, b: string): number {
  const left = a[Symbol.iterator]();
  const right = b[Symbol.iterator]();
  for (;;) {
    const x = left.next(); const y = right.next();
    if (x.done || y.done) return x.done ? (y.done ? 0 : -1) : 1;
    const delta = x.value.codePointAt(0)! - y.value.codePointAt(0)!;
    if (delta !== 0) return delta;
  }
}

export function compareHistoryPositions(a: HistoryPosition, b: HistoryPosition): number {
  return a.date < b.date ? 1 : a.date > b.date ? -1
    : a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : compareIds(a.id, b.id);
}
