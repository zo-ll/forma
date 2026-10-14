import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import type { NotesModule } from '@forma/core';
import { collectNoteFieldCases } from './fixtures/note-field-cases.js';

export function noteFieldsContract(label: string, fixture: (t: TestContext) => NotesModule | Promise<NotesModule>): void {
  for (const item of collectNoteFieldCases(assert)) {
    test(label + ': ' + item.name, async (t) => item.run(await fixture(t)));
  }
}
