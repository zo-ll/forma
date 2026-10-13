import React from 'react';
import {Modal, ScrollView} from 'react-native';
import type {Exercise} from '@forma/core';
import {Button, ScreenHeader} from './controls';
import type {Palette} from './theme';

/** Full-screen list of catalog exercises in catalog order. */
export function ExercisePicker({palette, visible, exercises, selectedId, anyLabel, onPick, onClose}: {
  palette: Palette; visible: boolean; exercises: readonly Exercise[]; selectedId: string | null;
  anyLabel?: string; onPick: (exerciseId: string | null) => void; onClose: () => void;
}) {
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <ScrollView style={{flex: 1, backgroundColor: palette.background}} contentContainerStyle={{padding: 20, gap: 8}}>
      <ScreenHeader palette={palette} title="Choose an exercise" back={{label: 'Back', onPress: onClose}}/>
      {anyLabel && <Button palette={palette} label={anyLabel} selected={selectedId === null} onPress={() => onPick(null)}/>}
      {exercises.map(exercise => <Button key={exercise.id} palette={palette} label={exercise.name}
        selected={exercise.id === selectedId} onPress={() => onPick(exercise.id)}/>)}
    </ScrollView>
  </Modal>;
}
