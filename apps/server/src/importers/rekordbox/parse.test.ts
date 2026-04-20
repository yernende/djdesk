import assert from "node:assert/strict";
import test from "node:test";

import { parseRekordboxPlaylist } from "./parse.ts";

test("parses Rekordbox TSV range and normalizes keys", () => {
  const parsed = parseRekordboxPlaylist(
    [
      "#\tArtwork\tTrack Title\tArtist\tBPM\tKey\tComments",
      "1\t\tFlat Minor\tArtist A\t92.00\tDbm\t",
      "2\t\tCyrillic C\tArtist B\t86.00\tС\t",
      "3\t\tComment Key\tArtist C\t75.00\t\tBbm, no ne stroit",
      "4\t\tMissing Key\tArtist D\t80.00\t\t",
      "5\t\tModal Key\tArtist E\t120.00\tAm\tFm dorian",
      "6\t\tHarmonic Minor\tArtist F\t90.00\tEm\tHarm + Half-bar fermata in last verse",
      "7\t\tOutside Range\tArtist G\t120.00\tAm\t",
    ].join("\n"),
    {
      fromPosition: 1,
      toPosition: 6,
    },
  );

  assert.equal(parsed.rowCount, 6);
  assert.equal(parsed.records.length, 6);
  assert.equal(parsed.skipped.length, 0);
  assert.equal(parsed.records[0]?.key?.tonic, "C#");
  assert.equal(parsed.records[0]?.key?.mode, "natural-minor");
  assert.equal(parsed.records[0]?.rawKey, "Dbm");
  assert.equal(parsed.records[1]?.key?.tonic, "C");
  assert.equal(parsed.records[1]?.key?.mode, "major");
  assert.equal(parsed.records[1]?.rawKey, "C");
  assert.equal(parsed.records[2]?.key?.tonic, "A#");
  assert.equal(parsed.records[2]?.keySource, "comments");
  assert.equal(parsed.records[2]?.comments, "Bbm, no ne stroit");
  assert.equal(parsed.records[2]?.doesNotFit, true);
  assert.equal(parsed.records[2]?.harmonyNotes, null);
  assert.equal(parsed.records[3]?.key, null);
  assert.equal(parsed.records[3]?.keySource, "missing");
  assert.equal(parsed.records[4]?.key?.tonic, "F");
  assert.equal(parsed.records[4]?.key?.mode, "dorian");
  assert.equal(parsed.records[5]?.key?.variant, "raised-leading-tone");
  assert.equal(parsed.records[5]?.comment, "Half-bar fermata in last verse");
});
