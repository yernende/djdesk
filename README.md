# DJ Desk

Planning tool for Brazilian-music DJ sets, with a private local mode and a public demo mode.

## Public demo

The public mode offers a curated read-only catalogue and private sets saved through a secret
workspace link. It has no user accounts, uploads, suggestions, or public set pages.
Each visitor's sets are isolated; the same secret link opens all their sets on another device.

The public interface supports Russian and English. A saved RU / EN choice takes priority;
otherwise Russian is selected when any browser language preference is Russian, and English
is the fallback. Language and key notation are independent. In-app help uses the same
content as the [Russian user guide](docs/user-guide.ru.md), regenerated with `npm run guide:ru`.

See [example-server deployment instructions](deploy/README.md) for publication selection, safe
data preparation, Node/nginx/systemd deployment and code rollback. Pushes to `main` in the private
[GitHub repository](https://github.com/yernende/djdesk) run checks and automatically
deploy the built release through GitHub Actions. Public mode
requires `APP_MODE=public` and `PUBLIC_ORIGIN`. Existing catalogue entries remain private
until explicitly selected, and existing personal sets are adopted through the operator CLI.

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
startup. Sample tracks are seeded into an empty database only with `SEED_SAMPLE_DATA=true`.

```sh
npm run db:migrate
```

Use `DATABASE_PATH=/absolute/path/to/file.sqlite` to point the server or migration runner
at another database file. Use `SEED_SAMPLE_DATA=false` to start with an empty migrated
database.

## Audio Quality

Audio quality is derived from linked files with FFprobe and cached in SQLite. Do not
hand-author `audio_quality_*` columns from importers or scripts; use the contract in
`docs/specs/audio-quality.md`.

```sh
npm run audio:quality -- --dry-run --limit 10 --force
npm run audio:quality -- --force
```

## Import ChordAI reports

```sh
npm run import:chordai -- --reports "$HOME/Documents/ChordAI Pipeline Kit/reports" --remove-samples
```

The importer applies migrations, reads complete ChordAI report folders, upserts tracks,
marks imported BPM/key/chords as estimated, and stores full chord segment and bar-grid
data for later detailed views.

## Checks

```sh
npm run check
```
