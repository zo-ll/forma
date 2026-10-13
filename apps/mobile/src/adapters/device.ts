import {FormaError} from '@forma/core';
import NativeDevice from '../native/NativeFormaDevice';
import {nativeArchiveFailure} from '../archive/flow';
import type {ArchiveFiles, OpenResult, SaveResult} from '../archive/flow';

function fileFailure(error: unknown): FormaError {
  const failure = nativeArchiveFailure(error);
  return new FormaError(failure.code as FormaError['code'], failure.message,
    failure.field === null ? {cause: error} : {field: failure.field, cause: error});
}

/** Archive files through the system pickers. Native URIs never reach JavaScript. */
const files: ArchiveFiles = {
  async saveArchive(text, suggestedName) {
    let result: Awaited<ReturnType<typeof NativeDevice.saveArchive>>;
    try {result = await NativeDevice.saveArchive(text, suggestedName);} catch (error) {throw fileFailure(error);}
    const status = result.status === 'saved' || result.status === 'cancelled' ? result.status : 'failed';
    return {status, byteLength: result.byteLength, partialFileRemoved: result.partialFileRemoved} satisfies SaveResult;
  },
  async openArchive(maxBytes) {
    let result: Awaited<ReturnType<typeof NativeDevice.openArchive>>;
    try {result = await NativeDevice.openArchive(maxBytes);} catch (error) {throw fileFailure(error);}
    if (result.status === 'opened' && typeof result.text === 'string') return {status: 'opened', text: result.text} satisfies OpenResult;
    return {status: 'cancelled', text: null};
  },
};

export const deviceAdapters = {
  platform: {timeZone: () => NativeDevice.deviceTimeZone(), nowUtc: () => new Date().toISOString()},
  clock: {nowUtc: () => new Date().toISOString()},
  ids: {next: () => NativeDevice.newId()},
  preferences: {
    read: () => NativeDevice.readPreferences(),
    write(serialized: string) {
      if (!NativeDevice.writePreferences(serialized)) throw new FormaError('STORAGE_FAILURE', 'The preference save is unconfirmed. Stored values may have changed. Restart the app to read them.');
    },
  },
  isHostGate: () => NativeDevice.isHostGate(),
  files,
  gateSnapshots: {read: () => NativeDevice.readGateSnapshot(), write: (value: string) => NativeDevice.writeGateSnapshot(value)},
};
