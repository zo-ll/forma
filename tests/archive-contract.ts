import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import type { FormaService } from '@forma/core';
import { collectArchiveCases } from './fixtures/archive-cases.js';

let services = 0;
/**
 * `open` returns a new, empty service on its own database with the supplied IDs.
 * Distinct IDs per service model UUIDs: a restored record never collides with a new one.
 */
export function archiveContract(label: string,
  open: (t: TestContext, ids: readonly string[]) => Promise<FormaService>): void {
  for (const item of collectArchiveCases(assert)) {
    test(label + ': ' + item.name, async (t) => item.run(() => {
      const prefix = 'archive-' + ++services + '-';
      return open(t, Array.from({ length: 100 }, (_, index) => prefix + index));
    }));
  }
}
