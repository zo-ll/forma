import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export interface Spec extends TurboModule {
  newId(): string;
  deviceTimeZone(): string;
  readPreferences(): string | null;
  writePreferences(value: string): boolean;
  isHostGate(): boolean;
  readGateSnapshot(): string | null;
  writeGateSnapshot(value: string): boolean;
  /** Opens the system create-document picker. The URI stays native. */
  saveArchive(text: string, suggestedName: string): Promise<{status: string; byteLength: number; partialFileRemoved: boolean}>;
  /** Opens the system open-document picker and reads at most maxBytes as strict UTF-8. */
  openArchive(maxBytes: number): Promise<{status: string; text: string | null; byteLength: number}>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('FormaDevice');
