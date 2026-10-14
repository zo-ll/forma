import type {BodyPart, BodySide, Note, NoteFields, NoteKind, PainState, SleepQuality} from '@forma/core';

/**
 * Form state for the workout and notes screens. This module has no runtime imports, so the Node
 * suite and the React Native bundle use the same file.
 *
 * It owns request identity for UI commands and the parsing of typed text.
 * It owns no record rule: the core validates every value again and stays the
 * source of truth for ranges, dates, and load metadata.
 */

/** Keep each exercise's unconfirmed add separate within a workout. */
export function addSetSlot(workoutId: string, exerciseId: string): string {
  return `workout.addSet:${JSON.stringify([workoutId, exerciseId])}`;
}

export interface RequestIdSource {
  next(): string;
}

/** One saved command: the key and input exist before the first attempt. */
export interface PendingCommand<I> {
  readonly requestId: string;
  readonly input: I;
  readonly unconfirmed: boolean;
}

export interface CommandLedger {
  /**
   * Send one intended command. A repeated call for the same slot while an
   * attempt runs returns that attempt, so a double tap gives one result.
   * A retry after an unconfirmed failure reuses the saved key and input.
   */
  run<I, R>(slot: string, input: I, send: (requestId: string, input: I) => Promise<R>): Promise<R>;
  pending(slot: string): PendingCommand<unknown> | null;
  busy(slot: string): boolean;
  /** The running attempt for a slot, so a remounted screen can wait for it. */
  current<R>(slot: string): Promise<R> | null;
  forget(slot: string): void;
  /**
   * Drop every saved command after a records replacement. A running attempt
   * still settles for its caller, but it no longer owns a slot.
   */
  clear(): void;
}

/** Codes where the core proves that no record change and no receipt exist. */
const DEFINITIVE_REJECTIONS: ReadonlySet<string> = new Set(['INVALID_INPUT', 'NOT_FOUND', 'CONFLICT']);

function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object') return null;
  const code = (error as {code?: unknown}).code;
  return typeof code === 'string' ? code : null;
}

/** Stable text form of plain input, independent of property order. */
export function commandSignature(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return '[' + value.map(commandSignature).join(',') + ']';
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter(key => record[key] !== undefined).sort();
  return '{' + keys.map(key => JSON.stringify(key) + ':' + commandSignature(record[key])).join(',') + '}';
}

export function createCommandLedger(ids: RequestIdSource): CommandLedger {
  interface Entry {
    requestId: string;
    input: unknown;
    signature: string;
    unconfirmed: boolean;
    attempt: Promise<unknown> | null;
  }
  const entries = new Map<string, Entry>();

  function run<I, R>(slot: string, input: I, send: (requestId: string, input: I) => Promise<R>): Promise<R> {
    const existing = entries.get(slot);
    if (existing?.attempt) return existing.attempt as Promise<R>;
    const signature = commandSignature(input);
    // Same input after an unconfirmed failure: retry with the saved key.
    // Different input: a new intended command gets a new key.
    const entry: Entry = existing && existing.signature === signature
      ? existing
      : {requestId: ids.next(), input, signature, unconfirmed: false, attempt: null};
    entries.set(slot, entry);
    const savedInput = entry.input as I;
    const attempt = (async () => send(entry.requestId, savedInput))();
    entry.attempt = attempt;
    attempt.then(() => {
      if (entries.get(slot) === entry) entries.delete(slot);
    }, (error: unknown) => {
      if (entries.get(slot) !== entry) return;
      const code = errorCode(error);
      if (code !== null && DEFINITIVE_REJECTIONS.has(code)) entries.delete(slot);
      else {
        entry.attempt = null;
        entry.unconfirmed = true;
      }
    });
    return attempt;
  }

  return {
    run,
    pending(slot) {
      const entry = entries.get(slot);
      return entry ? {requestId: entry.requestId, input: entry.input, unconfirmed: entry.unconfirmed} : null;
    },
    busy(slot) {
      return entries.get(slot)?.attempt != null;
    },
    current<R>(slot: string) {
      return (entries.get(slot)?.attempt as Promise<R> | null | undefined) ?? null;
    },
    forget(slot) {
      const entry = entries.get(slot);
      if (entry && entry.attempt === null) entries.delete(slot);
    },
    clear() {
      entries.clear();
    },
  };
}

/** Unsaved text values, kept for the host lifetime across navigation and background. */
export interface DraftStore {
  get<T extends object>(key: string): T | null;
  set<T extends object>(key: string, value: T): void;
  clear(key: string): void;
  /** Drop every unsaved value after a records replacement. */
  clearAll(): void;
}

export function createDraftStore(): DraftStore {
  const drafts = new Map<string, object>();
  return {
    get<T extends object>(key: string) {
      return (drafts.get(key) as T | undefined) ?? null;
    },
    set(key, value) {
      drafts.set(key, Object.freeze({...value}));
    },
    clear(key) {
      drafts.delete(key);
    },
    clearAll() {
      drafts.clear();
    },
  };
}

export interface FieldProblem {
  readonly field: string;
  readonly message: string;
}

export type Parsed<T> =
  | {readonly ok: true; readonly value: T}
  | {readonly ok: false; readonly problems: readonly FieldProblem[]};


export interface NoteDraft {
  readonly date: string;
  readonly text: string;
  readonly kind: NoteKind;
  readonly expectedRevision: number | null;
}
export function noteDraft(note: Note | null, date: string): NoteDraft {
  return note ? {date: note.date, text: note.text, kind: note.kind, expectedRevision: note.revision}
    : {date, text: '', kind: 'general', expectedRevision: null};
}
export interface PainDraft {
  readonly bodyPart: BodyPart;
  readonly otherBodyPart: string;
  readonly side: BodySide;
  readonly state: PainState;
  readonly severity: string;
}
export interface FieldsDraft {
  readonly expectedRevision: number;
  readonly pain: readonly PainDraft[];
  readonly minutes: string;
  readonly quality: SleepQuality | null;
  readonly claim: string;
}
export function fieldsDraft(revision: number, fields: NoteFields | null): FieldsDraft {
  return {expectedRevision: revision, pain: fields?.pain.map(p => ({...p, otherBodyPart: p.otherBodyPart ?? '', severity: p.severity === null ? '' : String(p.severity)})) ?? [],
    minutes: fields?.sleep?.durationMin == null ? '' : String(fields.sleep.durationMin), quality: fields?.sleep?.quality ?? null,
    claim: fields?.personalBest?.claimText ?? ''};
}
/** Parse optional keyboard values only. Core owns range and contradiction validation. */
export function parseFieldsDraft(draft: FieldsDraft): Parsed<NoteFields> {
  const minutes = parseOptionalDecimal(draft.minutes, 'fields.sleep.durationMin', 'sleep minutes');
  const pain = draft.pain.map((p, i) => parseOptionalDecimal(p.severity, `fields.pain[${i}].severity`, 'severity'));
  const problems = [minutes, ...pain].flatMap(p => p.ok ? [] : p.problems);
  if (!minutes.ok || pain.some(p => !p.ok)) return {ok: false, problems};
  return {ok: true, value: {
    pain: draft.pain.map((p, i) => ({bodyPart: p.bodyPart, otherBodyPart: p.bodyPart === 'other' ? p.otherBodyPart : null,
      side: p.side, state: p.state, severity: pain[i]!.ok ? pain[i]!.value : null})),
    sleep: minutes.value === null && draft.quality === null ? null : {durationMin: minutes.value, quality: draft.quality},
    personalBest: draft.claim.trim() === '' ? null : {claimText: draft.claim},
  }};
}
export function noteKey(name: string, id?: string, revision?: number): string {
  return `notes:${JSON.stringify([name, id ?? null, revision ?? null])}`;
}


const WHOLE = /^\d+$/;
const DECIMAL = /^-?\d+(?:[.,]\d+)?$/;

/** Typing aid only. The core decides if the number is a valid record value. */
export function parseWholeNumber(text: string, field: string, label: string): Parsed<number> {
  const trimmed = text.trim();
  if (trimmed === '') return {ok: false, problems: [{field, message: `Enter ${label}.`}]};
  if (!WHOLE.test(trimmed)) return {ok: false, problems: [{field, message: `${capitalize(label)} must be digits only.`}]};
  return {ok: true, value: Number(trimmed)};
}

/** Typing aid only. A comma decimal separator is accepted as a point. */
export function parseDecimal(text: string, field: string, label: string): Parsed<number> {
  const trimmed = text.trim();
  if (trimmed === '') return {ok: false, problems: [{field, message: `Enter ${label}.`}]};
  if (!DECIMAL.test(trimmed)) return {ok: false, problems: [{field, message: `${capitalize(label)} must be a number.`}]};
  return {ok: true, value: Number(trimmed.replace(',', '.'))};
}

/** An empty optional value parses to null. */
export function parseOptionalDecimal(text: string, field: string, label: string): Parsed<number | null> {
  return text.trim() === '' ? {ok: true, value: null} : parseDecimal(text, field, label);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface DateDraft {
  readonly dateFrom: string;
  readonly dateTo: string;
}

/** Apply visible date text together with a status, exercise, or range change. */
export function withTypedDates<T extends DateDraft>(filters: T, typed: DateDraft): T {
  return {...filters, dateFrom: typed.dateFrom.trim(), dateTo: typed.dateTo.trim()};
}

/** Typed text of one set form. The load choice comes from the picker, not the keyboard. */
export interface SetDraft {
  readonly reps: string;
  readonly weight: string;
  readonly rpe: string;
  readonly loadConvention: string;
  readonly implementCount: 1 | 2 | null;
}

export const EMPTY_SET_DRAFT: SetDraft = Object.freeze({reps: '', weight: '', rpe: '', loadConvention: 'unknown', implementCount: null});

export interface SetValues {
  readonly reps: number;
  readonly weightKg: number;
  readonly rpe: number | null;
  readonly loadConvention: string;
  readonly implementCount: 1 | 2 | null;
}

/** Collect every typing problem at once. Field names match the core input fields. */
export function parseSetDraft(draft: SetDraft): Parsed<SetValues> {
  const reps = parseWholeNumber(draft.reps, 'reps', 'reps');
  const weight = parseDecimal(draft.weight, 'weightKg', 'weight');
  const rpe = parseOptionalDecimal(draft.rpe, 'rpe', 'RPE');
  const problems = [reps, weight, rpe].flatMap(result => result.ok ? [] : result.problems);
  if (!reps.ok || !weight.ok || !rpe.ok) return {ok: false, problems};
  return {ok: true, value: {
    reps: reps.value, weightKg: weight.value, rpe: rpe.value,
    loadConvention: draft.loadConvention, implementCount: draft.implementCount,
  }};
}

/** Text or an explicit load choice makes the draft different from the empty form. */
export function draftHasValues(draft: SetDraft): boolean {
  return draft.reps.trim() !== '' || draft.weight.trim() !== '' || draft.rpe.trim() !== ''
    || draft.loadConvention !== EMPTY_SET_DRAFT.loadConvention || draft.implementCount !== EMPTY_SET_DRAFT.implementCount;
}
