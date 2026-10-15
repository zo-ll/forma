import type {ModelFiles} from '@forma/mobile-host';
import NativeModels from '../native/NativeFormaModels';

/** The controller validates every JSON DTO. No document URI or private path reaches this adapter. */
export const modelFiles: ModelFiles = {
  status: async () => JSON.parse(await NativeModels.modelStatus()) as unknown,
  importFile: async (artifactId, requestId) => JSON.parse(await NativeModels.importModel(artifactId, requestId)) as unknown,
  cancel: requestId => NativeModels.cancelModelImport(requestId),
};
