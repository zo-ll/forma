import {StyleSheet} from 'react-native';

/** Design brief §4 tokens. No other color is approved; state uses glyphs and text as well. */
export interface Palette {
  readonly background: string;
  readonly card: string;
  readonly text: string;
  readonly muted: string;
  readonly accent: string;
  /** Label on an accent fill. It reuses the background token for contrast. */
  readonly onAccent: string;
}

export const LIGHT: Palette = {background: '#f5f7f2', card: '#ffffff', text: '#17241c', muted: '#506456', accent: '#185d38', onAccent: '#f5f7f2'};
export const DARK: Palette = {background: '#101815', card: '#1b2923', text: '#f0f5f1', muted: '#b4c5ba', accent: '#b1efc2', onAccent: '#101815'};

export const shared = StyleSheet.create({
  card: {borderRadius: 18, padding: 18, gap: 10},
  title: {fontSize: 22, fontWeight: '600'},
  brand: {fontSize: 32, fontWeight: '700'},
  button: {minHeight: 48, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderRadius: 12, justifyContent: 'center', alignItems: 'center'},
  mainButton: {minHeight: 56},
  input: {borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 48},
  row: {flexDirection: 'row', alignItems: 'center', gap: 8},
  notice: {borderWidth: 1, borderRadius: 12, padding: 12, gap: 4},
  label: {fontSize: 13, fontWeight: '500'},
  code: {fontFamily: 'monospace', fontSize: 13},
});
