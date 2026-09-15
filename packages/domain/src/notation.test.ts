import assert from "node:assert/strict";
import test from "node:test";
import { formatKeyNotation, formatCircleNotation, KEY_NOTATIONS } from "./notation.ts";
import { canKeysTransition, describePlacement } from "./circle.ts";
import type { PitchClass, TrackKey } from "./types.ts";

test("all 24 major/minor keys use the standard Camelot and Open Key mapping", () => {
  const minor: PitchClass[] = ["A", "E", "B", "F#", "C#", "G#", "D#", "A#", "F", "C", "G", "D"];
  const major: PitchClass[] = ["C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#", "F"];
  for (let i = 0; i < 12; i++) {
    for (const isMinor of [true, false]) {
      const key: TrackKey = {
        tonic: (isMinor ? minor : major)[i]!,
        mode: isMinor ? "natural-minor" : "major",
        variant: "diatonic",
      };
      assert.equal(
        formatKeyNotation(key, "camelot"),
        `${((i + 7) % 12) + 1}${isMinor ? "A" : "B"}`,
      );
      assert.equal(formatKeyNotation(key, "open-key"), `${i + 1}${isMinor ? "m" : "d"}`);
      assert.equal(formatKeyNotation(key, "camelot", "ru"), formatKeyNotation(key, "camelot"));
      assert.equal(formatKeyNotation(key, "open-key", "ru"), formatKeyNotation(key, "open-key"));
    }
  }
});

test("Russian key labels retain exact modes, variants and enharmonic spellings", () => {
  const minor: TrackKey = { tonic: "A", mode: "natural-minor", variant: "diatonic" };
  assert.equal(formatKeyNotation(minor, "letters", "ru"), "A минор");
  assert.equal(formatKeyNotation(minor, "solfege", "ru"), "Ля натуральный минор");
  assert.equal(formatCircleNotation("D#", "solfege", "ru").primary, "Ми♭ m");
  assert.equal(formatCircleNotation("D#", "solfege", "ru").enharmonic, "Ре♯ m");
  const key: TrackKey = { tonic: "A", mode: "dorian", variant: "variable-degree" };
  for (const notation of KEY_NOTATIONS) {
    assert.match(formatKeyNotation(key, notation, "ru"), /дорийский, переменная ступень/);
    assert.equal(formatKeyNotation(null, notation, "ru"), "Тональность неизвестна");
  }
  assert.match(
    formatKeyNotation({ ...minor, variant: "raised-leading-tone" }, "camelot", "ru"),
    /повышенная вводная ступень/,
  );
  assert.equal(describePlacement(minor, "ru"), "Основная тональность");
});

test("notation preserves unknown keys, modal variants and musical behaviour", () => {
  const modal: TrackKey = { tonic: "A", mode: "dorian", variant: "variable-degree" };
  const next: TrackKey = { tonic: "E", mode: "phrygian", variant: "diatonic" };
  const original = structuredClone(modal);
  const compatible = canKeysTransition(modal, next);
  for (const notation of KEY_NOTATIONS) {
    assert.equal(formatKeyNotation(null, notation), "Unknown key");
    assert.match(formatKeyNotation(modal, notation), /Dorian/);
    assert.deepEqual(modal, original);
    assert.equal(canKeysTransition(modal, next), compatible);
  }
  assert.equal(
    formatKeyNotation({ tonic: "D#", mode: "major", variant: "diatonic" }, "camelot"),
    "5B",
  );
});
