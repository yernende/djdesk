import assert from "node:assert/strict";
import test from "node:test";

import { parseCsv } from "./csv.ts";
import { parseChordAiKey } from "./keys.ts";
import { compactChordProgression, parseChordSegments } from "./parse.ts";

test("normalizes ChordAI flat and minor keys for the circle UI", () => {
  assert.deepEqual(parseChordAiKey("Ab"), {
    mode: "major",
    rawKey: "Ab",
    tonic: "G#",
  });
  assert.deepEqual(parseChordAiKey("Ebm"), {
    mode: "natural-minor",
    rawKey: "Ebm",
    tonic: "D#",
  });
  assert.deepEqual(parseChordAiKey("F#m"), {
    mode: "natural-minor",
    rawKey: "F#m",
    tonic: "F#",
  });
  assert.deepEqual(parseChordAiKey("Am"), {
    mode: "natural-minor",
    rawKey: "Am",
    tonic: "A",
  });
});

test("parses CSV rows and preserves midi notes", () => {
  const rows = parseCsv(
    'index,start_s,end_s,duration_s,chord,bass,label,basic_label,degree,midi_notes\n1,0,1.5,1.5,"F,add9",A,Fadd9/A,Fadd9,,60 64 67\n',
  );

  assert.equal(rows[0]?.chord, "F,add9");
  assert.equal(rows[0]?.midi_notes, "60 64 67");
});

test("creates adjacent-deduped compact chord progression", () => {
  const segments = parseChordSegments(
    [
      "index,start_s,end_s,duration_s,chord,bass,label,basic_label,degree,midi_notes",
      "1,0,1,1,Am,A,Am,Am,,60 64 69",
      "2,1,2,1,Am,A,Am,Am,,60 64 69",
      "3,2,3,1,F,F,F,F,,65 69 72",
      "4,3,4,1,N,N,N,N,,",
      "5,4,5,1,F,F,F,F,,65 69 72",
    ].join("\n"),
  );

  assert.deepEqual(compactChordProgression(segments), ["Am", "F"]);
});
