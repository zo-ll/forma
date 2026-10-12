import React, {useEffect, useState} from 'react';
import {AppState, ScrollView, StatusBar, StyleSheet, Text, View, Pressable, useColorScheme, TextInput} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {FormaError} from '@forma/core';
import type {WorkoutHistoryPage} from '@forma/core';
import {MOBILE_THEMES} from '@forma/mobile-host';
import type {MobileHost, MobileHostSnapshot} from '@forma/mobile-host';
import {mobileRoot} from './src/root';
import {deviceAdapters} from './src/adapters/device';
import {runHostGate} from './src/gate';

type Route = 'Home' | 'History' | 'Settings';
function errorText(error: unknown): string {
  return error instanceof FormaError ? `${error.field ? error.field + ': ' : ''}${error.message} (${error.code})`
    : 'The operation failed. Restart the app if the problem continues.';
}
const gateRuns = new Set<string>();
export default function App({formaMode, formaRunId}: {formaMode?: string; formaRunId?: string}) {
  const host = mobileRoot();
  useEffect(() => {
    if (deviceAdapters.isHostGate() && formaMode && formaRunId && !gateRuns.has(formaRunId + formaMode)) {
      gateRuns.add(formaRunId + formaMode);
      void runHostGate(host, formaMode, formaRunId);
    }
  }, [host, formaMode, formaRunId]);
  return <SafeAreaProvider><Shell host={host}/></SafeAreaProvider>;
}
function Shell({host}: {host: MobileHost}) {
  const [snapshot, setSnapshot] = useState<MobileHostSnapshot>(() => host.snapshot());
  const [route, setRoute] = useState<Route>('Home');
  const [failure, setFailure] = useState<string | null>(null);
  const scheme = useColorScheme();
  const dark = snapshot.preferences.theme === 'dark' || (snapshot.preferences.theme === 'system' && scheme === 'dark');
  const colors = dark ? {background: '#101815', card: '#1b2923', text: '#f0f5f1', muted: '#b4c5ba', accent: '#b1efc2'}
    : {background: '#f5f7f2', card: '#ffffff', text: '#17241c', muted: '#506456', accent: '#185d38'};
  const ready = snapshot.phase === 'ready' || snapshot.phase === 'background';
  useEffect(() => {
    const unsubscribe = host.subscribe(() => setSnapshot(host.snapshot()));
    void host.start().then(() => {
      if (AppState.currentState !== 'active') host.background();
    }).catch(error => setFailure(errorText(error)));
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') void host.resume().catch(error => setFailure(errorText(error)));
      else host.background();
    });
    return () => {unsubscribe(); appState.remove();};
    // Component disposal is not host disposal. The React instance retains its one host.
  }, [host]);
  const action = (label: string, onPress: () => void, selected = false, disabled = false) =>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{selected, disabled}}
      disabled={disabled} onPress={onPress} style={[styles.button, {borderColor: colors.accent, opacity: disabled ? 0.5 : 1}]}>
      <Text style={{color: colors.accent, fontWeight: '600'}}>{label}</Text>
    </Pressable>;
  return <SafeAreaView style={[styles.screen, {backgroundColor: colors.background}]}>
    <StatusBar barStyle={dark ? 'light-content' : 'dark-content'}/>
    <View style={styles.heading}><Text accessibilityRole="header" style={[styles.brand, {color: colors.text}]}>Forma</Text>
      <Text style={{color: colors.muted}}>Local workouts. Your records stay on this device.</Text></View>
    <View style={styles.navigation}>{(['Home', 'History', 'Settings'] as const).map(item =>
      <React.Fragment key={item}>{action(item, () => setRoute(item), route === item)}</React.Fragment>)}</View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {(failure || snapshot.error) && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.error, {color: colors.text}]}>
        {failure ?? errorText(snapshot.error)}</Text>}
      {!ready && <Text style={{color: colors.text}}>{snapshot.phase === 'closed' ? 'Local service closed. Restart the app to open it.' : `Local service: ${snapshot.phase}`}</Text>}
      {route === 'Home' && <View style={[styles.card, {backgroundColor: colors.card}]}>
        <Text accessibilityRole="header" style={[styles.title, {color: colors.text}]}>Workout space</Text>
        <Text style={{color: colors.muted}}>Today: {snapshot.calendar?.dateFrom ?? 'Resolving device date…'}</Text>
        <Text style={{color: colors.muted}}>Timezone: {snapshot.calendar?.timeZone ?? 'Device'}</Text>
        <Text style={[styles.paragraph, {color: colors.text}]}>Storage and history are ready. Workout entry screens are the next step.</Text>
        <Text style={{color: colors.muted}}>No account, server, or model is required.</Text>
      </View>}
      {route === 'History' && ready && <History host={host} textColor={colors.text} mutedColor={colors.muted} button={action}/>}
      {route === 'Settings' && <View style={[styles.card, {backgroundColor: colors.card}]}>
        <Text accessibilityRole="header" style={[styles.title, {color: colors.text}]}>Local preferences</Text>
        <Text style={{color: colors.muted}}>Date context: current device timezone</Text>
        <Text style={{color: colors.muted}}>Week: Monday–Sunday · Weight: kg</Text>
        <Text accessibilityRole="header" style={[styles.paragraph, {color: colors.text}]}>Appearance</Text>
        {MOBILE_THEMES.map(theme => <React.Fragment key={theme}>{action(`Theme: ${theme}`, () => {
          void host.setTheme(theme).then(() => setFailure(null)).catch(error => setFailure(errorText(error)));
        }, snapshot.preferences.theme === theme, !ready)}</React.Fragment>)}
        {action('Close local service', () => {void host.close().catch(error => setFailure(errorText(error)));}, false, !ready)}
        <Text style={{color: colors.muted}}>Close drains accepted work. It does not delete records.</Text>
      </View>}
    </ScrollView>
  </SafeAreaView>;
}
function History({host, textColor, mutedColor, button}: {host: MobileHost; textColor: string; mutedColor: string; button: (label: string, press: () => void, selected?: boolean, disabled?: boolean) => React.ReactNode}) {
  const [from, setFrom] = useState('');
  const [page, setPage] = useState<WorkoutHistoryPage | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true); setFailure(null);
    try {setPage(await host.service().workouts.history(from.trim() ? {dateFrom: from.trim()} : {}));}
    catch (error) {setPage(null); setFailure(errorText(error));}
    finally {setBusy(false);}
  };
  return <View>
    <Text accessibilityRole="header" style={[styles.title, {color: textColor}]}>Workout history</Text>
    <Text style={{color: mutedColor}}>Start date (optional, YYYY-MM-DD)</Text>
    <TextInput accessibilityLabel="History start date" value={from} onChangeText={setFrom} editable={!busy}
      autoCapitalize="none" autoCorrect={false} placeholder="YYYY-MM-DD" placeholderTextColor={mutedColor}
      style={[styles.input, {color: textColor, borderColor: mutedColor}]} maxLength={32}/>
    {button(busy ? 'Loading history…' : 'Load history', () => {void load();}, false, busy)}
    {failure && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{color: textColor}}>{failure}</Text>}
    {page && <Text style={{color: mutedColor}}>{page.items.length ? 'Finished workouts' : 'No finished workouts in this range.'}</Text>}
    {page?.items.map(workout => <View key={workout.id} style={styles.historyRow}>
      <Text style={{color: textColor}}>{workout.date}</Text><Text style={{color: mutedColor}}>{workout.sets.length} saved sets</Text>
    </View>)}
    {page?.nextCursor && <Text style={{color: mutedColor}}>More workouts exist. Full pagination controls come with the history screen.</Text>}
  </View>;
}
const styles = StyleSheet.create({
  screen: {flex: 1}, heading: {paddingHorizontal: 20, paddingTop: 16, gap: 6}, brand: {fontSize: 32, fontWeight: '700'},
  navigation: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16}, content: {padding: 20, gap: 18},
  button: {minHeight: 48, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderRadius: 12, justifyContent: 'center', marginVertical: 4},
  card: {borderRadius: 18, padding: 18, gap: 10}, title: {fontSize: 22, fontWeight: '600', marginBottom: 8}, paragraph: {marginVertical: 12},
  input: {borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 48, marginVertical: 12}, error: {borderWidth: 1, borderRadius: 12, padding: 12}, historyRow: {paddingVertical: 12},
});
