// The fixed smoke-test corpus. The notes are fictional.
import type { RetrievedNote } from './types';

export type NoteRecord = {
  id: string;
  text: string;
};

export type QueryRecord = {
  text: string;
  /** The note IDs that the query must find in the top three. */
  expectedIds: string[];
};

export const CORPUS_QUERY_RESULT_LIMIT = 3;

export const NOTES: NoteRecord[] = [
  { id: 'N1', text: 'Mild ache in my left knee after back squats.' },
  { id: 'N2', text: 'Woke up four times last night. Felt exhausted this morning.' },
  { id: 'N3', text: 'Lunch was salmon, rice, and broccoli.' },
  { id: 'N4', text: 'Sharp left-knee pain during reverse lunges. I stopped.' },
  { id: 'N5', text: 'Romanian deadlifts felt good. Left knee felt fine.' },
  { id: 'N6', text: 'Right shoulder hurt during incline bench press.' },
  { id: 'N7', text: 'Bench press personal best today. Really happy with that.' },
  { id: 'N8', text: 'Felt hungry after dinner and ate another snack.' },
];

export const QUERIES: QueryRecord[] = [
  { text: 'Which notes mention discomfort in my knee?', expectedIds: ['N1', 'N4'] },
  { text: 'When did I have interrupted sleep?', expectedIds: ['N2'] },
  { text: 'Did my shoulder bother me at the gym?', expectedIds: ['N6'] },
  { text: 'What did I eat for lunch?', expectedIds: ['N3'] },
];

export function topThree(ranked: RetrievedNote[]): RetrievedNote[] {
  return ranked.slice(0, CORPUS_QUERY_RESULT_LIMIT);
}
