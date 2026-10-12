# FitRAG — Specification

Version 0.1. Status: draft.

## 1. Purpose

FitRAG is a phone app for one user. The app logs workouts, meals, and notes. The user asks questions about their own history. The app answers from local data. The app does not use the network.

## 2. Goals

- Log workouts: exercises, sets, reps, weight, and RPE.
- Log meals: foods, grams, and macros.
- Log free-text notes and voice notes.
- Answer questions about the history, for example "what did I bench last week".
- Answer questions about notes, for example "when did my knee hurt".
- Keep all data on the device.
- Work in airplane mode.

## 3. Non-goals

- No cloud service in version 1.
- No account and no sync in version 1.
- No Jev and no other hosted decision API.
- No text generation for numbers. Code computes every number.
- No multi-user support.
- No social features.
- No reference knowledge base in version 1. This version answers about your own history only.

## 4. Constraints

- The target is a phone. Android is first. iOS is second.
- The runtime is fully on-device.
- No data leaves the device.
- The app must fit in the free memory of a mid-range phone.
- Run the models in bfloat16 or float32. Do not use float16.

## 5. Key user questions

| Question | Data source |
| --- | --- |
| What did I bench last week? | SQL over `sets` and `exercises` |
| What is my best squat? | SQL over `sets` and `exercises` |
| How much protein did I eat this week? | SQL over `foods` |
| How many calories on Tuesday? | SQL over `foods` |
| When did my knee hurt? | SQL over `notes` fields, then vector search |
| Which notes mention poor sleep? | Vector search over `notes` |
| Show meals like this photo. | Vector search over meal photo vectors |

## 6. Data model

The store is SQLite. The vector store is `sqlite-vec`. Keep the two parts apart.

### 6.1 Tables

**exercises** — `id`, `name`, `muscle_group`, `equipment`, `aliases`.
The `aliases` field holds short names, for example `RDL` for `Romanian deadlift`.

**workouts** — `id`, `date`, `duration_min`, `notes`.

**sets** — `id`, `workout_id`, `exercise_id`, `reps`, `weight_kg`, `rpe`, `position`.

**meals** — `id`, `date`, `meal_type`, `notes`, `photo_path`.

**foods** — `id`, `meal_id`, `name`, `grams`, `kcal`, `protein_g`, `carbs_g`, `fat_g`.

**notes** — `id`, `date`, `kind`, `text`, `audio_path`.
The `kind` field is one of `workout`, `meal`, `pain`, `sleep`, `other`.

**note_extract** — `note_id`, `body_part`, `mentions_pain`, `severity`, `is_personal_best`.
This table holds the typed fields from the note extraction step.

### 6.2 Vector index

Embed only free text and media. Do not embed sets, reps, or macros.

- One vector per row of `notes`.
- One vector per meal photo.
- Dimension: 256. Re-normalize the vector after truncation.

## 7. Model stack

### 7.1 Retriever

- Model: `google/embeddinggemma-2`.
- Configuration: text only. Pass `{"vision_config": None, "audio_config": None}`. The model then uses 270M parameters.
- Output dimension: 256 by default. Test 512 if quality is low.
- Run in bfloat16 or float32.

### 7.2 Generator

- Model: Gemma 4 E2B.
- Job: write the answer from the tool output.
- Limit: the model must not invent a number.

### 7.3 Note extraction

- First pass: rules and a keyword list. Keywords cover body parts, pain words, and sleep words.
- Second pass (optional later): a function call from the generator.
- No hosted API.

### 7.4 Runtimes

| Platform | Runtime |
| --- | --- |
| Android | LiteRT-LM |
| iOS | CoreML or MLX |
| Both | ONNX Runtime Mobile as one code path |

## 8. Query flow

1. The user enters a question.
2. The router picks a tool. The router is a rule set in version 1.
3. The tool runs. A tool returns rows or chunks.
4. The generator writes the answer. The prompt states: use the tool values for numbers.

### 8.1 Tools

- `get_sets(date_from, date_to, exercise)`
- `get_pr(exercise)`
- `get_macros(date_from, date_to)`
- `search_notes(query)`
- `search_meal_photos(photo)`

Do not let the model write free SQL. A fixed tool cannot read the wrong table.

## 9. Retrieval

Use hybrid search. Vector search alone misses exact names. `RDL`, `OHP`, and `DB` are short and easy to confuse.

- Combine the vector score with a keyword score.
- Use SQLite FTS5 for the keyword score.
- Chunk rule for notes: one note is one chunk.
- Chunk rule for recipes and programs: one item is one chunk. This rule applies if a reference base is added later.

## 10. Note extraction

1. Scan the note text for a body part from a fixed list.
2. Scan for pain words, for example `hurt`, `ache`, `pain`, `tweak`, `pinch`.
3. Scan for personal-best words, for example `PR`, `best`, `record`.
4. Set `severity` from a fixed phrase list, for example `mild`, `sharp`, `bad`.
5. Write the result to `note_extract`.
6. Ask the user to confirm a low-confidence row.

The user confirms every row that sets `mentions_pain` to true.

## 11. Build phases

**Phase 0 — Seed.** Create the `exercises` table. Add name, muscle group, equipment, and aliases. About 150 rows cover most gyms.

**Phase 1 — Logging.** Build the logging screens. Write to SQLite. No model.

**Phase 2 — Tools.** Write the five tools. Test them without a generator.

**Phase 3 — Generator.** Add Gemma 4 E2B. Answer text questions over the logs by tool call.

**Phase 4 — Retrieval.** Add EmbeddingGemma 2. Embed the notes. Add the `search_notes` tool. Add hybrid search.

**Phase 5 — Media.** Add meal photo search. Add voice notes. Add the vision encoder. Add the audio encoder.

## 12. Evaluation

Keep a fixed question set with known answers. Run the set after every change.

- Target: 20 questions.
- Mix: 10 SQL questions, 6 note questions, 4 media questions.
- Score: correct answer, correct number, and correct source.
- Check the 128-dimension option against the 256-dimension option on your own notes.

## 13. Risks and warnings

- **Numbers.** Do not let the model compute a number. A wrong row gives a wrong answer that looks correct.
- **Precision.** The model returns NaN or bad embeddings in float16. The failure is silent.
- **Memory.** Test the free memory of the target phone before you pick the generator size.
- **Names.** Keep the exercise names exact. `RDL` and `Romanian deadlift` must map to one row.
- **Chunk mismatch.** The query and the documents must use the same dimension.
- **Cold start.** Retention needs a logging streak of about two weeks before retrieval is useful.
- **Privacy.** Airplane mode is the test. No request may leave the device.

## 14. Open questions

- Android only, or Android and iOS together?
- Is Gemma 4 E2B small enough for the target phone?
- Should the app use one screen for logging and one screen for questions?
- Do you have a CSV export from an older app? If yes, write an import script.
- Which foods and macros do you track by default?

## 15. Glossary

- **Embedding** — a fixed-length vector that represents content.
- **RAG** — retrieval-augmented generation. Retrieve content, then write an answer.
- **Noul, Choice, Score** — the three answer types of Jev. Not used in this project.
- **MRL** — Matryoshka Representation Learning. A short vector keeps most of the quality.
- **Hybrid search** — a mix of vector search and keyword search.
- **Cold start** — the period before the app has enough history.
