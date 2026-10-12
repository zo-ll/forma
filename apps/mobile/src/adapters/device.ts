import {FormaError} from '@forma/core';
import NativeDevice from '../native/NativeFormaDevice';

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
  gateSnapshots: {read: () => NativeDevice.readGateSnapshot(), write: (value: string) => NativeDevice.writeGateSnapshot(value)},
};
