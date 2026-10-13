import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { FormaService, PreviousSetsResult } from '@forma/core';
import { FormaError } from '@forma/core';
import { memoryFixture } from './helpers.js';

interface Element {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
  readonly children: readonly unknown[];
}

type Loaded = {state: 'loading'} | {state: 'error'; error: unknown} | {state: 'ready'; value: PreviousSetsResult};

/** Component contract checks only: native layout and React lifecycle still need the phone. */
function renderPreviousSets(loaded: Loaded) {
  let read!: (service: FormaService) => Promise<PreviousSetsResult>;
  let reloads = 0;
  const pushed: unknown[] = [];
  const ctx = {host: {}, palette: {}, push: (screen: unknown) => pushed.push(screen)};
  const tags = (names: string[]) => Object.fromEntries(names.map(name => [name, name]));
  const modules: Record<string, unknown> = {
    react: {createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element =>
      ({type, props: props ?? {}, children})},
    'react-native': tags(['Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View']),
    '../forms/index': {},
    '../ui/controls': tags(['Button', 'Card', 'ConfirmSheet', 'ErrorNotice', 'Muted', 'ScreenHeader']),
    '../ui/LoadPicker': {},
    '../ui/theme': {shared: {label: {}}},
    './context': {useServiceRead: (_host: unknown, _key: string, query: typeof read) => {
      read = query;
      return {loaded, reload: () => reloads++};
    }},
    './workoutCommands': {},
    './Home': {},
  };
  const source = readFileSync(resolve('apps/mobile/src/screens/Entry.tsx'), 'utf8');
  const output = ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
  }}).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(output, {exports, require: (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected screen import: ${name}`);
    return modules[name];
  }});
  const component = exports.PreviousSets as (props: object) => Element;
  const tree = component({ctx, exerciseId: 'lat-pulldown', beforeDate: '2026-02-10', refreshKey: 'revision'});
  const elements: Element[] = [];
  const text: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {node.forEach(visit); return;}
    if (typeof node === 'string') {text.push(node); return;}
    if (node !== null && typeof node === 'object' && 'children' in node) {
      const element = node as Element;
      elements.push(element);
      element.children.forEach(visit);
    }
  };
  visit(tree);
  return {read, elements, text: text.join(' '), pushed, reloads: () => reloads};
}

test('previous sets query the current exercise before the saved workout date', async (t) => {
  const {service} = memoryFixture(t);
  const previous = await service.workouts.create({requestId: 'previous', date: '2026-02-09'});
  const sameDate = await service.workouts.create({requestId: 'same-date', date: '2026-02-10'});
  const current = await service.workouts.start({requestId: 'current', date: '2026-02-10'});
  for (const workout of [previous, sameDate, current]) {
    await service.workouts.addSet({requestId: 'set-' + workout.id, workoutId: workout.id,
      exerciseId: 'lat-pulldown', reps: 8, weightKg: 50});
  }
  const rendered = renderPreviousSets({state: 'loading'});
  assert.match(rendered.text, /Loading previous sets/);
  const result = await rendered.read(service);
  assert.equal(result.exerciseId, 'lat-pulldown');
  assert.equal(result.beforeDate, current.date);
  assert.equal(result.workout?.id, previous.id);
  assert.equal(result.sets.length, 1);
  assert.equal(result.sets[0]?.loadConvention, 'unknown');

  const ready = renderPreviousSets({state: 'ready', value: result});
  const rows = ready.elements.filter(element => typeof element.type === 'function');
  assert.equal(rows.length, result.sets.length);
  assert.equal(rows[0]?.props.set, result.sets[0]);
  const source = ready.elements.find(element => element.type === 'Button');
  assert.equal(source?.props.label, 'Open previous workout: 2026-02-09');
  (source?.props.onPress as () => void)();
  assert.equal(JSON.stringify(ready.pushed), JSON.stringify([{name: 'Summary', workoutId: previous.id}]));
});

test('previous sets show an empty state without a source link', () => {
  const rendered = renderPreviousSets({state: 'ready', value: {
    exerciseId: 'lat-pulldown', beforeDate: '2026-02-10', revision: 0, workout: null, sets: [],
  }});
  assert.match(rendered.text, /No earlier finished workout/);
  assert.equal(rendered.elements.some(element => element.type === 'Button'), false);
});

test('a failed previous-sets read keeps the typed error and offers a retry', () => {
  const error = new FormaError('STORAGE_FAILURE', 'The read failed.');
  const rendered = renderPreviousSets({state: 'error', error});
  assert.equal(rendered.elements.find(element => element.type === 'ErrorNotice')?.props.error, error);
  const retry = rendered.elements.find(element => element.type === 'Button');
  assert.equal(retry?.props.label, 'Reload previous sets');
  (retry?.props.onPress as () => void)();
  assert.equal(rendered.reloads(), 1);
  assert.equal(rendered.pushed.length, 0);
});
