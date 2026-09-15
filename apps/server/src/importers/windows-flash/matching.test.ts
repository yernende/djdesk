import assert from "node:assert/strict";
import test from "node:test";

import {
  findExistingDuplicate,
  parseFlashFileName,
  rankStreamingMatches,
  shouldReuseExistingForAnalysis,
} from "./matching.ts";

test("parseFlashFileName strips junk but keeps version tokens", () => {
  const parsed = parseFlashFileName(
    "/E:/Любимые/001 Anitta - Veneno - Recorded At Spotify Studios NYC (mp3layk.ru).mp3",
  );

  assert.equal(parsed.artistHints[0], "Anitta");
  assert.equal(parsed.titleHint, "Veneno - Recorded At Spotify Studios NYC");
  assert.match(parsed.query, /Anitta/);
  assert.doesNotMatch(parsed.query, /mp3layk/i);
});

test("rankStreamingMatches keeps remix variants distinct", () => {
  const parsed = parseFlashFileName(
    "/E:/Любимые/Archie,Paulo Mac,P Lowe - Wish (Remix_ feat. Paulo Mac & P Lowe).mp3",
  );
  const matches = rankStreamingMatches(parsed, [
    {
      artists: ["Archie", "Paulo Mac", "P Lowe"],
      durationMs: 210_000,
      id: "spotify-0",
      lossless: null,
      matchPercent: null,
      raw: {
        id: "spotify-track-remix",
        isrc: "AAA111",
      },
      source: "spotify",
      title: "Wish (Remix)",
      url: "https://open.spotify.com/track/remix",
    },
    {
      artists: ["Archie", "Paulo Mac", "P Lowe"],
      durationMs: 209_000,
      id: "spotify-1",
      lossless: null,
      matchPercent: null,
      raw: {
        id: "spotify-track-plain",
        isrc: "AAA222",
      },
      source: "spotify",
      title: "Wish",
      url: "https://open.spotify.com/track/plain",
    },
  ]);

  assert.equal(matches[0]?.title, "Wish (Remix)");
  assert.ok((matches[0]?.score.confidence ?? 0) > (matches[1]?.score.confidence ?? 0));
});

test("findExistingDuplicate matches exact canonical track and source identity", () => {
  const parsed = parseFlashFileName("/E:/Любимые/Anitta - Veneno.mp3");
  const [match] = rankStreamingMatches(parsed, [
    {
      artists: ["Anitta"],
      durationMs: 185_000,
      id: "spotify-0",
      lossless: null,
      matchPercent: null,
      raw: {
        id: "spotify-track-veneno",
        isrc: "BR-AAA-123",
      },
      source: "spotify",
      title: "Veneno",
      url: "https://open.spotify.com/track/veneno",
    },
  ]);

  assert.ok(match);
  assert.deepEqual(
    findExistingDuplicate(
      [
        {
          artist: "Anitta",
          id: "trk-existing",
          sourceIdentity: "isrc:BR-AAA-123",
          sourceKind: "spotify",
          title: "Veneno",
        },
      ],
      match!,
    ),
    {
      artist: "Anitta",
      id: "trk-existing",
      sourceIdentity: "isrc:BR-AAA-123",
      sourceKind: "spotify",
      title: "Veneno",
    },
  );
});

test("shouldReuseExistingForAnalysis only resumes exact-source incomplete tracks", () => {
  const parsed = parseFlashFileName("/E:/Любимые/Anitta - Veneno.mp3");
  const [match] = rankStreamingMatches(parsed, [
    {
      artists: ["Anitta"],
      durationMs: 185_000,
      id: "spotify-0",
      lossless: null,
      matchPercent: null,
      raw: {
        id: "spotify-track-veneno",
        isrc: "BR-AAA-123",
      },
      source: "spotify",
      title: "Veneno",
      url: "https://open.spotify.com/track/veneno",
    },
  ]);

  assert.ok(match);
  assert.equal(
    shouldReuseExistingForAnalysis(
      {
        artist: "Anitta",
        bpm: null,
        hasChords: false,
        id: "trk-existing",
        keyUnknown: 1,
        sourceIdentity: "isrc:BR-AAA-123",
        sourceKind: "spotify",
        title: "Veneno",
      },
      match!,
    ),
    true,
  );
  assert.equal(
    shouldReuseExistingForAnalysis(
      {
        artist: "Anitta",
        bpm: 128,
        hasChords: true,
        id: "trk-existing",
        keyUnknown: 0,
        sourceIdentity: "isrc:BR-AAA-123",
        sourceKind: "spotify",
        title: "Veneno",
      },
      match!,
    ),
    false,
  );
});
