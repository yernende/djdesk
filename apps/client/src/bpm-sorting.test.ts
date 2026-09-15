import assert from "node:assert/strict";
import test from "node:test";

import { compareBpmDescending, findClosestBpmTrack, type BpmSortableTrack } from "./bpm-sorting.ts";

function sortedTitles(tracks: BpmSortableTrack[]): string[] {
  return [...tracks].sort(compareBpmDescending).map((track) => track.title);
}

test("sorts known BPM from high to low before unknown BPM", () => {
  assert.deepEqual(
    sortedTitles([
      { bpm: null, title: "unknown bpm" },
      { bpm: 80, title: "80 bpm" },
      { bpm: 120, title: "120 bpm" },
      { bpm: 95, title: "95 bpm" },
    ]),
    ["120 bpm", "95 bpm", "80 bpm", "unknown bpm"],
  );
});

test("sorts equal BPM by title", () => {
  assert.deepEqual(
    sortedTitles([
      { bpm: 80, title: "Zulu" },
      { bpm: 80, title: "Alpha" },
      { bpm: 80, title: "Mango" },
    ]),
    ["Alpha", "Mango", "Zulu"],
  );
});

test("finds the closest known BPM to the target", () => {
  assert.equal(
    findClosestBpmTrack(82, [
      { bpm: null, title: "unknown bpm" },
      { bpm: 90, title: "90 bpm" },
      { bpm: 80, title: "80 bpm" },
    ])?.title,
    "80 bpm",
  );
});

test("prefers the higher BPM when closest target distance is tied", () => {
  assert.equal(
    findClosestBpmTrack(85, [
      { bpm: 80, title: "80 bpm" },
      { bpm: 90, title: "90 bpm" },
    ])?.title,
    "90 bpm",
  );
});

test("returns null when no visible tracks have BPM", () => {
  assert.equal(findClosestBpmTrack(80, [{ bpm: null, title: "unknown bpm" }]), null);
});
