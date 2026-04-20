# ADR 0006: Dense Set-Planning Interactions

## Status

Accepted.

## Date

2026-04-20

## Context

After importing real catalog data, the modal circle is no longer a small demo
map. Each section can contain many tracks, some tracks have unknown keys, and a
draft set can become harmonically invalid after removing or moving one item.

The operator needs the interface to make these states visible without blocking
manual judgement. DJ Desk should warn about risky transitions, but it should not
prevent intentional non-harmonic choices.

The first implementation remains local and client-side. Draft set editing is
mocked in the Vue state until persisted multi-set editing is implemented.

## Decision

Keep track browsing centered on sections, subsections, and boundaries, but make
the selected map area explicit:

- selected parent sections, natural subsections, pure-modal subsections, and
  boundary subsections receive a visible selected contour.
- the center readout describes the selected map area, not the currently focused
  track.
- boundary readouts use compact primary section labels so long enharmonic
  strings do not overflow the center of the circle.

Treat unknown-key tracks as a separate shelf outside the circle:

- the unknown-key control is placed at the bottom-right of the wheel panel.
- unknown-key tracks remain hidden from harmonic sections until a key is known.
- selecting the shelf opens only unplaced tracks in the browser.

Use user-facing music language in the browser:

- show `natural tracks` instead of the internal `home tracks` label.
- show `natural`, `pure modal`, `modal mixture`, and `unknown key` as lane
  labels on track cards.

Keep the `Add` action permissive but stable:

- a red `Add` button means the selected track is already present in any draft
  set, the transition is non-harmonic, or both.
- the visible reason is shown next to the button.
- the action area reserves a fixed layout slot so the button does not jump when
  the reason appears or disappears.
- repeated tracks are allowed because a DJ set may intentionally reuse a track.

Expose draft set editing directly in the chain:

- tracks can be removed from any position.
- tracks can be moved with up/down controls.
- tracks can also be reordered with native drag-and-drop.
- after any edit, every adjacent transition is re-evaluated.
- risky adjacent pairs are shown as red `Non-harmonic transition` dividers
  between the two tracks, because non-harmonicity is a relationship between
  neighboring set positions rather than an attribute of either track alone.

Add a `Sort harmonically` control for the active draft set:

- the sorter is a deterministic client-side helper, not a persisted planner.
- it tries each track as a possible start and greedily chooses the next best
  track by the current transition rules.
- compatible transitions score highest; BPM distance and circle distance are
  only tie-breakers.
- if no fully compatible sequence exists, the best available order is applied
  and remaining risky joins stay visibly marked.

Add BPM compatibility to the track browser:

- browser tracks are sorted against the last track in the active draft set.
- the primary browser sort is a soft BPM compatibility score, followed by
  harmonic compatibility as a tie-breaker.
- the BPM score compares the real BPM values directly; half-time and
  double-time equivalence are intentionally not considered because this
  workflow does not mix that way.
- the score is displayed as a number and clipped progress meter on each track
  card.
- the progress meter uses one fixed red-yellow-green scale and clips the
  unfilled right side, so short bars do not rescale the full gradient.

Keep verification confidence close to the values it qualifies:

- track cards do not show large standalone `Key unverified` or
  `BPM unverified` badges.
- key and BPM confidence labels are rendered inline next to the corresponding
  key or BPM value.
- the focus panel uses the same inline confidence pattern.

Keep the future focused-view idea documented but out of scope for this change:
a later map mode may show only the active sector and neighboring sectors instead
of the full circle, improving tap targets on small screens.

## Consequences

- Dense sections are easier to operate because the selected browsing target is
  visible independently from the last draft track.
- Unknown-key tracks are no longer presented as if they belonged to the harmonic
  map.
- The operator can intentionally create, inspect, and repair non-harmonic joins.
- Non-harmonic warnings are easier to interpret because they are attached to
  transitions, not track cards.
- BPM proximity becomes visible during next-track browsing without imposing a
  hard compatibility cutoff.
- Track cards are less visually noisy while still preserving unverified key and
  BPM information.
- The draft set chain becomes editable without introducing a persistence layer
  change yet.
- Harmonic sorting is useful as a fast repair tool but remains explainable and
  non-authoritative.
- Future work should persist draft set changes, add undo/redo, and consider a
  focused sector view for mobile and laptop layouts.
