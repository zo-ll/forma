import React, {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import {Button, ConfirmSheet, Muted} from '../ui/controls';
import {EXPORT_WARNING, RESTORE_WARNING, describeCounts} from '../archive/flow';
import type {ArchiveFlow} from '../archive/flow';
import type {Palette} from '../ui/theme';

/** Settings section for the local archive. The flow owns the steps; the core owns every archive rule. */
export function ArchiveSettings({palette, flow, ready}: {palette: Palette; flow: ArchiveFlow; ready: boolean}) {
  const [, setVersion] = useState(0);
  useEffect(() => flow.subscribe(() => setVersion(version => version + 1)), [flow]);
  const {view, notice} = flow.state();
  const busy = view.step === 'busy' ? `${view.label}…` : null;
  const blocked = !ready ? 'The local service is not ready.'
    : view.step === 'unconfirmed' ? 'Retry or cancel the unconfirmed restore first.' : null;
  const preview = view.step === 'restoreConfirm' ? view.preview : null;
  const restoreBody = preview === null ? '' : [
    RESTORE_WARNING,
    `Archive from ${preview.createdAt}: ${describeCounts(preview.archive)}.`,
    `This phone now: ${describeCounts(preview.current)}.`,
    view.step === 'restoreConfirm' && view.changed ? 'The records on this phone changed after the first preview.' : '',
  ].filter(Boolean).join('\n\n');
  return <View style={{gap: 10}}>
    <Text accessibilityRole="header" style={{color: palette.text, fontWeight: '600', marginTop: 12}}>Local archive</Text>
    <Muted palette={palette}>Export saves all workout records to a plaintext file. Restore replaces all records on this phone with an archive.</Muted>
    {notice ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{color: palette.text}}>{notice}</Text> : null}
    {view.step === 'unconfirmed'
      ? <>
        <Button palette={palette} primary label="Retry restore" busyLabel={busy} onPress={() => void flow.retryRestore()}/>
        <Button palette={palette} label="Cancel restore" onPress={() => flow.cancel()}/>
      </>
      : null}
    <Button palette={palette} label="Export archive" busyLabel={busy} disabledReason={blocked} onPress={() => flow.requestExport()}/>
    <Button palette={palette} label="Restore from archive" busyLabel={busy} disabledReason={blocked} onPress={() => void flow.chooseArchive()}/>
    <ConfirmSheet palette={palette} visible={view.step === 'exportWarning'} busy={false}
      title="Export personal records?" body={EXPORT_WARNING}
      confirmLabel="Export archive" keepLabel="Keep records private"
      onConfirm={() => void flow.confirmExport()} onKeep={() => flow.cancel()}/>
    <ConfirmSheet palette={palette} visible={preview !== null} busy={false}
      title="Replace all records on this phone?" body={restoreBody}
      confirmLabel="Replace records" keepLabel="Keep current records"
      onConfirm={() => void flow.confirmRestore()} onKeep={() => flow.cancel()}/>
  </View>;
}
