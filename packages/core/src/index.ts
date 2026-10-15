export { createFormaService } from './service.js';
export { INFERENCE_LIMITS } from './inference/types.js';
export { createInferenceCancellation } from './inference/cancellation.js';
export { embeddingProfilesCompatible } from './inference/validation.js';
export type {
  EmbedInput, EmbedNoteInput, EmbeddingProfile, EmbeddingResult, GenerateNoteInput, GenerationProfile,
  GenerationResult, InferenceApi, InferenceCancellation, InferenceCancellationToken, InferenceCapabilities,
  InferenceCapability, InferenceRuntime, ModelProfile, RuntimeEmbedding, RuntimeGeneration, RuntimeIdentity,
  WeightQuantization,
} from './inference/types.js';
export { createNotesModule } from './notes/service.js';
export { NOTE_LIMITS } from './notes/validation.js';
export { noteFieldConfirmationResult, validateNoteFields } from './notes/field-validation.js';
export { noteFromRecord } from './notes/validation.js';
export { BODY_PARTS, NOTE_FIELD_LIMITS } from './notes/field-validation.js';
export { suggestNoteFields } from './notes/field-rules.js';
export type {
  BodyPart, BodySide, ConfirmNoteFieldsInput, FieldSuggestion, NoteFieldConfirmation, NoteFields,
  NoteFieldsView, NoteFieldSuggestions, PainField, PainState, PersonalBestField, SleepField,
  SleepQuality, SuggestionGroup, SuggestionReason, SuggestNoteFieldsInput, TextEvidence,
} from './notes/field-types.js';
export { compareNotePositions } from './notes/history.js';
export type {
  CreateNoteInput, Note, NoteCommandInput, NoteHistoryFilter, NoteHistoryInput, NoteHistoryPage,
  NoteKind, NotePosition, NoteRecord, NoteSource, NoteSearchInput, NoteSearchFilter, NoteSearchPage, NotesApi, NotesModule, UpdateNoteInput,
} from './notes/types.js';
export type {
  NotesDependencies, NotesReader, NotesSearchQuery, NotesStore, NotesStorePage, NotesStoreQuery, NotesWriter,
} from './notes/ports.js';
export { FormaError } from './errors.js';
export type { FormaErrorCode } from './errors.js';
export { DEFAULT_EXERCISES, DEFAULT_SPLIT_DAYS } from './catalog.js';
export { normalizeExerciseAlias } from './validation.js';
export { resolveCalendarRange } from './calendar.js';
export type { CalendarPeriod, CalendarRange, CalendarRangeInput } from './calendar.js';
export { calculateSetLoad, compareSetLoads, validateSetLoadDetails } from './workouts/loads.js';
export type { SetLoadFact } from './workouts/loads.js';
export { validateWorkoutSession } from './workouts/session.js';
export { WORKOUT_HISTORY_LIMITS } from './workouts/history-limits.js';
export { compareHistoryPositions } from './workouts/history-order.js';
export type {
  CountFact, HistoryFilter, HistoryPosition, HistoryStorePage, HistoryStoreQuery, LoadStatisticsGroup,
  PreviousSetsInput, PreviousSetsResult, SetSource, WorkoutHistoryApi, WorkoutHistoryInput,
  WorkoutHistoryPage, WorkoutSource, WorkoutStatistics, WorkoutStatisticsInput,
} from './workouts/history-types.js';
export { withRequest } from './requests/service.js';
export { ARCHIVE_FORMAT_VERSION, ARCHIVE_LIMITS } from './archive/format.js';
export { sha256Utf8 } from './archive/sha256.js';
export type { ResultCodec } from './requests/service.js';
export type {
  ArchiveNotesRecords, ArchiveRecords, Clock, FormaDependencies, IdGenerator, RequestReader, RequestReceipt, RequestWriter,
  WorkoutReader, WorkoutStore, WorkoutWriter,
} from './ports.js';
export type {
  ArchiveApi, ArchiveCounts, ArchiveExport, ArchiveInspection, ArchiveRestoreResult, InspectArchiveInput, RestoreArchiveInput,
  AddSetInput, CreateWorkoutInput, DeleteSetInput, Exercise, ExerciseApi, FormaService,
  ListWorkoutsInput, LoadConvention, SetLoadDetails, UpdateSetInput, UpdateWorkoutInput, Workout,
  WorkoutApi, WorkoutCommandInput, WorkoutSessionDetails, WorkoutStatus, SplitDay, SplitDayApi, WorkoutSet,
} from './types.js';
