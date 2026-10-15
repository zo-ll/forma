import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/** Model documents and private destination paths stay native. These are JSON DTOs, not engine handles. */
export interface Spec extends TurboModule {
  modelStatus(): Promise<string>;
  importModel(artifactId: string, requestId: string): Promise<string>;
  cancelModelImport(requestId: string): Promise<boolean>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('FormaModels');
