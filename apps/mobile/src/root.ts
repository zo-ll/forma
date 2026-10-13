import {open} from '@op-engineering/op-sqlite';
import {openAndroidForma} from '@forma/adapters/android';
import {createMobileHost} from '@forma/mobile-host';
import type {MobileHost} from '@forma/mobile-host';
import {deviceAdapters} from './adapters/device';
import {createCommandLedger, createDraftStore} from './forms/index';
import type {CommandLedger, DraftStore} from './forms/index';

const key = Symbol.for('forma.mobile.host.v1');
const registry = globalThis as typeof globalThis & {[key: symbol]: unknown};
/** The React instance owns one host, including across Fast Refresh component mounts. */
export function mobileRoot(): MobileHost {
  const existing = registry[key] as MobileHost | undefined;
  if (existing) return existing;
  const host = createMobileHost({
    openService: () => openAndroidForma({
      databaseName: 'forma.sqlite', openDatabase: open,
      clock: deviceAdapters.clock, ids: deviceAdapters.ids,
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
}

const formsKey = Symbol.for('forma.mobile.forms.v1');
/** Saved request keys and unsaved values live as long as the host, not a screen. */
export function mobileForms(): MobileForms {
  const existing = registry[formsKey] as MobileForms | undefined;
  if (existing) return existing;
  const forms: MobileForms = {commands: createCommandLedger(deviceAdapters.ids), drafts: createDraftStore()};
  registry[formsKey] = forms;
  return forms;
}
