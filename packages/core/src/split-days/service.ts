import { FormaError } from '../errors.js';
import type { WorkoutStore } from '../ports.js';
import type { SplitDayApi } from '../types.js';
import { identifier } from '../validation.js';

export function createSplitDayApi(store: WorkoutStore, ensureOpen: () => void): SplitDayApi {
  return {
    async list() {
      ensureOpen();
      return store.read((reader) => reader.listSplitDays());
    },
    async get(splitDayId) {
      ensureOpen();
      identifier(splitDayId, 'splitDayId');
      return store.read(async (reader) => {
        const splitDay = await reader.getSplitDay(splitDayId);
        if (!splitDay) throw new FormaError('NOT_FOUND', 'The split day does not exist.', { field: 'splitDayId' });
        return splitDay;
      });
    },
  };
}
