# ADR 0005: Default Key Display Solmization

## Status

Accepted.

## Date

2026-04-20

## Context

DJ Desk stores analyzed keys as normalized pitch classes so imports, transition
rules, and database queries stay compact and stable. That internal
representation should not dictate how the interface displays keys.

The working UI should use the operator's default solmization vocabulary instead
of raw letter names. Letter-key display may return later as an explicit display
preference, but it should not leak into the default interface.

## Decision

Keep `TrackKey.tonic` and database `tonic` values in normalized pitch-class form.

Use domain display formatters for user-facing key labels:

- C -> Do
- D -> Re
- E -> Mi
- F -> Fa
- G -> Sol
- A -> La
- B -> Si

For altered pitch classes, show Unicode accidentals:

- sharp: `♯`
- flat: `♭`

When an imported key is stored in the sharp-normalized internal form but has a
common enharmonic flat display, show both solmization labels in the UI. The
canonical spelling is shown first and the alternate spelling second.

Circle section labels keep the minor-section suffix, for example `La m` and
`Fa♯ m / Sol♭ m`. Section labels use the natural-minor circle convention:
`Do♯ m` remains primary for C-sharp minor, while `Mi♭ m` and `Si♭ m` are primary
for the D-sharp/E-flat and A-sharp/B-flat sections.

Full track key labels combine the solmization tonic with the mode label, for
example `Re Dorian`. For full key labels, choose the canonical tonic spelling by
the key's mode spelling cost: prefer the spelling that avoids excessive
accidentals in the full seven-note mode. For example:

- C-sharp natural minor -> `Do♯ / Re♭ Natural minor`
- C-sharp major -> `Re♭ / Do♯ Major`
- A-sharp natural minor -> `Si♭ / La♯ Natural minor`

## Consequences

- The UI no longer exposes raw `A`, `B`, `C`, `D`, or `E` key names by default.
- Enharmonic pairs no longer always put the sharp spelling first.
- Importers and transition logic do not need storage changes.
- A future notation switcher can be implemented as another formatter without
  changing the database schema.
