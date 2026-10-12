# Forma

Forma is a planned local-first fitness service for personal workout records,
meal records, and notes. The mobile app will act as a client of the core.

## Status

This repo contains the specification and project documentation.
The core and mobile app do not exist yet. No fitness features have an
implementation here.

The standalone validation app has a separate private repo:
https://github.com/zo-ll/on-device-validation

That repo owns the test screen, Kotlin embedding module, database checks,
model import, build configuration, and test corpus. Forma has no runtime
dependency on the validation app.

## Architecture direction

- `@forma/core` will own domain rules, validation, calculations, query tools,
  retrieval, and answer rules.
- `@forma/adapters` will implement storage, inference, and file access through
  the core's port interfaces.
- `forma-mobile` will own screens, navigation, forms, and display state.

The core will use plain TypeScript and platform-independent data contracts.
It will not import React, Expo, Telegram, or a SQLite driver.
Each host will construct the adapters and inject them into the core service.
These package names describe the plan; the packages do not exist yet.

A future Telegram adapter will require a separate privacy decision because
Telegram messages pass through its servers.

## Initial technical choices

- React Native and TypeScript for the mobile client.
- OP-SQLite with FTS5 and sqlite-vec for Android storage.
- EmbeddingGemma 2 Text 270M on CPU for note embeddings.
- Gemma 4 E2B on GPU as the initial generator candidate.
- LiteRT-LM through a native adapter for Android inference.
- No backend for the first mobile version.

The validation repo records the phone tests and their limits. Those tests do
not prove the future production service or joint model memory use.

## Specification

Read [SPEC.md](SPEC.md) for the draft scope, data model, and build phases.
The specification still needs an architecture update before implementation.
