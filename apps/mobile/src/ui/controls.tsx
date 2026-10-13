import React from 'react';
import {Pressable, Text, View} from 'react-native';
import type {StyleProp, ViewStyle} from 'react-native';
import {FormaError} from '@forma/core';
import type {Palette} from './theme';
import {shared} from './theme';

export interface ButtonProps {
  readonly palette: Palette;
  readonly label: string;
  readonly onPress: () => void;
  /** Filled accent button for the main action of a screen. */
  readonly primary?: boolean;
  readonly selected?: boolean;
  /** Shown instead of the label while a command runs. Taps do nothing. */
  readonly busyLabel?: string | null;
  /** A visible reason replaces color alone for a disabled control. */
  readonly disabledReason?: string | null;
  readonly accessibilityLabel?: string;
  readonly style?: StyleProp<ViewStyle>;
}

export function Button({palette, label, onPress, primary, selected, busyLabel, disabledReason, accessibilityLabel, style}: ButtonProps) {
  const busy = busyLabel != null;
  const disabled = busy || disabledReason != null;
  const filled = primary && !disabledReason;
  const text = busy ? busyLabel : disabledReason ? `${label} · unavailable` : label;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label}
    accessibilityHint={disabledReason ?? undefined} accessibilityState={{selected: !!selected, disabled, busy}}
    disabled={disabled} onPress={onPress}
    style={[shared.button, primary && shared.mainButton, {
      borderColor: disabledReason ? palette.muted : palette.accent,
      borderStyle: disabledReason || busy ? 'dashed' : 'solid',
      backgroundColor: filled && !busy ? palette.accent : 'transparent',
    }, style]}>
    <Text style={{color: filled && !busy ? palette.onAccent : disabledReason ? palette.muted : palette.accent, fontWeight: '600', fontSize: primary ? 17 : 15}}>
      {selected ? '✓ ' : ''}{text}
    </Text>
  </Pressable>;
}

/** Typed core failures keep their message, field, and code. */
export function describeError(error: unknown): {message: string; field: string | null; code: string} {
  if (error instanceof FormaError) return {message: error.message, field: error.field ?? null, code: error.code};
  return {message: 'The operation failed. Restart the app if the problem continues.', field: null, code: 'UNEXPECTED'};
}

const GLYPHS: Record<string, string> = {SERVICE_CLOSED: '■', CONFLICT: '◆'};

export function ErrorNotice({palette, error, title}: {palette: Palette; error: unknown; title?: string}) {
  const {message, field, code} = describeError(error);
  return <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={[shared.notice, {borderColor: palette.text}]}>
    <Text style={[shared.label, {color: palette.text}]}>{GLYPHS[code] ?? '▲'} {title ?? (code === 'CONFLICT' ? 'CONFLICT' : 'ERROR')}</Text>
    <Text style={{color: palette.text}}>{field ? <Text style={{fontWeight: '700'}}>{field}: </Text> : null}{message}</Text>
    <Text style={[shared.code, {color: palette.muted}]}>{code}{field ? ` · field ${field}` : ''}</Text>
  </View>;
}

export function Card({palette, children, style}: {palette: Palette; children: React.ReactNode; style?: StyleProp<ViewStyle>}) {
  return <View style={[shared.card, {backgroundColor: palette.card}, style]}>{children}</View>;
}

export function ScreenHeader({palette, title, subtitle, back}: {palette: Palette; title: string; subtitle?: string; back?: {label: string; onPress: () => void}}) {
  return <View style={{gap: 6}}>
    {back && <Pressable accessibilityRole="button" accessibilityLabel={`Back to ${back.label}`} onPress={back.onPress}
      style={{minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: 12}}>
      <Text style={{color: palette.accent, fontWeight: '600'}}>← {back.label}</Text>
    </Pressable>}
    <Text accessibilityRole="header" style={[shared.title, {color: palette.text}]}>{title}</Text>
    {subtitle ? <Text style={{color: palette.muted}}>{subtitle}</Text> : null}
  </View>;
}

export function Muted({palette, children}: {palette: Palette; children: React.ReactNode}) {
  return <Text style={{color: palette.muted}}>{children}</Text>;
}
