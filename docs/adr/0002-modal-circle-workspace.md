# ADR 0002: Modal Circle Workspace

## Status

Accepted.

## Date

2026-04-20

## Context

The main DJ Desk surface is a production workspace for manually arranging tracks into a
set. The interface must help the operator reason about harmonic proximity quickly, while
still leaving room for manual judgement.

Most tracks can be placed by tonic and common mode, but Brazilian and adjacent repertoire
often contains modal color, variable scale degrees, mixture, or unusual modulations.
Those cases need to be visible without forcing a full music-theory analysis into the
main map.

The future dataset is expected to contain hundreds of tracks, so the first screen must
support dense browsing, quick focus changes, and a draft set chain.

## Decision

Use a twelve-section circle-of-fifths workspace as the primary visual model. The first
solmization labels are fixed to Do, Re, Mi, Fa, Sol, La, Si, with enharmonic spellings
shown together for sharp/flat pitch classes.

Track placement is derived from `TrackKey` and represented as `ModalPlacement`:

- `home`: major and natural minor tracks remain in the tonic section.
- `pure-modal`: pure Dorian, Lydian, Phrygian, and Mixolydian tracks are placed in the
  section representing their diatonic collection.
- `modal-mixture`: tracks with a variable degree are placed between the home tonic and
  the pure modal target section.

Use `variable-degree` as the data variant and `modal mixture` as the UI lane language.
This avoids calling tracks "dirty" while still capturing the practical mixing concern.

Add two independent free-text fields to tracks:

- `harmonyNotes`: special warnings or instructions about harmony, modulation, exotic
  modes, or other analysis details that require attention before mixing.
- `comment`: ordinary operator notes that do not need warning treatment.

When `harmonyNotes` is present, show a compact warning indicator on the track dot, in the
sector browser, and inside the draft set chain. Show the full text only in the focused
track panel.

Keep chord progressions as a simple list for now. The future raw dataset may contain a
large amount of chord data, so the detailed chord table will be designed after import
format and density are known.

## Consequences

- The map stays fast to scan even when tracks have nuanced modal behavior.
- A track can be visible near both its home tonic and its modal collection through the
  `modal-mixture` lane and nearby-section filtering.
- Special harmony warnings are not lost inside ordinary comments.
- The model remains small enough for the spike while leaving room for richer analysis
  data, chord tables, solmization preferences, and import workflows.
