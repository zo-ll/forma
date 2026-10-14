import type { WorkoutHistoryApi } from './workouts/history-types.js';

export interface Exercise {
  readonly id: string;
  readonly name: string;
  readonly muscleGroup: string | null;
  readonly equipment: string | null;
  readonly aliases: readonly string[];
}

export interface SplitDay {
  readonly id: string;
  readonly name: string;
  readonly exerciseIds: readonly string[];
}

export type LoadConvention = 'unknown' | 'entered' | 'per-hand' | 'combined' | 'body-weight';

export interface SetLoadDetails {
  readonly loadConvention: LoadConvention;
  readonly implementCount: 1 | 2 | null;
}

export interface WorkoutSet extends SetLoadDetails {
  readonly id: string;
  readonly exerciseId: string;
  readonly reps: number;
  readonly weightKg: number;
  readonly rpe: number | null;
  readonly position: number;
}

export type WorkoutStatus = 'in-progress' | 'finished';

export interface WorkoutSessionDetails {
  readonly status: WorkoutStatus;
  readonly finishedAt: string | null;
}

export interface Workout extends WorkoutSessionDetails {
  readonly id: string;
  readonly date: string;
  readonly splitDayId: string | null;
  readonly notes: string;
  readonly durationMin: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sets: readonly WorkoutSet[];
}

export interface CreateWorkoutInput {
  readonly requestId: string;
  readonly date: string;
  readonly splitDayId?: string;
  readonly notes?: string;
  readonly durationMin?: number;
}

export interface WorkoutCommandInput {
  readonly requestId: string;
  readonly workoutId: string;
}

export interface UpdateWorkoutInput extends WorkoutCommandInput {
  readonly date?: string;
  readonly splitDayId?: string | null;
  readonly notes?: string;
  readonly durationMin?: number | null;
}

export interface AddSetInput {
  readonly requestId: string;
  readonly workoutId: string;
  readonly exerciseId: string;
  readonly reps: number;
  readonly weightKg: number;
  readonly loadConvention?: LoadConvention;
  readonly implementCount?: 1 | 2 | null;
  readonly rpe?: number;
}

export interface UpdateSetInput {
  readonly requestId: string;
  readonly workoutId: string;
  readonly setId: string;
  readonly exerciseId?: string;
  readonly reps?: number;
  readonly weightKg?: number;
  readonly loadConvention?: LoadConvention;
  readonly implementCount?: 1 | 2 | null;
  readonly rpe?: number | null;
}

export interface DeleteSetInput {
  readonly requestId: string;
  readonly workoutId: string;
  readonly setId: string;
}

export interface ListWorkoutsInput {
  readonly dateFrom?: string;
  readonly dateTo?: string;
}

export interface ExerciseApi {
  list(): Promise<readonly Exercise[]>;
  get(exerciseId: string): Promise<Exercise>;
  resolveAlias(alias: string): Promise<Exercise>;
}

export interface SplitDayApi {
  list(): Promise<readonly SplitDay[]>;
  get(splitDayId: string): Promise<SplitDay>;
}

export interface WorkoutApi extends WorkoutHistoryApi {
  create(input: CreateWorkoutInput): Promise<Workout>;
  start(input: CreateWorkoutInput): Promise<Workout>;
  inProgress(): Promise<Workout | null>;
  resume(workoutId: string): Promise<Workout>;
  finish(input: WorkoutCommandInput): Promise<Workout>;
  update(input: UpdateWorkoutInput): Promise<Workout>;
  delete(input: WorkoutCommandInput): Promise<void>;
  discard(input: WorkoutCommandInput): Promise<void>;
  addSet(input: AddSetInput): Promise<WorkoutSet>;
  updateSet(input: UpdateSetInput): Promise<WorkoutSet>;
  deleteSet(input: DeleteSetInput): Promise<void>;
  get(workoutId: string): Promise<Workout>;
  list(input?: ListWorkoutsInput): Promise<readonly Workout[]>;
}

export interface ArchiveCounts {
  readonly workouts: number;
  readonly sets: number;
  readonly receipts: number;
  readonly inProgress: number;
}

export interface ArchiveExport {
  readonly text: string;
  readonly byteLength: number;
  readonly digest: string;
  readonly createdAt: string;
  readonly counts: ArchiveCounts;
}

export interface InspectArchiveInput {
  readonly text: string;
}

export interface ArchiveInspection {
  readonly digest: string;
  readonly formatVersion: 1;
  readonly createdAt: string;
  readonly byteLength: number;
  readonly modules: readonly string[];
  readonly archive: ArchiveCounts;
  readonly current: ArchiveCounts;
  readonly currentHistoryRevision: number;
}

export interface RestoreArchiveInput {
  readonly requestId: string;
  readonly text: string;
  readonly expectedDigest: string;
  readonly expectedHistoryRevision: number;
}

export interface ArchiveRestoreResult {
  readonly digest: string;
  readonly counts: ArchiveCounts;
}

/** Plaintext local archives. Restore is full replacement after explicit confirmation. */
export interface ArchiveApi {
  export(): Promise<ArchiveExport>;
  inspect(input: InspectArchiveInput): Promise<ArchiveInspection>;
  restore(input: RestoreArchiveInput): Promise<ArchiveRestoreResult>;
}

export interface FormaService {
  readonly notes: import('./notes/types.js').NotesApi;
  readonly exercises: ExerciseApi;
  readonly splitDays: SplitDayApi;
  readonly workouts: WorkoutApi;
  readonly archive: ArchiveApi;
  close(): Promise<void>;
}
