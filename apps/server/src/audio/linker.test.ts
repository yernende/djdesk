import assert from "node:assert/strict";
import test from "node:test";

import {
  findBestAudioFileForTrack,
  normalizeAudioLookupText,
  type AudioFileCandidate,
  type AudioLinkTrack,
} from "./linker.ts";

test("normalizes filesystem lookup text for Rekordbox-like names", () => {
  assert.equal(normalizeAudioLookupText("_11PM_"), "11pm");
  assert.equal(
    normalizeAudioLookupText("Go Down Deh (feat_ Shaggy and Sean Paul)"),
    "go down deh feat shaggy and sean paul",
  );
  assert.equal(normalizeAudioLookupText("Adán y Eva"), "adan y eva");
});

test("matches exact titles before artist-prefixed copies in lower-priority roots", () => {
  const track = createTrack({
    title: "Tanto",
  });
  const match = findBestAudioFileForTrack(track, [
    createCandidate("/music/current/Tanto.flac", 0),
    createCandidate("/music/sources/Luis Fonsi - Tanto.flac", 1),
  ]);

  assert.equal(match?.audioPath, "/music/current/Tanto.flac");
});

test("matches artist-prefixed files when the title is too short for suffix matching", () => {
  const track = createTrack({
    artist: "Miami Beatz",
    title: "X",
  });
  const match = findBestAudioFileForTrack(track, [
    createCandidate("/music/current/Miami Beatz - X.flac", 0),
  ]);

  assert.equal(match?.audioPath, "/music/current/Miami Beatz - X.flac");
});

test("matches ChordAI audio file names independently from title punctuation", () => {
  const track = createTrack({
    audioFileName: "11PM",
    title: '"11PM"',
  });
  const match = findBestAudioFileForTrack(track, [
    createCandidate("/music/current/_11PM_.flac", 0),
  ]);

  assert.equal(match?.audioPath, "/music/current/_11PM_.flac");
});

test("matches safe join-word differences in descriptive titles", () => {
  const track = createTrack({
    artist: "Disturbed",
    title: "The Sound Of Silence (Paul Simon & Art Garfunkel cover)",
  });
  const match = findBestAudioFileForTrack(track, [
    createCandidate(
      "/music/current/The Sound Of Silence (Paul Simon _ Art Garfunkel cover).flac",
      0,
    ),
  ]);

  assert.equal(
    match?.audioPath,
    "/music/current/The Sound Of Silence (Paul Simon _ Art Garfunkel cover).flac",
  );
});

test("normalizes ChordAI file names even when an extension is present", () => {
  const track = createTrack({
    audioFileName: "Pony.flac",
    title: "Pony",
  });
  const match = findBestAudioFileForTrack(track, [createCandidate("/music/current/Pony.flac", 0)]);

  assert.equal(match?.audioPath, "/music/current/Pony.flac");
});

test("uses extension rank as a deterministic tie-breaker", () => {
  const track = createTrack({
    title: "Pony",
  });
  const match = findBestAudioFileForTrack(track, [
    createCandidate("/music/current/Pony.mp3", 0),
    createCandidate("/music/current/Pony.flac", 0),
  ]);

  assert.equal(match?.audioPath, "/music/current/Pony.flac");
});

function createTrack(input: Partial<AudioLinkTrack>): AudioLinkTrack {
  return {
    artist: null,
    audioFileName: null,
    id: "trk-fixture",
    title: "Fixture",
    ...input,
  };
}

function createCandidate(audioPath: string, rootIndex: number): AudioFileCandidate {
  const name =
    audioPath
      .split("/")
      .at(-1)
      ?.replace(/\.[^.]+$/, "") ?? audioPath;

  return {
    audioPath,
    extensionRank: audioPath.endsWith(".flac") ? 0 : 5,
    name,
    normalizedName: normalizeAudioLookupText(name),
    rootIndex,
  };
}
