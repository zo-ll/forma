import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/** Explicit local inference only. SDK objects and private paths stay native. */
export interface Spec extends TurboModule {
  openInference(ownerId: string): Promise<void>;
  runInference(ownerId: string, sequence: number, request: string): Promise<string>;
  cancelInference(ownerId: string, sequence: number): Promise<boolean>;
  closeInference(ownerId: string): Promise<void>;
}
export default TurboModuleRegistry.get<Spec>('FormaInference');
