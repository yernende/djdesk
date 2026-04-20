import assert from "node:assert/strict";
import test from "node:test";

import {
  bucketTracksByTonic,
  CIRCLE_OF_FIFTHS,
  describeKey,
  getCircleIndex,
  getModalPlacement,
  sampleTracks,
} from "./index.ts";

test("circle of fifths starts from C and moves by fifths", () => {
  assert.deepEqual(CIRCLE_OF_FIFTHS.slice(0, 4), ["C", "G", "D", "A"]);
  assert.equal(getCircleIndex("F"), 11);
});

test("tracks are bucketed by tonic", () => {
  const buckets = bucketTracksByTonic(sampleTracks);
  const dBucket = buckets[getCircleIndex("D")];

  assert.ok(dBucket);
  assert.equal(dBucket.tracks[0]?.id, "trk-berimbau");
});

test("key descriptions include modal variants only when needed", () => {
  assert.equal(describeKey(sampleTracks[1].key), "D Dorian");
  assert.equal(describeKey(sampleTracks[3].key), "G Natural minor, Raised leading tone");
});

test("pure modal tracks stay in home sections with directional offsets", () => {
  assert.equal(
    getModalPlacement({
      tonic: "A",
      mode: "dorian",
      variant: "diatonic",
    }).displayIndex.toFixed(2),
    "3.18",
  );

  assert.equal(
    getModalPlacement({
      tonic: "A",
      mode: "phrygian",
      variant: "diatonic",
    }).displayIndex.toFixed(2),
    "2.82",
  );
});

test("modal mixture tracks share boundaries between neighboring sections", () => {
  assert.equal(
    getModalPlacement({
      tonic: "A",
      mode: "dorian",
      variant: "variable-degree",
    }).displayIndex,
    3.5,
  );

  assert.equal(
    getModalPlacement({
      tonic: "E",
      mode: "phrygian",
      variant: "variable-degree",
    }).displayIndex,
    3.5,
  );
});
