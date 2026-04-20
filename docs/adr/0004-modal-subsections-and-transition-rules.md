# ADR 0004: Modal Subsections and Transition Rules

## Status

Accepted.

## Date

2026-04-20

## Context

The imported catalog is dense enough that dots on the modal circle are not a
usable primary control. DJ Desk needs larger tap targets and a clearer model for
pure modal tracks and modal-mixture tracks around each circle boundary.

The operator also needs the `Add` warning and wheel coloring to follow a small,
explicit transition graph instead of a broad "nearby key" heuristic.

## Decision

Keep the twelve natural-minor circle sections as the main frame.

Within each section, divide the annular area into:

- a central home subsection for natural minor, major via relative minor, and
  raised-leading-tone home tracks.
- two side pure-modal subsections near the neighboring boundaries.
- a boundary subsection between each pair of circle sections for modal-mixture
  tracks.

Pure modal tracks are displayed in the section of the natural-minor collection
they use, not in the section of their tonic. For example:

```text
La natural minor
Mi pure Phrygian
La Dorian mixture + Mi Phrygian mixture
La pure Dorian
Mi natural minor
```

Use these directed transition rules for the draft-set `Add` warning:

- home can move to the same or neighboring home section.
- pure modal can move to pure modal with the same mode and same or neighboring
  home tonic.
- home can move to pure modal when the home section is the pure modal track's
  target collection section or a neighboring section.
- pure modal can move to home when the home section is the pure modal track's
  target collection section or a neighboring section.
- home can move to modal mixture when the home section belongs to that
  modal-mixture boundary.
- modal mixture can move to home when the home section belongs to that
  modal-mixture boundary.
- modal mixture can move to modal mixture only on the same boundary.
- modal mixture can move to pure modal only for the same home tonic and same
  mode.

The wheel compatibility coloring stays symmetric for browsing: a zone is shown
as compatible with the last draft track when at least one track in the zone can
move in either direction with that draft endpoint.

## Consequences

- Pure modes are easier to understand visually because they sit beside the
  natural-minor collection they actually use.
- Modal-mixture tracks from neighboring tonics naturally share one boundary
  target.
- The add button remains directional, while the wheel stays useful for browsing
  both possible directions around the current draft endpoint.
- The rules are intentionally conservative and can be revised after listening
  tests without changing the storage model.
