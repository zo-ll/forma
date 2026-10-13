import React, {useState} from 'react';
import {Modal, Pressable, Text, View} from 'react-native';
import type {LoadConvention} from '@forma/core';
import {Button} from './controls';
import type {Palette} from './theme';
import {shared} from './theme';

export const LOAD_OPTIONS: readonly {readonly id: LoadConvention; readonly label: string; readonly hint: string}[] = [
  {id: 'unknown', label: 'Unknown', hint: 'Not sure how the load was measured'},
  {id: 'entered', label: 'Entered', hint: 'The number on the machine or bar'},
  {id: 'per-hand', label: 'Per hand', hint: 'Weight of each dumbbell'},
  {id: 'combined', label: 'Combined', hint: 'Total of all implements'},
  {id: 'body-weight', label: 'Body weight', hint: 'Added external load only'},
];

export interface LoadChoice {
  readonly loadConvention: LoadConvention;
  readonly implementCount: 1 | 2 | null;
}

/** Trigger text: "Per hand ×2" for per-hand, the label alone for the others. */
export function loadLabel(choice: LoadChoice): string {
  const label = LOAD_OPTIONS.find(option => option.id === choice.loadConvention)?.label ?? choice.loadConvention;
  return choice.loadConvention === 'per-hand' && choice.implementCount !== null ? `${label} ×${choice.implementCount}` : label;
}

/** Plain-language line that restates the recorded meaning of the weight. */
export function loadSentence(weight: string, choice: LoadChoice): string {
  switch (choice.loadConvention) {
    case 'entered': return `${weight} kg as shown on the machine or bar.`;
    case 'per-hand': return choice.implementCount === 2 ? `${weight} kg in each hand, 2 implements.` : `${weight} kg in one hand, 1 implement.`;
    case 'combined': return `${weight} kg total of all implements.`;
    case 'body-weight': return `${weight} kg added to body weight. Body weight is not counted.`;
    default: return 'Load convention unknown. This set is not compared.';
  }
}

/** The trigger sits beside the weight input in the same row (issue #10). */
export function LoadTrigger({palette, choice, onPress, disabled}: {palette: Palette; choice: LoadChoice; onPress: () => void; disabled?: boolean}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Load convention: ${loadLabel(choice)}. Change`}
    accessibilityState={{disabled: !!disabled}} disabled={disabled} onPress={onPress}
    style={[shared.input, {borderColor: palette.accent, justifyContent: 'center', minWidth: 48}]}>
    <Text style={{color: palette.accent, fontWeight: '600'}}>{loadLabel(choice)} ▾</Text>
  </Pressable>;
}

/** Convention and implement count commit together on Done. */
export function LoadPicker({palette, visible, title, initial, onDone, onCancel}: {
  palette: Palette; visible: boolean; title: string; initial: LoadChoice;
  onDone: (choice: LoadChoice) => void; onCancel: () => void;
}) {
  const [convention, setConvention] = useState<LoadConvention>(initial.loadConvention);
  const [count, setCount] = useState<1 | 2 | null>(initial.implementCount);
  const perHand = convention === 'per-hand';
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}
    onShow={() => {setConvention(initial.loadConvention); setCount(initial.implementCount);}}>
    <View style={{flex: 1, justifyContent: 'flex-end', backgroundColor: palette.background}}>
      <View style={[shared.card, {backgroundColor: palette.card, borderBottomLeftRadius: 0, borderBottomRightRadius: 0}]}>
        <Text accessibilityRole="header" style={[shared.title, {color: palette.text}]}>{title}</Text>
        <View accessibilityRole="radiogroup">
          {LOAD_OPTIONS.map(option => {
            const selected = option.id === convention;
            return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{checked: selected}}
              accessibilityLabel={`${option.label}. ${option.hint}`} onPress={() => setConvention(option.id)}
              style={[shared.row, {minHeight: 56}]}>
              <Text style={{color: selected ? palette.accent : palette.muted, width: 24}}>{selected ? '◉' : '○'}</Text>
              <View style={{flexShrink: 1}}><Text style={{color: palette.text, fontWeight: selected ? '700' : '400'}}>{option.label}</Text>
                <Text style={{color: palette.muted}}>{option.hint}</Text></View>
            </Pressable>;
          })}
        </View>
        {perHand && <View style={{gap: 6}}>
          <Text style={[shared.label, {color: palette.muted}]}>Implements · required for per hand</Text>
          <View accessibilityRole="radiogroup" style={shared.row}>
            {([1, 2] as const).map(value => <Button key={value} palette={palette} style={{flex: 1}}
              label={value === 1 ? '1 implement' : '2 implements'} selected={count === value} onPress={() => setCount(value)}/>)}
          </View>
        </View>}
        <Button palette={palette} primary label="Done" disabledReason={perHand && count === null ? 'Choose 1 or 2 implements.' : null}
          onPress={() => onDone({loadConvention: convention, implementCount: perHand ? count : null})}/>
        <Button palette={palette} label="Cancel" onPress={onCancel}/>
      </View>
    </View>
  </Modal>;
}
