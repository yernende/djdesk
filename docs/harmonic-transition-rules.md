# Harmonic Transition Rules

DJ Desk treats every analyzed key as a transition profile. The profile is used
for set transition warnings, compatibility coloring on the circle, and the
optional `Only compatible` filter. `canKeysTransition` in the domain package is
the source of truth; the browsing changes do not alter these musical rules.

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

## Transition Rules

A `home` track uses its section as its effective collection. A `pure modal`
track uses its target collection section, independently of its home tonic and
mode. A modal-mixture track uses its pair of boundary sections instead of a
single collection.

- Between any two `home` or `pure modal` tracks, the effective collections must
  be the same or adjacent on the circle, including across the wraparound.
- Between a `home` or `pure modal` track and a `modal mixture`, the effective
  collection must be one of that mixture's boundary sections.
- Between two `modal mixture` tracks, both must use the same boundary pair.
- A track with an unknown key cannot form a confirmed compatible transition.

These rules currently give symmetric results, but callers still check each
transition in playback order. Adding checks `last track -> candidate`.
Replacing a position checks both `previous track -> candidate` and
`candidate -> next track`; a missing neighbor creates no constraint. Replacing
the only track in a set therefore has no reference for compatibility filtering.

## Reference Cases

```text
D natural minor -> A natural minor        valid
D natural minor -> A Dorian pure          warning
D Dorian pure -> A Dorian pure            valid

A natural minor -> E natural minor        valid
A natural minor -> A Dorian pure          valid
A natural minor -> A Phrygian pure        valid
A natural minor -> E Dorian pure          warning
A natural minor -> E Phrygian pure        valid
A natural minor -> E Dorian mixture       warning
A Dorian pure -> B natural minor          valid
B natural minor -> A Dorian pure          valid
A Dorian pure -> E Phrygian pure          valid
A Dorian pure -> D Mixolydian pure        valid
A Dorian pure -> A Phrygian pure          warning

A natural minor -> A Dorian mixture       valid
A natural minor -> E Phrygian mixture     valid
A Dorian mixture -> E natural minor       valid
A Dorian mixture -> A natural minor       valid
A Dorian mixture -> A Dorian pure         valid
A Dorian mixture -> E Phrygian pure       valid
A Dorian mixture -> E Dorian pure         warning
A Dorian mixture -> E Phrygian mixture    valid

F# natural minor -> C# Phrygian mixture   valid
D natural minor -> A Dorian mixture       warning
```

## Set Context and Browsing

Circle coloring and `Only compatible` use the current set position: the final
track when appending, or both available neighbors when replacing. A zone is
colored compatible when at least one of its tracks passes all applicable
transition checks. Empty zones and positions without either neighbor have no
compatibility color. Selecting or listening to a candidate does not change the
set context; changing the set order or selected position does.

The catalogue is global by default. Clicking any subsection prioritizes its
whole large sector; clicking a boundary prioritizes the union of both adjacent
sectors without duplicate tracks. This changes ordering only and does not hide
other sectors. Text relevance precedes sector priority, then tracks are sorted
by BPM within each group. Clearing the query, clearing sector priority, and
turning off compatibility are separate actions.

`Only compatible` is initially off and must be enabled explicitly. It filters
by the transition rules above, without adding BPM or set-membership limits.
It is unavailable without either reference neighbor and turns off if the
reference disappears. Unknown-key candidates remain visible in global search
but do not pass compatibility filtering when a reference exists. Transition
warnings remain advisory: users can still add or replace with a risky track.
