import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as core from '@forma/core';
import * as forms from '../apps/mobile/src/forms/index.js';
import * as noteForms from '../apps/mobile/src/forms/index.js';
import {memoryFixture} from './helpers.js';

interface Element {type: unknown; props: Record<string, any>; children: unknown[]}
/** Callback harness, not native layout or a device scheduler. */
function runtime() {
  let index = 0;
  const slots: any[] = [];
  let effects: (() => void)[] = [];
  const cleanups: (() => void)[] = [];
  const react = {
    createElement: (type: unknown, props: object | null, ...children: unknown[]) => ({type, props: props ?? {}, children}),
    Fragment: 'Fragment',
    useState(initial: any) {
      const n = index++;
      if (!(n in slots)) slots[n] = typeof initial === 'function' ? initial() : initial;
      return [slots[n], (value: any) => {slots[n] = typeof value === 'function' ? value(slots[n]) : value;}];
    },
    useRef(initial: unknown) {const n = index++; if (!(n in slots)) slots[n] = {current: initial}; return slots[n];},
    useCallback(fn: unknown, deps: unknown[]) {
      const n = index++; const previous = slots[n];
      if (!previous || deps.some((d, i) => d !== previous.deps[i])) slots[n] = {fn, deps};
      return slots[n].fn;
    },
    useEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const n = index++;
      const previous = slots[n];
      if (!previous || deps.some((d, i) => d !== previous.deps[i])) {
        slots[n] = {deps};
        effects.push(() => {previous?.cleanup?.(); const cleanup = effect(); slots[n].cleanup = cleanup; if (cleanup) cleanups.push(cleanup);});
      }
    },
  };
  return {react, render(component: (props: any) => Element, props: any) {
    index = 0; const tree = component(props); const pending = effects; effects = []; pending.forEach(e => e()); return view(tree);
  }, unmount: () => cleanups.forEach(c => c())};
}
function view(tree: unknown) {
  const nodes: Element[] = [];
  const text: string[] = [];
  function visit(value: any): void {
    if (Array.isArray(value)) value.forEach(visit);
    else if (typeof value === 'string' || typeof value === 'number') text.push(String(value));
    else if (value?.children) {nodes.push(value); value.children.forEach(visit);}
  }
  visit(tree);
  const find = (key: string, value: string) => {const node = nodes.find(n => n.props[key] === value); assert.ok(node, `Missing ${key}: ${value}`); return node.props;};
  return {text: text.join(' '), label: (s: string) => find('label', s), input: (s: string) => find('accessibilityLabel', s),
    type: (s: string) => {const n = nodes.find(n => n.type === s || (typeof n.type === 'function' && n.type.name === s)); assert.ok(n, `Missing ${s}`); return n.props;},
    has: (label: string) => nodes.some(n => n.props.label === label)};
}
const tags = (...names: string[]) => Object.fromEntries(names.map(n => [n, n]));
function load(file: string, react: object, overrides: Record<string, unknown> = {}): any {
  const modules: Record<string, unknown> = {
    react, '@forma/core': core, 'react-native': tags('Text', 'TextInput', 'View'),
    '../forms/index': forms, '../forms/notes': noteForms, '../ui/theme': {shared: {}},
    '../ui/controls': tags('Button', 'Card', 'ConfirmSheet', 'ErrorNotice', 'Muted', 'ScreenHeader'),
    './Notes': tags('ExactNote', 'NoteInput', 'NoteText', 'Suggestions'),
    ...overrides,
  };
  if (!modules['./context']) modules['./context'] = file === 'context.ts' ? {} : load('context.ts', react);
  if (!modules['./noteHooks'] && file !== 'noteHooks.ts' && file !== 'context.ts') modules['./noteHooks'] = load('noteHooks.ts', react, {'./context': modules['./context']});
  const exports = {};
  const source = readFileSync(resolve('apps/mobile/src/screens', file), 'utf8');
  const output = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true}}).outputText;
  runInNewContext(output, {exports, require: (name: string) => {assert.ok(name in modules, name); return modules[name];}});
  return exports;
}
function store() {
  let n = 0;
  return {commands: forms.createCommandLedger({next: () => `screen-${++n}`}), drafts: forms.createDraftStore()};
}
function context(service: any, saved = store()) {
  const snapshot = {phase: 'ready', recordsEpoch: 0, calendar: {dateFrom: '2026-10-14'}};
  const routes: any[] = [];
  const ctx = {forms: saved, snapshot, palette: {}, host: {snapshot: () => snapshot, service: () => service},
    push: (r: unknown) => routes.push(r), reset: (r: unknown) => routes.push(r), pop: () => routes.push('pop')};
  return {ctx, routes};
}
const settle = async () => {for (let i = 0; i < 20; i++) await Promise.resolve();};

test('late async reads cannot replace a different source or survive service close', async () => {
  const s = context({}); const r = runtime(); const hooks = load('noteHooks.ts', r.react);
  const replies: ((value: string) => void)[] = [];
  let key = 'old';
  const probe = () => {
    const read = hooks.useNoteRead(s.ctx, key, () => new Promise<string>(resolve => replies.push(resolve)));
    return {type: 'Read', props: read.loaded, children: []};
  };
  r.render(probe, {}); key = 'new'; r.render(probe, {});
  replies[1]!('new source'); await settle(); replies[0]!('old source'); await settle();
  assert.equal(r.render(probe, {}).type('Read').value, 'new source');
  key = 'close'; r.render(probe, {}); s.ctx.snapshot.phase = 'closed'; replies[2]!('closed source'); await settle();
  const failed = r.render(probe, {}).type('Read'); assert.equal(failed.state, 'error'); assert.equal(failed.error.code, 'SERVICE_CLOSED');
});
test('definitive validation failure retains exact input and permits correction', async t => {
  const f = memoryFixture(t); const s = context(f.service); const r = runtime(); const screen = load('Notes.tsx', r.react).NoteForm;
  const props = {ctx: s.ctx, note: null}; let rendered = r.render(screen, props);
  rendered.label('Original note text').onChange('   '); rendered.label('Save note').onPress(); await settle();
  rendered = r.render(screen, props); assert.equal(rendered.label('Original note text').value, '   ');
  assert.equal(rendered.type('ErrorNotice').error.code, 'INVALID_INPUT');
  rendered.label('Original note text').onChange(sample.text); rendered.label('Save note').onPress(); await settle();
  assert.equal((await f.service.notes.history()).items.length, 1);
});
test('a captured request can settle after the saved source revision has changed', async t => {
  const f = memoryFixture(t); const note = await f.service.notes.create({requestId: 'retry-seed', date: sample.date, text: sample.text});
  const s = context(f.service); const slot = noteForms.noteKey('update', note.id, note.revision);
  const input = {noteId: note.id, expectedRevision: note.revision, text: 'updated'};
  await assert.rejects(s.ctx.forms.commands.run(slot, input, async (requestId, saved) => {
    await f.service.notes.update({requestId, ...saved}); throw new Error('lost update reply');
  }));
  assert.equal((await f.service.notes.get(note.id)).revision, 2);
  const r = runtime(); const screen = load('Notes.tsx', r.react).NotePendingRetry;
  r.render(screen, {ctx: s.ctx, source: note.source, operation: 'update'}).label('Retry captured note request').onPress(); await settle();
  assert.equal((await f.service.notes.get(note.id)).revision, 2); assert.equal(s.routes[0][0].source.revision, 2);
});
test('lost confirmation reply survives remount and uses the saved identity', async t => {
  const f = memoryFixture(t); const note = await f.service.notes.create({requestId: 'seed-fields', date: sample.date, text: sample.text});
  const fields = await f.service.notes.fields(note.id); const inputs: core.ConfirmNoteFieldsInput[] = [];
  const service = {notes: {...f.service.notes, confirmFields: async (input: core.ConfirmNoteFieldsInput) => {
    inputs.push(input); const result = await f.service.notes.confirmFields(input); if (inputs.length === 1) throw new Error('lost'); return result;
  }}};
  const s = context(service); const props = {ctx: s.ctx, note, fields}; const a = runtime();
  let rendered = a.render(load('NoteFields.tsx', a.react).FieldsForm, props);
  rendered.label('Copy sleep suggestion 1 to draft').onPress(); rendered.label('Confirm these fields').onPress(); await settle(); a.unmount();
  const b = runtime(); rendered = b.render(load('NoteFields.tsx', b.react).FieldsForm, props);
  assert.match(rendered.text, /unconfirmed/); rendered.label('Confirm these fields').onPress(); await settle();
  assert.equal(inputs.length, 2); assert.equal(inputs[0]!.requestId, inputs[1]!.requestId);
  assert.equal((await f.service.notes.get(note.id)).revision, 2);
  assert.equal((await f.service.notes.fields(note.id)).confirmation!.fields.sleep!.durationMin, 420);
});
const sample = core.noteFromRecord({id: 'n', date: '2026-10-14', text: 'No left knee pain. Slept 7 hours.', kind: 'pain', revision: 1,
  createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z'});
const fieldView = (note = sample): core.NoteFieldsView => ({source: note.source, state: 'pending', confirmation: null, suggestions: core.suggestNoteFields({source: note.source, text: note.text})});

test('pure note drafts preserve exact text and source revision; new defaults use host date', () => {
  assert.deepEqual(noteForms.noteDraft(null, '2026-10-14'), {date: '2026-10-14', text: '', kind: 'general', expectedRevision: null});
  assert.equal(noteForms.noteDraft(sample, '').text, sample.text);
  assert.equal(noteForms.noteDraft(sample, '').expectedRevision, 1);
});
test('field parsing keeps unknown null and preserves contradictory severity for core rejection', () => {
  const draft = noteForms.fieldsDraft(1, null);
  assert.deepEqual(noteForms.parseFieldsDraft(draft), {ok: true, value: {pain: [], sleep: null, personalBest: null}});
  const parsed = noteForms.parseFieldsDraft({...draft, pain: [{bodyPart: 'knee', otherBodyPart: '', side: 'left', state: 'uncertain', severity: '4'}], minutes: '420,5', claim: '  my claim  '});
  assert.ok(parsed.ok); assert.equal(parsed.value.pain[0]!.severity, 4); assert.equal(parsed.value.sleep!.durationMin, 420.5); assert.equal(parsed.value.personalBest!.claimText, '  my claim  ');
  assert.throws(() => core.validateNoteFields(parsed.value), (e: any) => e.code === 'INVALID_INPUT');
  assert.equal(noteForms.parseFieldsDraft({...draft, minutes: 'seven'}).ok, false);
});
test('note Save uses no models; same-render changes, rapid taps, and queued callbacks create once', async t => {
  const f = memoryFixture(t);
  const s = context(f.service); const r = runtime(); const screen = load('Notes.tsx', r.react).NoteForm;
  const props = {ctx: s.ctx, note: null}; const first = r.render(screen, props);
  first.label('Original note text').onChange('  No left knee pain.\nExact text  ');
  const save = first.label('Save note').onPress; save(); save(); await settle(); save(); await settle();
  const page = await f.service.notes.history(); assert.equal(page.items.length, 1); assert.equal(page.items[0]!.text, '  No left knee pain.\nExact text  ');
  assert.equal(page.items[0]!.kind, 'general'); assert.equal(page.items[0]!.date, '2026-10-14');
  r.unmount(); const next = runtime(); next.render(load('Notes.tsx', next.react).NoteForm, props); await settle();
  assert.equal((await f.service.notes.history()).items.length, 1);
});
test('drafts survive background and remount without a save', () => {
  const s = context({}); const r = runtime(); const screen = load('Notes.tsx', r.react).NoteForm;
  const props = {ctx: s.ctx, note: null}; const initial = r.render(screen, props);
  initial.label('Original note text').onChange(sample.text); initial.label('Note date').onChange('2026-10-13');
  s.ctx.snapshot.phase = 'background'; r.unmount();
  const next = runtime(); const restored = next.render(load('Notes.tsx', next.react).NoteForm, props);
  assert.equal(restored.label('Original note text').value, sample.text); assert.equal(restored.label('Note date').value, '2026-10-13');
});
test('lost save reply retries captured input with the same request ID', async t => {
  const f = memoryFixture(t); let calls = 0; const inputs: any[] = [];
  const service = {notes: {...f.service.notes, create: async (input: core.CreateNoteInput) => {inputs.push(input); const note = await f.service.notes.create(input); if (++calls === 1) throw new Error('lost reply'); return note;}}};
  const s = context(service); const r = runtime(); const screen = load('Notes.tsx', r.react).NoteForm; const props = {ctx: s.ctx, note: null};
  let rendered = r.render(screen, props); rendered.label('Original note text').onChange(sample.text); rendered.label('Save note').onPress(); await settle();
  rendered = r.render(screen, props); assert.match(rendered.text, /unconfirmed/); rendered.label('Original note text').onChange('changed'); rendered.label('Save note').onPress(); await settle();
  assert.equal(inputs.length, 2); assert.equal(inputs[0].requestId, inputs[1].requestId); assert.equal(inputs[1].text, sample.text);
  assert.equal((await f.service.notes.history()).items.length, 1);
});
test('navigation attaches to a running save; late callbacks do not navigate the old screen', async () => {
  let resolveSave!: (value: core.Note) => void; let calls = 0;
  const s = context({notes: {create: () => {calls++; return new Promise<core.Note>(resolve => {resolveSave = resolve;});}}});
  const a = runtime(); const props = {ctx: s.ctx, note: null}; const first = a.render(load('Notes.tsx', a.react).NoteForm, props);
  first.label('Original note text').onChange('saved'); first.label('Save note').onPress(); a.unmount();
  const b = runtime(); b.render(load('Notes.tsx', b.react).NoteForm, props); resolveSave(sample); await settle();
  assert.equal(calls, 1); assert.equal(s.routes.length, 1);
});
test('restore and service-close invalidate late save replies and queued callbacks', async () => {
  for (const mode of ['restore', 'close']) {
    let resolveSave!: (value: core.Note) => void; let calls = 0;
    const s = context({notes: {create: () => {calls++; return new Promise<core.Note>(resolve => {resolveSave = resolve;});}}});
    const r = runtime(); const rendered = r.render(load('Notes.tsx', r.react).NoteForm, {ctx: s.ctx, note: null});
    rendered.label('Original note text').onChange('old'); const save = rendered.label('Save note').onPress; save();
    if (mode === 'restore') {s.ctx.snapshot.recordsEpoch++; s.ctx.forms.commands.clear(); s.ctx.forms.drafts.clearAll();}
    else s.ctx.snapshot.phase = 'closed';
    resolveSave(sample); await settle(); save(); await settle(); assert.equal(calls, 1); assert.equal(s.routes.length, 0);
    assert.equal(s.ctx.forms.drafts.get(`${noteForms.noteKey('create')}:completed`), null);
  }
});
test('stale edit drafts retain input and require an explicit reload', () => {
  const s = context({}); const key = noteForms.noteKey('edit', sample.id);
  s.ctx.forms.drafts.set(key, {...noteForms.noteDraft(sample, ''), text: 'keep me', expectedRevision: 0});
  const r = runtime(); const rendered = r.render(load('Notes.tsx', r.react).NoteForm, {ctx: s.ctx, note: sample});
  assert.equal(rendered.label('Original note text').value, 'keep me'); assert.match(rendered.label('Save note').disabledReason, /Reload/);
  rendered.label('Save note').onPress(); assert.equal(s.ctx.forms.commands.pending(noteForms.noteKey('update', sample.id, 1)), null);
});
test('a changed exact source shows mismatch, not a newer note under the old revision', () => {
  const newer = {...sample, text: 'newer text', revision: 2, source: {...sample.source, revision: 2}};
  const s = context({}); const r = runtime(); const screen = load('Notes.tsx', r.react, {'./noteHooks': {noteUnavailable: () => null, useNoteRead: () => ({loaded: {state: 'ready', value: {note: newer, fields: fieldView(newer)}}})}}).ExactNote;
  const rendered = r.render(screen, {ctx: s.ctx, source: sample.source, children: () => {throw new Error('Must not show newer body');}});
  assert.match(rendered.text, /Requested revision/); rendered.label('Refresh to current note').onPress(); assert.equal(s.routes[0][0].source.revision, 2);
});
test('suggestion copy is not confirmation; explicit rapid confirmation sends once', async t => {
  const f = memoryFixture(t); const note = await f.service.notes.create({requestId: 'seed', date: sample.date, text: sample.text});
  const fields = await f.service.notes.fields(note.id); let count = 0;
  const service = {notes: {...f.service.notes, confirmFields: async (input: core.ConfirmNoteFieldsInput) => {count++; return f.service.notes.confirmFields(input);}}};
  const s = context(service); const r = runtime(); const screen = load('NoteFields.tsx', r.react).FieldsForm; const props = {ctx: s.ctx, note, fields};
  let rendered = r.render(screen, props); rendered.label('Copy pain suggestion 1 to draft').onPress(); assert.equal(count, 0);
  rendered = r.render(screen, props); assert.equal(rendered.label('Pain 1 state: absent').selected, true);
  const confirm = rendered.label('Confirm these fields').onPress; confirm(); confirm(); await settle(); confirm();
  assert.equal(count, 1); assert.equal((await f.service.notes.fields(note.id)).confirmation!.fields.pain[0]!.state, 'absent');
});
test('delete cancellation blocks even a queued confirmation callback', () => {
  let count = 0; const s = context({notes: {delete: () => {count++; return Promise.resolve();}}}); const r = runtime(); const screen = load('Notes.tsx', r.react).NoteDetailBody; const props = {ctx: s.ctx, note: sample, fields: fieldView()};
  let rendered = r.render(screen, props); rendered.label('Delete note').onPress(); rendered = r.render(screen, props);
  const sheet = rendered.type('ConfirmSheet'); sheet.onKeep(); sheet.onConfirm(); assert.equal(count, 0);
});
test('negated primary text is visible separately from unconfirmed suggestions', () => {
  const s = context({}); const r = runtime(); const screen = load('Notes.tsx', r.react).NoteDetailBody;
  const rendered = r.render(screen, {ctx: s.ctx, note: sample, fields: fieldView()});
  assert.equal(rendered.type('NoteText').text, sample.text);
  assert.ok(!rendered.text.includes('Confirmed fields')); assert.match(rendered.text, /pending/);
});
test('history uses bounded literal search, exact result routes, and cursor-conflict restart', () => {
  const keys: string[] = []; let response: any = {state: 'ready', value: {items: [sample], nextCursor: 'next'}};
  const s = context({}); const r = runtime(); const screen = load('Notes.tsx', r.react, {'./noteHooks': {noteUnavailable: () => null, useNoteRead: (_ctx: unknown, key: string) => {keys.push(key); return {loaded: response, reload: () => {}};}}}).Notes;
  const props = {ctx: s.ctx}; let rendered = r.render(screen, props);
  rendered.label('Literal text search').onChange('no pain'); rendered.label('Notes start date').onChange('2026-10-01'); rendered.label('Search / load notes').onPress();
  rendered = r.render(screen, props); assert.equal(JSON.parse(keys.at(-1)!).query, 'no pain'); assert.equal(JSON.parse(keys.at(-1)!).limit, 20);
  rendered.label(`Open note ${sample.id}, revision 1`).onPress(); assert.deepEqual(s.routes[0].source, sample.source);
  const older = rendered.label('Older notes').onPress; older(); older(); rendered = r.render(screen, props); assert.equal(JSON.parse(keys.at(-1)!).cursor, 'next');
  response = {state: 'error', error: new core.FormaError('CONFLICT', 'Restart', {field: 'cursor'})}; rendered = r.render(screen, props);
  rendered.label('Restart notes from newest').onPress(); r.render(screen, props); assert.equal(JSON.parse(keys.at(-1)!).cursor, undefined);
});
