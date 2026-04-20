import assert from "node:assert/strict";
import test from "node:test";

import {
  areKeysTransitionCompatible,
  bucketTracksByTonic,
  canKeysTransition,
  CIRCLE_OF_FIFTHS,
  describeKey,
  getCircleIndex,
  getModalPlacement,
  getPitchClassLabel,
  getTransitionProfile,
  PITCH_CLASS_LABELS,
  sampleTracks,
} from "./index.ts";

test("circle of fifths starts from A minor and moves by fifths", () => {
  assert.deepEqual(CIRCLE_OF_FIFTHS.slice(0, 4), ["A", "E", "B", "F#"]);
  assert.equal(getCircleIndex("D"), 11);
});

test("tracks are bucketed by display section", () => {
  const buckets = bucketTracksByTonic(sampleTracks);
  const aBucket = buckets[getCircleIndex("A")];

  assert.ok(aBucket);
  assert.equal(
    aBucket.tracks.some((track) => track.id === "trk-berimbau"),
    true,
  );
});

test("key descriptions include modal variants only when needed", () => {
  assert.equal(describeKey(sampleTracks[1].key), "Re Dorian");
  assert.equal(describeKey(sampleTracks[3].key), "Sol Natural minor, Raised leading tone");
});

test("pitch labels use default solmization with unicode accidentals", () => {
  assert.equal(getPitchClassLabel("C#"), "Do♯ / Re♭");
  assert.equal(getPitchClassLabel("A"), "La");
  assert.equal(PITCH_CLASS_LABELS["F#"].primary, "Fa♯ m");
  assert.equal(PITCH_CLASS_LABELS["F#"].enharmonic, "Sol♭ m");
});

test("major keys share sections with their relative minors", () => {
  assert.equal(
    getModalPlacement({
      tonic: "C",
      mode: "major",
      variant: "diatonic",
    }).displayIndex,
    0,
  );

  assert.equal(
    getModalPlacement({
      tonic: "A",
      mode: "natural-minor",
      variant: "diatonic",
    }).displayIndex,
    0,
  );
});

test("pure modal tracks display in their collection sections near the shared boundary", () => {
  assert.equal(
    getModalPlacement({
      tonic: "A",
      mode: "dorian",
      variant: "diatonic",
    }).displayIndex.toFixed(2),
    "0.63",
  );

  assert.equal(
    getModalPlacement({
      tonic: "A",
      mode: "phrygian",
      variant: "diatonic",
    }).displayIndex.toFixed(2),
    "11.37",
  );

  assert.equal(
    getModalPlacement({
      tonic: "E",
      mode: "phrygian",
      variant: "diatonic",
    }).displayIndex.toFixed(2),
    "0.37",
  );
});

test("raised-leading-tone keys stay in their home section", () => {
  assert.deepEqual(getModalPlacement(sampleTracks[3].key), {
    homeIndex: 10,
    targetIndex: 10,
    displayIndex: 10,
    lane: "home",
    summary: "Home key with raised leading tone",
  });
});

test("modal mixture tracks share boundaries between neighboring sections", () => {
  assert.equal(
    getModalPlacement({
      tonic: "A",
      mode: "dorian",
      variant: "variable-degree",
    }).displayIndex,
    0.5,
  );

  assert.equal(
    getModalPlacement({
      tonic: "E",
      mode: "phrygian",
      variant: "variable-degree",
    }).displayIndex,
    0.5,
  );
});

test("transition profiles encode modal vectors and boundaries", () => {
  assert.deepEqual(
    getTransitionProfile({
      tonic: "A",
      mode: "dorian",
      variant: "diatonic",
    }),
    {
      direction: "clockwise",
      homeSection: 0,
      kind: "pure-modal",
      mode: "dorian",
      targetSection: 1,
    },
  );

  assert.deepEqual(
    getTransitionProfile({
      tonic: "C#",
      mode: "phrygian",
      variant: "variable-degree",
    }),
    {
      boundarySections: [4, 3],
      direction: "counter",
      homeSection: 4,
      kind: "modal-mixture",
      mode: "phrygian",
      targetSection: 3,
    },
  );
});

test("home transitions allow only home-neighbor shortcuts", () => {
  assert.equal(
    canKeysTransition(
      { tonic: "A", mode: "natural-minor", variant: "diatonic" },
      { tonic: "E", mode: "natural-minor", variant: "diatonic" },
    ),
    true,
  );

  assert.equal(
    canKeysTransition(
      { tonic: "A", mode: "natural-minor", variant: "diatonic" },
      { tonic: "E", mode: "dorian", variant: "diatonic" },
    ),
    false,
  );

  assert.equal(
    canKeysTransition(
      { tonic: "A", mode: "natural-minor", variant: "diatonic" },
      { tonic: "E", mode: "dorian", variant: "variable-degree" },
    ),
    false,
  );

  assert.equal(
    canKeysTransition(
      { tonic: "A", mode: "natural-minor", variant: "diatonic" },
      { tonic: "E", mode: "phrygian", variant: "diatonic" },
    ),
    true,
  );
});

test("pure modal transitions follow modal vectors", () => {
  assert.equal(
    canKeysTransition(
      { tonic: "D", mode: "natural-minor", variant: "diatonic" },
      { tonic: "A", mode: "natural-minor", variant: "diatonic" },
    ),
    true,
  );

  assert.equal(
    canKeysTransition(
      { tonic: "D", mode: "natural-minor", variant: "diatonic" },
      { tonic: "A", mode: "dorian", variant: "diatonic" },
    ),
    false,
  );

  assert.equal(
    canKeysTransition(
      { tonic: "D", mode: "dorian", variant: "diatonic" },
      { tonic: "A", mode: "dorian", variant: "diatonic" },
    ),
    true,
  );

  assert.equal(
    canKeysTransition(
      { tonic: "A", mode: "dorian", variant: "diatonic" },
      { tonic: "D", mode: "dorian", variant: "diatonic" },
    ),
    true,
  );

  assert.equal(
    canKeysTransition(
      { tonic: "A", mode: "dorian", variant: "diatonic" },
      { tonic: "E", mode: "natural-minor", variant: "diatonic" },
    ),
    true,
  );
});

test("modal mixture transitions use their own boundary pairs", () => {
  assert.equal(
    canKeysTransition(
      { tonic: "F#", mode: "natural-minor", variant: "diatonic" },
      { tonic: "C#", mode: "phrygian", variant: "variable-degree" },
    ),
    true,
  );

  assert.equal(
    canKeysTransition(
      { tonic: "D", mode: "natural-minor", variant: "diatonic" },
      { tonic: "A", mode: "dorian", variant: "variable-degree" },
    ),
    false,
  );

  assert.equal(
    areKeysTransitionCompatible(
      { tonic: "A", mode: "dorian", variant: "variable-degree" },
      { tonic: "E", mode: "phrygian", variant: "variable-degree" },
    ),
    true,
  );

  assert.equal(
    canKeysTransition(
      { tonic: "A", mode: "dorian", variant: "variable-degree" },
      { tonic: "E", mode: "dorian", variant: "variable-degree" },
    ),
    false,
  );

  assert.equal(
    canKeysTransition(
      { tonic: "A", mode: "dorian", variant: "variable-degree" },
      { tonic: "A", mode: "dorian", variant: "diatonic" },
    ),
    true,
  );

  assert.equal(
    canKeysTransition(
      { tonic: "A", mode: "dorian", variant: "variable-degree" },
      { tonic: "E", mode: "dorian", variant: "diatonic" },
    ),
    false,
  );
});
