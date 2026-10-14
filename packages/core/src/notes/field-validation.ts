import { finiteNumber, invalid, objectInput, utcTimestamp } from '../validation.js';
import type { ResultCodec } from '../requests/service.js';
import type { BodyPart, BodySide, NoteFieldConfirmation, NoteFields, PainField } from './field-types.js';
import type { NoteSource } from './types.js';
import { noteId, noteRevision } from './validation.js';

export const NOTE_FIELD_LIMITS = Object.freeze({
  maxPainEntries: 32, maxSuggestionsPerGroup: 32, maxOtherBodyPartCharacters: 128,
  maxClaimCharacters: 1_024, maxSleepDurationMin: 1_440,
});
export const BODY_PARTS: readonly BodyPart[] = Object.freeze([
  'neck', 'shoulder', 'upper-arm', 'elbow', 'forearm', 'wrist', 'hand', 'upper-back',
  'lower-back', 'hip', 'thigh', 'knee', 'calf', 'ankle', 'foot', 'other',
]);
const sides: readonly BodySide[] = ['left', 'right', 'bilateral', 'unspecified'];

function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000\uD800-\uDFFF]/u.test(value)) {
    invalid(field, 'The field must contain nonempty bounded valid Unicode without NUL.');
  }
  return value;
}

export function noteSource(value: unknown): NoteSource {
  objectInput(value, ['module', 'noteId', 'revision']);
  const source = value as NoteSource;
  if (source.module !== 'notes') invalid('source', 'The source must identify a note.');
  return { module: 'notes', noteId: noteId(source.noteId), revision: noteRevision(source.revision, 'revision') };
}

function painField(value: unknown): PainField {
  objectInput(value, ['bodyPart', 'otherBodyPart', 'side', 'state', 'severity']);
  const field = value as PainField;
  if (!BODY_PARTS.includes(field.bodyPart)) invalid('bodyPart', 'The body part is not supported.');
  if (!sides.includes(field.side)) invalid('side', 'The side is not supported.');
  if (!['present', 'absent', 'uncertain'].includes(field.state)) invalid('state', 'The pain state is not supported.');
  const otherBodyPart = field.bodyPart === 'other'
    ? boundedText(field.otherBodyPart, 'otherBodyPart', NOTE_FIELD_LIMITS.maxOtherBodyPartCharacters) : null;
  if (field.bodyPart !== 'other' && field.otherBodyPart !== null) {
    invalid('otherBodyPart', 'Known body parts require a null description.');
  }
  const severity = field.severity === null ? null : finiteNumber(field.severity, 'severity', 0);
  if (severity !== null && (severity > 10 || field.state === 'uncertain'
    || (field.state === 'present' && severity === 0) || (field.state === 'absent' && severity !== 0))) {
    invalid('severity', 'The explicit severity must agree with the pain state and the 0–10 scale.');
  }
  return { bodyPart: field.bodyPart, otherBodyPart, side: field.side, state: field.state, severity };
}

function locationKey(field: PainField): string {
  if (field.bodyPart !== 'other') return field.bodyPart;
  const description = field.otherBodyPart!.trim().toLowerCase().replace(/[ -]+/g, '-');
  const aliases: Readonly<Record<string, string>> = {
    knees: 'knee', shoulders: 'shoulder', elbows: 'elbow', wrists: 'wrist', hands: 'hand',
    hips: 'hip', thighs: 'thigh', calves: 'calf', ankles: 'ankle', feet: 'foot',
    'upper-arms': 'upper-arm', forearms: 'forearm', necks: 'neck',
  };
  const known = aliases[description] ?? description;
  return BODY_PARTS.includes(known as BodyPart) && known !== 'other' ? known : 'other:' + description;
}

/** A complete, detached replacement. Missing keys never silently erase a field. */
export function validateNoteFields(value: unknown): NoteFields {
  objectInput(value, ['pain', 'sleep', 'personalBest']);
  const fields = value as NoteFields;
  if (!Array.isArray(fields.pain) || fields.pain.length > NOTE_FIELD_LIMITS.maxPainEntries) {
    invalid('pain', 'Pain fields must be a bounded array.');
  }
  const pain = Array.from(fields.pain, painField);
  for (let i = 0; i < pain.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = pain[i]!; const b = pain[j]!;
      if (locationKey(a) === locationKey(b)
        && (a.side === b.side || ['bilateral', 'unspecified'].includes(a.side)
          || ['bilateral', 'unspecified'].includes(b.side))) {
        invalid('pain', 'Pain fields must not repeat or overlap a location.');
      }
    }
  }
  pain.sort((a, b) => BODY_PARTS.indexOf(a.bodyPart) - BODY_PARTS.indexOf(b.bodyPart)
    || ((a.otherBodyPart ?? '') < (b.otherBodyPart ?? '') ? -1 : (a.otherBodyPart ?? '') > (b.otherBodyPart ?? '') ? 1 : 0)
    || sides.indexOf(a.side) - sides.indexOf(b.side));
  let sleep = null;
  if (fields.sleep !== null) {
    objectInput(fields.sleep, ['durationMin', 'quality']);
    const durationMin = fields.sleep.durationMin === null ? null : finiteNumber(fields.sleep.durationMin, 'durationMin', 0);
    if (durationMin !== null && durationMin > NOTE_FIELD_LIMITS.maxSleepDurationMin) {
      invalid('durationMin', 'A reported sleep duration must not exceed 1440 minutes.');
    }
    const quality = fields.sleep.quality;
    if (quality !== null && quality !== 'poor' && quality !== 'fair' && quality !== 'good') {
      invalid('quality', 'The sleep quality is not supported.');
    }
    if (durationMin === null && quality === null) invalid('sleep', 'Use null for an entirely unknown sleep field.');
    sleep = { durationMin, quality };
  }
  let personalBest = null;
  if (fields.personalBest !== null) {
    objectInput(fields.personalBest, ['claimText']);
    personalBest = { claimText: boundedText(fields.personalBest.claimText, 'claimText', NOTE_FIELD_LIMITS.maxClaimCharacters) };
  }
  return { pain, sleep, personalBest };
}

export const noteFieldConfirmationResult: ResultCodec<NoteFieldConfirmation> = {
  parse(value) {
    objectInput(value, ['formatVersion', 'source', 'confirmedAt', 'fields']);
    const result = value as NoteFieldConfirmation;
    if (result.formatVersion !== 1) invalid('formatVersion', 'The confirmation format is not supported.');
    return { formatVersion: 1, source: noteSource(result.source), confirmedAt: utcTimestamp(result.confirmedAt),
      fields: validateNoteFields(result.fields) };
  },
};
