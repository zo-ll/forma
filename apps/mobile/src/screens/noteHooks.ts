import {useEffect, useRef, useState} from 'react';
import {FormaError} from '@forma/core';
import type {FormaService} from '@forma/core';
import type {ScreenContext} from './context';
import {useServiceRead} from './context';

export function noteUnavailable(ctx: ScreenContext): string | null {
  const snapshot = ctx.host.snapshot();
  if (snapshot.recordsEpoch !== ctx.snapshot.recordsEpoch) return 'Records changed. Open Notes again.';
  const phase = snapshot.phase;
  return phase === 'ready' || phase === 'background' ? null : 'The local service is not ready. Restart if it is closed.';
}
function current(ctx: ScreenContext, epoch: number): boolean {
  return ctx.host.snapshot().recordsEpoch === epoch && noteUnavailable(ctx) === null;
}
export function useNoteRead<T>(ctx: ScreenContext, key: string, read: (service: FormaService) => Promise<T>) {
  return useServiceRead(ctx.host, `${ctx.snapshot.recordsEpoch}:${key}`, async service => {
    const epoch = ctx.host.snapshot().recordsEpoch;
    const value = await read(service);
    if (!current(ctx, epoch)) throw new FormaError('SERVICE_CLOSED', 'This note read is no longer current.');
    return value;
  });
}

/** A completed intent survives navigation too. Queued callbacks cannot submit it again. */
export function useNoteCommand<I, R>(ctx: ScreenContext, slot: string, draftKey: string,
  send: (service: FormaService, requestId: string, input: I) => Promise<R>, onDone: (result: R) => void) {
  const completionKey = `${slot}:completed`;
  const [busy, setBusy] = useState(ctx.forms.commands.busy(slot));
  const [failure, setFailure] = useState<unknown>(null);
  const mounted = useRef(true);
  const consumed = useRef(false);
  const epoch = useRef(ctx.snapshot.recordsEpoch);
  const done = useRef(onDone);
  done.current = onDone;
  const valid = () => mounted.current && current(ctx, epoch.current);
  const attach = (attempt: Promise<R>) => {
    setBusy(true);
    attempt.then(result => {
      if (!valid()) return;
      setBusy(false);
      consumed.current = true;
      done.current(result);
    }, error => {
      if (!valid()) return;
      consumed.current = false;
      setBusy(false);
      setFailure(error);
    });
  };
  useEffect(() => {
    mounted.current = true;
    const completed = ctx.forms.drafts.get<{result: R}>(completionKey);
    const running = ctx.forms.commands.current<R>(slot);
    if (completed && valid()) {consumed.current = true; done.current(completed.result);}
    else if (running) {consumed.current = true; attach(running);}
    return () => {mounted.current = false;};
  }, [slot]);
  const run = (input: I) => {
    if (!valid() || consumed.current || ctx.forms.commands.busy(slot) || ctx.forms.drafts.get(completionKey)) return;
    consumed.current = true;
    setFailure(null);
    // An unconfirmed operation must settle before a different intended operation.
    const pending = ctx.forms.commands.pending(slot);
    const captured = pending?.unconfirmed ? pending.input as I : input;
    attach(ctx.forms.commands.run(slot, captured, async (requestId, saved) => {
      const result = await send(ctx.host.service(), requestId, saved);
      // Persist settlement independently of the mounted screen, but never across restore/close.
      if (current(ctx, epoch.current)) {
        ctx.forms.drafts.set(completionKey, {result});
        ctx.forms.drafts.clear(draftKey);
      }
      return result;
    }));
  };
  return {busy, failure, run, unconfirmed: ctx.forms.commands.pending(slot)?.unconfirmed === true};
}
