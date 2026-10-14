import { compareNotePositions, FormaError } from '@forma/core';
import type { NoteRecord, NotesReader, NotesStore, NotesWriter, RequestReceipt } from '@forma/core';
import { cloneValue } from './fixtures/contract-helpers.js';

export interface MemoryNotesState {
  notes: Map<string, NoteRecord>;
  reservedIds: Set<string>;
  receipts: Map<string, RequestReceipt>;
  revision: number;
}

/** A contract-test adapter. Retained state is not proof of durable storage. */
export class MemoryNotesStore implements NotesStore {
  readonly state: MemoryNotesState;
  writes = 0;
  saves = 0;
  closeCalls = 0;
  private tail: Promise<void> = Promise.resolve();
  private accepting = true;
  private closePromise: Promise<void> | undefined;

  constructor(state?: MemoryNotesState) {
    this.state = state ?? { notes: new Map(), reservedIds: new Set(), receipts: new Map(), revision: 0 };
  }

  private view(writable: boolean): { writer: NotesWriter; expire(): void } {
    let active = true;
    const check = (write = false): void => {
      if (!active) throw new FormaError('STORAGE_FAILURE', 'The transaction view expired.');
      if (write && !writable) throw new FormaError('STORAGE_FAILURE', 'The view is read-only.');
    };
    return {
      expire: () => { active = false; },
      writer: {
        getNote: async (id) => { check(); return cloneValue(this.state.notes.get(id) ?? null); },
        hasNoteId: async (id) => { check(); return this.state.reservedIds.has(id); },
        getNotesHistoryRevision: async () => { check(); return this.state.revision; },
        getRequestReceipt: async (id) => { check(); return cloneValue(this.state.receipts.get(id) ?? null); },
        listNotes: async ({ filter, after, limit }) => {
          check();
          const candidates = [...this.state.notes.values()].filter((note) =>
            (filter.dateFrom === null || note.date >= filter.dateFrom)
            && (filter.dateTo === null || note.date <= filter.dateTo)
            && (filter.kind === null || note.kind === filter.kind)
            && (after === null || compareNotePositions(note, after) > 0))
            .sort(compareNotePositions).slice(0, limit + 1);
          return { items: cloneValue(candidates.slice(0, limit)), hasMore: candidates.length > limit };
        },
        saveNote: async (note) => {
          check(true);
          this.saves++;
          this.state.notes.set(note.id, cloneValue(note));
          this.state.reservedIds.add(note.id);
          this.state.revision++;
        },
        deleteNote: async (id) => {
          check(true);
          if (this.state.notes.delete(id)) this.state.revision++;
        },
        saveRequestReceipt: async (receipt) => {
          check(true);
          if (this.state.receipts.has(receipt.requestId)) throw new FormaError('CONFLICT', 'Duplicate receipt.');
          this.state.receipts.set(receipt.requestId, cloneValue(receipt));
        },
      },
    };
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new FormaError('SERVICE_CLOSED', 'The notes store is closed.'));
    const result = this.tail.then(run);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  read<T>(run: (reader: NotesReader) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const view = this.view(false);
      try { return await run(view.writer); }
      finally { view.expire(); }
    });
  }

  write<T>(run: (writer: NotesWriter) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      this.writes++;
      const before = {
        notes: new Map([...this.state.notes].map(([id, note]) => [id, cloneValue(note)])),
        reservedIds: new Set(this.state.reservedIds),
        receipts: new Map([...this.state.receipts].map(([id, receipt]) => [id, cloneValue(receipt)])),
        revision: this.state.revision,
      };
      const view = this.view(true);
      try { return await run(view.writer); }
      catch (cause) { Object.assign(this.state, before); throw cause; }
      finally { view.expire(); }
    });
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      this.closeCalls++;
      this.accepting = false;
      this.closePromise = this.tail;
    }
    return this.closePromise;
  }
}
