// Persist the imported model path and the selected backend.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BackendName, ImportedModel } from './types';

const STORAGE_KEY = 'forma.validation.model.v1';

export type StoredModel = ImportedModel & {
  backend: BackendName;
};

export async function loadStoredModel(): Promise<StoredModel | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredModel>;
    if (
      typeof parsed.path !== 'string' ||
      typeof parsed.fileName !== 'string' ||
      typeof parsed.sizeBytes !== 'number' ||
      typeof parsed.importId !== 'string'
    ) {
      return null;
    }
    return {
      path: parsed.path,
      fileName: parsed.fileName,
      sizeBytes: parsed.sizeBytes,
      importId: parsed.importId,
      backend: parsed.backend === 'GPU' ? 'GPU' : 'CPU',
    };
  } catch {
    return null;
  }
}

export async function saveStoredModel(model: StoredModel): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(model));
}

export async function clearStoredModel(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
