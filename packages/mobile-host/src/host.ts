import { FormaError, resolveCalendarRange } from '@forma/core';
import type { CalendarRange, FormaService } from '@forma/core';
import { DEFAULT_PREFERENCES, isMobileTheme, parsePreferences, serializePreferences } from './preferences.js';
import type { MobilePreferences, MobileTheme } from './preferences.js';

export type MobileHostPhase =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'background'
  | 'restoring'
  | 'closing'
  | 'closed'
  | 'failed';

/** Native platform preference storage. The host never imports it. */
export interface PreferenceStorage {
  read(): string | null;
  write(serialized: string): void;
}

/** Native platform data. The host calls core for every calendar rule. */
export interface MobilePlatform {
  timeZone(): string;
  nowUtc(): string;
}

export interface MobileHostDependencies {
  readonly openService: () => FormaService;
  readonly preferences: PreferenceStorage;
  readonly platform: MobilePlatform;
}

export interface MobileHostSnapshot {
  readonly phase: MobileHostPhase;
  readonly preferences: MobilePreferences;
  readonly calendar: CalendarRange | null;
  readonly error: FormaError | null;
  /** Advances after a records replacement that changed, or can have changed, the database. */
  readonly recordsEpoch: number;
}

export interface MobileHost {
  start(): Promise<void>;
  resume(): Promise<void>;
  background(): void;
  close(): Promise<void>;
  snapshot(): MobileHostSnapshot;
  setTheme(theme: MobileTheme): Promise<void>;
  subscribe(listener: () => void): () => void;
  service(): FormaService;
  /**
   * Run one records replacement, such as an archive restore. The phase is
   * `restoring` for presentation; the core service enforces the exclusion.
   */
  replaceRecords<T>(run: (service: FormaService) => Promise<T>): Promise<T>;
}

/** These codes prove that the core rejected the operation without a change. */
const UNCHANGED_CODES: ReadonlySet<string> = new Set(['INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'SERVICE_CLOSED']);

function invalidInput(message: string, field: string): FormaError {
  return new FormaError('INVALID_INPUT', message, { field });
}

/** Keep FormaError details. Convert every other failure to STORAGE_FAILURE with a cause. */
function toFormaError(cause: unknown, message: string): FormaError {
  if (cause instanceof FormaError) return cause;
  const detail = cause instanceof Error && cause.message.length > 0 ? ' ' + cause.message : '';
  return new FormaError('STORAGE_FAILURE', message + detail, { cause });
}

function requireDependencies(input: unknown): MobileHostDependencies {
  if (input === null || typeof input !== 'object') {
    throw invalidInput('The mobile host dependencies are required.', 'input');
  }
  const record = input as Record<string, unknown>;
  if (typeof record.openService !== 'function') {
    throw invalidInput('openService must be a function.', 'openService');
  }
  const preferences = record.preferences;
  if (preferences === null || typeof preferences !== 'object'
    || typeof (preferences as Record<string, unknown>).read !== 'function'
    || typeof (preferences as Record<string, unknown>).write !== 'function') {
    throw invalidInput('preferences must provide read and write.', 'preferences');
  }
  const platform = record.platform;
  if (platform === null || typeof platform !== 'object'
    || typeof (platform as Record<string, unknown>).timeZone !== 'function'
    || typeof (platform as Record<string, unknown>).nowUtc !== 'function') {
    throw invalidInput('platform must provide timeZone and nowUtc.', 'platform');
  }
  return input as MobileHostDependencies;
}

/**
 * Build one portable mobile host. The host owns preference state, the device
 * date context, and the lifetime of one FormaService. It imports no platform
 * code; the app injects storage, platform data, and a service factory.
 */
export function createMobileHost(dependencies: MobileHostDependencies): MobileHost {
  const deps = requireDependencies(dependencies);

  let phase: MobileHostPhase = 'idle';
  let activeService: FormaService | null = null;
  let currentPreferences: MobilePreferences = DEFAULT_PREFERENCES;
  let currentCalendar: CalendarRange | null = null;
  let currentError: FormaError | null = null;
  let recordsEpoch = 0;
  let backgroundDuringRestore = false;
  let startPromise: Promise<void> | null = null;
  let closePromise: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  let tail: Promise<void> = Promise.resolve();

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A listener must not break host control flow or the operation queue.
      }
    }
  }

  /** Serialize mutating operations so a late result cannot revive a closed host. */
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  }

  function loadPreferences(): MobilePreferences {
    let text: string | null;
    try {
      text = deps.preferences.read();
    } catch (cause) {
      throw toFormaError(cause, 'The preference record could not be read.');
    }
    return parsePreferences(text);
  }

  function persistPreferences(preferences: MobilePreferences): void {
    try {
      deps.preferences.write(serializePreferences(preferences));
    } catch (cause) {
      throw toFormaError(cause, 'The preference record could not be saved.');
    }
  }

  function computeCalendar(): CalendarRange {
    try {
      return resolveCalendarRange({
        nowUtc: deps.platform.nowUtc(),
        timeZone: deps.platform.timeZone(),
        period: 'today',
      });
    } catch (cause) {
      throw toFormaError(cause, 'The device calendar could not be resolved.');
    }
  }

  async function runStart(): Promise<void> {
    if (phase === 'ready' || phase === 'background') return;
    if (phase === 'closed' || phase === 'closing') {
      throw new FormaError('SERVICE_CLOSED', 'The mobile host is closed.');
    }
    if (phase === 'failed') {
      throw currentError ?? new FormaError('STORAGE_FAILURE', 'The mobile host failed to start.');
    }
    phase = 'starting';
    notify();
    let opened: FormaService | null = null;
    try {
      opened = deps.openService();
      activeService = opened;
      const preferences = loadPreferences();
      const calendar = computeCalendar();
      currentPreferences = preferences;
      currentCalendar = calendar;
      currentError = null;
      phase = 'ready';
      notify();
    } catch (cause) {
      const error = toFormaError(cause, 'The mobile host could not start.');
      if (opened !== null) {
        try {
          await opened.close();
        } catch {
          // Keep the startup error primary. The adapter retains ownership after an unknown close state.
        }
      }
      activeService = null;
      currentError = error;
      phase = 'failed';
      notify();
      throw error;
    }
  }

  function start(): Promise<void> {
    if (phase === 'ready' || phase === 'background') return Promise.resolve();
    if (startPromise !== null) return startPromise;
    const attempt = enqueue(runStart);
    startPromise = attempt;
    const clear = (): void => {
      if (startPromise === attempt) startPromise = null;
    };
    void attempt.then(clear, clear);
    return attempt;
  }

  async function runResume(): Promise<void> {
    if (phase !== 'ready' && phase !== 'background') {
      if (phase === 'failed') throw currentError ?? new FormaError('STORAGE_FAILURE', 'The mobile host failed.');
      throw new FormaError('SERVICE_CLOSED', 'The mobile host is not ready.');
    }
    const calendar = computeCalendar();
    currentCalendar = calendar;
    phase = 'ready';
    notify();
  }

  function resume(): Promise<void> {
    return enqueue(runResume);
  }

  function background(): void {
    if (phase === 'restoring') {
      backgroundDuringRestore = true;
      return;
    }
    if (phase !== 'ready') return;
    phase = 'background';
    notify();
  }

  async function runSetTheme(theme: MobileTheme): Promise<void> {
    if (!isMobileTheme(theme)) throw invalidInput('The theme is not supported.', 'theme');
    if (phase !== 'ready' && phase !== 'background') {
      if (phase === 'failed') throw currentError ?? new FormaError('STORAGE_FAILURE', 'The mobile host failed.');
      throw new FormaError('SERVICE_CLOSED', 'The mobile host is not ready.');
    }
    const next: MobilePreferences = Object.freeze({ ...currentPreferences, theme });
    persistPreferences(next);
    currentPreferences = next;
    notify();
  }

  function setTheme(theme: MobileTheme): Promise<void> {
    return enqueue(() => runSetTheme(theme));
  }

  async function runReplaceRecords<T>(run: (service: FormaService) => Promise<T>): Promise<T> {
    if (typeof run !== 'function') throw invalidInput('The replacement must be a function.', 'run');
    if ((phase !== 'ready' && phase !== 'background') || activeService === null) {
      if (phase === 'failed') throw currentError ?? new FormaError('STORAGE_FAILURE', 'The mobile host failed.');
      throw new FormaError('SERVICE_CLOSED', 'The mobile host is not ready.');
    }
    const service = activeService;
    backgroundDuringRestore = phase === 'background';
    phase = 'restoring';
    notify();
    try {
      const result = await run(service);
      recordsEpoch += 1;
      return result;
    } catch (cause) {
      // An unconfirmed failure can hide a committed replacement. Treat the records as changed.
      const code = cause instanceof FormaError ? cause.code : null;
      if (code === null || !UNCHANGED_CODES.has(code)) recordsEpoch += 1;
      throw cause;
    } finally {
      phase = backgroundDuringRestore ? 'background' : 'ready';
      backgroundDuringRestore = false;
      notify();
    }
  }

  function replaceRecords<T>(run: (service: FormaService) => Promise<T>): Promise<T> {
    return enqueue(() => runReplaceRecords(run));
  }

  async function runClose(): Promise<void> {
    if (phase === 'closed') return;
    phase = 'closing';
    notify();
    const service = activeService;
    activeService = null;
    if (service !== null) {
      try {
        await service.close();
      } catch (cause) {
        const error = toFormaError(cause, 'The mobile host could not close its service.');
        currentError = error;
        phase = 'failed';
        notify();
        throw error;
      }
    }
    currentCalendar = null;
    currentError = null;
    phase = 'closed';
    notify();
  }

  function close(): Promise<void> {
    if (closePromise !== null) return closePromise;
    const attempt = enqueue(runClose);
    closePromise = attempt;
    return attempt;
  }

  function service(): FormaService {
    if (phase === 'restoring') {
      throw new FormaError('CONFLICT', 'A restore is running. Try again after it ends.', { field: 'restore' });
    }
    if ((phase === 'ready' || phase === 'background') && activeService !== null) return activeService;
    if (currentError !== null && phase === 'failed') throw currentError;
    throw new FormaError('SERVICE_CLOSED', 'The mobile host has no open service.');
  }

  function snapshot(): MobileHostSnapshot {
    return Object.freeze({
      phase,
      preferences: Object.freeze({ ...currentPreferences }),
      calendar: currentCalendar === null ? null : Object.freeze({ ...currentCalendar }),
      error: currentError,
      recordsEpoch,
    });
  }

  function subscribe(listener: () => void): () => void {
    if (typeof listener !== 'function') throw invalidInput('The listener must be a function.', 'listener');
    listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  }

  return { start, resume, background, close, snapshot, setTheme, subscribe, service, replaceRecords };
}
