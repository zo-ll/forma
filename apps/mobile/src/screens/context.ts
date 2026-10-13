import {useCallback, useEffect, useRef, useState} from 'react';
import type {FormaService} from '@forma/core';
import type {MobileHost, MobileHostSnapshot} from '@forma/mobile-host';
import type {MobileForms} from '../root';
import type {Palette} from '../ui/theme';

/** Stack screens of the entry flow. The tabs stay hidden while one is open. */
export type StackScreen =
  | {readonly name: 'SplitPicker'}
  | {readonly name: 'ExerciseOrder'; readonly splitDayId: string}
  | {readonly name: 'Entry'; readonly workoutId: string};

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
  const reload = useCallback(() => {
    const current = ++generation.current;
    setLoaded(previous => previous.state === 'ready' ? previous : {state: 'loading'});
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
    reload();
    return () => {generation.current++;};
  }, [reload, key]);
  return {loaded, reload};
}
