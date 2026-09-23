import assert from "node:assert/strict";
import test from "node:test";

import type { Track, TrackKey } from "@djdesk/domain";

import {
  getPriorityBpmTarget,
  getTrackSearchScore,
  getTrackSections,
  matchesBrowserPriority,
  normalizeSearchText,
  rankBrowserTracks,
  type BrowserPriority,
} from "./browser-search.ts";

type SearchTrack = Pick<Track, "id" | "title" | "artist" | "bpm" | "key" | "tags"> & {
  keyLabel?: string;
};

const aMinor: TrackKey = {
  tonic: "A",
  mode: "natural-minor",
  variant: "diatonic",
};
const bMinor: TrackKey = {
  tonic: "B",
  mode: "natural-minor",
  variant: "diatonic",
};
const aPriority: BrowserPriority = { kind: "sections", sections: [0] };

function track(id: string, overrides: Partial<SearchTrack> = {}): SearchTrack {
  return { id, title: id, bpm: 80, key: aMinor, tags: [], ...overrides };
}

function rank(tracks: readonly SearchTrack[], query = "", priority: BrowserPriority = null) {
  return rankBrowserTracks(tracks, { query, priority, keyLabel: () => "" });
}

test("search remains global when a different sector is prioritized", () => {
  const tracks = [track("first"), track("elsewhere", { key: bMinor })];

  assert.deepEqual(
    rank(tracks, "elsewhere", aPriority).map(({ id }) => id),
    ["elsewhere"],
  );
  assert.deepEqual(
    rank(tracks, "first", aPriority).map(({ id }) => id),
    ["first"],
  );
  assert.deepEqual(
    rank(tracks, "elsewhere", aPriority).map(({ id }) => id),
    ["elsewhere"],
  );
});

test("exact and stronger text matches outrank sector priority and BPM", () => {
  const tracks = [
    track("preferred", { title: "Sol remix", bpm: 130 }),
    track("exact", { title: "Sol", key: bMinor, bpm: 60 }),
    track("artist", { title: "Other", artist: "Sol", bpm: 160 }),
  ];

  assert.deepEqual(
    rank(tracks, "sol", aPriority).map(({ id }) => id),
    ["exact", "preferred", "artist"],
  );
});

test("priority breaks equal relevance before descending BPM without hiding other tracks", () => {
  const tracks = [
    track("outside-fast", { title: "Song fast", key: bMinor, bpm: 140 }),
    track("inside-slow", { title: "Song slow", bpm: 70 }),
    track("inside-fast", { title: "Song fast", bpm: 100 }),
    track("outside-unknown", { title: "Song unknown", key: null, bpm: null }),
  ];

  assert.deepEqual(
    rank(tracks, "song", aPriority).map(({ id }) => id),
    ["inside-fast", "inside-slow", "outside-fast", "outside-unknown"],
  );
  assert.deepEqual(
    rank(tracks, "", aPriority).map(({ id }) => id),
    ["inside-fast", "inside-slow", "outside-fast", "outside-unknown"],
  );
});

test("global browsing retains BPM order and gives stable title, artist and id ties", () => {
  const tracks = [
    track("z", { title: "Equal", artist: "Alpha", bpm: 80 }),
    track("unknown", { bpm: null }),
    track("artist", { title: "Equal", artist: "Zulu", bpm: 80 }),
    track("a", { title: "Equal", artist: "Alpha", bpm: 80 }),
    track("title", { title: "Before", bpm: 80 }),
    track("fast", { bpm: 120 }),
  ];
  const expected = ["fast", "title", "a", "z", "artist", "unknown"];

  assert.deepEqual(
    rank(tracks).map(({ id }) => id),
    expected,
  );
  assert.deepEqual(
    rank([...tracks].reverse()).map(({ id }) => id),
    expected,
  );
  assert.equal(tracks[0]?.id, "z");
});

test("search normalizes accents and case and includes artist, tags and both key labels", () => {
  const candidate = track("song", {
    title: "Coração",
    artist: "Ёлка",
    tags: ["Brazilian Zouk"],
    keyLabel: "A minor",
  });

  assert.equal(normalizeSearchText("  ЁЛКА Coração  "), "елка coracao");
  assert.equal(getTrackSearchScore(candidate, "CORACAO", "Ля минор"), 1000);
  assert.equal(getTrackSearchScore(candidate, "елка", "Ля минор"), 700);
  assert.equal(getTrackSearchScore(candidate, "zouk", "Ля минор"), 500);
  assert.equal(getTrackSearchScore(candidate, "ля минор", "Ля минор"), 400);
  assert.equal(getTrackSearchScore(candidate, "a minor", "Ля минор"), 400);
  assert.equal(getTrackSearchScore(candidate, "coracao елка", "Ля минор"), 300);
  assert.equal(getTrackSearchScore(candidate, "nonexistent", "Ля минор"), 0);
  assert.equal(getTrackSearchScore(candidate, "   ", "Ля минор"), 0);
});

test("large sectors use effective collections for major and pure modal keys", () => {
  const major = track("major", {
    key: { tonic: "C", mode: "major", variant: "diatonic" },
  });
  const dorian = track("dorian", {
    key: { tonic: "A", mode: "dorian", variant: "diatonic" },
  });
  const phrygian = track("phrygian", {
    key: { tonic: "E", mode: "phrygian", variant: "diatonic" },
  });

  assert.deepEqual(getTrackSections(major), [0]);
  assert.deepEqual(getTrackSections(dorian), [1]);
  assert.deepEqual(getTrackSections(phrygian), [0]);
  assert.equal(matchesBrowserPriority(dorian, aPriority), false);
  assert.equal(matchesBrowserPriority(phrygian, aPriority), true);
});

test("a mixture touches both boundary sectors and appears only once in a combined priority", () => {
  const mixture = track("mixture", {
    key: { tonic: "A", mode: "dorian", variant: "variable-degree" },
  });
  const outside = track("outside", { key: bMinor, bpm: 160 });
  const boundaryPriority: BrowserPriority = {
    kind: "sections",
    sections: [0, 1],
  };

  assert.deepEqual(getTrackSections(mixture), [0, 1]);
  assert.equal(matchesBrowserPriority(mixture, aPriority), true);
  assert.equal(matchesBrowserPriority(mixture, { kind: "sections", sections: [1] }), true);
  assert.deepEqual(
    rank([outside, mixture], "", boundaryPriority).map(({ id }) => id),
    ["mixture", "outside"],
  );

  const wrappedMixture = track("wrapped", {
    key: { tonic: "A", mode: "phrygian", variant: "variable-degree" },
  });
  assert.deepEqual(getTrackSections(wrappedMixture), [0, 11]);
  assert.equal(
    matchesBrowserPriority(wrappedMixture, {
      kind: "sections",
      sections: [11],
    }),
    true,
  );
});

test("unknown-key priority moves unknown tracks first without dropping known tracks", () => {
  const unknown = track("unknown", { key: null });
  const known = track("known", { bpm: 160 });

  assert.deepEqual(getTrackSections(unknown), []);
  assert.equal(matchesBrowserPriority(unknown, aPriority), false);
  assert.equal(matchesBrowserPriority(unknown, null), true);
  assert.deepEqual(
    rank([known, unknown], "", { kind: "unknown" }).map(({ id }) => id),
    ["unknown", "known"],
  );
});

test("BPM jump stays in the priority even when another sector has the exact target", () => {
  const tracks = [
    track("outside", { key: bMinor, bpm: 80 }),
    track("inside-low", { bpm: 75 }),
    track("inside-high", { bpm: 85 }),
  ];

  assert.equal(getPriorityBpmTarget(80, tracks, aPriority)?.id, "inside-high");
  assert.equal(getPriorityBpmTarget(80, tracks, null)?.id, "outside");
});

test("BPM jump has no global fallback for an empty priority and selects the first unknown BPM", () => {
  const outside = track("outside", { key: bMinor });
  const first = track("first", { bpm: null });
  const second = track("second", { bpm: null });

  assert.equal(getPriorityBpmTarget(80, [outside], aPriority), null);
  assert.equal(getPriorityBpmTarget(80, [outside], { kind: "sections", sections: [] }), null);
  assert.equal(getPriorityBpmTarget(80, [outside], { kind: "unknown" }), null);
  assert.equal(getPriorityBpmTarget(80, [outside, first, second], aPriority)?.id, "first");
  assert.equal(getPriorityBpmTarget(80, [first, second], null)?.id, "first");
  assert.equal(getPriorityBpmTarget(80, [], null), null);
});
