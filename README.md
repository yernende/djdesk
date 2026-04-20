# DJ Desk

Local-first planning tool for Brazilian-music DJ sets.

## Stack

- Vue 3 + Vite 8 for the client.
- Fastify 5 on Node 24 LTS for the API.
- TypeScript 6 across the workspace.
- Oxlint and Oxfmt for fast checks.
- SQLite-ready backend boundary for local data.

## Development

```sh
nvm use
npm install
npm run dev
```

Client: <http://localhost:5173>

Server: <http://localhost:3000>

The client dev server binds to `0.0.0.0`, and the API does the same by default. From
another device on the same LAN, open `http://<host-machine-ip>:5173`.

## Database

SQLite data lives at `data/djdesk.sqlite` by default. The server applies migrations on
startup and seeds sample tracks when the database is empty.

```sh
npm run db:migrate
```

Use `DATABASE_PATH=/absolute/path/to/file.sqlite` to point the server or migration runner
at another database file. Use `SEED_SAMPLE_DATA=false` to start with an empty migrated
database.

## Checks

```sh
npm run check
```
