import { objectInput } from '../validation.js';
import { NOTE_FIELD_LIMITS, noteSource } from './field-validation.js';
import type {
  BodyPart, BodySide, FieldSuggestion, NoteFieldSuggestions, PainField, PersonalBestField,
  SleepField, SleepQuality, SuggestionGroup, SuggestNoteFieldsInput, TextEvidence,
} from './field-types.js';
import { noteText } from './validation.js';

interface Clause extends TextEvidence { readonly question: boolean; readonly contextUncertain: boolean }
interface Mention { readonly start: number; readonly end: number; readonly bodyPart: BodyPart; readonly label: string | null; readonly side: BodySide }

const aliases: readonly [BodyPart, string][] = [
  ['neck', 'necks?'], ['shoulder', 'shoulders?'], ['upper-arm', 'upper[ -]arms?'],
  ['elbow', 'elbows?'], ['forearm', 'forearms?'], ['wrist', 'wrists?'], ['hand', 'hands?'],
  ['upper-back', 'upper[ -]back'], ['lower-back', 'lower[ -]back'], ['hip', 'hips?'],
  ['thigh', 'thighs?'], ['knee', 'knees?'], ['calf', 'calf|calves'], ['ankle', 'ankles?'],
  ['foot', 'foot|feet'], ['other', 'back|arms?|legs?'],
];
const caution = /\b(?:if|might|may|maybe|could|would|perhaps|whether|uncertain|unsure|yesterday|tomorrow|previously|last|used to|need|want|plan|wish|hope|should|his|her|their|brother|sister|friend)\b|not sure|["“”]|(?:^|\s)'[^']+'(?:$|\s)/i;
const negation = /\b(?:no|not|never|without)\b|n['’]t\b/i;
const positivePain = /\b(?:pain|painful|hurt|hurts|hurting|ache|aches|aching|sore|soreness)\b/i;
const absence = [
  /\bno\s+(?:(?:my|left|right|both|bilateral|upper|lower|neck|shoulders?|arms?|elbows?|forearms?|wrists?|hands?|back|hips?|thighs?|knees?|calf|calves|ankles?|feet|foot)\s+){0,4}(?:pain|aches?|soreness)\b/gi,
  /\b(?:without|free of)\s+(?:any\s+)?(?:pain|aches?|soreness)\b/gi,
  /\b(?:does not|doesn't|doesn’t|did not|didn't|didn’t|do not|don't|don’t|is not|isn't|isn’t|was not|wasn't|wasn’t)\s+(?:hurt|ache|sore|painful)\b/gi,
  /\b(?:not|never)\s+(?:hurt|hurting|sore|painful|aching)\b/gi,
  /\b(?:felt|feels?|feeling|is|was)\s+fine\b/gi,
  /\bpain[ -]free\b/gi,
];

function clauses(text: string): readonly Clause[] {
  const result: Clause[] = [];
  // Retain sentence context across commas and contrast words. Keep decimal points.
  const sentences = /[!?\n]+|(?<!\d)\.|\.(?!\d)/g;
  let sentenceStart = 0;
  function appendSentence(end: number, question: boolean): void {
    const sentence = text.slice(sentenceStart, end);
    const contextUncertain = caution.test(sentence);
    const separators = /[;,]+|\b(?:but|however|whereas|although|yet)\b/gi;
    let start = sentenceStart;
    function append(to: number): void {
      let from = start;
      while (from < to && /\s/u.test(text[from]!)) from++;
      while (to > from && /\s/u.test(text[to - 1]!)) to--;
      if (from < to) result.push({ start: from, end: to, text: text.slice(from, to), question, contextUncertain });
    }
    for (const match of sentence.matchAll(separators)) {
      append(sentenceStart + match.index);
      start = sentenceStart + match.index + match[0].length;
    }
    append(end);
  }
  for (const match of text.matchAll(sentences)) {
    appendSentence(match.index, match[0].includes('?'));
    sentenceStart = match.index + match[0].length;
  }
  appendSentence(text.length, false);
  return result;
}

function mentions(text: string): readonly Mention[] {
  const found: Mention[] = [];
  for (const [bodyPart, pattern] of aliases) {
    const regex = new RegExp('(?<![\\p{L}\\p{N}_])(?:' + pattern + ')(?![\\p{L}\\p{N}_])', 'giu');
    for (const match of text.matchAll(regex)) {
      const sideWord = /\b(left|right|both|bilateral)\s+(?:my\s+)?$/i.exec(text.slice(0, match.index))?.[1]?.toLowerCase();
      const side: BodySide = sideWord === 'left' || sideWord === 'right' ? sideWord
        : sideWord === 'both' || sideWord === 'bilateral' ? 'bilateral' : 'unspecified';
      const label = bodyPart === 'other' ? match[0].toLowerCase().replace(/s$/, '') : null;
      found.push({ start: match.index, end: match.index + match[0].length, bodyPart, label, side });
    }
  }
  // Keep the narrower longest alias, rather than also matching "back" in "lower back".
  found.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const disjoint: Mention[] = [];
  for (const mention of found) {
    if (!disjoint.some((other) => mention.start < other.end && other.start < mention.end)) disjoint.push(mention);
  }
  disjoint.sort((a, b) => a.start - b.start);
  const distinct = new Map<string, Mention>();
  for (const item of disjoint) distinct.set(JSON.stringify([item.bodyPart, item.label, item.side]), item);
  return [...distinct.values()];
}

function evidence(clause: Clause): TextEvidence {
  return { start: clause.start, end: clause.end, text: clause.text };
}

function painSuggestions(clause: Clause): readonly FieldSuggestion<PainField>[] {
  const locations = mentions(clause.text);
  if (!locations.length) return [];
  let remainder = clause.text;
  let hasAbsence = false;
  for (const pattern of absence) {
    const next = remainder.replace(pattern, ' ');
    if (next !== remainder) hasAbsence = true;
    remainder = next;
  }
  const hasPositive = positivePain.test(remainder);
  const unclear = clause.question || clause.contextUncertain || negation.test(remainder)
    || /\b(?:gone|better|improved|resolved)\b/i.test(clause.text)
    || (locations.length > 1 && (hasPositive || hasAbsence)) || (hasPositive && hasAbsence);
  const scores = [...clause.text.matchAll(/(?<![\p{L}\p{N}_.])([+-]?\d+(?:\.\d+)?)\s*(?:\/\s*10|out\s+of\s+10)\b/giu)]
    .map((match) => Number(match[1]));
  let state: PainField['state'] = unclear ? 'uncertain' : hasPositive ? 'present' : hasAbsence ? 'absent' : 'uncertain';
  let severity: number | null = null;
  if (scores.length) {
    const score = scores[0]!;
    if (scores.length !== 1 || score < 0 || score > 10 || state === 'uncertain'
      || (state === 'present' && score === 0) || (state === 'absent' && score !== 0)) state = 'uncertain';
    else severity = score;
  }
  return locations.map((location) => ({
    status: state === 'uncertain' ? 'uncertain' : 'pending',
    value: { bodyPart: location.bodyPart, otherBodyPart: location.label, side: location.side, state, severity },
    reason: state === 'present' ? 'explicit-pain' : state === 'absent' ? 'explicit-absence'
      : !hasPositive && !hasAbsence && !unclear ? 'body-part-only' : 'ambiguous-context',
    evidence: evidence(clause),
  }));
}

function sleepSuggestion(clause: Clause): FieldSuggestion<SleepField> | null {
  if (!/\b(?:sleep|sleeping|slept)\b/i.test(clause.text)) return null;
  const durationPattern = /\b(?:slept|sleep(?:ing)?)\s+(?:(?:for|duration|was|of|is)\s+){0,3}(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b(?:\s+(?:and\s+)?(\d+(?:\.\d+)?)\s*(minutes?|mins?|m)\b)?/gi;
  const durationMatches = [...clause.text.matchAll(durationPattern)];
  const durations = durationMatches.map((match) => Number(match[1]) * (/^h/i.test(match[2]!) ? 60 : 1) + Number(match[3] ?? 0));
  const extraDuration = /[+-]?\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b/i.test(clause.text.replace(durationPattern, ' '));
  const qualities: SleepQuality[] = [];
  if (/\b(?:poor|bad)\s+sleep\b|\b(?:sleep\s+(?:was|is)\s+(?:poor|bad)|slept\s+(?:poorly|badly))\b/i.test(clause.text)) qualities.push('poor');
  if (/\bfair\s+sleep\b|\b(?:sleep\s+(?:was|is)\s+(?:fair|okay)|slept\s+okay)\b/i.test(clause.text)) qualities.push('fair');
  if (/\b(?:good|restful)\s+sleep\b|\b(?:sleep\s+(?:was|is)\s+good|slept\s+well)\b/i.test(clause.text)) qualities.push('good');
  const unclear = clause.question || clause.contextUncertain || negation.test(clause.text)
    || durations.length > 1 || qualities.length > 1 || extraDuration
    || durationMatches.some((match) => match[3] !== undefined && !/^h/i.test(match[2]!))
    || durations.some((value) => !Number.isFinite(value) || value > NOTE_FIELD_LIMITS.maxSleepDurationMin);
  const durationMin = unclear ? null : durations[0] ?? null;
  const quality = unclear ? null : qualities[0] ?? null;
  return { status: unclear || (durationMin === null && quality === null) ? 'uncertain' : 'pending',
    value: durationMin === null && quality === null ? null : { durationMin, quality },
    reason: unclear ? 'ambiguous-context' : 'explicit-sleep', evidence: evidence(clause) };
}

function personalBestSuggestion(clause: Clause): FieldSuggestion<PersonalBestField> | null {
  if (!/\b(?:new\s+(?:pr|pb)|personal[ -]best|personal record)\b/i.test(clause.text)) return null;
  const unclear = clause.question || clause.contextUncertain || negation.test(clause.text)
    || clause.text.length > NOTE_FIELD_LIMITS.maxClaimCharacters;
  return { status: unclear ? 'uncertain' : 'pending', value: unclear ? null : { claimText: clause.text },
    reason: unclear ? 'ambiguous-context' : 'personal-best-claim', evidence: evidence(clause) };
}

function group<T>(all: readonly FieldSuggestion<T>[]): SuggestionGroup<T> {
  const truncated = all.length > NOTE_FIELD_LIMITS.maxSuggestionsPerGroup;
  const items = all.slice(0, NOTE_FIELD_LIMITS.maxSuggestionsPerGroup);
  return { state: truncated || items.some((item) => item.status === 'uncertain') ? 'uncertain'
    : items.length ? 'pending' : 'missing', items, truncated };
}

/** Deterministic, bounded English suggestions. This helper never confirms facts. */
export function suggestNoteFields(input: SuggestNoteFieldsInput): NoteFieldSuggestions {
  objectInput(input, ['source', 'text']);
  const source = noteSource(input.source);
  const text = noteText(input.text);
  const pain: FieldSuggestion<PainField>[] = [];
  const sleep: FieldSuggestion<SleepField>[] = [];
  const personalBest: FieldSuggestion<PersonalBestField>[] = [];
  for (const clause of clauses(text)) {
    pain.push(...painSuggestions(clause));
    const sleepItem = sleepSuggestion(clause);
    if (sleepItem) sleep.push(sleepItem);
    const bestItem = personalBestSuggestion(clause);
    if (bestItem) personalBest.push(bestItem);
  }
  const locations = new Map<string, string>();
  let conflictingPain = false;
  for (const item of pain) {
    const field = item.value!;
    const key = JSON.stringify([field.bodyPart, field.otherBodyPart, field.side]);
    const meaning = JSON.stringify([field.state, field.severity]);
    if (locations.has(key) && locations.get(key) !== meaning) conflictingPain = true;
    locations.set(key, meaning);
  }
  const painGroup = group(pain); const sleepGroup = group(sleep); const bestGroup = group(personalBest);
  return { source, rulesVersion: 1, rulesLanguage: 'en',
    pain: { ...painGroup, state: conflictingPain ? 'uncertain' : painGroup.state },
    sleep: { ...sleepGroup, state: sleep.length > 1 ? 'uncertain' : sleepGroup.state },
    personalBest: { ...bestGroup, state: personalBest.length > 1 ? 'uncertain' : bestGroup.state } };

}
