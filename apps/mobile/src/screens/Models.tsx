import React, {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import {MODEL_ARTIFACTS} from '@forma/mobile-host';
import type {ModelArtifactId, ModelImportFlow, ModelImportSnapshot} from '@forma/mobile-host';
import type {Palette} from '../ui/theme';
import {Button, ConfirmSheet, ErrorNotice} from '../ui/controls';

export function ModelSettings({palette, flow, ready}: {palette: Palette; flow: ModelImportFlow; ready: boolean}) {
  const [snapshot, setSnapshot] = useState<ModelImportSnapshot>(() => flow.snapshot());
  const [confirming, setConfirming] = useState<ModelArtifactId | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  useEffect(() => {
    const unsubscribe = flow.subscribe(() => setSnapshot(flow.snapshot()));
    setSnapshot(flow.snapshot());
    void flow.refresh();
    return unsubscribe;
  }, [flow]);
  const selected = MODEL_ARTIFACTS.find(a => a.id === confirming);
  const disabled = !ready ? 'The local service is not available.' : snapshot.active !== null ? 'Another model import is active.'
    : snapshot.checking ? 'The app must finish the file check.' : snapshot.files === null ? 'Check model files first.' : null;
  return <View style={{alignSelf: 'stretch', flexShrink: 0, marginTop: 18}}>
    <Text accessibilityRole="header" style={{color: palette.text, fontSize: 22, fontWeight: '600'}}>Local models</Text>
    <Text style={{color: palette.muted}}>Models are optional. Workouts, notes, and archives do not require a model.</Text>
    <Text style={{color: palette.muted}}>Import checks the exact file size and SHA-256. It does not load a model or enable inference.</Text>
    <Text style={{color: palette.muted}}>Download approved files separately. This app does not download models. Models stay outside record backups.</Text>
    {MODEL_ARTIFACTS.map(artifact => {
      const status = snapshot.files?.find(file => file.artifactId === artifact.id);
      return <View key={artifact.id} style={{alignSelf: 'stretch', flexShrink: 0, marginTop: 18}}>
        <Text accessibilityRole="header" style={{color: palette.text, fontWeight: '600'}}>{artifact.name}</Text>
        <Text selectable style={{color: palette.text}}>{artifact.filename}</Text>
        <Text style={{color: palette.muted}}>Required file size: {artifact.byteLength} bytes · Configured backend: {artifact.backend}</Text>
        <Text selectable style={{color: palette.muted}}>License: {artifact.license} · {artifact.licenseUrl}</Text>
        <Text selectable style={{color: palette.muted}}>Source: {artifact.url}</Text>
        <Text selectable style={{color: palette.muted}}>SHA-256: {artifact.sha256}</Text>
        <Text accessibilityLiveRegion="polite" style={{color: palette.text}}>File status: {status?.state ?? 'not checked'} · Stored bytes: {status?.byteLength ?? 'unknown'}</Text>
        <Text style={{color: palette.muted}}>Inference: not enabled. A verified file is not a ready engine.</Text>
        <Button palette={palette} label={`Import ${artifact.role} model`}
          busyLabel={snapshot.active === artifact.id ? 'Importing model…' : null}
          disabledReason={disabled} onPress={() => {setFailure(null); setConfirming(artifact.id);}}/>
      </View>;
    })}
    <View style={{alignSelf: 'stretch', flexShrink: 0, marginTop: 12}}>
      <Button palette={palette} label="Check model files" busyLabel={snapshot.checking ? 'Checking model files…' : null}
        disabledReason={snapshot.active ? 'A model import is active.' : null} onPress={() => {void flow.refresh();}}/>
    </View>
    {snapshot.active && <View style={{alignSelf: 'stretch', flexShrink: 0, marginTop: 12}}>
      <Button palette={palette} label="Cancel model import" busyLabel={snapshot.cancelling ? 'Cancel requested…' : null}
        onPress={() => {void flow.cancel();}}/>
      <Text style={{color: palette.muted}}>The app waits for the file operation to stop. A completed file commit cannot cancel.</Text>
    </View>}
    {snapshot.notice && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{color: palette.text, marginTop: 12}}>{snapshot.notice}</Text>}
    {snapshot.error != null || failure != null ? <ErrorNotice palette={palette} error={snapshot.error ?? failure} title="Model file error"/> : null}
    <ConfirmSheet palette={palette} visible={selected !== undefined} busy={false} title="Import approved model file?"
      body={selected ? `Select ${selected.filename} from a local file. It requires ${selected.byteLength} bytes of private storage, plus the current model until verification completes. A failed copy preserves the current model. Your file app can access remote providers; choose a local file. This app does not load the model after import.` : ''}
      confirmLabel="Select local model file" keepLabel="Keep current model"
      onKeep={() => setConfirming(null)} onConfirm={() => {
        if (!selected) return;
        const id = selected.id; setConfirming(null);
        void flow.importFile(id).catch(setFailure);
      }}/>
  </View>;
}
