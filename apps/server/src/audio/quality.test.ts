import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { analyzeAudioQuality, classifyAudioQuality } from "./quality.ts";

test("classifies 44.1 kHz 16-bit audio as strict HQ", () => {
  assert.deepEqual(
    classifyAudioQuality({
      bitDepth: 16,
      bitrateKbps: 844,
      codec: "flac",
      sampleRateHz: 44_100,
    }),
    {
      isHighBitrateLossy: false,
      status: "hq",
    },
  );
});

test("classifies 48 kHz 24-bit audio as strict HQ", () => {
  assert.deepEqual(
    classifyAudioQuality({
      bitDepth: 24,
      bitrateKbps: 2304,
      codec: "pcm_s24le",
      sampleRateHz: 48_000,
    }),
    {
      isHighBitrateLossy: false,
      status: "hq",
    },
  );
});

test("marks 320 kbps MP3 as high-bitrate lossy, not HQ", () => {
  assert.deepEqual(
    classifyAudioQuality({
      bitDepth: null,
      bitrateKbps: 320,
      codec: "mp3",
      sampleRateHz: 44_100,
    }),
    {
      isHighBitrateLossy: true,
      status: "lossy",
    },
  );
});

test("marks 128 kbps MP3 as regular lossy", () => {
  assert.deepEqual(
    classifyAudioQuality({
      bitDepth: null,
      bitrateKbps: 128,
      codec: "mp3",
      sampleRateHz: 44_100,
    }),
    {
      isHighBitrateLossy: false,
      status: "lossy",
    },
  );
});

test("marks low sample-rate 16-bit audio as lossy", () => {
  assert.deepEqual(
    classifyAudioQuality({
      bitDepth: 16,
      bitrateKbps: 705,
      codec: "flac",
      sampleRateHz: 22_050,
    }),
    {
      isHighBitrateLossy: false,
      status: "lossy",
    },
  );
});

test("returns unknown quality with probe error for missing files", async () => {
  const quality = await analyzeAudioQuality(join(tmpdir(), "djdesk-missing-audio.flac"), {
    now: new Date("2026-04-26T00:00:00.000Z"),
  });

  assert.equal(quality.status, "unknown");
  assert.equal(quality.analyzedAt, "2026-04-26T00:00:00.000Z");
  assert.equal(quality.probeError, "Audio file was not found");
});
