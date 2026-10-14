import React, {useRef, useState} from 'react';
import {Text, View} from 'react-native';
import {BODY_PARTS, FormaError} from '@forma/core';
import type {ConfirmNoteFieldsInput, Note, NoteFieldConfirmation, NoteFieldsView, NoteSource, PainField} from '@forma/core';
import {fieldsDraft, noteKey, parseFieldsDraft} from '../forms/index';
import type {FieldsDraft, PainDraft} from '../forms/index';
import {Button, Card, ErrorNotice, Muted, ScreenHeader} from '../ui/controls';
import {shared} from '../ui/theme';
import type {ScreenContext} from './context';
import {noteUnavailable, useNoteCommand} from './noteHooks';
import {ExactNote, NoteInput, NotePendingRetry, NoteText, Suggestions} from './Notes';

export function NoteFields({ctx, source}: {ctx: ScreenContext; source: NoteSource}) {
  return <ExactNote ctx={ctx} source={source} retry={<NotePendingRetry ctx={ctx} source={source} operation="confirm"/>}>{(note, fields) => <FieldsForm ctx={ctx} note={note} fields={fields}/>}</ExactNote>;
}
export function FieldsForm({ctx, note, fields}: {ctx: ScreenContext; note: Note; fields: NoteFieldsView}) {
  const {palette, forms} = ctx;
  const key = noteKey('fieldsDraft', note.id);
  const [draft, setDraft] = useState<FieldsDraft>(() => forms.drafts.get<FieldsDraft>(key) ?? fieldsDraft(note.revision, fields.confirmation?.fields ?? null));
  const intent = useRef(draft);
  const [problem, setProblem] = useState<string | null>(null);
  const command = useNoteCommand<Omit<ConfirmNoteFieldsInput, 'requestId'>, NoteFieldConfirmation>(ctx, noteKey('confirm', note.id, note.revision), key,
    (service, requestId, input) => service.notes.confirmFields({requestId, ...input}),
    result => ctx.reset([{name: 'NoteDetail', source: result.source}]));
  const stale = draft.expectedRevision !== note.revision || (command.failure instanceof FormaError && command.failure.code === 'CONFLICT');
  const disabled = noteUnavailable(ctx) ?? (command.busy || command.unconfirmed ? 'Settle the captured confirmation first.' : null);
  const change = (patch: Partial<FieldsDraft>) => {
    if (disabled) return;
    const next = {...intent.current, ...patch}; intent.current = next; setDraft(next); forms.drafts.set(key, next); setProblem(null);
  };
  const painChange = (index: number, patch: Partial<PainDraft>) => {
    change({pain: intent.current.pain.map((p, i) => i === index ? {...p, ...patch} : p)});
  };
  const add = (p: PainField | null) => {
    if (intent.current.pain.length >= 32) return;
    const row: PainDraft = p ? {...p, otherBodyPart: p.otherBodyPart ?? '', severity: p.severity === null ? '' : String(p.severity)}
      : {bodyPart: 'other', otherBodyPart: '', side: 'unspecified', state: 'uncertain', severity: ''};
    change({pain: [...intent.current.pain, row]});
  };
  return <View style={{gap: 14}}>
    <ScreenHeader palette={palette} title="Confirm note fields" back={{label: 'Note (keep draft)', onPress: () => {forms.drafts.set(key, intent.current); ctx.pop();}}}/>
    <NoteText ctx={ctx} text={note.text}/>
    <Muted palette={palette}>Unknown values stay empty. These controls replace all confirmed fields. Empty pain does not mean absence. A personal-best claim is not a computed record.</Muted>
    <Suggestions ctx={ctx} fields={fields}/>
    <Muted palette={palette}>Copying a suggestion only changes this draft. It does not confirm fields.</Muted>
    {fields.suggestions.pain.items.map((s, i) => s.value && <Button key={i} palette={palette} label={`Copy pain suggestion ${i + 1} to draft`} disabledReason={disabled} onPress={() => add(s.value)}/>)}
    {fields.suggestions.sleep.items.map((s, i) => s.value && <Button key={i} palette={palette} label={`Copy sleep suggestion ${i + 1} to draft`} disabledReason={disabled}
      onPress={() => {if (s.value) change({minutes: s.value.durationMin === null ? '' : String(s.value.durationMin), quality: s.value.quality});}}/>)}
    {fields.suggestions.personalBest.items.map((s, i) => s.value && <Button key={i} palette={palette} label={`Copy personal-best suggestion ${i + 1} to draft`} disabledReason={disabled}
      onPress={() => s.value && change({claim: s.value.claimText})}/>)}
    <Text accessibilityRole="header" style={{color: palette.text}}>Pain draft</Text>
    {draft.pain.map((p, i) => <Card key={i} palette={palette}>
      <Muted palette={palette}>Pain entry {i + 1} — not confirmed</Muted>
      <View style={[shared.row, {flexWrap: 'wrap'}]}>{BODY_PARTS.map(bodyPart => <Button key={bodyPart} palette={palette} label={`Pain ${i + 1} body part: ${bodyPart}`} selected={p.bodyPart === bodyPart} disabledReason={disabled}
        onPress={() => painChange(i, {bodyPart, otherBodyPart: ''})}/>)}</View>
      {p.bodyPart === 'other' && <NoteInput ctx={ctx} label={`Pain ${i + 1} other body part (max 128)`} value={p.otherBodyPart} onChange={otherBodyPart => painChange(i, {otherBodyPart})} editable={!disabled} maxLength={128}/>}
      <Muted palette={palette}>Changing the body part clears the other description.</Muted>
      <View style={[shared.row, {flexWrap: 'wrap'}]}>{(['left', 'right', 'bilateral', 'unspecified'] as const).map(side => <Button key={side} palette={palette} label={`Pain ${i + 1} side: ${side}`} selected={p.side === side} disabledReason={disabled} onPress={() => painChange(i, {side})}/>)}</View>
      <View style={[shared.row, {flexWrap: 'wrap'}]}>{(['present', 'absent', 'uncertain'] as const).map(state => <Button key={state} palette={palette} label={`Pain ${i + 1} state: ${state}`} selected={p.state === state} disabledReason={disabled} onPress={() => painChange(i, {state})}/>)}</View>
      <NoteInput ctx={ctx} label={`Pain ${i + 1} severity (optional 0–10)`} value={p.severity} onChange={severity => painChange(i, {severity})} editable={!disabled}/>
      <Muted palette={palette}>State changes retain severity for review. Present permits above zero or empty. Absent permits zero or empty. Uncertain requires empty. Correct any contradiction before confirmation.</Muted>
      <Button palette={palette} label={`Remove pain entry ${i + 1}`} disabledReason={disabled} onPress={() => change({pain: intent.current.pain.filter((_, n) => n !== i)})}/>
    </Card>)}
    <Button palette={palette} label="Add pain entry" disabledReason={disabled ?? (draft.pain.length >= 32 ? 'At most 32 entries.' : null)} onPress={() => add(null)}/>
    <Text accessibilityRole="header" style={{color: palette.text}}>Sleep draft</Text>
    <NoteInput ctx={ctx} label="Sleep minutes (optional 0–1440)" value={draft.minutes} onChange={minutes => change({minutes})} editable={!disabled}/>
    <View style={[shared.row, {flexWrap: 'wrap'}]}>{([null, 'poor', 'fair', 'good'] as const).map(quality => <Button key={quality ?? 'unknown'} palette={palette} label={`Sleep quality: ${quality ?? 'unknown'}`} selected={draft.quality === quality} disabledReason={disabled} onPress={() => change({quality})}/>)}</View>
    <NoteInput ctx={ctx} label="Personal-best claim (optional)" value={draft.claim} onChange={claim => change({claim})} editable={!disabled} multiline maxLength={1024}/>
    {problem && <Text accessibilityRole="alert" style={{color: palette.text}}>{problem}</Text>}
    {command.failure != null && <ErrorNotice palette={palette} error={command.failure}/>}
    {stale && <><Muted palette={palette}>Source conflict. The draft remains. Reload before confirmation.</Muted>
      <Button palette={palette} label="Reload fields source (keep draft)" onPress={() => ctx.reset([{name: 'NoteDetail', source: note.source}])}/>
      <Button palette={palette} label="Discard field draft and reload" onPress={() => {forms.drafts.clear(key); ctx.reset([{name: 'NoteDetail', source: note.source}]);}}/></>}
    {command.unconfirmed && <Muted palette={palette}>Confirmation is unconfirmed. Retry sends the same captured fields and request ID.</Muted>}
    <Button palette={palette} primary label="Confirm these fields" busyLabel={command.busy ? 'Confirming…' : null} disabledReason={noteUnavailable(ctx) ?? (stale ? 'Reload the source.' : null)} onPress={() => {
      if (stale) return;
      const parsed = parseFieldsDraft(intent.current);
      if (!parsed.ok) {setProblem(parsed.problems.map(p => p.message).join(' ')); return;}
      command.run({noteId: note.id, expectedRevision: intent.current.expectedRevision, fields: parsed.value});
    }}/>
  </View>;
}
