# Forma

Forma is a local-first fitness service. This milestone includes workouts only.
Nutrition will follow later.

## Status

The workout core and a SQLite adapter for Node exist.
The mobile app does not exist yet.

The service can:

- List your 19 exercises and three workout groups.
- Resolve exercise names and explicit aliases.
- Create workouts with an explicit calendar date.
- Add, edit, and delete sets.
- Retrieve workouts and filter history by date.
- Preserve records after the database closes and reopens.

The core does not use React, Expo, a SQLite driver, or a model.

## Start

Use Node 24 or later. The Node SQLite API still has experimental status.

1. Install the dependencies.

   ```sh
   npm ci
   ```

2. Run the tests.

   ```sh
   npm test
   ```

3. Run the example.

   ```sh
   npm run demo
   ```

The example creates fictional records in a temporary SQLite file.
It edits and deletes sets, closes the service, and verifies the records after reopen.
It removes the temporary database after the check.

Use `npm run typecheck` to check the types.
This command also emits the libraries and their type declarations.

## Packages

- [`@forma/core`](packages/core/src/index.ts) owns the domain rules and public API.
- [`@forma/adapters/node`](packages/adapters/src/node/index.ts) implements the storage port and constructs the Node service.
- [`examples/workouts.ts`](examples/workouts.ts) acts as a client of the service.
- [`tests/`](tests/) checks the same behavior with memory and SQLite adapters.

Each host constructs its adapters and injects them into the core.
The Node entry point remains separate from future mobile adapters.

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the API contracts.
Read [SPEC.md](SPEC.md) for the current scope and exercise catalog.

## Limits

This milestone has no mobile UI, Android adapter, nutrition module, or inference.
The catalog has no edit API.
History lists have no pagination.
Write commands have no request ID for duplicate prevention.
Clients must not automatically retry write commands.
SQLite files contain unencrypted data.

## Separate validation app

The private validation repo is:
https://github.com/zo-ll/on-device-validation

It owns the test UI, native inference module, model import, and device checks.
Forma has no runtime dependency on it.

The intended mobile client uses React Native and TypeScript.
Android is first, with OP-SQLite as the storage candidate.
The initial inference candidates remain EmbeddingGemma 2 Text 270M on CPU
and Gemma 4 E2B on GPU through LiteRT-LM.
These models do not form part of this milestone.

The earlier device tests do not prove this service on Android.
They do not prove simultaneous model memory use.
A future Telegram client requires a separate privacy decision.
Telegram messages pass through its servers.
