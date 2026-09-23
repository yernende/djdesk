# ADR 0010: Global Search and Explicit Set Navigation

## Status

Accepted. Supersedes the catalogue filtering and ordering decisions in ADR 0002
and ADR 0006, and the client demo-data flag in ADR 0008. The musical transition
rules and permissive set editing remain.

## Date

2026-09-23

## Context

Selecting a candidate used to narrow browsing to its position on the circle.
A subsequent search could therefore hide the desired track in another key.
Automatically opened sets also made a returning visitor's starting context unclear.
The planner needs free catalogue search while preserving sequential exploration
around the circle and deliberate selection of compatible next tracks.

## Decision

Keep track focus and playback, sector priority, and compatibility filtering as
independent state. Search is global by default; selecting or listening to a track
does not change ordering or impose a harmonic restriction.

- Any subsection click prioritizes its whole large sector. A boundary prioritizes
  the union of its two sectors without duplicates. Other tracks remain available.
  The unknown-key shelf similarly prioritizes unplaced tracks without hiding others.
- Without text, order each priority group by the existing BPM sort. With text,
  use relevance, then sector priority, then BPM. Exact titles outside the preferred
  sector remain findable. A visible removable label identifies the priority.
- Circle clicks preserve playback. BPM navigation stays within the preferred
  group; text searches start at the top. An empty preferred group leaves the other
  results visible. Clearing text does not clear priority or compatibility.
- Only compatible starts off. When enabled, appending checks the last set track;
  replacing checks each available neighbor in playback order. Candidate focus
  does not change the reference. Set edits and position changes do.
- Use the existing harmonic rules without implicit BPM or set-membership limits.
  Unknown keys do not pass a required transition check. With no reference track,
  including replacement of an only track, compatibility is unavailable and any
  enabled filter switches off. Empty results offer a way to turn it off while
  retaining the query. Risk warnings never prohibit adding a track.

Start the plain home page with an empty editor and no selected track, regardless
of an existing access cookie. Create set and Open set are explicit actions; the
saved-set list opens on request, including when opening a workspace access link.
Remove built-in demo-set generation and the `VITE_ENABLE_DEMO_DATA` client flag.
Optional server sample metadata remains controlled by `SEED_SAMPLE_DATA`.
Startup does not delete visitor-created sets.

Creating or opening a set writes `?set=<id>`; refresh restores that selection only
with valid access. Closing or deleting clears it without opening another set.
Track titles and the copy action use `/?track=<id>`; copied track URLs contain no
workspace path, selected set or secret. Direct track navigation and browser history
restore selection without autoplay. Unavailable IDs show an error without choosing
a substitute. Set URLs identify a set but grant no access to it.

Keep autosave, serialized revision checks and conflict recovery. Switching or
closing the editor preserves failed snapshots in the current tab; reopening the
affected set exposes recovery actions. Warn before leaving with unsaved work.
These drafts are not durable across a forced page close. Existing APIs and database
tables suffice; isolate search ordering and URL operations into testable client
modules. Update both interface languages and the shared in-app/exported guide.

## Consequences and Verification

Global search and circle exploration share one catalogue without hidden harmonic
restrictions. A visitor can deliberately narrow it to compatible candidates, and
direct track links can be shared independently of private workspace access.

Verify cross-key search after listening; whole sectors, modal subsections and
boundary unions; unknown keys, missing BPM and empty priority groups; appending
and replacing first, middle, last and only positions; losing a compatibility
reference; fresh home with an existing cookie; explicit set refresh and closing;
track links with and without a session; unavailable IDs; browser history; and
failed-save recovery after switching sets. Run the project checks and production
build, then verify desktop and mobile behavior in a browser. Keep operational
verification details and private access information outside the repository.
