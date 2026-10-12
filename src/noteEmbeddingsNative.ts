// Typed adapter for the native NoteEmbeddings module.
//
// The native module runs the LiteRT-LM EmbeddingEngine on Android. Unit tests
// do not import this file.
import { requireNativeModule } from 'expo-modules-core';
import type { NoteEmbeddingsNativeModule } from '../modules/note-embeddings/src/NoteEmbeddings.types';

const noteEmbeddings = requireNativeModule<NoteEmbeddingsNativeModule>('NoteEmbeddings');

export default noteEmbeddings;
