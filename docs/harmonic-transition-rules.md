# Harmonic Transition Rules

DJ Desk treats every analyzed key as a transition profile. The profile is used
for the draft-set `Add` warning and for compatibility coloring on the circle.

## Profiles

### Home

Regular major, natural minor, and raised-leading-tone minor tracks are `home`
tracks. A major track is placed in the section of its relative minor.

```text
C major -> La m section
A natural minor -> La m section
G natural minor with raised leading tone -> Sol m section
```

### Pure Modal

Pure modal tracks keep their modal home tonic in the profile, but the UI places
them in the section of the natural-minor pitch collection they use.

```text
A Dorian pure:    home La m, displayed in Mi m collection
E Phrygian pure:  home Mi m, displayed in La m collection
C# Phrygian pure: home Do# m, displayed in Fa# m collection
```

Dorian and Lydian point clockwise from their home tonic to the collection
section. Phrygian and Mixolydian point counter-clockwise. On the wheel this
means the pure modal side zones around a boundary read as:

```text
La natural minor
E pure Phrygian
La Dorian mixture + E Phrygian mixture
La pure Dorian
Mi natural minor
```

### Modal Mixture

Modal-mixture tracks live on the boundary between their home section and modal
target section. Neighboring modal-mixture tracks from both sides of the same
boundary share one boundary zone.

```text
A Dorian modal mixture:    La m / Mi m boundary
E Phrygian modal mixture:  Mi m / La m boundary
C# Phrygian modal mixture: Do# m / Fa# m boundary
```

## Directed Add Rules

The draft-set `Add` warning is directional: it checks whether the selected track
can follow the last draft track.

- `home -> home` is valid when the sections are the same or adjacent.
- `home -> pure modal` is valid when the home section is the pure modal track's
  target collection section.
- `pure modal -> home` is valid when the next home section is the pure modal
  track's target collection section.
- `pure modal -> pure modal` is valid when both tracks use the same modal mode
  and their home sections are the same or adjacent.
- `home -> modal mixture` is valid when the home section belongs to that
  modal-mixture boundary.
- `modal mixture -> home` is valid when the home section belongs to that
  modal-mixture boundary.
- `modal mixture -> modal mixture` is valid only when both tracks use the same
  boundary.
- `modal mixture -> pure modal` is valid only into the same tonic and same mode.

No other cross-lane transition is considered valid in the current spike.

## Reference Cases

```text
D natural minor -> A natural minor        valid
D natural minor -> A Dorian pure          warning
D Dorian pure -> A Dorian pure            valid

A natural minor -> E natural minor        valid
A natural minor -> E Dorian pure          warning
A natural minor -> E Phrygian pure        valid
A natural minor -> E Dorian mixture       warning

A natural minor -> A Dorian mixture       valid
A natural minor -> E Phrygian mixture     valid
A Dorian mixture -> E natural minor       valid
A Dorian mixture -> A natural minor       valid
A Dorian mixture -> A Dorian pure         valid
A Dorian mixture -> E Dorian pure         warning
A Dorian mixture -> E Phrygian mixture    valid

F# natural minor -> C# Phrygian mixture   valid
D natural minor -> A Dorian mixture       warning
```

## Draft Reference Coloring

Circle coloring uses the last track in the draft set as the reference track,
because the map should answer the planning question "what can I pick next?".
Selecting a row or a circle zone changes the focus panel and browser content, but
does not change the compatibility colors.

A zone is compatible with the last draft track when at least one track in that
zone can either follow the draft track or precede it. This symmetric rule keeps
the map useful when browsing around the current draft endpoint.
