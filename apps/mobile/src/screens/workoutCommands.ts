import type {Workout} from '@forma/core';
import type {ScreenContext} from './context';
import {useCommand} from './context';

export function finishSlot(workoutId: string): string {
  return `workout.finish:${workoutId}`;
}
export function discardSlot(workoutId: string): string {
  return `workout.discard:${workoutId}`;
}
export function deleteSlot(workoutId: string): string {
  return `workout.delete:${workoutId}`;
}

/** Discard only for an in-progress workout, Delete only for a finished one (decision 2026-10-13). */
export function useRemoveWorkout(ctx: ScreenContext, workout: Workout | null, onDone: () => void) {
  const id = workout?.id ?? '';
  const inProgress = workout?.status === 'in-progress';
  const discard = useCommand<{workoutId: string}, void>(ctx, discardSlot(id),
    (service, requestId, input) => service.workouts.discard({requestId, ...input}), onDone);
  const remove = useCommand<{workoutId: string}, void>(ctx, deleteSlot(id),
    (service, requestId, input) => service.workouts.delete({requestId, ...input}), onDone);
  const command = inProgress ? discard : remove;
  return {command, inProgress, run: () => command.run({workoutId: id})};
}
