import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
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
    preview.missingModules?.includes('notes') ? 'This version-1 archive has no notes module. All current notes, confirmations, and reserved note IDs will become empty.' : '',
    `Archive from ${preview.createdAt}: ${describeCounts(preview.archive)}.`,
    `This phone now: ${describeCounts(preview.current)}.`,
    view.step === 'restoreConfirm' && view.changed ? 'The records on this phone changed after the first preview.' : '',
  ].filter(Boolean).join('\n\n');
  // Layout key: a new step or notice remounts the actions, so native frames come from one fresh layout pass.
  const layoutKey = `${view.step}:${notice === null ? 0 : notice.length}`;
  return <>
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.header, {color: palette.text}]}>Local archive</Text>
      <View style={styles.block}>
        <Muted palette={palette}>Export saves all workout records, notes, and confirmed fields to a plaintext file. Restore replaces all records on this phone with an archive.</Muted>
      </View>
      {/* The notice wrapper stays mounted. Its text can wrap to several lines. */}
      <View style={styles.block} collapsable={false}>
        {notice ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{color: palette.text}}>{notice}</Text> : null}
      </View>
      <View key={layoutKey} style={styles.actions} collapsable={false}>
        {view.step === 'unconfirmed' ? <View style={styles.action} collapsable={false}>
          <Button palette={palette} primary label="Retry restore" busyLabel={busy} onPress={() => void flow.retryRestore()}/>
        </View> : null}
        {view.step === 'unconfirmed' ? <View style={styles.action} collapsable={false}>
          <Button palette={palette} label="Cancel restore" onPress={() => flow.cancel()}/>
        </View> : null}
        <View style={styles.action} collapsable={false}>
          <Button palette={palette} label="Export archive" busyLabel={busy} disabledReason={blocked} onPress={() => flow.requestExport()}/>
        </View>
        <View style={styles.action} collapsable={false}>
          <Button palette={palette} label="Restore from archive" busyLabel={busy} disabledReason={blocked} onPress={() => void flow.chooseArchive()}/>
        </View>
      </View>
    </View>
    {/* The modal sheets stay outside the action column. */}
    <ConfirmSheet palette={palette} visible={view.step === 'exportWarning'} busy={false}
      title="Export personal records?" body={EXPORT_WARNING}
      confirmLabel="Export archive" keepLabel="Keep records private"
      onConfirm={() => void flow.confirmExport()} onKeep={() => flow.cancel()}/>
    <ConfirmSheet palette={palette} visible={preview !== null} busy={false}
      title="Replace all records on this phone?" body={restoreBody}
      confirmLabel="Replace records" keepLabel="Keep current records"
      onConfirm={() => void flow.confirmRestore()} onKeep={() => flow.cancel()}/>
  </>;
}

/** Explicit margins, no gap, and no shrink: each archive action keeps its own layout space. */
export const styles = StyleSheet.create({
  section: {alignSelf: 'stretch', flexShrink: 0},
  header: {fontWeight: '600', marginTop: 12},
  block: {alignSelf: 'stretch', flexShrink: 0, marginTop: 10},
  actions: {alignSelf: 'stretch', flexShrink: 0, flexDirection: 'column', marginTop: 10},
  action: {alignSelf: 'stretch', flexShrink: 0, marginBottom: 10},
});
