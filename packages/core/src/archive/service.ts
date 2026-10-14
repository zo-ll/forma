import { FormaError } from '../errors.js';
import type { Clock, WorkoutReader, WorkoutStore } from '../ports.js';
import { canonicalJson, withRequest } from '../requests/service.js';
import type { ArchiveApi } from '../types.js';
import { identifier, objectInput, utcTimestamp } from '../validation.js';
import { ARCHIVE_MODULES, checkCounts, parseArchive, serializeArchive } from './format.js';
import type { ParsedArchive } from './format.js';
import { archiveDigest, historyRevision, restoreResult } from './receipts.js';

/** One restore at a time. While it is active, every new service operation fails. */
export interface RestoreExclusion {
  /** The store for public APIs. New operations fail with CONFLICT on restore during a restore. */
  readonly store: WorkoutStore;
  ensureAvailable(): void;
  invalidateDerived(): void;
  begin(): void;
  end(): void;
}

function restoreConflict(): FormaError {
  return new FormaError('CONFLICT', 'A restore is running. Try again after it ends.', { field: 'restore' });
}

export function createRestoreExclusion(store: WorkoutStore, onBegin: () => void = () => undefined): RestoreExclusion {
  let active = false;
  return {
    store: {
      read: (run) => active ? Promise.reject(restoreConflict()) : store.read(run),
      write: (run) => active ? Promise.reject(restoreConflict()) : store.write(run),
      close: () => store.close(),
    },
    ensureAvailable() { if (active) throw restoreConflict(); },
    invalidateDerived: onBegin,
    begin() {
      if (active) throw restoreConflict();
      active = true;
    },
    end() { active = false; },
  };
}

/** The catalog is read-only data. Exact equality, including order, keeps every current catalog row. */
async function requireCatalog(reader: WorkoutReader, archive: ParsedArchive): Promise<void> {
  const exercises = await reader.listExercises();
  const splitDays = await reader.listSplitDays();
  if (canonicalJson(exercises) !== canonicalJson(archive.exercises) || canonicalJson(splitDays) !== canonicalJson(archive.splitDays)) {
    throw new FormaError('INVALID_INPUT', 'The archive catalog does not match the catalog of this app.', { field: 'archive.catalog' });
  }
}

export function createArchiveApi(
  store: WorkoutStore, exclusion: RestoreExclusion, clock: Clock, ensureOpen: () => void,
): ArchiveApi {
  return {
    async export() {
      ensureOpen();
      const createdAt = utcTimestamp(clock.nowUtc());
      const content = await exclusion.store.read(async (reader) => {
        // Check the budget before the read materializes the records.
        checkCounts(await reader.countArchiveRecords());
        return {
          createdAt, exercises: await reader.listExercises(), splitDays: await reader.listSplitDays(),
          workouts: await reader.listWorkouts({}), receipts: await reader.listRequestReceipts(), notes: await reader.readArchiveNotes(),
        };
      });
      const { text, digest } = serializeArchive(content);
      let parsed: ParsedArchive;
      try { parsed = parseArchive(text); }
      catch (cause) {
        if (cause instanceof FormaError && cause.field === 'archive.size') throw cause;
        // The export never omits a record. Stored data that fails the archive rules stops the export.
        throw new FormaError('STORAGE_FAILURE', 'The stored records cannot form a valid archive.', {
          field: (cause instanceof FormaError ? cause.field : undefined) ?? 'archive', cause,
        });
      }
      return { text, byteLength: parsed.byteLength, digest, createdAt, counts: parsed.counts };
    },

    async inspect(input) {
      ensureOpen();
      objectInput(input, ['text']);
      const archive = parseArchive(input.text);
      return exclusion.store.read(async (reader) => {
        await requireCatalog(reader, archive);
        const current = await reader.countArchiveRecords();
        const currentHistoryRevision = await reader.getArchiveRevision();
        return {
          digest: archive.digest, formatVersion: archive.formatVersion, missingModules: archive.missingModules, createdAt: archive.createdAt, byteLength: archive.byteLength,
          modules: ARCHIVE_MODULES.filter(name => !archive.missingModules.includes(name)), archive: archive.counts, current, currentHistoryRevision,
        };
      });
    },

    async restore(input) {
      ensureOpen();
      objectInput(input, ['requestId', 'text', 'expectedDigest', 'expectedHistoryRevision']);
      const requestId = identifier(input.requestId, 'requestId');
      const expectedDigest = archiveDigest(input.expectedDigest, 'expectedDigest');
      const expectedHistoryRevision = historyRevision(input.expectedHistoryRevision, 'expectedHistoryRevision');
      const archive = parseArchive(input.text);
      if (archive.digest !== expectedDigest) {
        throw new FormaError('CONFLICT', 'The archive differs from the confirmed archive.', { field: 'expectedDigest' });
      }
      if (archive.receipts.some((receipt) => receipt.requestId === requestId)) {
        throw new FormaError('CONFLICT', 'The archive already contains this requestId.', { field: 'requestId' });
      }
      // Begin and queue in one synchronous step. Accepted operations drain first in the store FIFO.
      exclusion.begin();
      try {
        const pending = withRequest(store, requestId, 'archive.restore', { digest: archive.digest, expectedHistoryRevision },
          restoreResult, async (writer) => {
            if (await writer.getArchiveRevision() !== expectedHistoryRevision) {
              throw new FormaError('CONFLICT', 'The records changed after the inspection. Inspect the archive again.', {
                field: 'expectedHistoryRevision',
              });
            }
            await requireCatalog(writer, archive);
            await writer.replaceArchiveRecords({ workouts: archive.workouts, receipts: archive.receipts, notes: archive.notes });
            return { digest: archive.digest, counts: archive.counts };
          });
        // Queue the record write before cancellation listeners can re-enter close.
        exclusion.invalidateDerived();
        return await pending;
      } finally {
        exclusion.end();
      }
    },
  };
}
