import { FormaError } from '../errors.js';
import type { WorkoutStore } from '../ports.js';
import type { WorkoutGroupApi } from '../types.js';
import { identifier } from '../validation.js';

export function createGroupApi(store: WorkoutStore, ensureOpen: () => void): WorkoutGroupApi {
  return {
    async list() {
      ensureOpen();
      return store.read((reader) => reader.listGroups());
    },
    async get(groupId) {
      ensureOpen();
      identifier(groupId, 'groupId');
      return store.read(async (reader) => {
        const group = await reader.getGroup(groupId);
        if (!group) throw new FormaError('NOT_FOUND', 'The workout group does not exist.', { field: 'groupId' });
        return group;
      });
    },
  };
}
