import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ARCHIVE_LIMITS, FormaError, createFormaService } from '@forma/core';
import type { FormaService } from '@forma/core';
import { createMobileHost } from '@forma/mobile-host';
import type { MobileHost } from '@forma/mobile-host';
import * as flowModule from '../apps/mobile/src/archive/flow.js';
import type { ArchiveFiles, ArchiveFlow, ArchiveService, OpenResult, SaveResult } from '../apps/mobile/src/archive/flow.js';
import { createCommandLedger } from '../apps/mobile/src/forms/index.js';
import type { CommandLedger } from '../apps/mobile/src/forms/index.js';
import { signedArchive } from './fixtures/archive-cases.js';
import { MemoryWorkoutStore, TEST_TIME } from './helpers.js';

interface Element { readonly type: unknown; readonly props: Record<string, unknown>; readonly children: readonly unknown[]; }

/** State survives a render. Mount effects run once. Child components do not render. */
function mount<P extends object>(component: (props: P) => Element, props: P) {
  const slots: unknown[] = [];
  let index = 0;
  const effects: (() => unknown)[] = [];
  const react = {
    createElement: (type: unknown, elementProps: Record<string, unknown> | null, ...children: unknown[]): Element =>
      ({ type, props: elementProps ?? {}, children }),
    Fragment: 'Fragment',
    useState(initial: unknown) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], (value: unknown) => {
        slots[slot] = typeof value === 'function' ? (value as (current: unknown) => unknown)(slots[slot]) : value;
      }];
    },
    useEffect(effect: () => unknown) {
      const slot = index++;
      if (!(slot in slots)) { slots[slot] = true; effects.push(effect); }
    },
  };
  return { react, render: () => {
    index = 0;
    const tree = component(props);
    effects.splice(0).forEach((effect) => effect());
    return view(tree);
  } };
}

let lastTree: Element | undefined;
function view(tree: Element) {
  lastTree = tree;
  const elements: Element[] = [];
  const text: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (typeof node === 'string' || typeof node === 'number') { text.push(String(node)); return; }
    if (node !== null && typeof node === 'object' && 'children' in node) { elements.push(node as Element); (node as Element).children.forEach(visit); }
  };
  visit(tree);
  return {
    text: text.join(' '),
    button: (label: string) => {
      const found = elements.find((element) => element.type === 'Button' && element.props.label === label);
      assert.ok(found, 'Missing button ' + label);
      return found.props as { onPress: () => void; disabledReason?: string | null; busyLabel?: string | null };
    },
    hasButton: (label: string) => elements.some((element) => element.type === 'Button' && element.props.label === label),
    sheet: (title: string) => {
      const found = elements.find((element) => element.type === 'ConfirmSheet' && element.props.title === title);
      assert.ok(found, 'Missing sheet ' + title);
      return found.props as { visible: boolean; body: string; onConfirm: () => void; onKeep: () => void };
    },
  };
}

type Screen = (props: { palette: object; flow: ArchiveFlow; ready: boolean }) => Element;
function screen(flow: ArchiveFlow) {
  const holder: { react?: object } = {};
  let compiled: Screen | undefined;
  const component = ((props) => {
    if (compiled) return compiled(props);
    const source = readFileSync(resolve('apps/mobile/src/screens/Archive.tsx'), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
    } }).outputText;
    const modules: Record<string, unknown> = {
      react: holder.react, 'react-native': { StyleSheet: { create: <T>(value: T) => value }, Text: 'Text', View: 'View' },
      '../ui/controls': { Button: 'Button', ConfirmSheet: 'ConfirmSheet', Muted: 'Muted' },
      '../archive/flow': flowModule,
    };
    const exports: Record<string, unknown> = {};
    runInNewContext(output, { exports, require: (name: string) => {
      assert.ok(Object.hasOwn(modules, name), 'Unexpected screen import: ' + name);
      return modules[name];
    } });
    compiled = exports.ArchiveSettings as Screen;
    return compiled(props);
  }) as Screen;
  const mounted = mount(component, { palette: {}, flow, ready: true });
  holder.react = mounted.react;
  return { ...mounted, tree: () => { mounted.render(); return lastTree!; } };
}

async function settled(flow: ArchiveFlow): Promise<void> {
  for (let round = 0; round < 200; round++) {
    await new Promise((done) => setImmediate(done));
    if (flow.state().view.step !== 'busy') return;
  }
  assert.fail('The flow did not settle.');
}

interface Setup {
  readonly host: MobileHost;
  readonly store: MemoryWorkoutStore;
  readonly ledger: CommandLedger;
  readonly saves: string[];
  readonly opens: number[];
  readonly requestIds: string[];
  files: { save: (text: string) => Promise<SaveResult>; open: () => Promise<OpenResult> };
  replaceFailure: FormaError | null;
  flow(): ArchiveFlow;
}

async function setup(t: TestContext): Promise<Setup> {
  const store = new MemoryWorkoutStore();
  let next = 0;
  let saved: string | null = null;
  const host = createMobileHost({
    openService: () => createFormaService({ store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'dst-' + ++next } }),
    preferences: { read: () => saved, write: (value) => { saved = value; } },
    platform: { timeZone: () => 'Europe/Rome', nowUtc: () => TEST_TIME },
  });
  t.after(() => host.close());
  await host.start();
  let request = 0;
  const ledger = createCommandLedger({ next: () => 'restore-request-' + ++request });
  const state: Setup = {
    host, store, ledger, saves: [], opens: [], requestIds: [], replaceFailure: null,
    files: { save: async (text) => ({ status: 'saved', byteLength: Buffer.byteLength(text, 'utf8'), partialFileRemoved: false }),
      open: async () => ({ status: 'cancelled', text: null }) },
    flow: () => flowModule.createArchiveFlow({
      service: () => host.service() as unknown as ArchiveService,
      // An injected failure after the real restore models a commit with a lost result.
      replaceRecords: async (run) => {
        const result = await host.replaceRecords((service) => run(spy(service)));
        const failure = state.replaceFailure;
        state.replaceFailure = null;
        if (failure) throw failure;
        return result;
      },
      files: {
        saveArchive: (text, name) => { state.saves.push(name); return state.files.save(text); },
        openArchive: (maxBytes) => { state.opens.push(maxBytes); return state.files.open(); },
      } satisfies ArchiveFiles,
      restoreLedger: ledger, localDate: () => '2026-10-13', maxBytes: ARCHIVE_LIMITS.maxArchiveBytes,
    }),
  };
  function spy(service: FormaService): ArchiveService {
    return { archive: { ...service.archive, restore: (input: Parameters<FormaService["archive"]["restore"]>[0]) => { state.requestIds.push(input.requestId); return service.archive.restore(input); } } } as unknown as ArchiveService;
  }
  return state;
}

async function archiveText(t: TestContext): Promise<string> {
  const store = new MemoryWorkoutStore();
  let next = 0;
  const service = createFormaService({ store, clock: { nowUtc: () => TEST_TIME }, ids: { next: () => 'src-' + ++next } });
  t.after(() => service.close());
  const live = await service.workouts.start({ requestId: 'src-start', date: '2026-10-01', splitDayId: 'lower' });
  await service.workouts.addSet({ requestId: 'src-set', workoutId: live.id, exerciseId: 'hammer-curls', reps: 10, weightKg: 12 });
  return (await service.archive.export()).text;
}

test('export shows the privacy warning first and reports save, cancel, and partial files', async (t) => {
  const s = await setup(t);
  const flow = s.flow();
  const ui = screen(flow);
  let page = ui.render();
  assert.equal(page.sheet('Export personal records?').visible, false);
  page.button('Export archive').onPress();
  page = ui.render();
  const warning = page.sheet('Export personal records?');
  assert.equal(warning.visible, true);
  for (const phrase of ['plain text', 'deleted records', 'does not encrypt', 'does not prove who made the file']) assert.match(warning.body, new RegExp(phrase));
  warning.onKeep();
  page = ui.render();
  assert.equal(page.sheet('Export personal records?').visible, false);
  assert.deepEqual(s.saves, []);

  const outcomes: [SaveResult | 'mismatch', RegExp][] = [
    [{ status: 'saved', byteLength: -1, partialFileRemoved: false }, /not complete.*can remain/],
    [{ status: 'cancelled', byteLength: 0, partialFileRemoved: false }, /Export cancelled\. The records did not change\. If the file app made an empty file, delete it\./],
    [{ status: 'failed', byteLength: 10, partialFileRemoved: true }, /removed the incomplete file/],
    [{ status: 'failed', byteLength: 10, partialFileRemoved: false }, /incomplete file can remain/],
    ['mismatch', /Archive saved: 0 workouts, 0 sets, 0 receipts, 0 notes, 0 note confirmations, 0 reserved note IDs, \d+ bytes\./],
  ];
  for (const [outcome, notice] of outcomes) {
    s.files.save = outcome === 'mismatch'
      ? async (text) => ({ status: 'saved', byteLength: Buffer.byteLength(text, 'utf8'), partialFileRemoved: false })
      : async () => outcome;
    ui.render().button('Export archive').onPress();
    ui.render().sheet('Export personal records?').onConfirm();
    await settled(flow);
    assert.match(ui.render().text, notice);
  }
  assert.deepEqual(s.saves, Array(5).fill('forma-archive-2026-10-13.json'));
  s.files.save = async () => { throw new FormaError('STORAGE_FAILURE', 'Native write failure.'); };
  ui.render().button('Export archive').onPress();
  ui.render().sheet('Export personal records?').onConfirm();
  await settled(flow);
  assert.match(ui.render().text, /Export failed\. The records did not change\. An incomplete file can remain\./);
  assert.equal(s.host.snapshot().recordsEpoch, 0);
});

test('restore previews, keeps records on cancel, and replaces them after explicit confirmation', async (t) => {
  const text = await archiveText(t);
  const s = await setup(t);
  const own = await s.host.service().workouts.create({ requestId: 'own', date: '2026-09-01' });
  const flow = s.flow();
  const ui = screen(flow);
  s.files.open = async () => ({ status: 'cancelled', text: null });
  ui.render().button('Restore from archive').onPress();
  await settled(flow);
  assert.match(ui.render().text, /No archive selected\. The records did not change\./);
  assert.deepEqual(s.opens, [ARCHIVE_LIMITS.maxArchiveBytes]);

  s.files.open = async () => ({ status: 'opened', text });
  ui.render().button('Restore from archive').onPress();
  await settled(flow);
  let sheet = ui.render().sheet('Replace all records on this phone?');
  assert.equal(sheet.visible, true);
  for (const phrase of ['replaces all workouts', 'including an active workout', 'Export the current records first',
    'Archive from 2026-10-12T09:00:00.000Z: 1 workout, 1 set, 2 receipts, 0 notes, 0 note confirmations, 0 reserved note IDs, 1 active workout', 'This phone now: 1 workout, 0 sets, 1 receipt']) {
    assert.match(sheet.body, new RegExp(phrase));
  }
  sheet.onKeep();
  assert.equal(ui.render().sheet('Replace all records on this phone?').visible, false);
  assert.deepEqual(await s.host.service().workouts.list(), [own]);
  assert.equal(s.store.replacements, 0);

  ui.render().button('Restore from archive').onPress();
  await settled(flow);
  ui.render().sheet('Replace all records on this phone?').onConfirm();
  await settled(flow);
  assert.match(ui.render().text, /Restore finished: 1 workout, 1 set, 2 receipts, 0 notes, 0 note confirmations, 0 reserved note IDs, 1 active workout\./);
  assert.equal(s.store.replacements, 1);
  assert.equal((await s.host.service().workouts.inProgress())?.id, 'src-1');
  assert.equal(s.host.snapshot().recordsEpoch, 1);
  assert.equal(s.ledger.pending(flowModule.RESTORE_SLOT), null);
});

test('legacy archive warning names notes loss and confirmation uses the global revision', async (t) => {
  const root = JSON.parse(await archiveText(t)); root.formatVersion = 1; delete root.modules.notes;
  const text = signedArchive(root);
  const s = await setup(t);
  const note = await s.host.service().notes.create({requestId: 'note', date: '2026-10-14', text: 'private note'});
  const flow = s.flow(); const ui = screen(flow);
  s.files.open = async () => ({status: 'opened', text});
  ui.render().button('Restore from archive').onPress(); await settled(flow);
  let sheet = ui.render().sheet('Replace all records on this phone?');
  assert.match(sheet.body, /All current notes, confirmations, and reserved note IDs will become empty/);
  assert.match(sheet.body, /1 note, 0 note confirmations, 1 reserved note ID/);
  await s.host.service().notes.update({requestId: 'changed-note', noteId: note.id, expectedRevision: 1, text: 'changed'});
  sheet.onConfirm(); await settled(flow);
  assert.equal(s.store.replacements, 0);
  sheet = ui.render().sheet('Replace all records on this phone?');
  assert.match(sheet.body, /changed after the first preview/);
  sheet.onConfirm(); await settled(flow);
  assert.equal(s.store.replacements, 1);
  assert.equal((await s.host.service().notes.history()).items.length, 0);
  assert.equal(s.host.snapshot().recordsEpoch, 1);
});

test('a change after preview asks for a new confirmation with zero replacement', async (t) => {
  const text = await archiveText(t);
  const s = await setup(t);
  const flow = s.flow();
  const ui = screen(flow);
  s.files.open = async () => ({ status: 'opened', text });
  ui.render().button('Restore from archive').onPress();
  await settled(flow);
  const late = await s.host.service().workouts.create({ requestId: 'late', date: '2026-09-02' });
  ui.render().sheet('Replace all records on this phone?').onConfirm();
  await settled(flow);
  const page = ui.render();
  const sheet = page.sheet('Replace all records on this phone?');
  assert.equal(sheet.visible, true);
  assert.match(sheet.body, /changed after the first preview/);
  assert.match(sheet.body, /This phone now: 1 workout/);
  assert.match(page.text, /Check the new preview and confirm again/);
  assert.deepEqual(await s.host.service().workouts.list(), [late]);
  assert.equal(s.store.replacements, 0);
  assert.equal(s.host.snapshot().recordsEpoch, 0);
  sheet.onConfirm();
  await settled(flow);
  assert.equal(s.store.replacements, 1);
  assert.equal(s.requestIds.length, 2);
  assert.notEqual(s.requestIds[0], s.requestIds[1]);
});

test('an unconfirmed restore survives screen disposal and retries with the same request ID', async (t) => {
  const text = await archiveText(t);
  const s = await setup(t);
  const flow = s.flow();
  const ui = screen(flow);
  s.files.open = async () => ({ status: 'opened', text });
  ui.render().button('Restore from archive').onPress();
  await settled(flow);
  s.replaceFailure = new FormaError('STORAGE_FAILURE', 'The commit result was lost.');
  ui.render().sheet('Replace all records on this phone?').onConfirm();
  await settled(flow);
  let page = ui.render();
  assert.match(page.text, /not confirmed/);
  assert.equal(page.button('Export archive').disabledReason, 'Retry or cancel the unconfirmed restore first.');
  assert.equal(s.store.replacements, 1);
  assert.equal(s.host.snapshot().recordsEpoch, 1);

  // A new flow and screen, as after navigation, find the saved restore identity.
  const again = s.flow();
  const second = screen(again);
  page = second.render();
  assert.match(page.text, /An earlier restore has no confirmed result/);
  page.button('Retry restore').onPress();
  await settled(again);
  assert.match(second.render().text, /Restore finished: 1 workout/);
  assert.equal(s.requestIds.length, 2);
  assert.equal(s.requestIds[0], s.requestIds[1]);
  // The retry replayed the saved receipt. It did not replace again.
  assert.equal(s.store.replacements, 1);
  assert.equal(second.render().hasButton('Retry restore'), false);
});

test('cancel of an unconfirmed restore forgets it, and damaged or too-large files change nothing', async (t) => {
  const text = await archiveText(t);
  const s = await setup(t);
  const flow = s.flow();
  const ui = screen(flow);
  s.files.open = async () => ({ status: 'opened', text: text.replace('"reps":10', '"reps":11') });
  ui.render().button('Restore from archive').onPress();
  await settled(flow);
  assert.match(ui.render().text, /cannot be restored.*archive\.integrity/);
  s.files.open = async () => { throw new FormaError('INVALID_INPUT', 'The file is larger than the archive limit.', { field: 'archive.size' }); };
  ui.render().button('Restore from archive').onPress();
  await settled(flow);
  assert.match(ui.render().text, /cannot be read\. The records did not change\. archive\.size/);

  s.files.open = async () => ({ status: 'opened', text });
  ui.render().button('Restore from archive').onPress();
  await settled(flow);
  s.replaceFailure = new FormaError('STORAGE_FAILURE', 'Unknown.');
  ui.render().sheet('Replace all records on this phone?').onConfirm();
  await settled(flow);
  ui.render().button('Cancel restore').onPress();
  assert.equal(s.ledger.pending(flowModule.RESTORE_SLOT), null);
  assert.equal(ui.render().hasButton('Retry restore'), false);
  assert.equal(s.flow().state().view.step, 'idle');
});

test('native archive failures map to typed meanings', () => {
  assert.deepEqual(flowModule.nativeArchiveFailure({ code: 'FORMA_ARCHIVE_TOO_LARGE' }), { code: 'INVALID_INPUT', field: 'archive.size', message: 'The file is larger than the archive limit.' });
  assert.equal(flowModule.nativeArchiveFailure({ code: 'FORMA_ARCHIVE_BUSY' }).field, 'archive.picker');
  assert.equal(flowModule.nativeArchiveFailure({ code: 'FORMA_ARCHIVE_UNREADABLE' }).field, 'archive');
  assert.equal(flowModule.nativeArchiveFailure({ code: 'FORMA_ARCHIVE_LIMIT' }).field, 'maxBytes');
  assert.deepEqual(flowModule.nativeArchiveFailure(new Error('x')), { code: 'STORAGE_FAILURE', field: null, message: 'The file operation failed.' });
  assert.equal(flowModule.nativeArchiveFailure({ code: 'toString' }).code, 'STORAGE_FAILURE');
  // The Kotlin limit equals the core limit.
  const kotlin = readFileSync(resolve('apps/mobile/android/app/src/main/java/dev/forma/mobile/FormaDeviceModule.kt'), 'utf8');
  assert.match(kotlin, new RegExp('MAX_ARCHIVE_BYTES = ' + ARCHIVE_LIMITS.maxArchiveBytes.toLocaleString('en-US').replaceAll(',', '_')));
});

interface Placed { readonly element: Element; readonly ancestors: readonly Element[]; }
function placed(tree: Element): Placed[] {
  const result: Placed[] = [];
  const visit = (node: unknown, ancestors: readonly Element[]): void => {
    if (Array.isArray(node)) { node.forEach((child) => visit(child, ancestors)); return; }
    if (node !== null && typeof node === 'object' && 'children' in node) {
      const element = node as Element;
      result.push({ element, ancestors });
      element.children.forEach((child) => visit(child, [...ancestors, element]));
    }
  };
  visit(tree, []);
  return result;
}

/**
 * Structure only. The Node hook runtime cannot prove native bounds; the next
 * authorized phone pass must measure them.
 */
function checkActionLayout(tree: Element, labels: readonly string[]): { actionsKey: unknown } {
  const all = placed(tree);
  // Styles come from the screen's vm context. Compare plain JSON values.
  const style = (element: Element) => JSON.parse(JSON.stringify(element.props.style ?? {})) as Record<string, unknown>;
  const buttons = all.filter((item) => item.element.type === 'Button');
  assert.deepEqual(buttons.map((item) => item.element.props.label), labels);
  const columns = new Set<Element>();
  for (const { element, ancestors } of buttons) {
    const wrapper = ancestors.at(-1)!;
    const column = ancestors.at(-2)!;
    assert.equal(wrapper.type, 'View');
    assert.equal(wrapper.children.filter((child) => child !== null).length, 1, 'One action per wrapper: ' + String(element.props.label));
    assert.deepEqual(style(wrapper), { alignSelf: 'stretch', flexShrink: 0, marginBottom: 10 });
    assert.equal(wrapper.props.collapsable, false);
    for (const ancestor of ancestors) assert.equal(style(ancestor).gap, undefined, 'No gap layout above an archive action.');
    columns.add(column);
  }
  assert.equal(columns.size, 1, 'All archive actions share one explicit column.');
  const [column] = [...columns];
  assert.deepEqual(style(column!), { alignSelf: 'stretch', flexShrink: 0, flexDirection: 'column', marginTop: 10 });
  for (const sheet of all.filter((item) => item.element.type === 'ConfirmSheet')) {
    assert.equal(sheet.ancestors.includes(column!), false, 'A modal sheet is not in the action column.');
  }
  // The notice wrapper stays mounted before the action column, with or without text.
  const section = all.find((item) => item.element === column)!.ancestors.at(-1)!;
  const blocks = section.children.filter((child): child is Element => child !== null && typeof child === 'object' && !Array.isArray(child));
  assert.equal(blocks.indexOf(column!), 3, 'Header, description, notice wrapper, then actions.');
  assert.deepEqual(style(blocks[2]!), { alignSelf: 'stretch', flexShrink: 0, marginTop: 10 });
  return { actionsKey: column!.props.key };
}

test('every archive action keeps its own layout space across notices, busy, and retry states', async (t) => {
  const text = await archiveText(t);
  const s = await setup(t);
  const flow = s.flow();
  const ui = screen(flow);
  const idle = checkActionLayout(ui.tree(), ['Export archive', 'Restore from archive']);

  // The native defect: export warning, picker cancel, then a notice above the actions.
  s.files.save = async () => ({ status: 'cancelled', byteLength: 0, partialFileRemoved: false });
  ui.render().button('Export archive').onPress();
  checkActionLayout(ui.tree(), ['Export archive', 'Restore from archive']);
  ui.render().sheet('Export personal records?').onConfirm();
  const busy = checkActionLayout(ui.tree(), ['Export archive', 'Restore from archive']);
  assert.equal(ui.render().button('Export archive').busyLabel, 'Exporting…');
  await settled(flow);
  const cancelled = checkActionLayout(ui.tree(), ['Export archive', 'Restore from archive']);
  assert.match(ui.render().text, /Export cancelled/);
  assert.notEqual(cancelled.actionsKey, idle.actionsKey);
  assert.notEqual(cancelled.actionsKey, busy.actionsKey);

  // A long notice wraps to several lines in its own wrapper.
  s.files.open = async () => ({ status: 'opened', text: text.replace('"reps":10', '"reps":11') });
  ui.render().button('Restore from archive').onPress();
  await settled(flow);
  assert(flow.state().notice!.length > 80, flow.state().notice!);
  checkActionLayout(ui.tree(), ['Export archive', 'Restore from archive']);

  // Retry and cancel use the same layout path.
  s.files.open = async () => ({ status: 'opened', text });
  ui.render().button('Restore from archive').onPress();
  await settled(flow);
  s.replaceFailure = new FormaError('STORAGE_FAILURE', 'The commit result was lost.');
  ui.render().sheet('Replace all records on this phone?').onConfirm();
  await settled(flow);
  checkActionLayout(ui.tree(), ['Retry restore', 'Cancel restore', 'Export archive', 'Restore from archive']);
  ui.render().button('Cancel restore').onPress();
  checkActionLayout(ui.tree(), ['Export archive', 'Restore from archive']);
});
