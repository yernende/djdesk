import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

import { normalizeConfusableKeyText, parseImportedKey } from "../shared/keys.ts";
import { analyzeRekordboxComment } from "./notes.ts";
import type { RekordboxPlaylistEntry, RekordboxSkippedEntry } from "./types.ts";

interface RawRekordboxRow {
  artist: string;
  bpm: string;
  comments: string;
  key: string;
  playlistPosition: string;
  title: string;
}

export interface RekordboxParseOptions {
  fromPosition: number;
  toPosition: number;
}

export interface RekordboxParseResult {
  records: RekordboxPlaylistEntry[];
  rowCount: number;
  skipped: RekordboxSkippedEntry[];
}

const expectedHeaders = ["#", "Artwork", "Track Title", "Artist", "BPM", "Key", "Comments"];
const keyTokenPattern = /(?:^|[^A-Za-z#bСс])([A-GСс](?:#|b)?m?)(?=$|[^A-Za-z#b])/;

export function decodeRekordboxPlaylist(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes);
  }

  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes);
  }

  return new TextDecoder("utf-8").decode(bytes);
}

export function parseRekordboxPlaylist(
  text: string,
  options: RekordboxParseOptions,
): RekordboxParseResult {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  const headerLine = lines[0];

  if (!headerLine) {
    throw new Error("Rekordbox playlist is empty");
  }

  const headers = headerLine.split("\t");
  const headerMismatch = expectedHeaders.some((header, index) => headers[index] !== header);

  if (headerMismatch) {
    throw new Error(`Unsupported Rekordbox headers: ${headers.join(", ")}`);
  }

  const records: RekordboxPlaylistEntry[] = [];
  const skipped: RekordboxSkippedEntry[] = [];

  for (const line of lines.slice(1)) {
    const row = parseRow(line);
    const playlistPosition = parseInteger(row.playlistPosition);

    if (playlistPosition === null) {
      skipped.push({
        playlistPosition: null,
        reason: `Invalid playlist position: ${row.playlistPosition}`,
        title: stringOrNull(row.title),
      });
      continue;
    }

    if (playlistPosition < options.fromPosition || playlistPosition > options.toPosition) {
      continue;
    }

    const parsed = parseEntry(row, playlistPosition);

    if ("record" in parsed) {
      records.push(parsed.record);
    } else {
      skipped.push(parsed.skipped);
    }
  }

  return {
    records,
    rowCount: records.length + skipped.length,
    skipped,
  };
}

export function createRekordboxSourceIdentity(title: string, artist: string | null): string {
  const normalizedTitle = normalizeIdentityPart(title);
  const normalizedArtist = normalizeIdentityPart(artist ?? "");

  return createHash("sha256").update(`${normalizedTitle}|${normalizedArtist}`).digest("hex");
}

function parseRow(line: string): RawRekordboxRow {
  const cells = line.split("\t");
  const [playlistPosition = "", , title = "", artist = "", bpm = "", key = "", ...rest] = cells;

  return {
    artist,
    bpm,
    comments: rest.join("\t"),
    key,
    playlistPosition,
    title,
  };
}

function parseEntry(
  row: RawRekordboxRow,
  playlistPosition: number,
):
  | {
      record: RekordboxPlaylistEntry;
    }
  | {
      skipped: RekordboxSkippedEntry;
    } {
  const title = row.title.trim();
  const artist = stringOrNull(row.artist);
  const comments = stringOrNull(row.comments);
  const bpm = parseNumber(row.bpm);

  if (!title) {
    return {
      skipped: {
        playlistPosition,
        reason: "Missing track title",
        title: null,
      },
    };
  }

  if (!bpm || bpm <= 0) {
    return {
      skipped: {
        playlistPosition,
        reason: `Missing or invalid BPM: ${row.bpm}`,
        title,
      },
    };
  }

  const rawKey = stringOrNull(row.key);
  const commentKey = rawKey ? null : extractKeyFromComments(comments);
  const keyText = rawKey ?? commentKey;
  const sourceIdentity = createRekordboxSourceIdentity(title, artist);

  try {
    const baseKey = keyText ? parseImportedKey(keyText, "Rekordbox") : null;
    const analysis = analyzeRekordboxComment(comments, baseKey);

    return {
      record: {
        artist,
        bpm,
        comment: analysis.comment,
        comments,
        doesNotFit: analysis.doesNotFit,
        harmonyNotes: analysis.harmonyNotes,
        key: analysis.key,
        keySource: rawKey ? "key-column" : analysis.key ? "comments" : "missing",
        meter: analysis.meter,
        playlistPosition,
        rawKey: rawKey ? normalizeConfusableKeyText(rawKey) : null,
        sourceIdentity,
        title,
        trackId: `trk-rbx-${sourceIdentity.slice(0, 12)}`,
      },
    };
  } catch (error) {
    return {
      skipped: {
        playlistPosition,
        reason: error instanceof Error ? error.message : String(error),
        title,
      },
    };
  }
}

function extractKeyFromComments(comments: string | null): string | null {
  if (!comments) {
    return null;
  }

  const match = keyTokenPattern.exec(comments);

  return match?.[1] ? normalizeConfusableKeyText(match[1]) : null;
}

function parseInteger(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10);

  return Number.isInteger(parsed) ? parsed : null;
}

function parseNumber(value: string): number | null {
  const parsed = Number(value.trim());

  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: string): string | null {
  const trimmed = value.trim();

  return trimmed ? trimmed : null;
}

function normalizeIdentityPart(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}
