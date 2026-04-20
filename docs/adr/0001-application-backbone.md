# ADR 0001: Application Backbone

## Status

Accepted.

## Date

2026-04-20

## Context

DJ Desk needs to move quickly from raw track analysis into an interactive set-planning
workspace. The first product risk is the domain model: keys, modes, BPM, chord
progressions, confidence states, and set planning workflows. Rendering performance is
important, but it is not the bottleneck yet.

The application starts local-first, but it should be deployable later without changing
the core architecture.

## Decision

Use an npm workspace monorepo:

- `apps/client`: Vue 3 + Vite application.
- `apps/server`: Fastify API running TypeScript directly on Node 24 LTS.
- `packages/domain`: shared TypeScript package for musical domain types and helpers.
- `docs/adr`: architecture decisions.

Use Node 24 LTS as the runtime baseline and npm as the only package manager. Do not use
Yarn Plug'n'Play or pnpm.

Use Vue 3 stable first. Do not base the application on Vue Vapor Mode yet, because Vapor
is still beta-only in Vue 3.6. Keep the client in Composition API and `<script setup>` so
Vapor can be evaluated later for isolated, performance-sensitive surfaces.

Use TypeScript 6 as the stable compiler. Keep TypeScript 7 native preview optional through
`npm run typecheck:native`; it is not a required build step.

Use Oxlint and Oxfmt as the primary linting and formatting tools. Avoid ESLint/Prettier
until a concrete rule gap appears.

Use a build boundary for `packages/domain`. Node can run application `.ts` files directly,
but built-in type stripping refuses TypeScript files under `node_modules`. The shared
package therefore emits JavaScript and declarations to `dist`.

Prepare the backend for SQLite persistence, but keep the initial API in memory while the
domain model and screens are still forming.

## Consequences

- The development stack stays small and fast.
- The server can run `.ts` directly with Node's stable type stripping.
- Type checking remains explicit via `tsc`; Node does not type-check runtime TypeScript.
- Shared domain logic is isolated from framework code and can be tested independently.
- The app remains easy to deploy later: build the domain package, build the client, and
  run the Fastify server on Node 24 LTS.
- Vapor Mode can be tested later without forcing the whole client onto a beta runtime.
