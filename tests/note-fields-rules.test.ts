import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOTE_FIELD_LIMITS, suggestNoteFields } from '@forma/core';
import type { BodySide, PainState, SleepField } from '@forma/core';
import { errorCode } from './helpers.js';

const source = { module: 'notes', noteId: 'note-1', revision: 1 } as const;
const suggest = (text: string) => suggestNoteFields({ source, text });

const painCases: readonly (readonly [string, PainState, BodySide, number | null])[] = [
  ...['I think', 'I believe', 'I suspect', 'probably', 'possibly', 'seems like', 'appears to be', 'he has', 'she has', 'they have', 'we have']
    .map((prefix) => [prefix + ' left knee pain', 'uncertain', 'left', null] as const),
  ['left and right knees hurt', 'present', 'bilateral', null],
  ['right and left knees hurt', 'present', 'bilateral', null],
  ['left knee felt fine', 'absent', 'left', null],
  ['no left knee pain', 'absent', 'left', null],
  ['left knee has no pain', 'absent', 'left', null],
  ["left knee doesn't hurt", 'absent', 'left', null],
  ['left knee does not hurt', 'absent', 'left', null],
  ['left knee is pain-free', 'absent', 'left', null],
  ['left knee without pain', 'absent', 'left', null],
  ['left knee pain 3/10', 'present', 'left', 3],
  ['RIGHT KNEE HURTS 2.5 out of 10', 'present', 'right', 2.5],
  ['both knees are sore', 'present', 'bilateral', null],
  ['knee is sore', 'present', 'unspecified', null],
  ['left knee range of motion', 'uncertain', 'left', null],
  ['left knee might hurt', 'uncertain', 'left', null],
  ['not sure if left knee hurts', 'uncertain', 'left', null],
  ['if left knee hurts I will stop', 'uncertain', 'left', null],
  ['left knee hurt yesterday', 'uncertain', 'left', null],
  ['left knee hurts?', 'uncertain', 'left', null],
  ['"left knee hurts"', 'uncertain', 'left', null],
  ["'left knee hurts'", 'uncertain', 'left', null],
  ['left knee is not pain-free', 'uncertain', 'left', null],
  ['left knee did not feel fine', 'uncertain', 'left', null],
  ['left knee was painful and then felt fine', 'uncertain', 'left', null],
  ['left knee pain is gone', 'uncertain', 'left', null],
  ['left knee pain 0/10', 'uncertain', 'left', null],
  ['left knee felt fine 3/10', 'uncertain', 'left', null],
  ['left knee pain 11/10', 'uncertain', 'left', null],
  ['left knee pain -3/10', 'uncertain', 'left', null],
  ['left knee pain 3/10 and 4/10', 'uncertain', 'left', null],
  ['my friend has left knee pain', 'uncertain', 'left', null],
];
for (const [text, state, side, severity] of painCases) {
  test('pain rule: ' + text, () => {
    const item = suggest(text).pain.items[0]!;
    assert.equal(item.value!.bodyPart, 'knee');
    assert.equal(item.value!.state, state);
    assert.equal(item.value!.side, side);
    assert.equal(item.value!.severity, severity);
    assert.equal(item.status, state === 'uncertain' ? 'uncertain' : 'pending');
  });
}

const sleepCases: readonly (readonly [string, SleepField | null, 'pending' | 'uncertain'])[] = [
  ...['I will', 'I am going to', 'I intend to'].map((prefix) => [prefix + ' sleep 8 hours', null, 'uncertain'] as const),
  ['slept 7 hours', { durationMin: 420, quality: null }, 'pending'],
  ['slept 7.5h', { durationMin: 450, quality: null }, 'pending'],
  ['slept 7 hours 30 minutes', { durationMin: 450, quality: null }, 'pending'],
  ['slept 7 h and 30 min', { durationMin: 450, quality: null }, 'pending'],
  ['sleep duration was 45 minutes', { durationMin: 45, quality: null }, 'pending'],
  ['slept 0 hours', { durationMin: 0, quality: null }, 'pending'],
  ['slept well', { durationMin: null, quality: 'good' }, 'pending'],
  ['poor sleep', { durationMin: null, quality: 'poor' }, 'pending'],
  ['sleep was fair', { durationMin: null, quality: 'fair' }, 'pending'],
  ['slept 6h and sleep was good', { durationMin: 360, quality: 'good' }, 'pending'],
  ["didn't sleep well", null, 'uncertain'],
  ['might sleep 8h', null, 'uncertain'],
  ['I want to sleep 8h', null, 'uncertain'],
  ['slept 25h', null, 'uncertain'],
  ['slept 6h and slept 2h', null, 'uncertain'],
  ['slept 6h and 2h', null, 'uncertain'],
  ['slept 30 min and 20 min', null, 'uncertain'],
  ['sleep was good and sleep was poor', null, 'uncertain'],
  ['sleep was unusual', null, 'uncertain'],
];
for (const [text, expected, status] of sleepCases) {
  test('sleep rule: ' + text, () => {
    const item = suggest(text).sleep.items[0]!;
    assert.deepEqual(item.value, expected);
    assert.equal(item.status, status);
  });
}

test('contrast clauses keep absence separate from positive pain', () => {
  const text = 'Left knee felt fine, but right shoulder hurts 4/10.';
  const result = suggest(text);
  assert.deepEqual(result.pain.items.map((item) => [item.value!.bodyPart, item.value!.side, item.value!.state, item.value!.severity]),
    [['knee', 'left', 'absent', null], ['shoulder', 'right', 'present', 4]]);
});

test('one shared predicate across different locations remains uncertain', () => {
  const result = suggest('left knee and right shoulder hurt');
  assert.equal(result.pain.items.length, 2);
  assert(result.pain.items.every((item) => item.status === 'uncertain' && item.value!.state === 'uncertain'));
});

test('narrow aliases do not also return generic arm or back', () => {
  const result = suggest('left upper arm hurts; lower back is sore; right forearm aches');
  assert.deepEqual(result.pain.items.map((item) => item.value!.bodyPart), ['upper-arm', 'lower-back', 'forearm']);
  assert.deepEqual(suggest('back hurts').pain.items[0]!.value, {
    bodyPart: 'other', otherBodyPart: 'back', side: 'unspecified', state: 'present', severity: null,
  });
});

test('no-match, unsupported language, and pain without a body part remain missing', () => {
  for (const text of ['ate an apple', 'Dolor en la rodilla izquierda', 'I have pain', 'kneejerk response']) {
    const result = suggest(text);
    assert.equal(result.pain.state, 'missing');
    assert.equal(result.sleep.state, 'missing');
    assert.equal(result.personalBest.state, 'missing');
  }
});

test('personal-best claims stay pending or uncertain, never calculated facts', () => {
  const result = suggest('new PR on incline press');
  assert.deepEqual(result.personalBest.items[0]!.value, { claimText: 'new PR on incline press' });
  assert.equal(result.personalBest.items[0]!.status, 'pending');
  for (const text of ['no new PR', 'maybe a personal best', 'personal record yesterday', 'new PR?']) {
    const item = suggest(text).personalBest.items[0]!;
    assert.equal(item.status, 'uncertain'); assert.equal(item.value, null);
  }
});

test('evidence identifies exact UTF-16 slices in the unchanged source text', () => {
  const text = '💪 İ training. Left knee felt fine; slept 7.5 hours. new PR on curls';
  const result = suggest(text);
  for (const group of [result.pain, result.sleep, result.personalBest]) {
    for (const item of group.items) {
      assert.equal(text.slice(item.evidence.start, item.evidence.end), item.evidence.text);
      assert(item.evidence.start >= 0 && item.evidence.end <= text.length);
    }
  }
  assert.deepEqual(result.source, source);
  assert.equal(result.rulesVersion, 1); assert.equal(result.rulesLanguage, 'en');
  assert.equal(result.sleep.items[0]!.value!.durationMin, 450);
});

test('all approved body parts have conservative English aliases', () => {
  const names = ['neck', 'shoulder', 'upper arm', 'elbow', 'forearm', 'wrist', 'hand',
    'upper back', 'lower back', 'hip', 'thigh', 'knee', 'calf', 'ankle', 'foot'];
  for (const name of names) {
    const result = suggest(name + ' pain');
    assert.equal(result.pain.items.length, 1);
    assert.equal(result.pain.items[0]!.value!.bodyPart, name.replace(' ', '-'));
    assert.equal(result.pain.items[0]!.status, 'pending');
    assert.equal(result.pain.items[0]!.value!.severity, null);
  }
});

test('suggestion budgets are explicit and do not silently claim completeness', () => {
  const count = NOTE_FIELD_LIMITS.maxSuggestionsPerGroup + 1;
  for (const [text, key] of [
    [Array(count).fill('left knee hurts').join('. '), 'pain'],
    [Array(count).fill('slept 7 hours').join('. '), 'sleep'],
    [Array(count).fill('new PR on curls').join('. '), 'personalBest'],
  ] as const) {
    const group = suggest(text)[key];
    assert.equal(group.items.length, NOTE_FIELD_LIMITS.maxSuggestionsPerGroup);
    assert.equal(group.truncated, true); assert.equal(group.state, 'uncertain');
  }
});

test('hypothetical, third-person, and quoted context survives clause boundaries', () => {
  for (const text of [
    'If I train again, left knee hurts',
    'My friend reported this: shoulder aches; left knee hurts',
    '"slept 7 hours, left knee hurts"',
  ]) {
    const result = suggest(text);
    assert(result.pain.items.length > 0);
    assert(result.pain.items.every((item) => item.status === 'uncertain'));
    assert(result.sleep.items.every((item) => item.status === 'uncertain'));
  }
});

test('conflicting pain statements and multiple sleep episodes remain uncertain at group level', () => {
  assert.equal(suggest('left knee hurts. left knee felt fine').pain.state, 'uncertain');
  const sleep = suggest('slept 6h. slept 2h');
  assert.equal(sleep.sleep.state, 'uncertain');
  assert.deepEqual(sleep.sleep.items.map((item) => item.value!.durationMin), [360, 120]);
  assert.equal(suggest('new PR on curls. new PR on incline press').personalBest.state, 'uncertain');
});

test('rule helper validates source and text and detaches caller-owned source objects', () => {
  const mutable = { ...source };
  const result = suggestNoteFields({ source: mutable, text: 'left knee pain' });
  assert.notEqual(result.source, mutable);
  assert.throws(() => suggestNoteFields({ source: { ...source, revision: 0 }, text: 'x' }), errorCode('INVALID_INPUT', 'revision'));
  assert.throws(() => suggestNoteFields({ source, text: '\ud800' }), errorCode('INVALID_INPUT', 'text'));
});
