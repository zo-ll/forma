import type { Exercise, SplitDay } from './types.js';

function exercise(
  id: string,
  name: string,
  equipment: string | null = null,
  aliases: readonly string[] = [],
): Exercise {
  return Object.freeze({
    id, name, muscleGroup: null, equipment,
    aliases: Object.freeze([...aliases]),
  });
}

// Equipment remains unknown unless the supplied name states it.
export const DEFAULT_EXERCISES: readonly Exercise[] = Object.freeze([
  exercise('incline-dumbbell-press', 'Incline Dumbbell Press', 'dumbbell', ['Incline DB Press']),
  exercise('lat-pulldown', 'Lat Pulldown', null, ['Lat Pull-down']),
  exercise('cable-row', 'Cable Row', 'cable'),
  exercise('cable-pullover', 'Cable Pullover', 'cable'),
  exercise('lateral-raises', 'Lateral Raises'),
  exercise('triceps-pushdowns', 'Triceps Pushdowns', null, ['Triceps Pushdown']),
  exercise('preacher-curl-machine', 'Preacher Curl Machine', 'machine'),
  exercise('hack-squat', 'Hack Squat'),
  exercise('bulgarian-split-squat', 'Bulgarian Split Squat'),
  exercise('calf-raises', 'Calf Raises'),
  exercise('hammer-curls', 'Hammer Curls'),
  exercise('leg-extensions', 'Leg Extensions', null, ['Leg Extension']),
  exercise('leg-curls', 'Leg Curls', null, ['Leg Curl']),
  exercise('preacher-curl', 'Preacher Curl'),
  exercise('dumbbell-overhead-triceps-extension', 'Dumbbell Overhead Triceps Extension',
    'dumbbell', ['DB Overhead Triceps Extension']),
  exercise('cable-lateral-raises', 'Cable Lateral Raises', 'cable'),
  exercise('cable-biceps-curl', 'Cable Biceps Curl', 'cable'),
  exercise('overhead-shoulder-press', 'Overhead Shoulder Press'),
  exercise('upright-row', 'Upright Row'),
]);

function splitDay(id: string, name: string, exerciseIds: readonly string[]): SplitDay {
  return Object.freeze({ id, name, exerciseIds: Object.freeze([...exerciseIds]) });
}

export const DEFAULT_SPLIT_DAYS: readonly SplitDay[] = Object.freeze([
  splitDay('upper', 'Upper', [
    'incline-dumbbell-press', 'lat-pulldown', 'cable-row', 'cable-pullover',
    'lateral-raises', 'triceps-pushdowns', 'preacher-curl-machine',
  ]),
  splitDay('lower', 'Lower', [
    'hack-squat', 'bulgarian-split-squat', 'calf-raises', 'hammer-curls',
    'leg-extensions', 'leg-curls',
  ]),
  splitDay('arms-shoulders', 'Arms & Shoulders', [
    'preacher-curl', 'dumbbell-overhead-triceps-extension', 'cable-lateral-raises',
    'cable-biceps-curl', 'triceps-pushdowns', 'overhead-shoulder-press', 'upright-row',
  ]),
]);
