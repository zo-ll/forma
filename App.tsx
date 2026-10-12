import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { runDatabaseTests } from './src/dbTest';
import { describeError, type DbTestReport } from './src/dbTestCore';
import { cacheKey, NoteEmbeddingCache, retrievalBlockedReason, runNoteRetrieval, runRetrievalWithBusyFlag, type EmbeddingPort } from './src/noteRetrieval';
import noteEmbeddings from './src/noteEmbeddingsNative';
import { clearStoredModel, loadStoredModel, saveStoredModel, type StoredModel } from './src/store';
import type { BackendName, NoteRetrievalReport, TestStatus } from './src/types';
import type { NativeLoadResult } from './modules/note-embeddings/src/NoteEmbeddings.types';

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusColor(status: TestStatus): string {
  if (status === 'passed') {
    return '#146c2e';
  }
  if (status === 'failed') {
    return '#a11a1a';
  }
  return '#444444';
}

export default function App() {
  const [stored, setStored] = useState<StoredModel | null>(null);
  const [backend, setBackend] = useState<BackendName>('CPU');
  const [loadResult, setLoadResult] = useState<NativeLoadResult | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [status, setStatus] = useState('No model imported.');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dbReports, setDbReports] = useState<DbTestReport[]>([]);
  const [dbStatus, setDbStatus] = useState<TestStatus>('idle');
  const [retrieval, setRetrieval] = useState<NoteRetrievalReport | null>(null);
  const [retrievalStatus, setRetrievalStatus] = useState<TestStatus>('idle');
  const cache = useRef(new NoteEmbeddingCache()).current;

  useEffect(() => {
    let active = true;
    loadStoredModel().then((value) => {
      if (!active || !value) {
        return;
      }
      setStored(value);
      setBackend(value.backend);
      setStatus(`Imported ${value.fileName}. Load the model to run the tests.`);
    });
    return () => {
      active = false;
    };
  }, []);

  function resetRetrieval(): void {
    cache.clear();
    setRetrieval(null);
    setRetrievalStatus('idle');
    setLoadResult(null);
    setLoadedKey(null);
  }

  async function persistModel(nextStored: StoredModel): Promise<void> {
    setStored(nextStored);
    setBackend(nextStored.backend);
    await saveStoredModel(nextStored);
  }

  async function handleImport(): Promise<void> {
    setError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || picked.assets.length === 0) {
        return;
      }
      const asset = picked.assets[0];
      setBusy(true);
      setStatus('Copying the model into app storage...');
      await noteEmbeddings.unloadModel().catch(() => undefined);
      const imported = await noteEmbeddings.importModel(asset.uri, asset.name);
      const nextStored: StoredModel = {
        path: imported.path,
        fileName: imported.fileName,
        sizeBytes: imported.sizeBytes,
        importId: `${Date.now()}-${imported.sizeBytes}`,
        backend,
      };
      resetRetrieval();
      await persistModel(nextStored);
      setStatus(`Imported ${imported.fileName} (${formatBytes(imported.sizeBytes)}).`);
    } catch (caught) {
      setError(describeError(caught));
      setStatus('Model import failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleClearModel(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await noteEmbeddings.unloadModel();
      await clearStoredModel();
      resetRetrieval();
      setStored(null);
      setStatus('No model imported.');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleLoad(): Promise<void> {
    if (!stored) {
      setError('Import a model first.');
      return;
    }
    setBusy(true);
    setError(null);
    resetRetrieval();
    setStatus('Loading the model...');
    try {
      const result = await noteEmbeddings.loadModel(stored.path, backend);
      setLoadResult(result);
      setLoadedKey(cacheKey({ importId: stored.importId, backend }));
      setStatus(`Model loaded in ${result.loadTimeMs} ms.`);
    } catch (caught) {
      setError(describeError(caught));
      setStatus('Model load failed. The app does not fall back to CPU.');
    } finally {
      setBusy(false);
    }
  }

  async function handleUnload(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await noteEmbeddings.unloadModel();
      resetRetrieval();
      setStatus('Model unloaded.');
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleBackendChange(value: BackendName): Promise<void> {
    if (value === backend) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await noteEmbeddings.unloadModel().catch(() => undefined);
      resetRetrieval();
      if (stored) {
        await persistModel({ ...stored, backend: value });
      } else {
        setBackend(value);
      }
      setStatus(`Backend set to ${value}. Load the model again.`);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleDatabaseTests(): Promise<void> {
    setError(null);
    setDbStatus('running');
    setDbReports([]);
    try {
      const reports = await runDatabaseTests();
      setDbReports(reports);
      setDbStatus(reports.every((report) => report.status === 'passed') ? 'passed' : 'failed');
    } catch (caught) {
      setError(describeError(caught));
      setDbStatus('failed');
    }
  }

  async function handleRetrieval(): Promise<void> {
    if (!stored || !loadResult) {
      setError('Load the model first.');
      return;
    }
    const blocked = retrievalBlockedReason(loadedKey, { importId: stored.importId, backend });
    if (blocked) {
      setError(blocked);
      return;
    }
    setError(null);
    setRetrievalStatus('running');
    setRetrieval(null);
    // Hold the busy flag for the whole run. The import, model, and backend
    // controls stay disabled. The flag clears after a success and a failure.
    await runRetrievalWithBusyFlag(async () => {
      try {
        const port: EmbeddingPort = {
          compute: (input) => noteEmbeddings.computeEmbedding(input),
        };
        const report = await runNoteRetrieval(port, {
          modelPath: loadResult.modelPath,
          configuredBackend: loadResult.configuredBackend,
          effectiveBackend: loadResult.effectiveBackend,
          declaredDimension: loadResult.declaredDimension,
          supportedTextBackends: loadResult.supportedTextBackends,
          modelLoadMs: loadResult.loadTimeMs,
          cache,
          cacheKey: cacheKey({ importId: stored.importId, backend }),
        });
        setRetrieval(report);
        setRetrievalStatus(report.results.every((result) => result.expectedCovered) ? 'passed' : 'failed');
      } catch (caught) {
        setError(describeError(caught));
        setRetrievalStatus('failed');
      }
    }, setBusy);
  }

  const modelLoaded = loadedKey !== null && loadResult !== null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <StatusBar style="auto" />
      <Text style={styles.title}>Forma validation app</Text>
      <Text style={styles.caption}>
        This app checks text embedding retrieval and the OP-SQLite extensions on one phone. Every
        test runs on the device. The app does not use the network.
      </Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>1. Model</Text>
        <Text style={styles.body}>
          {stored
            ? `File: ${stored.fileName} (${formatBytes(stored.sizeBytes)})`
            : 'File: none'}
        </Text>
        <Text style={styles.body}>{`Path: ${stored ? stored.path : 'none'}`}</Text>
        <View style={styles.row}>
          <Pressable style={styles.button} disabled={busy} onPress={handleImport}>
            <Text style={styles.buttonText}>Import model</Text>
          </Pressable>
          <Pressable style={styles.button} disabled={busy || !stored} onPress={handleClearModel}>
            <Text style={styles.buttonText}>Clear model</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>2. Backend</Text>
        <View style={styles.row}>
          <Pressable
            style={[styles.toggle, backend === 'CPU' && styles.toggleActive]}
            disabled={busy}
            onPress={() => handleBackendChange('CPU')}
          >
            <Text style={styles.buttonText}>CPU</Text>
          </Pressable>
          <Pressable
            style={[styles.toggle, backend === 'GPU' && styles.toggleActive]}
            disabled={busy}
            onPress={() => handleBackendChange('GPU')}
          >
            <Text style={styles.buttonText}>GPU</Text>
          </Pressable>
        </View>
        <Text style={styles.body}>Configured backend: {backend}</Text>
        <Text style={styles.body}>
          Effective backend: {loadResult ? loadResult.effectiveBackend : 'not reported'}
        </Text>
        <Text style={styles.body}>
          Declared dimension: {loadResult?.declaredDimension ?? 'unknown'}
        </Text>
        <Text style={styles.body}>
          Model backends: {loadResult ? loadResult.supportedTextBackends.join(', ') || 'unknown' : 'unknown'}
        </Text>
        <Text style={styles.body}>
          Model load time: {loadResult ? `${loadResult.loadTimeMs} ms` : 'not measured'}
        </Text>
        <View style={styles.row}>
          <Pressable style={styles.button} disabled={busy || !stored} onPress={handleLoad}>
            <Text style={styles.buttonText}>Load model</Text>
          </Pressable>
          <Pressable style={styles.button} disabled={busy || !modelLoaded} onPress={handleUnload}>
            <Text style={styles.buttonText}>Unload model</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>3. Database tests (OP-SQLite)</Text>
        <Text style={styles.body}>
          The tests check the SQLite version, FTS5, sqlite-vec, 256-dimension search, a dimension
          mismatch, a transaction rollback, and persistence.
        </Text>
        <Pressable style={styles.button} disabled={busy || dbStatus === 'running'} onPress={handleDatabaseTests}>
          <Text style={styles.buttonText}>Run database tests</Text>
        </Pressable>
        {dbStatus === 'running' ? <ActivityIndicator style={styles.spinner} /> : null}
        {dbReports.map((report) => (
          <Text key={report.name} style={[styles.result, { color: statusColor(report.status) }]}>
            {report.status === 'passed' ? 'PASS' : 'FAIL'} {report.name}: {report.detail} (
            {report.durationMs} ms)
          </Text>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>4. Note retrieval test</Text>
        <Text style={styles.body}>
          The test embeds eight notes and four queries. It shows the top three note IDs, the note
          text, and the cosine score.
        </Text>
        <Pressable
          style={styles.button}
          disabled={busy || retrievalStatus === 'running' || !modelLoaded}
          onPress={handleRetrieval}
        >
          <Text style={styles.buttonText}>Run note retrieval test</Text>
        </Pressable>
        {retrievalStatus === 'running' ? <ActivityIndicator style={styles.spinner} /> : null}
        {retrieval ? (
          <View>
            <Text style={styles.body}>
              Note embedding time: {retrieval.noteEmbeddingMs} ms. Model load time:{' '}
              {retrieval.modelLoadMs} ms.
            </Text>
            <Text style={styles.body}>
              Query prefix: "task: search query | text: ". Note prefix: "task: search result | text: ".
            </Text>
            {retrieval.results.map((result) => (
              <View key={result.query} style={styles.queryBlock}>
                <Text style={styles.queryText}>{result.query}</Text>
                <Text style={[styles.result, { color: statusColor(result.expectedCovered ? 'passed' : 'failed') }]}>
                  {result.expectedCovered ? 'COVERED' : 'NOT COVERED'} expected:{' '}
                  {result.expectedIds.join(', ')} ({result.queryEmbeddingMs} ms embed,{' '}
                  {result.rankMs} ms rank)
                </Text>
                {result.top.map((note) => (
                  <Text key={note.id} style={styles.result}>
                    {note.id} {note.score.toFixed(4)} {note.text}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>Error: {error}</Text>
        </View>
      ) : null}
      <Text style={styles.status}>{status}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f2f2f2',
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 6,
  },
  caption: {
    fontSize: 14,
    color: '#444444',
    marginBottom: 14,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: '#222222',
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  button: {
    backgroundColor: '#1d4ed8',
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginRight: 8,
    marginBottom: 8,
  },
  toggle: {
    backgroundColor: '#6b7280',
    borderRadius: 6,
    paddingHorizontal: 22,
    paddingVertical: 10,
    marginRight: 8,
  },
  toggleActive: {
    backgroundColor: '#1d4ed8',
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  spinner: {
    marginTop: 6,
  },
  result: {
    fontSize: 13,
    marginTop: 4,
  },
  queryBlock: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 8,
  },
  queryText: {
    fontSize: 14,
    fontWeight: '600',
  },
  errorBox: {
    backgroundColor: '#fde8e8',
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
  },
  errorText: {
    color: '#a11a1a',
    fontSize: 13,
  },
  status: {
    fontSize: 13,
    color: '#444444',
  },
});
