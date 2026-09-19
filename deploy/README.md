# Self-hosting DJ Desk

This guide describes a conventional Linux deployment: nginx terminates HTTPS on
port443, serves the built client and forwards the API to `127.0.0.1:3100`. It uses
systemd and persistent SQLite/audio directories outside each code release.
Adapt the hostname, certificate paths and Node executable to your server.

## Prerequisites and runtime layout

- Node.js 24.15.0 and npm 11.12.1 or newer on the build machine and server.
- A working FFprobe on the server and wherever public audio is prepared.
- nginx, systemd, a domain and a valid TLS certificate for that domain.
- A dedicated unprivileged `djdesk` service account.

| Path in the examples                 | Purpose                                                      |
| ------------------------------------ | ------------------------------------------------------------ |
| `/srv/djdesk/releases/<release>`     | Application source, production dependencies and built assets |
| `/srv/djdesk/current`                | Symlink to the active code release                           |
| `/var/lib/djdesk/data/djdesk.sqlite` | Persistent SQLite database                                   |
| `/var/lib/djdesk/audio`              | Persistent audio files                                       |
| `/etc/djdesk.env`                    | Runtime settings, root-readable mode0600                     |

Node runs the server TypeScript directly. Deploy the server source, migrations and
built `packages/domain/dist` alongside `apps/client/dist`; a client-only upload is
insufficient. Install production dependencies on the target Linux platform.

The examples are [systemd](djdesk.service), [environment](djdesk.env.example) and
[nginx](nginx.conf). Set the actual Node 24 executable in `ExecStart` and adjust service
resource limits to your host. Create the writable data and readable audio directories
before starting the service. Runtime data should belong to `djdesk`, with directories
mode0700 and files mode0600; application code should not be writable by that account.

## Prepare an initial public catalogue

Run from the repository root with your local catalogue already populated:

```sh
npm ci
npm run check
npm run build
mkdir -p artifacts
npm run public -- export --database data/djdesk.sqlite --output artifacts/publication.json
```

Edit the exported manifest. `publish: true` exposes a card; `audio: true` enables both
streaming and download. Select only audio you are authorized to distribute.

```sh
npm run public -- prepare --database data/djdesk.sqlite \
  --manifest artifacts/publication.json --output artifacts/public-release \
  --origin https://djdesk.example.com --audio-root /var/lib/djdesk/audio
```

The output directory must be new. Preparation makes a consistent copy, keeps IDs,
relocates audio under hashed filenames, verifies checksums and recomputes audio quality.
Only output with a `READY` marker is installable. Verify copied audio against the generated
`audio-manifest.json`. Keep any `owner-access-link.txt` private and outside all webroots,
release archives and Git.

Copy this prepared database and audio **only for the first installation**. Subsequent
releases must use the existing persistent database: replacing it would discard visitors'
saved sets, sessions and access. Keep the source catalogue separate from the live database.

## Build and start a release

```sh
python3 deploy/release.py --output artifacts/release
```

The release builder runs checks and builds assets. It produces a tarball plus a manifest
with the source commit, dirty-tree flag, release ID and SHA-256. Transfer the archive to
your server, verify its hash and extract it into a new `/srv/djdesk/releases/<release>`
directory. Install dependencies there with `npm ci --omit=dev --ignore-scripts` as a
non-root deployment account, then point `/srv/djdesk/current` at that directory.

Install the reviewed systemd unit and runtime environment, set `APP_MODE=public` and
`PUBLIC_ORIGIN=https://djdesk.example.com`, and keep the API bound to loopback. Install
the reviewed nginx configuration with your TLS certificate paths. Never serve the
repository root, runtime `.env`, database or audio directory as static files.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now djdesk
sudo nginx -t
sudo systemctl reload nginx
curl --fail http://127.0.0.1:3100/health
curl --fail https://djdesk.example.com/health
curl --fail https://djdesk.example.com/release.json
```

The nginx example overwrites forwarded IP headers with the actual peer IP. Fastify trusts
loopback proxies only. If you introduce another proxy or load balancer, configure that
trust boundary explicitly so visitors cannot forge their rate-limit identity.

## Optional GitHub Actions deployment

Checks and release builds run on pull requests and `main`. Automatic deployment is
opt-in and requires a compatible restricted SSH receiver already installed on your host.
This repository's client scripts do not install or provision that receiver. The receiver
must accept `deploy RELEASE SHA256`, read the archive from stdin, validate its checksum
and contents, install it without root, activate the release and restore the previous code
if health or release-identity checks fail. Server administration is a separate concern.

Configure the repository variable `DEPLOY_ENABLED=true` only after installing and
validating your receiver. Create a `production` environment with a deployment branch
policy allowing only `main`, and configure:

| Kind                 | Name                   | Value                                                     |
| -------------------- | ---------------------- | --------------------------------------------------------- |
| Environment secret   | `DEPLOY_SSH_TARGET`    | Dedicated `user@hostname` for deployment                  |
| Environment secret   | `DEPLOY_SSH_KEY`       | Dedicated restricted SSH private key                      |
| Environment secret   | `DEPLOY_KNOWN_HOSTS`   | Host key verified through trusted server access           |
| Environment variable | `DEPLOY_PUBLIC_ORIGIN` | Public HTTPS origin, such as `https://djdesk.example.com` |

The workflow pins the host key and verifies `/release.json` after deployment. Keep
`StrictHostKeyChecking` enabled. External pull requests only run checks/builds and must
never receive the production environment or its secrets. Manual workflow dispatch can
retry the latest `main`; superseded commits are skipped. Official actions are pinned to
commit SHAs and workflow permissions are `contents: read`.

`activate-release.sh` is an operator fallback for hosts with that receiver installed;
it is not a general installer. A fork can use the manual deployment above or provide its
own deployment system without enabling this integration.

## Updates, maintenance and recovery

Install each update in a new release directory; never copy a prepared database over live
data. Record the previous code target, switch `current` atomically, restart `djdesk`, and
check `/health` plus `/release.json`. On failure, switch to the previous known-compatible
release and restart. Application startup applies migrations; code rollback does not
reverse them, so schema changes must preserve compatibility.

Use the administrative CLI against the persistent database for catalogue changes.
`public publish --database PATH --manifest PATH` updates the selection atomically.
Preserve withdrawn track records and IDs so saved sets retain unavailable positions.
When audio paths change, clear and recompute quality using the
[canonical quality contract](../docs/specs/audio-quality.md).

Define your own backup and restore policy for the persistent database and audio. The
`public backup --database PATH --output PATH` command creates a consistent SQLite copy;
it does not copy audio or schedule backups. Code releases and CI artifacts do not back
up visitor data. Store backups privately and test restoration in an isolated location.

Before exposing the service, verify workspace isolation, secret-link exchange and
rotation, CSRF/Origin checks, conflict recovery, real-IP limits and persistence through
restart and release activation. Check desktop and narrow-screen layouts, playback,
seeking and downloads for each audio format you offer. Keep request bodies, cookies,
access links and raw operational evidence out of public logs and screenshots.
