import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import type { NotesModule } from '@forma/core';
import { collectNoteCases } from './fixtures/note-cases.js';

export function notesContract(label: string, fixture: (t: TestContext) => NotesModule | Promise<NotesModule>): void {
  for (const item of collectNoteCases(assert)) {
    test(label + ': ' + item.name, async (t) => item.run(await fixture(t)));
  }
}
