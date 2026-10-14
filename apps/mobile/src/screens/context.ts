import {useCallback, useEffect, useRef, useState} from 'react';
import type {FormaService, NoteSource} from '@forma/core';
import type {MobileHost, MobileHostSnapshot} from '@forma/mobile-host';
import type {MobileForms} from '../root';
import type {Palette} from '../ui/theme';

/** Stack screens of the entry flow. The tabs stay hidden while one is open. */
export type StackScreen =
  | {readonly name: 'NoteCreate'}
  | {readonly name: 'NoteDetail'; readonly source: NoteSource}
  | {readonly name: 'NoteEdit'; readonly source: NoteSource}
  | {readonly name: 'NoteFields'; readonly source: NoteSource}
  | {readonly name: 'SplitPicker'}
  | {readonly name: 'ExerciseOrder'; readonly splitDayId: string}
  | {readonly name: 'Entry'; readonly workoutId: string}
  | {readonly name: 'Summary'; readonly workoutId: string}
  | {readonly name: 'EditDetails'; readonly workoutId: string}
  | {readonly name: 'SetEdit'; readonly workoutId: string; readonly setId: string};

export interface ScreenContext {
  readonly host: MobileHost;
  readonly snapshot: MobileHostSnapshot;
  readonly palette: Palette;
  readonly forms: MobileForms;
  readonly push: (screen: StackScreen) => void;
  readonly pop: () => void;
  /** Replace the whole stack, for example after a start opens the entry screen. */
  readonly reset: (screens: readonly StackScreen[]) => void;
}

export type Loaded<T> =
  | {readonly state: 'loading'}
  | {readonly state: 'ready'; readonly value: T}
  | {readonly state: 'error'; readonly error: unknown};

/**
 * Read service data for a screen. Reads run again when `key` changes, and a
 * late result from an earlier read never replaces a newer one.
 */
export function useServiceRead<T>(host: MobileHost, key: string, read: (service: FormaService) => Promise<T>) {
  const [loaded, setLoaded] = useState<Loaded<T>>({state: 'loading'});
  const generation = useRef(0);
  const readRef = useRef(read);
  readRef.current = read;
  const reload = useCallback((fresh = false) => {
    const current = ++generation.current;
    setLoaded(previous => !fresh && previous.state === 'ready' ? previous : {state: 'loading'});
    void (async () => {
      try {
        const value = await readRef.current(host.service());
        if (generation.current === current) setLoaded({state: 'ready', value});
      } catch (error) {
        if (generation.current === current) setLoaded({state: 'error', error});
      }
    })();
  }, [host]);
  useEffect(() => {
    reload(true);
    return () => {generation.current++;};
  }, [reload, key]);
  return {loaded, reload: () => reload()};
}

/**
 * Send one write through the host-lifetime ledger. A command that is still
 * running after navigation is attached again instead of sent twice.
 */
export function useCommand<I, R>(ctx: ScreenContext, slot: string,
  send: (service: FormaService, requestId: string, input: I) => Promise<R>, onDone: (result: R) => void) {
  const [busy, setBusy] = useState(() => ctx.forms.commands.busy(slot));
  const [failure, setFailure] = useState<unknown>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const attach = useCallback((attempt: Promise<R>) => {
    setBusy(true);
    setFailure(null);
    attempt.then(result => {setBusy(false); doneRef.current(result);}, error => {setBusy(false); setFailure(error);});
  }, []);
  useEffect(() => {
    const running = ctx.forms.commands.current<R>(slot);
    if (running) attach(running);
  }, [ctx.forms, slot, attach]);
  const run = (input: I) => {
    if (ctx.forms.commands.busy(slot)) return;
    attach(ctx.forms.commands.run(slot, input, (requestId, saved) => send(ctx.host.service(), requestId, saved)));
  };
  const unconfirmed = !busy && ctx.forms.commands.pending(slot)?.unconfirmed === true;
  return {busy, failure, unconfirmed, run, clearFailure: () => setFailure(null)};
}
