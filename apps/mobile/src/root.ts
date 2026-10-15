import {open} from '@op-engineering/op-sqlite';
import {openAndroidForma} from '@forma/adapters/android';
import {createMobileHost, createModelImportFlow} from '@forma/mobile-host';
import type {MobileHost, ModelImportFlow} from '@forma/mobile-host';
import {modelFiles} from './adapters/models';
import {deviceAdapters} from './adapters/device';
import {ARCHIVE_LIMITS} from '@forma/core';
import type {InferenceRuntime} from '@forma/core';
import {experimentalGateInference} from './adapters/inference';
import {createArchiveFlow} from './archive/flow';
import type {ArchiveFlow} from './archive/flow';
import {createCommandLedger, createDraftStore} from './forms/index';
import type {CommandLedger, DraftStore} from './forms/index';

const key = Symbol.for('forma.mobile.host.v1');
const registry = globalThis as typeof globalThis & {[key: symbol]: unknown};
/** The React instance owns one host, including across Fast Refresh component mounts. */
export function mobileRoot(mode?: string): MobileHost {
  const existing = registry[key] as MobileHost | undefined;
  if (existing) return existing;
  let inference: InferenceRuntime | undefined;
  try { inference = experimentalGateInference(mode); } catch { /* Optional inference cannot prevent record service startup. */ }
  const host = createMobileHost({
    openService: () => openAndroidForma({
      databaseName: 'forma.sqlite', openDatabase: open,
      clock: deviceAdapters.clock, ids: deviceAdapters.ids,
      ...(inference === undefined ? {} : {inference}),
    }),
    preferences: deviceAdapters.preferences,
    platform: deviceAdapters.platform,
  });
  registry[key] = host;
  return host;
}

export interface MobileForms {
  readonly commands: CommandLedger;
  readonly drafts: DraftStore;
  /** The restore command identity. A records change does not clear it, so an unconfirmed restore can retry. */
  readonly restore: CommandLedger;
}

const formsKey = Symbol.for('forma.mobile.forms.v1');
/** Saved request keys and unsaved values live as long as the host, not a screen. */
export function mobileForms(): MobileForms {
  const existing = registry[formsKey] as MobileForms | undefined;
  if (existing) return existing;
  const forms: MobileForms = {
    commands: createCommandLedger(deviceAdapters.ids), drafts: createDraftStore(), restore: createCommandLedger(deviceAdapters.ids),
  };
  registry[formsKey] = forms;
  return forms;
}

const modelKey = Symbol.for('forma.mobile.models.v1');
/** File import survives navigation. It never loads inference or enters the records queue. */
export function mobileModelFlow(): ModelImportFlow {
  const existing = registry[modelKey] as ModelImportFlow | undefined;
  if (existing) return existing;
  const host = mobileRoot();
  const flow = createModelImportFlow({
    files: modelFiles, nextId: deviceAdapters.ids.next,
    available: () => ['ready', 'background'].includes(host.snapshot().phase),
  });
  host.subscribe(() => {
    if (['closing', 'closed', 'failed'].includes(host.snapshot().phase)) void flow.cancel();
  });
  registry[modelKey] = flow;
  return flow;
}

const archiveKey = Symbol.for('forma.mobile.archive.v1');
/** One archive flow per host lifetime, so a picker result survives navigation. */
export function mobileArchiveFlow(): ArchiveFlow {
  const existing = registry[archiveKey] as ArchiveFlow | undefined;
  if (existing) return existing;
  const host = mobileRoot();
  const flow = createArchiveFlow({
    service: () => host.service(),
    replaceRecords: run => host.replaceRecords(run),
    files: deviceAdapters.files,
    restoreLedger: mobileForms().restore,
    localDate: () => host.snapshot().calendar?.dateFrom ?? new Date().toISOString().slice(0, 10),
    maxBytes: ARCHIVE_LIMITS.maxArchiveBytes,
  });
  registry[archiveKey] = flow;
  return flow;
}
