import React, {useEffect, useState} from 'react';
import {AppState, BackHandler, ScrollView, StatusBar, StyleSheet, Text, View, Pressable, useColorScheme} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {FormaError} from '@forma/core';
import {MOBILE_THEMES} from '@forma/mobile-host';
import type {MobileHost, MobileHostSnapshot} from '@forma/mobile-host';
import {mobileForms, mobileRoot} from './src/root';
import {deviceAdapters} from './src/adapters/device';
import {runHostGate} from './src/gate';
import {DARK, LIGHT} from './src/ui/theme';
import type {ScreenContext, StackScreen} from './src/screens/context';
import {Home} from './src/screens/Home';
import {ExerciseOrder, SplitPicker} from './src/screens/StartWorkout';
import {Entry} from './src/screens/Entry';
import {Summary} from './src/screens/Summary';
import {EditDetails} from './src/screens/EditDetails';
import {SetEdit} from './src/screens/SetEdit';
import {History} from './src/screens/History';
import {Progress} from './src/screens/Progress';
import {ConfirmSheet} from './src/ui/controls';

type Route = 'Home' | 'History' | 'Progress' | 'Settings';
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
  const [stack, setStack] = useState<readonly StackScreen[]>([]);
  const [visits, setVisits] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const scheme = useColorScheme();
  const dark = snapshot.preferences.theme === 'dark' || (snapshot.preferences.theme === 'system' && scheme === 'dark');
  const colors = dark ? DARK : LIGHT;
  const ready = snapshot.phase === 'ready' || snapshot.phase === 'background';
  useEffect(() => {
    const unsubscribe = host.subscribe(() => setSnapshot(host.snapshot()));
    void host.start().then(() => {
      if (AppState.currentState !== 'active') host.background();
    }).catch(error => setFailure(errorText(error)));
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') void host.resume().then(() => setVisits(count => count + 1)).catch(error => setFailure(errorText(error)));
      else host.background();
    });
    return () => {unsubscribe(); appState.remove();};
    // Component disposal is not host disposal. The React instance retains its one host.
  }, [host]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length === 0) return false;
      setStack(current => current.slice(0, -1));
      return true;
    });
    return () => subscription.remove();
  }, [stack.length]);
  const ctx: ScreenContext = {
    host, snapshot, palette: colors, forms: mobileForms(),
    push: screen => setStack(current => [...current, screen]),
    pop: () => setStack(current => current.slice(0, -1)),
    reset: screens => {setStack(screens); setVisits(count => count + 1);},
  };
  const top = stack[stack.length - 1];
  const action = (label: string, onPress: () => void, selected = false, disabled = false) =>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{selected, disabled}}
      disabled={disabled} onPress={onPress} style={[styles.button, {borderColor: colors.accent, opacity: disabled ? 0.5 : 1}]}>
      <Text style={{color: colors.accent, fontWeight: '600'}}>{label}</Text>
    </Pressable>;
  return <SafeAreaView style={[styles.screen, {backgroundColor: colors.background}]}>
    <StatusBar barStyle={dark ? 'light-content' : 'dark-content'}/>
    {!top && <View style={styles.navigation}>{(['Home', 'History', 'Progress', 'Settings'] as const).map(item =>
      <React.Fragment key={item}>{action(item, () => {setRoute(item); setVisits(count => count + 1);}, route === item)}</React.Fragment>)}</View>}
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {(top || route !== 'Home') && (failure || snapshot.error) && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.error, {color: colors.text}]}>
        {failure ?? errorText(snapshot.error)}</Text>}
      {!ready && (top || route !== 'Home') && <Text style={{color: colors.text}}>{snapshot.phase === 'closed' ? 'Local service closed. Restart the app to open it.' : `Local service: ${snapshot.phase}`}</Text>}
      {top?.name === 'SplitPicker' && <SplitPicker ctx={ctx}/>}
      {top?.name === 'ExerciseOrder' && <ExerciseOrder key={top.splitDayId} ctx={ctx} splitDayId={top.splitDayId}/>}
      {top?.name === 'Entry' && <Entry key={top.workoutId} ctx={ctx} workoutId={top.workoutId}/>}
      {top?.name === 'Summary' && <Summary key={top.workoutId} ctx={ctx} workoutId={top.workoutId}/>}
      {top?.name === 'EditDetails' && <EditDetails key={top.workoutId} ctx={ctx} workoutId={top.workoutId}/>}
      {top?.name === 'SetEdit' && <SetEdit key={top.setId} ctx={ctx} workoutId={top.workoutId} setId={top.setId}/>}
      {!top && route === 'Home' && <Home ctx={ctx} refreshKey={String(visits)}/>}
      {!top && route === 'History' && ready && <History ctx={ctx}/>}
      {!top && route === 'Progress' && ready && <Progress ctx={ctx}/>}
      {!top && route === 'Settings' && <View style={[styles.card, {backgroundColor: colors.card}]}>
        <Text accessibilityRole="header" style={[styles.title, {color: colors.text}]}>Local preferences</Text>
        <Text style={{color: colors.muted}}>Date context: current device timezone</Text>
        <Text style={{color: colors.muted}}>Week: Monday–Sunday · Weight: kg</Text>
        <Text accessibilityRole="header" style={[styles.paragraph, {color: colors.text}]}>Appearance</Text>
        {MOBILE_THEMES.map(theme => <React.Fragment key={theme}>{action(`Theme: ${theme}`, () => {
          void host.setTheme(theme).then(() => setFailure(null)).catch(error => setFailure(errorText(error)));
        }, snapshot.preferences.theme === theme, !ready)}</React.Fragment>)}
        {action('Close local service', () => setConfirmingClose(true), false, !ready)}
        <Text style={{color: colors.muted}}>Close drains accepted work. It does not delete records.</Text>
      </View>}
    </ScrollView>
    <ConfirmSheet palette={colors} visible={confirmingClose} busy={closing}
      title="Close the local service?"
      body="Close drains accepted work and keeps every saved record. The service cannot reopen in this app run. Restart the app to open it again."
      confirmLabel="Close service" keepLabel="Keep service"
      onConfirm={() => {
        setClosing(true);
        void host.close()
          .then(() => setConfirmingClose(false))
          .catch(error => {setConfirmingClose(false); setFailure(errorText(error));})
          .finally(() => setClosing(false));
      }}
      onKeep={() => setConfirmingClose(false)}/>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: {flex: 1},
  navigation: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16}, content: {padding: 20, gap: 18},
  button: {minHeight: 48, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderRadius: 12, justifyContent: 'center', marginVertical: 4},
  card: {borderRadius: 18, padding: 18, gap: 10}, title: {fontSize: 22, fontWeight: '600', marginBottom: 8}, paragraph: {marginVertical: 12},
  error: {borderWidth: 1, borderRadius: 12, padding: 12},
});
