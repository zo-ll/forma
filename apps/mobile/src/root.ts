import {open} from '@op-engineering/op-sqlite';
import {openAndroidForma} from '@forma/adapters/android';
import {createMobileHost} from '@forma/mobile-host';
import type {MobileHost} from '@forma/mobile-host';
import {deviceAdapters} from './adapters/device';

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
