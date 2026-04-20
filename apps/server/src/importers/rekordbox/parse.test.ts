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
      "5\t\tOutside Range\tArtist E\t120.00\tAm\t",
    ].join("\n"),
    {
      fromPosition: 1,
      toPosition: 4,
    },
  );

  assert.equal(parsed.rowCount, 4);
  assert.equal(parsed.records.length, 3);
  assert.equal(parsed.skipped.length, 1);
  assert.equal(parsed.records[0]?.key.tonic, "C#");
  assert.equal(parsed.records[0]?.key.mode, "natural-minor");
  assert.equal(parsed.records[0]?.rawKey, "Dbm");
  assert.equal(parsed.records[1]?.key.tonic, "C");
  assert.equal(parsed.records[1]?.key.mode, "major");
  assert.equal(parsed.records[1]?.rawKey, "C");
  assert.equal(parsed.records[2]?.key.tonic, "A#");
  assert.equal(parsed.records[2]?.keySource, "comments");
  assert.equal(parsed.records[2]?.comments, "Bbm, no ne stroit");
  assert.equal(parsed.skipped[0]?.playlistPosition, 4);
  assert.equal(parsed.skipped[0]?.reason, "Missing key");
});
