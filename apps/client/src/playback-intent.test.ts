import assert from "node:assert/strict";
import test from "node:test";

import { getNextPlaybackIntentForAudioEvent } from "./playback-intent.ts";

test("keeps playback intent armed when a stale audio element pauses after focus moved", () => {
  assert.equal(
    getNextPlaybackIntentForAudioEvent({
      activeTrackId: "track-without-audio",
      currentIntent: true,
      eventTrackId: "track-with-audio",
      eventType: "pause",
    }),
    true,
  );
});

test("disarms playback intent when the active audio element pauses", () => {
  assert.equal(
    getNextPlaybackIntentForAudioEvent({
      activeTrackId: "track-with-audio",
      currentIntent: true,
      eventTrackId: "track-with-audio",
      eventType: "pause",
    }),
    false,
  );
});

test("arms playback intent when the active audio element starts playing", () => {
  assert.equal(
    getNextPlaybackIntentForAudioEvent({
      activeTrackId: "track-with-audio",
      currentIntent: false,
      eventTrackId: "track-with-audio",
      eventType: "play",
    }),
    true,
  );
});
