# Public mode

Public mode uses the same Vue client, Fastify API, SQLite database and musical
algorithms as the local planner. Enable it with `APP_MODE=public` and an exact
`PUBLIC_ORIGIN`. The default local profile exposes operator tools and belongs in a
trusted environment. See [self-hosting](../deploy/README.md) for deployment examples.

## Catalogue publication

Tracks become public only through an explicitly selected publication manifest.
Card visibility and audio availability are separate switches: audio permission enables
both streaming and whole-file download. Unpublished direct audio and harmony URLs
return 404. Withdrawing a track should preserve its database record and stable ID so
existing set positions can display “Track unavailable”. Repeated IDs are not collapsed.

`npm run public --` provides `export`, `prepare`, `publish`, `owner-link`, `backup`
and `verify`. Preparation copies the source database, adopts unowned legacy sets into
a private workspace, copies selected audio with checksum verification and recomputes
quality through the canonical analyzer. Every publication switch defaults to disabled.
A failed preparation has no `READY` marker and must not be deployed. A prepared copy
is for initial installation; never replace a live database containing visitors' work.

## Workspaces and access

The first Add creates a workspace and its first set. Later sets belong to the same
workspace. Names, order and repeated tracks are saved online; there are no accounts,
uploads, suggestions or public set pages in this profile.

A workspace's secret link is shown once. Its random 32-byte secret is carried in the
URL fragment, exchanged for an HttpOnly, SameSite cookie and removed from the address
bar. SQLite stores secret and session hashes. Anyone holding the link can edit that
workspace; without the link or a valid browser session there is no recovery.

Sessions expire after 30 days. Replacing a link invalidates the old link and all old
sessions, then gives the current device a fresh session. Mutations require the configured
Origin and a session-bound CSRF token. Default limits are five workspace creations per
IP/day, 100 sets per workspace, 300 positions per set, 120-character names and 120 writes
per IP/minute. Limits are configurable through the public environment variables.

## Saving and conflicts

The client sends full snapshots sequentially with the last acknowledged revision.
A stale save receives HTTP 409. Failed work stays in the editor: the visitor can retry
a network failure, load the saved version or save their version as another set. Earlier
responses do not replace newer edits. Set names autosave after a typing pause and on blur.
Navigation warns about unsaved work, but drafts remain in memory and can be lost if
the browser is forcibly closed.

## Language and notation

The visitor flow supports English and Russian. A saved `djdesk.locale` preference
wins; otherwise Russian is selected when the browser language list contains `ru` or
a regional variant, with English as fallback. Unavailable localStorage still allows
an in-memory choice. Language is initialized before mounting and updates `html.lang`.
Changing language preserves drafts, set names and audio playback.

Letters, solfege, Camelot and Open Key are display preferences; nonstandard modes
retain explicit names and the harmonic model stays unchanged. API errors keep a
stable `code` and numeric limit parameters for client-side translation. Unknown
errors receive a safe localized fallback. In-app help and the
[Russian guide](user-guide.ru.md) share a source; `npm run guide:ru` exports the guide.

## Verification

The test suites cover workspace isolation, secret/session expiration and rotation,
CSRF, limits, revision conflicts, unavailable rows, standard key mappings,
source-preserving preparation and derived audio quality. CI runs checks and the
production build with FFprobe installed.

A deployment should also verify HTTPS, real client IP handling, audio range requests,
playback, seeking, downloads, conflict recovery and persistence across service restarts
and code updates. Publication images use a separate demonstration workspace and must
exclude access links and personal data. Operational evidence belongs with the operator's
private infrastructure records, outside the application repository.
