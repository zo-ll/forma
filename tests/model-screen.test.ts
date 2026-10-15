import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as host from '@forma/mobile-host';

interface Element { type: unknown; props: Record<string, any>; children: unknown[] }
/** Screen callbacks only. This harness does not measure Android layout or picker behavior. */
function runtime() {
  let index = 0;
  const slots: any[] = [];
  let effects: (() => void)[] = [];
  const react = {
    createElement: (type: unknown, props: object | null, ...children: unknown[]) => ({ type, props: props ?? {}, children }),
    useState(initial: any) { const n = index++; if (!(n in slots)) slots[n] = typeof initial === 'function' ? initial() : initial;
      return [slots[n], (v: any) => { slots[n] = typeof v === 'function' ? v(slots[n]) : v; }]; },
    useEffect(effect: () => (() => void), deps: unknown[]) { const n = index++; const old = slots[n];
      if (!old || deps.some((d, i) => d !== old.deps[i])) {
        slots[n] = { deps }; effects.push(() => { old?.cleanup?.(); slots[n].cleanup = effect(); });
      }
    },
  };
  const modules: Record<string, unknown> = {
    react, '@forma/mobile-host': host, 'react-native': { Text: 'Text', View: 'View' },
    '../ui/controls': { Button: 'Button', ConfirmSheet: 'ConfirmSheet', ErrorNotice: 'ErrorNotice' },
  };
  const output = ts.transpileModule(readFileSync('apps/mobile/src/screens/Models.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(output, { exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; } });
  return {
    render(props: unknown) {
      index = 0; const tree = exports.ModelSettings(props); const nodes: Element[] = []; const texts: string[] = [];
      const walk = (v: any): void => { if (Array.isArray(v)) v.forEach(walk); else if (v?.children) { nodes.push(v); v.children.forEach(walk); }
        else if (typeof v === 'string' || typeof v === 'number') texts.push(String(v)); };
      walk(tree); const pending = effects; effects = []; pending.forEach(e => e());
      return { text: texts.join(' '), button: (label: string) => {
        const node = nodes.find(n => n.type === 'Button' && n.props.label === label); assert.ok(node, label); return node.props;
      }, sheet: () => nodes.find(n => n.type === 'ConfirmSheet')!.props };
    },
    unmount: () => slots.forEach(v => v?.cleanup?.()),
  };
}
const settle = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
function setup() {
  let resolve!: (value: unknown) => void;
  const result = new Promise<unknown>(yes => { resolve = yes; });
  const calls: string[] = [];
  const flow = host.createModelImportFlow({ nextId: () => 'screen-import', available: () => true, files: {
    status: async () => host.MODEL_ARTIFACTS.map(a => ({ artifactId: a.id, state: 'missing', byteLength: 0 })),
    importFile: async (id, request) => { calls.push(id, request); return result; },
    cancel: async request => { calls.push('cancel:' + request); return true; },
  } });
  return { flow, calls, resolve, props: { flow, ready: true, palette: {} } };
}
test('model settings display exact metadata, missing states, and import confirmation before the picker', async () => {
  const s = setup(); const r = runtime(); r.render(s.props); await settle();
  let page = r.render(s.props);
  for (const a of host.MODEL_ARTIFACTS) for (const text of [a.filename, String(a.byteLength), a.sha256, a.url, a.license]) assert.ok(page.text.includes(text), text);
  assert.match(page.text, /File status:\s+missing/); assert.match(page.text, /does not load a model or enable inference/);
  assert.equal(page.sheet().visible, false); page.button('Import embedding model').onPress(); page = r.render(s.props);
  assert.equal(page.sheet().visible, true); assert.match(page.sheet().body, /choose a local file/); assert.deepEqual(s.calls, []);
  page.sheet().onKeep(); assert.equal(r.render(s.props).sheet().visible, false); assert.deepEqual(s.calls, []);
  r.unmount();
});
test('navigation preserves an import and the new screen can cancel the same native request', async () => {
  const s = setup(); const first = runtime(); first.render(s.props); await settle();
  first.render(s.props).button('Import embedding model').onPress();
  const confirm = first.render(s.props).sheet().onConfirm; confirm(); confirm(); await settle();
  assert.deepEqual(s.calls, [host.MODEL_ARTIFACTS[0]!.id, 'screen-import']); first.unmount();
  const second = runtime(); second.render(s.props); await settle(); let page = second.render(s.props);
  assert.ok(page.button('Import embedding model').busyLabel);
  assert.ok(page.button('Import generation model').disabledReason);
  page.button('Cancel model import').onPress(); await settle(); page = second.render(s.props);
  assert.ok(page.button('Cancel model import').busyLabel);
  s.resolve({ status: 'cancelled', artifactId: host.MODEL_ARTIFACTS[0]!.id, byteLength: 0 }); await settle();
  assert.match(second.render(s.props).text, /cancelled/);
  assert.deepEqual(s.calls, [host.MODEL_ARTIFACTS[0]!.id, 'screen-import', 'cancel:screen-import']); second.unmount();
});
test('closed-service settings explain why model import is unavailable', async () => {
  const s = setup(); const r = runtime(); const props = { ...s.props, ready: false };
  r.render(props); await settle(); const page = r.render(props);
  assert.equal(page.button('Import embedding model').disabledReason, 'The local service is not available.');
  assert.match(page.text, /Workouts, notes, and archives do not require a model/); assert.deepEqual(s.calls, []); r.unmount();
});
