import type { ConfirmNoteFieldsInput, NoteFieldConfirmation, NoteFieldsView } from './field-types.js';

export type NoteKind = 'general' | 'pain' | 'sleep' | 'personal-best';

export interface NoteSource {
  readonly module: 'notes';
  readonly noteId: string;
  readonly revision: number;
}

export interface NoteRecord {
  readonly id: string;
  readonly date: string;
  readonly text: string;
  readonly kind: NoteKind;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Note extends NoteRecord {
  readonly source: NoteSource;
}

export interface CreateNoteInput {
  readonly requestId: string;
  readonly date: string;
  readonly text: string;
  readonly kind?: NoteKind;
}

export interface NoteCommandInput {
  readonly requestId: string;
  readonly noteId: string;
  readonly expectedRevision: number;
}

export interface UpdateNoteInput extends NoteCommandInput {
  readonly date?: string;
  readonly text?: string;
  readonly kind?: NoteKind;
}

export interface NoteHistoryInput {
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly kind?: NoteKind;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface NoteHistoryFilter {
  readonly dateFrom: string | null;
  readonly dateTo: string | null;
  readonly kind: NoteKind | null;
}

export interface NotePosition {
  readonly id: string;
  readonly date: string;
  readonly createdAt: string;
}

export interface NoteHistoryPage {
  readonly items: readonly Note[];
  readonly filter: NoteHistoryFilter;
  readonly revision: number;
  readonly nextCursor: string | null;
}

export interface NotesApi {
  create(input: CreateNoteInput): Promise<Note>;
  get(noteId: string): Promise<Note>;
  update(input: UpdateNoteInput): Promise<Note>;
  delete(input: NoteCommandInput): Promise<void>;
  history(input?: NoteHistoryInput): Promise<NoteHistoryPage>;
  fields(noteId: string): Promise<NoteFieldsView>;
  confirmFields(input: ConfirmNoteFieldsInput): Promise<NoteFieldConfirmation>;
}

export interface NotesModule {
  readonly notes: NotesApi;
  close(): Promise<void>;
}
