import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as core from '@forma/core';
import type { WorkoutSet } from '@forma/core';
import * as formsModule from '../apps/mobile/src/forms/index.js';
import type { CommandLedger, DraftStore } from '../apps/mobile/src/forms/index.js';
import { memoryFixture } from './helpers.js';

interface Element {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
  readonly children: readonly unknown[];
}

/**
 * A minimal hook runtime: state survives a render, and a new mount starts with
 * new state, as after navigation. Child components do not render. Native
 * layout and the real React scheduler still need the phone.
 */
function hookRuntime() {
  let slots: unknown[] = [];
  let index = 0;
  let effects: (() => void)[] = [];
  const react = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element =>
      ({type, props: props ?? {}, children}),
    Fragment: 'Fragment',
    useState(initial: unknown) {
      const own = slots;
      const slot = index++;
      if (!(slot in own)) own[slot] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      const set = (value: unknown) => {
        own[slot] = typeof value === 'function' ? (value as (current: unknown) => unknown)(own[slot]) : value;
      };
      return [own[slot], set];
    },
    useRef(initial: unknown) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = {current: initial};
      return slots[slot];
    },
    // The screens under test use mount effects only.
    useEffect(effect: () => void) {
      const slot = index++;
      if (!(slot in slots)) {slots[slot] = true; effects.push(effect);}
    },
  };
  return {
    react,
    mount<P extends object>(component: (props: P) => Element, props: P) {
      const own: unknown[] = [];
      const render = () => {
        slots = own;
        index = 0;
        const tree = component(props);
        const pending = effects;
        effects = [];
        pending.forEach(effect => effect());
        return view(tree);
      };
      return {render};
    },
  };
}

function view(tree: Element) {
  const elements: Element[] = [];
  const text: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {node.forEach(visit); return;}
    if (typeof node === 'string' || typeof node === 'number') {text.push(String(node)); return;}
    if (node !== null && typeof node === 'object' && 'children' in node) {
      const element = node as Element;
      elements.push(element);
      element.children.forEach(visit);
    }
  };
  visit(tree);
  const find = (match: (props: Record<string, unknown>) => boolean): Element => {
    const found = elements.find(element => match(element.props));
    assert.ok(found, 'Missing element');
    return found;
  };
  return {
    text: text.join(' '),
    has: (match: (props: Record<string, unknown>) => boolean) => elements.some(element => match(element.props)),
    byLabel: (label: string) => find(props => props.label === label),
    labelPosition: (label: string) => elements.indexOf(find(props => props.label === label)),
    byAccessibility: (label: string) => find(props => props.accessibilityLabel === label),
    byType: (type: string) => {
      const found = elements.find(element => element.type === type);
      assert.ok(found, `Missing ${type}`);
      return found;
    },
  };
}

function loadScreen(file: string, react: object, modules: Record<string, unknown>): Record<string, unknown> {
  const all: Record<string, unknown> = {
    react,
    'react-native': tags(['Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View']),
    '@forma/core': core,
    '../forms/index': formsModule,
    '../ui/theme': {shared: {}},
    ...modules,
  };
  const source = readFileSync(resolve('apps/mobile/src/screens', file), 'utf8');
  const output = ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  }}).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(output, {exports, require: (name: string) => {
    assert.ok(Object.hasOwn(all, name), `Unexpected screen import: ${name}`);
    return all[name];
  }});
  return exports;
}

function tags(names: string[]): Record<string, string> {
  return Object.fromEntries(names.map(name => [name, name]));
}

const CONTROLS = tags(['Button', 'Card', 'ConfirmSheet', 'ErrorNotice', 'Muted', 'ScreenHeader']);

function sequence(prefix: string): { next(): string } {
  let count = 0;
  return { next: () => prefix + '-' + ++count };
}

function forms(): { drafts: DraftStore; commands: CommandLedger } {
  return {drafts: formsModule.createDraftStore(), commands: formsModule.createCommandLedger(sequence('req'))};
}

/** Reads give a ready empty result. Each read key is recorded, so a query change is visible. */
function readRecorder() {
  const keys: string[] = [];
  const useServiceRead = (_host: unknown, key: string) => {
    keys.push(key);
    if (key === 'catalog') return {loaded: {state: 'ready', value: {splitDays: [], exercises: []}}, reload: () => {}};
    if (key === 'exercises') return {loaded: {state: 'ready', value: []}, reload: () => {}};
    if (key.startsWith('{"exerciseId":null')) return {loaded: {state: 'ready', value: null}, reload: () => {}};
    return {loaded: {state: 'ready', value: {items: [], nextCursor: null}}, reload: () => {}};
  };
  return {keys, useServiceRead, last: (skip: string) => keys.filter(key => key !== skip).at(-1)};
}

// Entry: the restored-notice Clear action.

function setForm(store: ReturnType<typeof forms>, previous: WorkoutSet | null,
  service?: core.FormaService, exerciseId = 'incline', phase = 'ready') {
  const runtime = hookRuntime();
  const exports = loadScreen('Entry.tsx', runtime.react, {
    '../ui/controls': {...CONTROLS, describeError: () => ({field: null, code: 'X', message: ''})},
    '../ui/LoadPicker': {...tags(['LoadPicker', 'LoadTrigger']), loadLabel: () => 'load'},
    './context': {useCommand: () => ({}), useServiceRead: () => ({loaded: {state: 'loading'}, reload: () => {}})},
    './workoutCommands': {},
    './Home': {},
  });
  const workout = {id: 'w1', date: '2026-10-13', updatedAt: 'r1', sets: previous ? [previous] : []};
  const ctx = {forms: store, palette: {}, host: {service: () => {
    assert.ok(service, 'A Save test must supply the real service');
    return service;
  }}, snapshot: {phase}, push: () => {}};
  const props = {ctx, workout, exerciseId, exerciseName: 'Incline', previous,
    nextIndex: previous ? 2 : 1, onSettled: () => {}};
  // A new mount is a return to the entry screen after Home.
  return () => runtime.mount(exports.SetForm as (props: object) => Element, props);
}

const INCLINE: WorkoutSet = {
  id: 's1', exerciseId: 'incline', reps: 5, weightKg: 20, rpe: null, position: 1, loadConvention: 'entered', implementCount: null,
};
const DRAFT_KEY = 'set:w1:incline';
const RESTORED = /Unsaved values restored/;
const reps = (screen: ReturnType<typeof view>) => screen.byLabel('Reps').props.value;

test('Clear after a restored draft keeps the notice absent after another return', () => {
  const store = forms();
  const open = setForm(store, INCLINE);
  let screen = open().render();
  assert.equal(reps(screen), '5');
  (screen.byLabel('Reps').props.onChange as (text: string) => void)('6');

  const resumed = open();
  screen = resumed.render();
  assert.match(screen.text, RESTORED);
  assert.equal(reps(screen), '6');
  (screen.byLabel('Clear').props.onPress as () => void)();
  screen = resumed.render();
  assert.doesNotMatch(screen.text, RESTORED);
  assert.equal(reps(screen), '5');
  assert.equal(screen.byLabel('Weight · kg').props.value, '20');
  assert.equal(store.drafts.get(DRAFT_KEY), null);

  screen = open().render();
  assert.doesNotMatch(screen.text, RESTORED);
  assert.equal(reps(screen), '5');
  assert.equal(screen.byLabel('Weight · kg').props.value, '20');
});

test('Clear on an exercise without a committed set returns to the empty form', () => {
  const store = forms();
  const open = setForm(store, null);
  let screen = open().render();
  (screen.byLabel('Weight · kg').props.onChange as (text: string) => void)('30');

  const resumed = open();
  screen = resumed.render();
  assert.match(screen.text, RESTORED);
  (screen.byLabel('Clear').props.onPress as () => void)();
  screen = resumed.render();
  assert.equal(screen.byLabel('Weight · kg').props.value, '');
  assert.equal(store.drafts.get(DRAFT_KEY), null);

  screen = open().render();
  assert.doesNotMatch(screen.text, RESTORED);
  assert.equal(reps(screen), '');
  assert.equal(screen.byLabel('Weight · kg').props.value, '');
});

test('Clear keeps an unconfirmed set command and its request identity', async () => {
  const store = forms();
  const slot = formsModule.addSetSlot('w1', 'incline');
  const input = {workoutId: 'w1', exerciseId: 'incline', reps: 6, weightKg: 20};
  await assert.rejects(store.commands.run(slot, input, async () => {
    throw new core.FormaError('STORAGE_FAILURE', 'No answer.');
  }));
  const before = store.commands.pending(slot);
  assert.equal(before?.unconfirmed, true);
  store.drafts.set(DRAFT_KEY, {...formsModule.EMPTY_SET_DRAFT, reps: '6', weight: '20'});

  const resumed = setForm(store, INCLINE)();
  let screen = resumed.render();
  assert.match(screen.text, RESTORED);
  (screen.byLabel('Clear').props.onPress as () => void)();
  screen = resumed.render();
  assert.deepEqual(store.commands.pending(slot), before);
  assert.match(screen.text, /The last save is unconfirmed/);
});

// Accepted Save intent must survive settlement, a new render, and a new mount.
const REAL_EXERCISE = 'incline-dumbbell-press';
const REAL_SLOT = formsModule.addSetSlot('w1', REAL_EXERCISE);
function enteredDraft(store: ReturnType<typeof forms>) {
  store.drafts.set(`set:w1:${REAL_EXERCISE}`, {
    reps: '6', weight: '20', rpe: '8.5', loadConvention: 'per-hand', implementCount: 2,
  });
}
const press = (screen: ReturnType<typeof view>, label: string) =>
  (screen.byLabel(label).props.onPress as () => void)();
async function settle(store: ReturnType<typeof forms>) {
  const attempt = store.commands.current<WorkoutSet>(REAL_SLOT);
  if (attempt) await attempt;
}

test('a closed service hides confirmation and disables Save', () => {
  const screen = setForm(forms(), INCLINE, undefined, 'incline', 'closed')().render();
  assert.equal(screen.byLabel('Save set').props.disabledReason, 'The local service is closed. Restart the app to add more.');
  assert.equal(screen.has(props => props.label === 'Confirm values for set 2'), false);
});

test('two screen Save callbacks before settlement send only one command', async t => {
  const {service} = memoryFixture(t, ['w1']);
  await service.workouts.start({requestId: 'screen-start', date: '2026-10-13', splitDayId: 'upper'});
  let release!: () => void;
  const gate = new Promise<void>(done => {release = done;});
  const keys: string[] = [];
  const hostService = {...service, workouts: {...service.workouts, addSet: async (input: core.AddSetInput) => {
    keys.push(input.requestId);
    await gate;
    return service.workouts.addSet(input);
  }}};
  const store = forms();
  enteredDraft(store);
  const screen = setForm(store, null, hostService, REAL_EXERCISE)().render();
  press(screen, 'Save set');
  press(screen, 'Save set');
  assert.deepEqual(keys, ['req-1']);
  release();
  await settle(store);
  assert.equal((await service.workouts.get('w1')).sets.length, 1);
});

test('a queued Save callback after a confirmed result cannot add the set again', async t => {
  const {service} = memoryFixture(t, ['w1']);
  await service.workouts.start({requestId: 'screen-start', date: '2026-10-13', splitDayId: 'upper'});
  const store = forms();
  enteredDraft(store);
  const mounted = setForm(store, null, service, REAL_EXERCISE)();
  const before = mounted.render();
  press(before, 'Save set');
  await settle(store);
  assert.equal(store.commands.pending(REAL_SLOT), null, 'The first receipt is confirmed, not still pending');
  // React can still dispatch the callback that existed before settlement.
  press(before, 'Save set');
  await settle(store);
  assert.equal((await service.workouts.get('w1')).sets.length, 1);
});

test('a new form needs new intent and can deliberately save identical consecutive sets', async t => {
  const {service} = memoryFixture(t, ['w1']);
  await service.workouts.start({requestId: 'screen-start', date: '2026-10-13', splitDayId: 'upper'});
  const store = forms();
  enteredDraft(store);
  press(setForm(store, null, service, REAL_EXERCISE)().render(), 'Save set');
  await settle(store);
  const first = (await service.workouts.get('w1')).sets[0]!;
  const mounted = setForm(store, first, service, REAL_EXERCISE)();
  let screen = mounted.render();
  assert.equal(reps(screen), '6');
  assert.equal(screen.byLabel('Weight · kg').props.value, '20');
  // Even a stale event delivered to a disabled control must not send a command.
  press(screen, 'Save set');
  await settle(store);
  assert.equal((await service.workouts.get('w1')).sets.length, 1);
  assert.ok(screen.byLabel('Save set').props.disabledReason);
  press(screen, 'Confirm values for set 2');
  screen = mounted.render();
  assert.equal(screen.byLabel('Save set').props.disabledReason, null);
  press(screen, 'Save set');
  await settle(store);
  const saved = (await service.workouts.get('w1')).sets;
  assert.equal(saved.length, 2);
  assert.notEqual(saved[0]!.id, saved[1]!.id);
  assert.deepEqual(saved.map(({reps, weightKg, loadConvention, implementCount, rpe}) =>
    ({reps, weightKg, loadConvention, implementCount, rpe})), Array(2).fill({
    reps: 6, weightKg: 20, loadConvention: 'per-hand', implementCount: 2, rpe: 8.5,
  }));
});

test('next-set confirmation precedes the fields instead of the Save section', () => {
  const screen = setForm(forms(), INCLINE)().render();
  const confirm = screen.labelPosition('Confirm values for set 2');
  assert.ok(confirm < screen.labelPosition('Reps'));
  assert.ok(confirm < screen.labelPosition('Weight · kg'));
  assert.ok(confirm < screen.labelPosition('Save set'));
  // Source order alone does not prove native bounds or gesture targets.
});

test('an edit supplies next-set intent without a separate confirmation', async t => {
  const {service} = memoryFixture(t, ['w1']);
  await service.workouts.start({requestId: 'screen-start', date: '2026-10-13', splitDayId: 'upper'});
  const first = await service.workouts.addSet({requestId: 'first-set', workoutId: 'w1', exerciseId: REAL_EXERCISE,
    reps: 6, weightKg: 20, loadConvention: 'per-hand', implementCount: 2, rpe: 8.5});
  const store = forms();
  const mounted = setForm(store, first, service, REAL_EXERCISE)();
  let screen = mounted.render();
  (screen.byLabel('Reps').props.onChange as (text: string) => void)('7');
  screen = mounted.render();
  assert.equal(screen.byLabel('Save set').props.disabledReason, null);
  press(screen, 'Save set');
  await settle(store);
  assert.deepEqual((await service.workouts.get('w1')).sets.map(set => set.reps), [6, 7]);
});

test('same-render field edits supply the exact current next-set intent', async t => {
  const {service} = memoryFixture(t, ['w1']);
  await service.workouts.start({requestId: 'screen-start', date: '2026-10-13', splitDayId: 'upper'});
  const first = await service.workouts.addSet({requestId: 'first-set', workoutId: 'w1', exerciseId: REAL_EXERCISE,
    reps: 6, weightKg: 20, loadConvention: 'per-hand', implementCount: 2, rpe: 8.5});
  const store = forms();
  const mounted = setForm(store, first, service, REAL_EXERCISE)();
  const before = mounted.render();
  (before.byLabel('Reps').props.onChange as (text: string) => void)('7');
  (before.byLabel('Weight · kg').props.onChange as (text: string) => void)('30');
  // The Save callback from that same render must use both new field values.
  press(before, 'Save set');
  await settle(store);
  const saved = (await service.workouts.get('w1')).sets;
  assert.equal(saved.length, 2);
  assert.equal(saved[1]!.reps, 7);
  assert.equal(saved[1]!.weightKg, 30);
  const screen = mounted.render();
  assert.equal(reps(screen), '7');
  assert.equal(screen.byLabel('Weight · kg').props.value, '30');
});

test('a lost Save answer still retries the original receipt without another set', async t => {
  const {service} = memoryFixture(t, ['w1']);
  await service.workouts.start({requestId: 'screen-start', date: '2026-10-13', splitDayId: 'upper'});
  const keys: string[] = [];
  let lose = true;
  const hostService = {...service, workouts: {...service.workouts, addSet: async (input: core.AddSetInput) => {
    keys.push(input.requestId);
    const saved = await service.workouts.addSet(input);
    if (lose) throw new Error('The answer was lost after the commit');
    return saved;
  }}};
  const store = forms();
  enteredDraft(store);
  const mounted = setForm(store, null, hostService, REAL_EXERCISE)();
  const before = mounted.render();
  press(before, 'Save set');
  await assert.rejects(settle(store));
  assert.equal(store.commands.pending(REAL_SLOT)?.unconfirmed, true);
  lose = false;
  // A return after the committed result became visible must still replay the old request.
  const committed = (await service.workouts.get('w1')).sets[0]!;
  const resumed = setForm(store, committed, hostService, REAL_EXERCISE)();
  press(resumed.render(), 'Save set');
  await settle(store);
  assert.deepEqual(keys, ['req-1', 'req-1']);
  assert.equal((await service.workouts.get('w1')).sets.length, 1);
  assert.equal(store.commands.pending(REAL_SLOT), null);
});

// History: typed but unapplied dates.

function historyScreen(store: ReturnType<typeof forms>) {
  const runtime = hookRuntime();
  const reads = readRecorder();
  const exports = loadScreen('History.tsx', runtime.react, {
    '../ui/controls': CONTROLS,
    '../ui/ExercisePicker': tags(['ExercisePicker']),
    './context': {useServiceRead: reads.useServiceRead},
    './Home': {setCountText: () => '', splitName: () => ''},
  });
  const ctx = {forms: store, palette: {}, host: {}, push: () => {}};
  return {reads, open: () => runtime.mount(exports.History as (props: object) => Element, {ctx})};
}

const historyQuery = (dates: {dateFrom?: string; dateTo?: string} = {}, status = 'finished') =>
  JSON.stringify({status, limit: 20, ...dates});
const typeInto = (screen: ReturnType<typeof view>, label: string, text: string) =>
  (screen.byAccessibility(label).props.onChangeText as (value: string) => void)(text);

test('unapplied history dates survive a return without a query change', () => {
  const store = forms();
  const {reads, open} = historyScreen(store);
  let screen = open().render();
  typeInto(screen, 'History start date', '2099-01-01');
  screen = open().render();
  assert.equal(screen.byAccessibility('History start date').props.value, '2099-01-01');
  assert.equal(reads.last('catalog'), historyQuery());
  assert.equal(store.drafts.get('history:filters'), null);
});

test('history Load and a filter change apply the visible dates', () => {
  const store = forms();
  const {reads, open} = historyScreen(store);
  const mounted = open();
  let screen = mounted.render();
  typeInto(screen, 'History start date', '2099-01-01');
  const resumed = open();
  screen = resumed.render();
  assert.equal(reads.last('catalog'), historyQuery());
  typeInto(screen, 'History end date', '2099-12-31');
  screen = resumed.render();
  (screen.byAccessibility('Status: All').props.onPress as () => void)();
  screen = resumed.render();
  assert.equal(reads.last('catalog'), historyQuery({dateFrom: '2099-01-01', dateTo: '2099-12-31'}, 'all'));
  assert.equal(store.drafts.get('history:typedDates'), null);

  typeInto(screen, 'History start date', ' 2098-01-01 ');
  screen = resumed.render();
  (screen.byLabel('Load history').props.onPress as () => void)();
  screen = open().render();
  assert.equal(reads.last('catalog'), historyQuery({dateFrom: '2098-01-01', dateTo: '2099-12-31'}, 'all'));
  assert.equal(screen.byAccessibility('History start date').props.value, '2098-01-01');
});

test('history Clear filters removes applied and typed dates', () => {
  const store = forms();
  const {reads, open} = historyScreen(store);
  const mounted = open();
  let screen = mounted.render();
  typeInto(screen, 'History start date', '2099-01-01');
  screen = mounted.render();
  (screen.byLabel('Load history').props.onPress as () => void)();
  screen = mounted.render();
  typeInto(screen, 'History end date', '2099-12-31');
  screen = mounted.render();
  (screen.byLabel('Clear filters').props.onPress as () => void)();
  mounted.render();
  assert.equal(reads.last('catalog'), historyQuery());

  screen = open().render();
  assert.equal(screen.byAccessibility('History start date').props.value, '');
  assert.equal(screen.byAccessibility('History end date').props.value, '');
  assert.equal(store.drafts.get('history:typedDates'), null);
});

// Progress: typed but unapplied custom dates.

function progressScreen(store: ReturnType<typeof forms>) {
  const runtime = hookRuntime();
  const reads = readRecorder();
  const exports = loadScreen('Progress.tsx', runtime.react, {
    '../adapters/device': {deviceAdapters: {platform: {nowUtc: () => '2026-10-13T10:00:00.000Z', timeZone: () => 'UTC'}}},
    '../ui/controls': CONTROLS,
    '../ui/ExercisePicker': tags(['ExercisePicker']),
    './context': {useServiceRead: reads.useServiceRead},
  });
  const ctx = {forms: store, palette: {}, host: {}, push: () => {}};
  return {reads, open: () => runtime.mount(exports.Progress as (props: object) => Element, {ctx})};
}

const progressQuery = (range: object) => JSON.stringify({exerciseId: 'incline', range});
const THIS_WEEK = core.resolveCalendarRange({nowUtc: '2026-10-13T10:00:00.000Z', timeZone: 'UTC', period: 'this-week'});

function chooseIncline(screen: ReturnType<typeof view>) {
  (screen.byType('ExercisePicker').props.onPick as (id: string) => void)('incline');
}

test('unapplied progress dates survive a return without a query change', () => {
  const store = forms();
  const {reads, open} = progressScreen(store);
  const mounted = open();
  let screen = mounted.render();
  chooseIncline(screen);
  screen = mounted.render();
  (screen.byLabel('Custom dates').props.onPress as () => void)();
  screen = mounted.render();
  assert.equal(reads.last('exercises'), progressQuery({dateFrom: '', dateTo: ''}));
  typeInto(screen, 'Progress start date', '2026-01-01');

  screen = open().render();
  assert.equal(screen.byAccessibility('Progress start date').props.value, '2026-01-01');
  assert.equal(screen.byLabel('Custom dates').props.selected, true);
  assert.equal(reads.last('exercises'), progressQuery({dateFrom: '', dateTo: ''}));
  assert.equal(store.drafts.get<{dateFrom: string}>('progress:filters')?.dateFrom, '');
});

test('progress Apply and a range change use the visible dates and keep relative ranges', () => {
  const store = forms();
  const {reads, open} = progressScreen(store);
  const mounted = open();
  let screen = mounted.render();
  chooseIncline(screen);
  screen = mounted.render();
  (screen.byLabel('Custom dates').props.onPress as () => void)();
  screen = mounted.render();
  typeInto(screen, 'Progress start date', '2026-01-01');
  screen = mounted.render();
  typeInto(screen, 'Progress end date', '2026-01-31');

  const resumed = open();
  screen = resumed.render();
  (screen.byLabel('Apply dates').props.onPress as () => void)();
  screen = resumed.render();
  assert.equal(reads.last('exercises'), progressQuery({dateFrom: '2026-01-01', dateTo: '2026-01-31'}));
  assert.equal(store.drafts.get('progress:typedDates'), null);

  // A relative range resolves in the core and ignores the typed dates.
  typeInto(screen, 'Progress end date', '2026-02-28');
  screen = resumed.render();
  (screen.byLabel('This week').props.onPress as () => void)();
  screen = resumed.render();
  assert.equal(reads.last('exercises'), progressQuery({dateFrom: THIS_WEEK.dateFrom, dateTo: THIS_WEEK.dateTo}));
  assert.equal(screen.has(props => props.accessibilityLabel === 'Progress start date'), false);

  const returned = open();
  screen = returned.render();
  (screen.byLabel('Custom dates').props.onPress as () => void)();
  returned.render();
  assert.equal(reads.last('exercises'), progressQuery({dateFrom: '2026-01-01', dateTo: '2026-02-28'}));
});

test('history date edits preserve both fields without an intervening render', () => {
  const store = forms();
  const {reads, open} = historyScreen(store);
  const mounted = open();
  let screen = mounted.render();
  // Both events use handlers from the same render.
  typeInto(screen, 'History start date', '2099-01-01');
  typeInto(screen, 'History end date', '2099-01-02');
  screen = mounted.render();
  assert.equal(screen.byAccessibility('History start date').props.value, '2099-01-01');
  assert.equal(screen.byAccessibility('History end date').props.value, '2099-01-02');
  assert.equal(store.drafts.get<formsModule.DateDraft>('history:typedDates')?.dateFrom, '2099-01-01');
  assert.equal(store.drafts.get<formsModule.DateDraft>('history:typedDates')?.dateTo, '2099-01-02');
  assert.equal(reads.last('catalog'), historyQuery());
  screen = open().render();
  assert.equal(screen.byAccessibility('History start date').props.value, '2099-01-01');
  assert.equal(screen.byAccessibility('History end date').props.value, '2099-01-02');
});

test('progress date edits preserve both fields without an intervening render', () => {
  const store = forms();
  const {reads, open} = progressScreen(store);
  const mounted = open();
  let screen = mounted.render();
  chooseIncline(screen);
  screen = mounted.render();
  (screen.byLabel('Custom dates').props.onPress as () => void)();
  screen = mounted.render();
  typeInto(screen, 'Progress start date', '2026-01-01');
  typeInto(screen, 'Progress end date', '2026-01-31');
  screen = mounted.render();
  assert.equal(screen.byAccessibility('Progress start date').props.value, '2026-01-01');
  assert.equal(screen.byAccessibility('Progress end date').props.value, '2026-01-31');
  assert.equal(store.drafts.get<formsModule.DateDraft>('progress:typedDates')?.dateFrom, '2026-01-01');
  assert.equal(store.drafts.get<formsModule.DateDraft>('progress:typedDates')?.dateTo, '2026-01-31');
  assert.equal(reads.last('exercises'), progressQuery({dateFrom: '', dateTo: ''}));
  const returned = open();
  screen = returned.render();
  assert.equal(screen.byAccessibility('Progress start date').props.value, '2026-01-01');
  assert.equal(screen.byAccessibility('Progress end date').props.value, '2026-01-31');
  (screen.byLabel('Apply dates').props.onPress as () => void)();
  returned.render();
  assert.equal(reads.last('exercises'), progressQuery({dateFrom: '2026-01-01', dateTo: '2026-01-31'}));
});
