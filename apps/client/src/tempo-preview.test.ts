import assert from "node:assert/strict";
import test from "node:test";

import { getTempoPreviewRate, isTempoPreviewRateActive } from "./tempo-preview.ts";

test("keeps original tempo when preview is disabled", () => {
  assert.equal(
    getTempoPreviewRate({
      enabled: false,
      sourceBpm: 70,
      targetBpm: 80,
    }),
    1,
  );
});

test("speeds tracks below the target BPM up to the target", () => {
  assert.equal(
    getTempoPreviewRate({
      enabled: true,
      sourceBpm: 70,
      targetBpm: 80,
    }),
    80 / 70,
  );
});

test("slows tracks above the target BPM down to the target", () => {
  assert.equal(
    getTempoPreviewRate({
      enabled: true,
      sourceBpm: 82,
      targetBpm: 80,
    }),
    80 / 82,
  );
});

test("keeps unknown BPM at original speed", () => {
  assert.equal(
    getTempoPreviewRate({
      enabled: true,
      sourceBpm: null,
      targetBpm: 80,
    }),
    1,
  );
});

test("marks only meaningful speed changes as active", () => {
  assert.equal(isTempoPreviewRateActive(1), false);
  assert.equal(isTempoPreviewRateActive(1.004), false);
  assert.equal(isTempoPreviewRateActive(0.996), false);
  assert.equal(isTempoPreviewRateActive(1.01), true);
  assert.equal(isTempoPreviewRateActive(0.99), true);
});
