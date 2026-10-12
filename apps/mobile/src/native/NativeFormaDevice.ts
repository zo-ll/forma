import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export interface Spec extends TurboModule {
  newId(): string;
  deviceTimeZone(): string;
  readPreferences(): string | null;
  writePreferences(value: string): boolean;
  isHostGate(): boolean;
}
export default TurboModuleRegistry.getEnforcing<Spec>('FormaDevice');
