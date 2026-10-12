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
}
export default TurboModuleRegistry.getEnforcing<Spec>('FormaDevice');
