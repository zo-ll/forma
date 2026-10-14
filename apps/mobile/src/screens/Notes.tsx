import React, {useRef, useState} from 'react';
import {Text, TextInput, View} from 'react-native';
import {FormaError} from '@forma/core';
import type {ConfirmNoteFieldsInput, CreateNoteInput, Note, NoteFieldConfirmation, NoteFieldsView, NoteHistoryInput, NoteHistoryPage, NoteKind, NoteSource, UpdateNoteInput} from '@forma/core';
import {noteDraft, noteKey} from '../forms/index';
import type {NoteDraft} from '../forms/index';
import {Button, Card, ConfirmSheet, ErrorNotice, Muted, ScreenHeader} from '../ui/controls';
import {shared} from '../ui/theme';
import type {ScreenContext} from './context';
import {noteUnavailable, useNoteCommand, useNoteRead} from './noteHooks';

export const NOTE_KINDS: readonly NoteKind[] = ['general', 'pain', 'sleep', 'personal-best'];
export function NoteText({ctx, text}: {ctx: ScreenContext; text: string}) {
  return <Text selectable style={{color: ctx.palette.text}}>{text}</Text>;
}
export function NoteInput({ctx, label, value, onChange, editable = true, multiline = false, maxLength}: {
  ctx: ScreenContext; label: string; value: string; onChange: (value: string) => void; editable?: boolean; multiline?: boolean; maxLength?: number;
}) {
  return <View style={{gap: 4}}><Muted palette={ctx.palette}>{label}</Muted>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} editable={editable && !noteUnavailable(ctx)}
      multiline={multiline} maxLength={maxLength} autoCorrect={false} autoCapitalize="none" placeholderTextColor={ctx.palette.muted}
      style={[shared.input, {color: ctx.palette.text, borderColor: ctx.palette.muted, minHeight: multiline ? 160 : 48, textAlignVertical: 'top'}]}/></View>;
}
interface Filters {readonly query: string; readonly dateFrom: string; readonly dateTo: string; readonly kind: NoteKind | null}
const EMPTY: Filters = {query: '', dateFrom: '', dateTo: '', kind: null};
const FILTER_KEY = noteKey('filters');
const TYPED_KEY = noteKey('typedFilters');
export function Notes({ctx}: {ctx: ScreenContext}) {
  const {palette, forms} = ctx;
  const [filters, setFilters] = useState(() => forms.drafts.get<Filters>(FILTER_KEY) ?? EMPTY);
  const [typed, setTyped] = useState(() => forms.drafts.get<Filters>(TYPED_KEY) ?? filters);
  const intent = useRef(typed);
  const [cursors, setCursors] = useState<readonly (string | undefined)[]>([undefined]);
  const page = cursors.length - 1;
  const input: NoteHistoryInput = {limit: 20, ...(filters.dateFrom ? {dateFrom: filters.dateFrom} : {}),
    ...(filters.dateTo ? {dateTo: filters.dateTo} : {}), ...(filters.kind ? {kind: filters.kind} : {}),
    ...(cursors[page] ? {cursor: cursors[page]} : {})};
  const readKey = JSON.stringify({query: filters.query, ...input});
  const {loaded, reload} = useNoteRead<NoteHistoryPage>(ctx, readKey, service => filters.query.trim() === ''
    ? service.notes.history(input) : service.notes.searchText({query: filters.query, ...input}));
  const change = (patch: Partial<Filters>) => {
    const next = {...intent.current, ...patch}; intent.current = next; setTyped(next); forms.drafts.set(TYPED_KEY, next);
  };
  const apply = () => {
    const next = {...intent.current, dateFrom: intent.current.dateFrom.trim(), dateTo: intent.current.dateTo.trim()};
    setFilters(next); forms.drafts.set(FILTER_KEY, next); setCursors([undefined]); reload();
  };
  const unavailable = noteUnavailable(ctx);
  const stale = loaded.state === 'error' && loaded.error instanceof FormaError && loaded.error.code === 'CONFLICT' && loaded.error.field === 'cursor';
  return <View style={{gap: 14}}>
    <ScreenHeader palette={palette} title="Notes"/>
    <Button palette={palette} primary label="New note" disabledReason={unavailable ?? (!ctx.snapshot.calendar ? 'The current date is not ready.' : null)} onPress={() => {
      if (noteUnavailable(ctx)) return;
      forms.drafts.clear(`${noteKey('create')}:completed`); ctx.push({name: 'NoteCreate'});
    }}/>
    <NoteInput ctx={ctx} label="Literal text search" value={typed.query} onChange={query => change({query})} maxLength={512}/>
    <Muted palette={palette}>Search matches a literal token phrase. Kind is a label, not a confirmed fact.</Muted>
    <NoteInput ctx={ctx} label="Notes start date" value={typed.dateFrom} onChange={dateFrom => change({dateFrom})}/>
    <NoteInput ctx={ctx} label="Notes end date" value={typed.dateTo} onChange={dateTo => change({dateTo})}/>
    <View style={[shared.row, {flexWrap: 'wrap'}]}>{([null, ...NOTE_KINDS]).map(kind => <Button key={kind ?? 'all'} palette={palette}
      label={`Kind: ${kind ?? 'all'}`} selected={typed.kind === kind} disabledReason={unavailable} onPress={() => change({kind})}/>)}</View>
    <Button palette={palette} label="Search / load notes" disabledReason={unavailable} onPress={apply}/>
    {loaded.state === 'loading' && <Muted palette={palette}>Loading notes…</Muted>}
    {loaded.state === 'error' && <><ErrorNotice palette={palette} error={loaded.error}/>
      <Button palette={palette} label={stale ? 'Restart notes from newest' : 'Reload notes'} disabledReason={unavailable}
        onPress={() => {setCursors([undefined]); reload();}}/></>}
    {loaded.state === 'ready' && <>
      {loaded.value.items.length === 0 && <Muted palette={palette}>No notes match.</Muted>}
      {loaded.value.items.map(note => <Card key={note.id} palette={palette}>
        <Muted palette={palette}>{note.date} · {note.kind} · revision {note.revision}</Muted>
        <NoteText ctx={ctx} text={note.text}/>
        <Button palette={palette} label={`Open note ${note.id}, revision ${note.revision}`} disabledReason={unavailable}
          onPress={() => {if (!noteUnavailable(ctx)) ctx.push({name: 'NoteDetail', source: note.source});}}/>
      </Card>)}
      <View style={shared.row}>
        <Button palette={palette} label="Newer notes" disabledReason={unavailable ?? (page === 0 ? 'Newest page.' : null)} onPress={() => setCursors(c => c.length > 1 ? c.slice(0, -1) : c)}/>
        <Muted palette={palette}>Page {page + 1}</Muted>
        <Button palette={palette} label="Older notes" disabledReason={unavailable ?? (!loaded.value.nextCursor ? 'No older notes.' : null)}
          onPress={() => {const next = loaded.value.nextCursor; if (next) setCursors(c => c.at(-1) === next ? c : [...c, next]);}}/>
      </View>
    </>}
  </View>;
}

/** No mutable snapshot is labelled as the route's exact source. */
export function ExactNote({ctx, source, children, retry}: {ctx: ScreenContext; source: NoteSource; retry?: React.ReactNode; children: (note: Note, fields: NoteFieldsView, reload: () => void) => React.ReactNode}) {
  const {loaded, reload} = useNoteRead(ctx, JSON.stringify(source), async service => {
    const [note, fields] = await Promise.all([service.notes.get(source.noteId), service.notes.fields(source.noteId)]);
    return {note, fields};
  });
  if (loaded.state === 'loading') return <Muted palette={ctx.palette}>Loading exact note…</Muted>;
  if (loaded.state === 'error') return <View><ErrorNotice palette={ctx.palette} error={loaded.error}/>
    <Button palette={ctx.palette} label="Reload exact note" disabledReason={noteUnavailable(ctx)} onPress={reload}/>
    <Button palette={ctx.palette} label="Back to notes" onPress={() => ctx.reset([])}/></View>;
  const {note, fields} = loaded.value;
  if (note.revision !== source.revision || fields.source.revision !== source.revision) return <View style={{gap: 12}}>
    <ScreenHeader palette={ctx.palette} title="Source changed" back={{label: 'Notes', onPress: () => ctx.reset([])}}/>
    <Muted palette={ctx.palette}>Requested revision {source.revision} is not the current source. No newer text is shown as that revision.</Muted>
    {retry}
    <Button palette={ctx.palette} label="Refresh to current note" disabledReason={noteUnavailable(ctx)}
      onPress={() => ctx.reset([{name: 'NoteDetail', source: note.source}])}/>
  </View>;
  return <>{children(note, fields, reload)}</>;
}
export function NoteDetail({ctx, source}: {ctx: ScreenContext; source: NoteSource}) {
  return <ExactNote ctx={ctx} source={source}>{(note, fields) => <NoteDetailBody ctx={ctx} note={note} fields={fields}/>}</ExactNote>;
}
export function NoteDetailBody({ctx, note, fields}: {ctx: ScreenContext; note: Note; fields: NoteFieldsView}) {
  const [confirming, setConfirming] = useState(false);
  const confirmationIntent = useRef(false);
  const showConfirmation = (value: boolean) => {confirmationIntent.current = value; setConfirming(value);};
  const slot = noteKey('delete', note.id, note.revision);
  const remove = useNoteCommand<{noteId: string; expectedRevision: number}, void>(ctx, slot, noteKey('edit', note.id),
    (service, requestId, input) => service.notes.delete({requestId, ...input}), () => ctx.reset([]));
  return <View style={{gap: 14}}>
    <ScreenHeader palette={ctx.palette} title="Note" subtitle={`${note.date} · ${note.kind} · revision ${note.revision}`} back={{label: 'Notes', onPress: () => ctx.reset([])}}/>
    <NoteText ctx={ctx} text={note.text}/>
    <Muted palette={ctx.palette}>Fields: {fields.state}. Kind is only a label.</Muted>
    {fields.confirmation && <Card palette={ctx.palette}><Text style={{color: ctx.palette.text}}>Confirmed fields</Text>
      {fields.confirmation.fields.pain.map((p, i) => <Muted key={i} palette={ctx.palette}>{p.bodyPart === 'other' ? p.otherBodyPart : p.bodyPart} · {p.side} · {p.state} · severity {p.severity ?? 'unknown'}</Muted>)}
      <Muted palette={ctx.palette}>Sleep: {fields.confirmation.fields.sleep?.durationMin ?? 'unknown'} min · {fields.confirmation.fields.sleep?.quality ?? 'unknown'}</Muted>
      <Muted palette={ctx.palette}>Personal-best claim: {fields.confirmation.fields.personalBest?.claimText ?? 'unknown'}. Not a computed record.</Muted>
    </Card>}
    <Suggestions ctx={ctx} fields={fields}/>
    <Button palette={ctx.palette} label="Edit note" disabledReason={noteUnavailable(ctx)} onPress={() => {if (!noteUnavailable(ctx)) ctx.push({name: 'NoteEdit', source: note.source});}}/>
    <Button palette={ctx.palette} label="Review and confirm fields" disabledReason={noteUnavailable(ctx)} onPress={() => {if (!noteUnavailable(ctx)) ctx.push({name: 'NoteFields', source: note.source});}}/>
    <Button palette={ctx.palette} label="Delete note" disabledReason={noteUnavailable(ctx)} onPress={() => showConfirmation(true)}/>
    {remove.failure != null && <><ErrorNotice palette={ctx.palette} error={remove.failure}/><Button palette={ctx.palette} label="Reload current source" onPress={() => ctx.reset([{name: 'NoteDetail', source: note.source}])}/></>}
    {remove.unconfirmed && <Muted palette={ctx.palette}>Deletion is unconfirmed. Confirm again to retry the saved request.</Muted>}
    <ConfirmSheet palette={ctx.palette} visible={confirming} busy={remove.busy} title="Delete this note?" body="This removes the note and its confirmed fields. You cannot undo this."
      confirmLabel="Confirm delete note" keepLabel="Keep note" onKeep={() => showConfirmation(false)}
      onConfirm={() => {if (confirmationIntent.current && !noteUnavailable(ctx)) remove.run({noteId: note.id, expectedRevision: note.revision});}}/>
  </View>;
}
export function Suggestions({ctx, fields}: {ctx: ScreenContext; fields: NoteFieldsView}) {
  return <Card palette={ctx.palette}><Text style={{color: ctx.palette.text}}>Suggestions only — not confirmed facts</Text>
    {(['pain', 'sleep', 'personalBest'] as const).map(group => <View key={group} style={{gap: 6}}>
      <Muted palette={ctx.palette}>{group}: {fields.suggestions[group].state}</Muted>
      {fields.suggestions[group].items.map((item, i) => <View key={i}><Muted palette={ctx.palette}>{item.status} · {item.reason}</Muted><NoteText ctx={ctx} text={item.evidence.text}/></View>)}
      {fields.suggestions[group].truncated && <Muted palette={ctx.palette}>More suggestions were omitted.</Muted>}
    </View>)}
  </Card>;
}
export function NoteCreate({ctx}: {ctx: ScreenContext}) {return <NoteForm ctx={ctx} note={null}/>;}
export function NoteEdit({ctx, source}: {ctx: ScreenContext; source: NoteSource}) {
  return <ExactNote ctx={ctx} source={source} retry={<NotePendingRetry ctx={ctx} source={source} operation="update"/>}>{note => <NoteForm ctx={ctx} note={note}/>}</ExactNote>;
}
/** A committed write with a lost reply can advance the source before the form remounts. */
export function NotePendingRetry({ctx, source, operation}: {ctx: ScreenContext; source: NoteSource; operation: 'update' | 'confirm'}) {
  const slot = noteKey(operation, source.noteId, source.revision);
  const pending = ctx.forms.commands.pending(slot);
  const draftKey = noteKey(operation === 'update' ? 'edit' : 'fieldsDraft', source.noteId);
  const command = useNoteCommand<Omit<UpdateNoteInput, 'requestId'> | Omit<ConfirmNoteFieldsInput, 'requestId'>, Note | NoteFieldConfirmation>(ctx, slot, draftKey,
    (service, requestId, saved) => 'fields' in saved ? service.notes.confirmFields({requestId, ...saved}) : service.notes.update({requestId, ...saved}),
    result => ctx.reset([{name: 'NoteDetail', source: result.source}]));
  if (!pending) return null;
  return <View style={{gap: 8}}><Muted palette={ctx.palette}>The captured write has no confirmed reply. Settle it before you use a new source.</Muted>
    {command.failure != null && <ErrorNotice palette={ctx.palette} error={command.failure}/>}
    <Button palette={ctx.palette} label="Retry captured note request" disabledReason={noteUnavailable(ctx)} busyLabel={command.busy ? 'Settling request…' : null}
      onPress={() => command.run(pending.input as Omit<UpdateNoteInput, 'requestId'> | Omit<ConfirmNoteFieldsInput, 'requestId'>)}/></View>;
}
type SaveInput = Omit<CreateNoteInput, 'requestId'> | Omit<UpdateNoteInput, 'requestId'>;
export function NoteForm({ctx, note}: {ctx: ScreenContext; note: Note | null}) {
  const {forms, palette} = ctx;
  const key = noteKey(note ? 'edit' : 'draft', note?.id);
  const [draft, setDraft] = useState<NoteDraft>(() => forms.drafts.get<NoteDraft>(key) ?? noteDraft(note, ctx.snapshot.calendar?.dateFrom ?? ''));
  const intent = useRef(draft);
  const stale = note !== null && draft.expectedRevision !== note.revision;
  const slot = noteKey(note ? 'update' : 'create', note?.id, note?.revision);
  const save = useNoteCommand<SaveInput, Note>(ctx, slot, key, (service, requestId, input) => 'noteId' in input
    ? service.notes.update({requestId, ...input}) : service.notes.create({requestId, ...input}),
  result => ctx.reset([{name: 'NoteDetail', source: result.source}]));
  const change = (patch: Partial<NoteDraft>) => {
    if (save.busy || save.unconfirmed || noteUnavailable(ctx)) return;
    const next = {...intent.current, ...patch}; intent.current = next; setDraft(next); forms.drafts.set(key, next);
  };
  const conflict = stale || (save.failure instanceof FormaError && save.failure.code === 'CONFLICT');
  return <View style={{gap: 14}}>
    <ScreenHeader palette={palette} title={note ? 'Edit note' : 'New note'} back={{label: 'Notes (keep draft)', onPress: () => {forms.drafts.set(key, intent.current); ctx.reset([]);}}}/>
    <NoteInput ctx={ctx} label="Note date" value={draft.date} onChange={date => change({date})} editable={!save.busy && !save.unconfirmed}/>
    <NoteInput ctx={ctx} label="Original note text" value={draft.text} onChange={text => change({text})} multiline maxLength={16384} editable={!save.busy && !save.unconfirmed}/>
    <View style={[shared.row, {flexWrap: 'wrap'}]}>{NOTE_KINDS.map(kind => <Button key={kind} palette={palette} label={`Note kind: ${kind}`} selected={draft.kind === kind}
      disabledReason={noteUnavailable(ctx) ?? (save.busy || save.unconfirmed ? 'Settle the saved request first.' : null)} onPress={() => change({kind})}/>)}</View>
    <Muted palette={palette}>Kind is a label. Saving does not use a model. An edit clears prior field confirmation.</Muted>
    {save.failure != null && <ErrorNotice palette={palette} error={save.failure}/>}
    {conflict && <><Muted palette={palette}>The source changed. Your draft remains. Reload the source before you edit again.</Muted>
      <Button palette={palette} label="Reload source (keep draft)" disabledReason={noteUnavailable(ctx)} onPress={() => note && ctx.reset([{name: 'NoteDetail', source: note.source}])}/>
      <Button palette={palette} label="Discard draft and reload source" disabledReason={noteUnavailable(ctx)} onPress={() => {forms.drafts.clear(key); if (note) ctx.reset([{name: 'NoteDetail', source: note.source}]);}}/></>}
    {save.unconfirmed && <Muted palette={palette}>The last save is unconfirmed. Retry sends the captured input and request ID. Settle it before you change the draft.</Muted>}
    <Button palette={palette} primary label="Save note" busyLabel={save.busy ? 'Saving note…' : null} disabledReason={noteUnavailable(ctx) ?? (conflict ? 'Reload the changed source.' : null)} onPress={() => {
      if (stale) return;
      const saved = intent.current;
      save.run({date: saved.date, text: saved.text, kind: saved.kind, ...(note ? {noteId: note.id, expectedRevision: saved.expectedRevision!} : {})});
    }}/>
  </View>;
}
