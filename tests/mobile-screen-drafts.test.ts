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

function setForm(store: ReturnType<typeof forms>, previous: WorkoutSet | null) {
  const runtime = hookRuntime();
  const exports = loadScreen('Entry.tsx', runtime.react, {
    '../ui/controls': {...CONTROLS, describeError: () => ({field: null, code: 'X', message: ''})},
    '../ui/LoadPicker': {...tags(['LoadPicker', 'LoadTrigger']), loadLabel: () => 'load'},
    './context': {useCommand: () => ({}), useServiceRead: () => ({loaded: {state: 'loading'}, reload: () => {}})},
    './workoutCommands': {},
    './Home': {},
  });
  const workout = {id: 'w1', date: '2026-10-13', updatedAt: 'r1', sets: previous ? [previous] : []};
  const ctx = {forms: store, palette: {}, host: {}, snapshot: {phase: 'ready'}, push: () => {}};
  const props = {ctx, workout, exerciseId: 'incline', exerciseName: 'Incline', previous,
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
