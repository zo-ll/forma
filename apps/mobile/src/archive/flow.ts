/**
 * Archive export and restore steps for the Settings screen. This module has
 * no imports, so the Node suite and the React Native bundle use the same file.
 *
 * It owns the order of warnings, pickers, previews, and confirmations.
 * It owns no archive rule: the core validates every archive again.
 */

export interface ArchiveCountsView {
  readonly workouts: number;
  readonly sets: number;
  readonly receipts: number;
  readonly inProgress: number;
}

export interface ArchivePreview {
  readonly digest: string;
  readonly createdAt: string;
  readonly byteLength: number;
  readonly archive: ArchiveCountsView;
  readonly current: ArchiveCountsView;
  readonly currentHistoryRevision: number;
}

export interface RestoreCommand {
  readonly text: string;
  readonly expectedDigest: string;
  readonly expectedHistoryRevision: number;
}

/** The structural part of the core archive API that the flow uses. */
export interface ArchiveService {
  readonly archive: {
    export(): Promise<{readonly text: string; readonly byteLength: number; readonly counts: ArchiveCountsView}>;
    inspect(input: {text: string}): Promise<ArchivePreview>;
    restore(input: RestoreCommand & {requestId: string}): Promise<{readonly counts: ArchiveCountsView}>;
  };
}

export interface SaveResult {
  readonly status: 'saved' | 'cancelled' | 'failed';
  readonly byteLength: number;
  readonly partialFileRemoved: boolean;
}

export interface OpenResult {
  readonly status: 'opened' | 'cancelled';
  readonly text: string | null;
}

/** Native file access. URIs and handles stay in the native module. */
export interface ArchiveFiles {
  saveArchive(text: string, suggestedName: string): Promise<SaveResult>;
  openArchive(maxBytes: number): Promise<OpenResult>;
}

/** The structural part of the forms command ledger. */
export interface RestoreLedger {
  run<I, R>(slot: string, input: I, send: (requestId: string, input: I) => Promise<R>): Promise<R>;
  pending(slot: string): {readonly input: unknown; readonly unconfirmed: boolean} | null;
  forget(slot: string): void;
}

export interface ArchiveFlowDependencies {
  service(): ArchiveService;
  replaceRecords<T>(run: (service: ArchiveService) => Promise<T>): Promise<T>;
  readonly files: ArchiveFiles;
  /** A ledger that the app does not clear after a records change. */
  readonly restoreLedger: RestoreLedger;
  localDate(): string;
  readonly maxBytes: number;
}

export type ArchiveStep =
  | {readonly step: 'idle'}
  | {readonly step: 'exportWarning'}
  | {readonly step: 'busy'; readonly label: string}
  | {readonly step: 'restoreConfirm'; readonly preview: ArchivePreview; readonly changed: boolean}
  | {readonly step: 'unconfirmed'};

export interface ArchiveFlowState {
  readonly view: ArchiveStep;
  /** A result or failure message in plain text. */
  readonly notice: string | null;
}

export interface ArchiveFlow {
  state(): ArchiveFlowState;
  subscribe(listener: () => void): () => void;
  requestExport(): void;
  confirmExport(): Promise<void>;
  chooseArchive(): Promise<void>;
  confirmRestore(): Promise<void>;
  retryRestore(): Promise<void>;
  cancel(): void;
}

export const RESTORE_SLOT = 'archive.restore';

export const EXPORT_WARNING = [
  'The archive contains all your workout records in plain text.',
  'It also contains the saved command receipts. These receipts can contain data from deleted records.',
  'Forma does not encrypt the file. Any person or app with access to the file can read it.',
  'The checksum detects damage. It does not prove who made the file.',
].join(' ');

export const RESTORE_WARNING = [
  'Restore replaces all workouts, sets, and saved command receipts on this phone.',
  'Records that are not in the archive will be removed, including an active workout.',
  'Export the current records first if you need them.',
].join(' ');

const DEFINITIVE: ReadonlySet<string> = new Set(['INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'SERVICE_CLOSED']);

function details(error: unknown): {code: string | null; field: string | null; message: string} {
  const record = error !== null && typeof error === 'object' ? error as {code?: unknown; field?: unknown; message?: unknown} : {};
  return {
    code: typeof record.code === 'string' ? record.code : null,
    field: typeof record.field === 'string' ? record.field : null,
    message: typeof record.message === 'string' && record.message.length > 0 ? record.message : 'The operation failed.',
  };
}

function describe(error: unknown): string {
  const {code, field, message} = details(error);
  return (field ? field + ': ' : '') + message + (code ? ' (' + code + ')' : '');
}

function plural(count: number, word: string): string {
  return count + ' ' + word + (count === 1 ? '' : 's');
}

export function describeCounts(counts: ArchiveCountsView): string {
  return plural(counts.workouts, 'workout') + ', ' + plural(counts.sets, 'set') + ', ' + plural(counts.receipts, 'receipt')
    + (counts.inProgress > 0 ? ', 1 active workout' : '');
}

function isRestoreCommand(value: unknown): value is RestoreCommand {
  const record = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  return typeof record.text === 'string' && typeof record.expectedDigest === 'string'
    && typeof record.expectedHistoryRevision === 'number';
}

export function createArchiveFlow(deps: ArchiveFlowDependencies): ArchiveFlow {
  const listeners = new Set<() => void>();
  // A saved unconfirmed restore survives screen disposal in the ledger.
  let current: ArchiveFlowState = {
    view: deps.restoreLedger.pending(RESTORE_SLOT)?.unconfirmed ? {step: 'unconfirmed'} : {step: 'idle'},
    notice: deps.restoreLedger.pending(RESTORE_SLOT)?.unconfirmed
      ? 'An earlier restore has no confirmed result. Retry it, or cancel it.' : null,
  };
  let text: string | null = null;

  function set(view: ArchiveStep, notice: string | null): void {
    current = {view, notice};
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* A listener must not stop the flow. */ }
    }
  }

  async function preview(changed: boolean, archiveText: string): Promise<void> {
    set({step: 'busy', label: 'Checking the archive'}, null);
    try {
      const result = await deps.service().archive.inspect({text: archiveText});
      text = archiveText;
      set({step: 'restoreConfirm', preview: result, changed}, changed
        ? 'The records on this phone changed after the preview. Check the new preview and confirm again.' : null);
    } catch (error) {
      text = null;
      set({step: 'idle'}, 'The archive cannot be restored. ' + describe(error));
    }
  }

  async function send(command: RestoreCommand): Promise<void> {
    set({step: 'busy', label: 'Restoring'}, null);
    try {
      const result = await deps.restoreLedger.run(RESTORE_SLOT, command,
        (requestId, input) => deps.replaceRecords((service) => service.archive.restore({requestId, ...input})));
      text = null;
      set({step: 'idle'}, 'Restore finished: ' + describeCounts(result.counts) + '.');
    } catch (error) {
      const {code, field} = details(error);
      if (code === 'CONFLICT' && field === 'expectedHistoryRevision') {
        await preview(true, command.text);
        return;
      }
      if (code !== null && DEFINITIVE.has(code)) {
        // The core proved that nothing changed. A later restore is a new command.
        deps.restoreLedger.forget(RESTORE_SLOT);
        text = null;
        set({step: 'idle'}, 'Restore did not change the records. ' + describe(error));
        return;
      }
      set({step: 'unconfirmed'}, 'The restore result is not confirmed. The records can be old or restored. '
        + 'Retry the same restore to get a confirmed result. ' + describe(error));
    }
  }

  return {
    state: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    requestExport() {
      if (current.view.step === 'busy') return;
      set({step: 'exportWarning'}, null);
    },
    async confirmExport() {
      if (current.view.step !== 'exportWarning') return;
      set({step: 'busy', label: 'Exporting'}, null);
      try {
        const exported = await deps.service().archive.export();
        const saved = await deps.files.saveArchive(exported.text, 'forma-archive-' + deps.localDate() + '.json');
        if (saved.status === 'cancelled') {
          set({step: 'idle'}, 'Export cancelled. The records did not change. If the file app made an empty file, delete it.');
        } else if (saved.status === 'saved' && saved.byteLength === exported.byteLength) {
          set({step: 'idle'}, 'Archive saved: ' + describeCounts(exported.counts) + ', ' + exported.byteLength + ' bytes.');
        } else {
          set({step: 'idle'}, 'The archive file is not complete. The records did not change. '
            + (saved.partialFileRemoved ? 'Forma removed the incomplete file.' : 'An incomplete file can remain. Delete it in the file app.'));
        }
      } catch (error) {
        set({step: 'idle'}, 'Export failed. The records did not change. An incomplete file can remain. ' + describe(error));
      }
    },
    async chooseArchive() {
      if (current.view.step === 'busy' || current.view.step === 'unconfirmed') return;
      set({step: 'busy', label: 'Opening the archive'}, null);
      try {
        const opened = await deps.files.openArchive(deps.maxBytes);
        if (opened.status === 'cancelled' || opened.text === null) {
          set({step: 'idle'}, 'No archive selected. The records did not change.');
          return;
        }
        await preview(false, opened.text);
      } catch (error) {
        set({step: 'idle'}, 'The archive cannot be read. The records did not change. ' + describe(error));
      }
    },
    async confirmRestore() {
      const view = current.view;
      if (view.step !== 'restoreConfirm' || text === null) return;
      await send({text, expectedDigest: view.preview.digest, expectedHistoryRevision: view.preview.currentHistoryRevision});
    },
    async retryRestore() {
      const pending = deps.restoreLedger.pending(RESTORE_SLOT);
      if (current.view.step !== 'unconfirmed' || !pending || !isRestoreCommand(pending.input)) return;
      await send(pending.input);
    },
    cancel() {
      if (current.view.step === 'busy') return;
      if (current.view.step === 'unconfirmed') deps.restoreLedger.forget(RESTORE_SLOT);
      text = null;
      set({step: 'idle'}, null);
    },
  };
}

/** Native rejection codes from FormaDeviceModule and their typed meaning. */
export const NATIVE_ARCHIVE_FAILURES: Readonly<Record<string, {readonly code: string; readonly field: string | null; readonly message: string}>> = Object.freeze({
  FORMA_ARCHIVE_BUSY: {code: 'CONFLICT', field: 'archive.picker', message: 'Another file request is open.'},
  FORMA_ARCHIVE_TOO_LARGE: {code: 'INVALID_INPUT', field: 'archive.size', message: 'The file is larger than the archive limit.'},
  FORMA_ARCHIVE_UNREADABLE: {code: 'INVALID_INPUT', field: 'archive', message: 'The file is not readable UTF-8 text.'},
  FORMA_ARCHIVE_LIMIT: {code: 'INVALID_INPUT', field: 'maxBytes', message: 'The requested size limit is not supported.'},
});

export function nativeArchiveFailure(error: unknown): {code: string; field: string | null; message: string} {
  const code = error !== null && typeof error === 'object' ? (error as {code?: unknown}).code : undefined;
  const known = typeof code === 'string' && Object.hasOwn(NATIVE_ARCHIVE_FAILURES, code) ? NATIVE_ARCHIVE_FAILURES[code] : undefined;
  return known ? {...known} : {code: 'STORAGE_FAILURE', field: null, message: 'The file operation failed.'};
}
