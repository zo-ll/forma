import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { open } from '@op-engineering/op-sqlite';
import { collectWorkoutCases } from 'forma-fixtures/workout-cases.js';
import { collectRequestCases } from 'forma-fixtures/request-cases.js';
import { collectLoadCases } from 'forma-fixtures/load-cases.js';
import { collectSessionCases } from 'forma-fixtures/session-cases.js';
import { collectNoteCases } from 'forma-fixtures/note-cases.js';
import { collectNoteFieldCases } from 'forma-fixtures/note-field-cases.js';
import { collectNoteSearchCases } from 'forma-fixtures/note-search-cases.js';
import { createPortableAssert } from 'forma-fixtures/portable-assert.js';
import { HISTORY_CASES } from 'forma-fixtures/history-cases.js';
import { nativeFixture, nativeNotesFixture, NATIVE_STORAGE_CASES, seedNativeRestart, verifyNativeRestart,
  nativeRestartConnectionIsRetained } from 'forma-fixtures/native-storage-cases.js';
import build from './forma-build.json';

interface Props { formaMode?: string; formaRunId?: string; }
export default function App({ formaMode = 'fixtures', formaRunId = 'manual' }: Props) {
  const [lines, setLines] = useState<string[]>(['Only synthetic records. No production Forma data.']);
  useEffect(() => {
    const say = (message: string) => { console.log('FORMA_STORAGE ' + message); setLines((old) => [...old.slice(-11), message]); };
    void (async () => {
      let count = 0;
      try {
        if (formaMode === 'seed') {
          await seedNativeRestart(open);
          if (!nativeRestartConnectionIsRetained()) throw new Error('The restart connection was not retained.');
          count = 1;
        } else if (formaMode === 'verify') {
          await verifyNativeRestart(open); count = 1;
        } else if (formaMode === 'fixtures') {
          const assert = createPortableAssert();
          const cases = [...collectWorkoutCases(assert), ...collectRequestCases(assert), ...collectLoadCases(assert),
            ...collectSessionCases(assert), ...HISTORY_CASES];
          for (const item of cases) {
            const fixture = nativeFixture(open, item.ids);
            try { await item.run(fixture.service); } finally { await fixture.service.close(); }
            count++; say('PASS ' + count + ': ' + item.name);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
          for (const item of [...collectNoteCases(assert), ...collectNoteFieldCases(assert), ...collectNoteSearchCases(assert)]) {
            const module = nativeNotesFixture(open);
            try { await item.run(module); } finally { await module.close(); }
            count++; say('PASS ' + count + ': ' + item.name);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
          for (const item of NATIVE_STORAGE_CASES) {
            await item.run(open); count++; say('PASS ' + count + ': ' + item.name);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        } else throw new Error('Unknown test mode.');
        const result = { mode: formaMode, runId: formaRunId, ok: true, count, ...build };
        console.log('FORMA_STORAGE_RESULT ' + JSON.stringify(result)); say('PASS: ' + count + ' checks');
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const stack = cause instanceof Error ? cause.stack : undefined;
        console.log('FORMA_STORAGE_RESULT ' + JSON.stringify({ mode: formaMode, runId: formaRunId, ok: false, count, message, stack, ...build }));
        say('FAIL: ' + message);
      }
    })();
  }, [formaMode, formaRunId]);
  return <View style={{ flex: 1, padding: 24, paddingTop: 48, backgroundColor: '#111' }}>
    <Text style={{ color: '#fff', fontSize: 22 }}>Forma storage test host</Text>
    <Text style={{ color: '#aaa', marginVertical: 12 }}>{formaMode} · {build.sourceHead}{build.dirty ? ' (dirty)' : ''}</Text>
    <ScrollView>{lines.map((line, index) => <Text key={index} style={{ color: '#b8f7bc', marginBottom: 8 }}>{line}</Text>)}</ScrollView>
  </View>;
}
