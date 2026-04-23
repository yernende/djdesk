# Product Ideas

This is a lightweight backlog of future ideas mentioned during the DJ Desk
spike. Items here are not architecture decisions yet; they are prompts for
product review.

## Focused Sector View

Add a second circle-display mode for detailed planning on small screens and
dense key areas.

Instead of showing the whole circle, the view would show the active sector, its
two neighboring sectors, and the boundaries between them. This should make the
areas that matter for the next transition much larger and easier to tap,
especially on phones.

Open questions:

- Whether this mode should open on tap, via a segmented control, or both.
- Whether boundary modal-mixture zones should appear as full columns between
  sectors in this focused view.
- Whether the active set endpoint should automatically move the focused view to
  the last added track's section.

## Notation And Solmization Modes

Add a display setting for key notation. The default should remain solfege
(`Do`, `Re`, `Mi`, `Fa`, `Sol`, `La`, `Si`) with canonical enharmonic spelling,
but the app should eventually support other naming systems.

Ideas mentioned:

- Solfege display as the main DJ workflow.
- Letter-name display for source/debug parity with Rekordbox and ChordAI.
- Canonical enharmonic spelling first, alternative enharmonic spelling second.
- A future notation switcher near the map or in settings.

Open questions:

- Whether the app should support Camelot/Open Key notation.
- Whether notation preference is global, per browser session, or per user.

## Manual Review Workflow

Imported analysis starts as unverified. The app needs a first-class workflow for
reviewing and confirming musical metadata independently.

Baseline implemented in ADR 0008: BPM/key editing and independent BPM/key
confidence are available from the focus panel.

Ideas mentioned:

- Confirm key separately from BPM.
- Confirm chord analysis separately from key and BPM.
- Edit the normalized key, raw key, mode, modal variant, meter, and BPM.
- Preserve manual confirmations across repeated imports.
- Show a review queue for unverified tracks.
- Keep raw imported values visible when a manual override exists.

Open questions:

- Whether review actions need an audit log.

## Harmony Notes Triage

The free-form harmony instructions should become more structured over time.
They are useful for edge cases such as modulation, exotic modes, ambiguous
analysis, and tracks that should not be placed on the harmonic map.

Ideas mentioned:

- Parse known phrases into structured flags where possible.
- Keep the original note text for context.
- Track a `non-building` flag for tracks that should stay in the database but
  stay hidden from normal map planning.
- Convert clear notes such as Dorian, Phrygian, harmonic minor, or modal mixture
  into the proper musical fields.
- Surface unresolved notes in a dedicated review queue.

Open questions:

- Which terms should be parsed automatically and which should require manual
  review.
- Whether a track can be non-building only for harmonic planning but still
  usable in a set for a deliberate break.

## Rich Chord Views

The current UI can show compact chord information, but the full ChordAI data can
support richer analysis views later.

Ideas mentioned:

- Show a compact list of unique chords used in the track.
- Keep the adjacent-deduped chord sequence for quick reading.
- Hide the full chord segment table behind a disclosure, drawer, or detail view.
- Add a bar-grid view for phrase-level inspection.
- Link chord segments to audio playback position.
- Add chord search/filtering inside a track.

Open questions:

- Whether the detailed view should be a panel, modal, or separate route.
- Whether chord names need normalization beyond preserving the ChordAI source
  value.

## Audio Player Upgrades

The local audio player is enough for previewing tracks, but DJ planning would
benefit from more transport and inspection tools.

Baseline implemented in ADR 0008: manual tracks can upload optional audio into
the configured local upload directory.

Baseline implemented in ADR 0009: existing and newly created tracks can launch a
single-track retrieval flow through the sibling `dj` downloader, with Yandex,
SpotiFLAC, and Lucida fallback. Retrieval job history is intentionally not
persisted yet.

Ideas mentioned:

- Waveform or overview seek bar.
- Larger touch-friendly scrubber on mobile.
- Keyboard shortcuts for play, pause, seek, and add.
- Cue points and markers.
- A/B preview between the last set track and the selected candidate.
- Optional transition preview with simple crossfade.
- Keep paths as a local source of truth for now, but design for a hosted-server
  file strategy later.
- Persist audio retrieval jobs across page reloads/server restarts.
- Support playlist retrieval as a separate bulk flow.
- Manually link a Lucida-downloaded file after the browser fallback.
- Consider a guarded UI for switching the configured audio folder later.

Open questions:

- Whether waveform data should be generated at import time or on demand.
- How hosted deployments should reference audio files without copying the
  user's local library.

## Track Library Navigation

Several hundred tracks make the map alone insufficient. The library needs
stronger browsing and filtering tools.

Ideas mentioned:

- Global search by title.
- Filters for BPM range, key, mode, modal variant, source, unverified fields,
  has audio, has harmony note, and non-building status.
- Dedicated view for unknown-key tracks.
- Better duplicate and "already used in a set" visibility.
- Bulk operations for review and cleanup.

Open questions:

- Whether source filtering belongs in the primary UI or only in admin/review
  tools.
- Whether unknown-key tracks should be sortable by BPM compatibility when a set
  endpoint exists.

## Set Management

Multiple sets now exist conceptually, but the long-term model should treat them
as real user-owned planning objects.

Baseline implemented in ADR 0008: sets are persisted in SQLite and can be
created, renamed, deleted, reordered, and sorted harmonically.

Ideas mentioned:

- Duplicate and archive sets.
- Support repeated tracks when the user intentionally wants them.
- Warn when a track appears in any set, while still allowing the action.
- Show non-harmonic links as relationship markers between adjacent tracks.
- Preserve deliberate non-harmonic breaks.
- Add locked tracks so automated sorting does not move anchors.
- Export set plans to a playlist-like format.

Open questions:

- Whether harmonic sort should optimize the entire set or only unlocked spans.
- Whether set ownership should be added before or after authentication.

## Harmonic Transition Model Refinement

The current transition rules are a useful spike, but the rules should remain
easy to revise as real listening tests reveal better heuristics.

Ideas mentioned:

- Keep neighbor-section rules for natural keys.
- Revisit whether pure modal collection-equivalence rules need a looser or
  stricter listening-tested exception list.
- Treat modal-mixture tracks as boundary tracks between two sections.
- Allow mixture-to-mixture only inside the same boundary.
- Make compatibility explainable in the UI.
- Support user overrides for transitions that are intentionally acceptable or
  intentionally bad.
- Track "certain" versus "experimental" rules outside the code path before
  promoting them into behavior.

Open questions:

- How to represent more exotic modes and modulations.
- Whether compatibility should be directional everywhere or symmetric for map
  coloring only.

## BPM Compatibility Refinement

BPM compatibility should stay score-based rather than a hard pass/fail cutoff.
Half-time and double-time matching should stay disabled unless the DJ workflow
changes.

Ideas mentioned:

- Tune the BPM score curve after listening tests.
- Sort candidate tracks by combined harmonic and BPM fit.
- Show an explanation for the BPM score.
- Add user-adjustable BPM tolerance.
- Consider pitch/tempo adjustment notes without treating half/double time as a
  match.

Open questions:

- Whether BPM score should affect sort order only, visual intensity only, or
  both.
- Whether key and BPM compatibility should be combined into one candidate score
  or shown separately.

## Import And Source Reconciliation

The importers should become more transparent and easier to operate as the track
library grows.

Ideas mentioned:

- Keep repeated ChordAI imports idempotent.
- Import partial Rekordbox data when chord data is unavailable.
- Match ChordAI, Rekordbox, and local audio files into one canonical track.
- Report unmatched audio files and unmatched imported tracks.
- Add a dry-run mode for importers.
- Add import-run summaries that can be reviewed in the UI.
- Consider watching a reports folder for new analyses later.

Open questions:

- Whether duplicate resolution should be automatic or require a merge UI.
- Whether importers should support multiple local music roots per user.

## Deployment And Users

The app is local-first now, but the architecture should keep hosted deployment
and future users in mind.

Ideas mentioned:

- Add authentication later.
- Associate sets and preferences with users.
- Keep the current single-user local workflow frictionless.
- Decide how hosted deployments access or store audio.
- Add backup/export for the SQLite database.

Open questions:

- Whether hosted mode should upload audio, mount a shared library, or only store
  metadata.
- Whether local and hosted modes should share one deployment shape or become
  separate profiles.

## Mobile Interaction Polish

The app-like mobile layout is a good baseline, but touch interaction still needs
real-device tuning.

Ideas mentioned:

- Avoid nested scrolling wherever possible.
- Keep bottom navigation as the main mobile mode switcher.
- Make map zones and boundary zones easier to hit.
- Consider bottom sheets for focused track details or the player.
- Test on phone and 13-inch laptop breakpoints after major UI changes.

Open questions:

- Whether mobile should default to the focused sector view instead of the full
  circle.
- Whether the set panel should remain a tab or become a persistent bottom
  drawer.

## Product Language And Naming

The terminology should be kept consistent before the UI grows much larger.

Ideas mentioned:

- Decide whether the product is `DJ Desk`, `DJ Dashboard`, or another name.
- Prefer `natural tracks` over `home tracks` in user-facing text.
- Make boundary, pure modal, modal mixture, unverified, confirmed, non-440, and
  non-building labels consistent.
- Keep developer terms in docs when useful, but avoid leaking confusing terms
  into the primary UI.

Open questions:

- Whether `modal mixture` is the best user-facing label for the boundary case.
- Whether `non-building` should be shown as-is or translated into a clearer DJ
  planning term.
