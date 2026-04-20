# ADR 0003: SQLite Persistence and Migrations

## Status

Accepted.

## Date

2026-04-20

## Context

DJ Desk starts as a local-first application, but it should not keep its core data only in
memory. Track analysis, harmony notes, comments, chord lists, tags, and draft set order
need a durable structure before raw import work begins.

The app is still a spike, so the persistence layer should stay small and easy to replace
if deployment requirements later push the project toward Postgres or another database.

## Decision

Use SQLite as the first durable store. Store the default database at `data/djdesk.sqlite`
and allow overrides through `DATABASE_PATH`.

Use plain SQL migration files under `apps/server/migrations`. The Fastify server applies
pending migrations on startup, and `npm run db:migrate` runs the same migration path
manually.

Keep migrations structural only. Seed data comes from the existing TypeScript sample
tracks and is inserted only when the database is empty. This keeps production data and
local bootstrap data separate.

Create normalized tables for:

- tracks and their key, BPM, confidence, harmony note, and comment metadata.
- ordered chord symbols per track.
- tags per track.
- draft sets and ordered draft set tracks.

## Consequences

- Local development has a durable database without adding an external service.
- The API can move from in-memory sample data to real persistence without changing the
  client contract.
- Raw imports can target normalized tables instead of pushing large JSON blobs through
  the app.
- Future migration to another SQL database remains possible because schema changes are
  explicit and repository access is isolated on the server.
