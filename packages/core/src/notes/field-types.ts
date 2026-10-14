import type { NoteCommandInput, NoteSource } from './types.js';

export type BodyPart = 'neck' | 'shoulder' | 'upper-arm' | 'elbow' | 'forearm' | 'wrist'
  | 'hand' | 'upper-back' | 'lower-back' | 'hip' | 'thigh' | 'knee' | 'calf' | 'ankle' | 'foot' | 'other';
export type BodySide = 'left' | 'right' | 'bilateral' | 'unspecified';
export type PainState = 'present' | 'absent' | 'uncertain';
export type SleepQuality = 'poor' | 'fair' | 'good';

export interface PainField {
  readonly bodyPart: BodyPart;
  readonly otherBodyPart: string | null;
  readonly side: BodySide;
  readonly state: PainState;
  readonly severity: number | null;
}
export interface SleepField {
  readonly durationMin: number | null;
  readonly quality: SleepQuality | null;
}
export interface PersonalBestField {
  readonly claimText: string;
}
export interface NoteFields {
  readonly pain: readonly PainField[];
  readonly sleep: SleepField | null;
  readonly personalBest: PersonalBestField | null;
}
export interface ConfirmNoteFieldsInput extends NoteCommandInput {
  readonly fields: NoteFields;
}
export interface NoteFieldConfirmation {
  readonly formatVersion: 1;
  readonly source: NoteSource;
  readonly confirmedAt: string;
  readonly fields: NoteFields;
}
export interface TextEvidence {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}
export type SuggestionReason = 'explicit-pain' | 'explicit-absence' | 'body-part-only'
  | 'ambiguous-context' | 'explicit-sleep' | 'personal-best-claim';
export interface FieldSuggestion<T> {
  readonly status: 'pending' | 'uncertain';
  readonly value: T | null;
  readonly reason: SuggestionReason;
  readonly evidence: TextEvidence;
}
export interface SuggestionGroup<T> {
  readonly state: 'missing' | 'pending' | 'uncertain';
  readonly items: readonly FieldSuggestion<T>[];
  readonly truncated: boolean;
}
export interface SuggestNoteFieldsInput {
  readonly source: NoteSource;
  readonly text: string;
}
export interface NoteFieldSuggestions {
  readonly source: NoteSource;
  readonly rulesVersion: 1;
  readonly rulesLanguage: 'en';
  readonly pain: SuggestionGroup<PainField>;
  readonly sleep: SuggestionGroup<SleepField>;
  readonly personalBest: SuggestionGroup<PersonalBestField>;
}
export interface NoteFieldsView {
  readonly source: NoteSource;
  readonly state: 'confirmed' | 'missing' | 'pending' | 'uncertain';
  readonly confirmation: NoteFieldConfirmation | null;
  readonly suggestions: NoteFieldSuggestions;
}
