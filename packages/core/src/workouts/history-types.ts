import type { Workout, WorkoutSet, WorkoutStatus } from '../types.js';

export interface HistoryFilter {
  readonly dateFrom: string | null;
  readonly dateTo: string | null;
  readonly exerciseId: string | null;
  readonly status: WorkoutStatus | 'all';
}
export interface HistoryPosition {
  readonly date: string;
  readonly createdAt: string;
  readonly id: string;
}
export interface HistoryStoreQuery {
  readonly filter: HistoryFilter;
  readonly after: HistoryPosition | null;
  readonly limit: number;
  /** Matching mode returns only the exercise's sets; never save those query rows as whole workouts. */
  readonly sets: 'all' | 'matching';
}
export interface HistoryStorePage {
  readonly items: readonly Workout[];
  readonly hasMore: boolean;
}
export interface WorkoutHistoryInput {
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly exerciseId?: string;
  readonly status?: WorkoutStatus | 'all';
  readonly limit?: number;
  readonly cursor?: string;
}
export interface WorkoutHistoryPage {
  readonly items: readonly Workout[];
  readonly nextCursor: string | null;
  readonly filter: HistoryFilter;
  readonly revision: number;
}
export interface PreviousSetsInput {
  readonly exerciseId: string;
  readonly beforeDate: string;
}
export interface PreviousSetsResult {
  readonly exerciseId: string;
  readonly beforeDate: string;
  readonly revision: number;
  readonly workout: { readonly id: string; readonly date: string; readonly updatedAt: string } | null;
  readonly sets: readonly WorkoutSet[];
}
export interface WorkoutStatisticsInput {
  readonly exerciseId: string;
  readonly dateFrom: string;
  readonly dateTo: string;
}
export interface WorkoutSource {
  readonly module: 'workouts';
  readonly workoutId: string;
  readonly date: string;
  readonly workoutUpdatedAt: string;
  readonly historyRevision: number;
}
export interface SetSource extends WorkoutSource {
  readonly setId: string;
}
export interface CountFact<S> {
  readonly value: number;
  readonly unit: 'workouts' | 'sets';
  readonly sources: readonly S[];
}
export interface LoadStatisticsGroup {
  readonly convention: 'entered' | 'combined';
  readonly volume: { readonly value: number; readonly unit: 'kg·rep'; readonly sources: readonly SetSource[] };
  readonly bestLoad: { readonly value: number; readonly unit: 'kg'; readonly sources: readonly SetSource[] };
  readonly bestReps: readonly {
    readonly loadKg: number; readonly value: number; readonly unit: 'reps'; readonly sources: readonly SetSource[];
  }[];
}
export interface WorkoutStatistics {
  readonly exerciseId: string;
  readonly dateContext: { readonly dateFrom: string; readonly dateTo: string; readonly semantics: 'saved-workout-date' };
  readonly revision: number;
  readonly workoutCount: CountFact<WorkoutSource>;
  readonly setCount: CountFact<SetSource>;
  readonly groups: readonly LoadStatisticsGroup[];
  readonly excluded: readonly {
    readonly reason: 'unknown' | 'body-weight';
    readonly count: CountFact<SetSource>;
  }[];
}
export interface WorkoutHistoryApi {
  history(input?: WorkoutHistoryInput): Promise<WorkoutHistoryPage>;
  previousSets(input: PreviousSetsInput): Promise<PreviousSetsResult>;
  statistics(input: WorkoutStatisticsInput): Promise<WorkoutStatistics>;
}
