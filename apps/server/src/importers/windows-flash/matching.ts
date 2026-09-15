import { createHash } from "node:crypto";
import { basename, extname } from "node:path";

import { normalizeAudioLookupText } from "../../audio/linker.ts";
import type { RetrieverCandidate } from "../../retrieval/types.ts";

const versionTokens = new Set([
  "acoustic",
  "bootleg",
  "club",
  "cover",
  "demo",
  "edit",
  "extended",
  "instrumental",
  "live",
  "mix",
  "piano",
  "radio",
  "recorded",
  "remaster",
  "remastered",
  "remix",
  "session",
  "spotify",
  "studio",
  "version",
]);

const noisePatterns = [
  /\b(?:128|160|192|256|320)\s?kbps\b/giu,
  /\bmp3(?:layk|party|tone|world|xa)?(?:\.ru)?\b/giu,
  /\bv(?:k|kontakte)\b/giu,
  /\bdownloaded from\b/giu,
  /\bofficial video\b/giu,
  /\blyrics?\b/giu,
  /\baudio\b/giu,
  /\bzouk music\b/giu,
  /\bmp3\b/giu,
];

export interface ParsedFlashFile {
  artistHints: string[];
  cleanedStem: string;
  extension: string;
  fileName: string;
  query: string;
  queryVariants: string[];
  titleHint: string | null;
}

export interface MatchScore {
  artistScore: number;
  confidence: number;
  queryScore: number;
  structured: boolean;
  titleScore: number;
  versionScore: number;
}

export interface CanonicalStreamingMatch {
  artist: string;
  candidate: RetrieverCandidate;
  score: MatchScore;
  sourceIdentity: string;
  sourceKind: "spotify" | "windows-flash" | "yandex";
  title: string;
}

export interface ExistingTrackSummary {
  artist: string | null;
  audioPath?: string | null;
  bpm?: number | null;
  hasChords?: boolean;
  id: string;
  keyUnknown?: number;
  sourceIdentity: string | null;
  sourceKind: string | null;
  title: string;
}

export function parseFlashFileName(filePath: string): ParsedFlashFile {
  const fileName = basename(filePath);
  const extension = extname(fileName);
  const rawStem = extension ? fileName.slice(0, -extension.length) : fileName;
  const cleanedStem = cleanupFlashStem(rawStem);
  const separators = [" - ", " – ", " — "];
  let artistHints: string[] = [];
  let titleHint: string | null = null;

  for (const separator of separators) {
    const index = cleanedStem.indexOf(separator);

    if (index <= 0) {
      continue;
    }

    const left = cleanedStem.slice(0, index).trim();
    const right = cleanedStem.slice(index + separator.length).trim();

    if (!left || !right) {
      continue;
    }

    artistHints = splitArtistCredits(left);
    titleHint = right;
    break;
  }

  if (!titleHint) {
    titleHint = cleanedStem || rawStem.trim();
  }

  const queries = new Set<string>();
  const primaryQuery = [artistHints.join(" "), titleHint].filter(Boolean).join(" ").trim();

  if (primaryQuery) {
    queries.add(primaryQuery);
  }

  if (cleanedStem) {
    queries.add(cleanedStem);
  }

  if (titleHint) {
    queries.add(titleHint);
  }

  return {
    artistHints,
    cleanedStem,
    extension,
    fileName,
    query: primaryQuery || cleanedStem || titleHint || rawStem.trim(),
    queryVariants: [...queries].filter(Boolean),
    titleHint,
  };
}

export function rankStreamingMatches(
  parsed: ParsedFlashFile,
  candidates: readonly RetrieverCandidate[],
): CanonicalStreamingMatch[] {
  return candidates
    .map((candidate) => toCanonicalMatch(parsed, candidate))
    .filter((candidate): candidate is CanonicalStreamingMatch => candidate !== null)
    .filter((candidate) => isAutoMatch(parsed, candidate.score))
    .sort((first, second) => compareMatches(first, second));
}

export function compareMatches(
  first: CanonicalStreamingMatch,
  second: CanonicalStreamingMatch,
): number {
  const delta = second.score.confidence - first.score.confidence;

  if (Math.abs(delta) > 0.05) {
    return delta;
  }

  if (first.sourceKind !== second.sourceKind) {
    return first.sourceKind === "yandex" ? -1 : 1;
  }

  return delta;
}

export function matchesAreCompatible(
  first: CanonicalStreamingMatch,
  second: CanonicalStreamingMatch,
): boolean {
  return (
    textSimilarity(first.title, second.title) >= 0.78 &&
    artistSimilarity(splitArtistCredits(first.artist), splitArtistCredits(second.artist)) >= 0.7
  );
}

export function findExistingDuplicate(
  existingTracks: readonly ExistingTrackSummary[],
  match: CanonicalStreamingMatch,
): ExistingTrackSummary | null {
  const bySource = existingTracks.find(
    (track) =>
      track.sourceKind === match.sourceKind && track.sourceIdentity === match.sourceIdentity,
  );

  if (bySource) {
    return bySource;
  }

  const expectedTitle = normalizeAudioLookupText(match.title);

  for (const track of existingTracks) {
    if (normalizeAudioLookupText(track.title) !== expectedTitle) {
      continue;
    }

    const artistScore = artistSimilarity(
      splitArtistCredits(match.artist),
      splitArtistCredits(track.artist),
    );

    if (artistScore >= 0.88) {
      return track;
    }
  }

  return null;
}

export function shouldReuseExistingForAnalysis(
  track: ExistingTrackSummary,
  match: CanonicalStreamingMatch,
): boolean {
  return (
    track.sourceKind === match.sourceKind &&
    track.sourceIdentity === match.sourceIdentity &&
    !track.hasChords &&
    track.keyUnknown === 1 &&
    track.bpm === null
  );
}

export function splitArtistCredits(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(/\s*(?:;|,|&| feat\.? | ft\.? | featuring | with )\s*/iu)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function artistSimilarity(
  expectedArtists: readonly string[],
  candidateArtists: readonly string[],
): number {
  if (expectedArtists.length === 0) {
    return 1;
  }

  if (candidateArtists.length === 0) {
    return 0;
  }

  const expectedPrimary = expectedArtists[0] ?? "";
  const candidatePrimary = candidateArtists[0] ?? "";
  const primaryScore = textSimilarity(expectedPrimary, candidatePrimary);
  let bestAny = primaryScore;

  for (const expected of expectedArtists) {
    for (const candidate of candidateArtists) {
      bestAny = Math.max(bestAny, textSimilarity(expected, candidate));
    }
  }

  return Math.max(primaryScore, bestAny * 0.85);
}

export function textSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeComparisonText(left);
  const normalizedRight = normalizeComparisonText(right);

  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    const ratio =
      Math.min(normalizedLeft.length, normalizedRight.length) /
      Math.max(normalizedLeft.length, normalizedRight.length);

    return Math.max(0.78, ratio);
  }

  return tokenSimilarity(normalizedLeft, normalizedRight);
}

function cleanupFlashStem(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[_]+/g, " ")
    .replace(/^\s*\d{1,3}[.)\]-]?\s+/u, "")
    .replace(/\[[^\]]+\]/gu, (match) =>
      looksLikeVersionTag(match) ? ` ${match.slice(1, -1)} ` : " ",
    )
    .replace(/\(([^)]+)\)/gu, (match, inner: string) =>
      looksLikeVersionTag(inner) ? ` (${inner.trim()}) ` : " ",
    )
    .replace(/\s+/g, " ")
    .replace(noisePatterns[0] ?? /$^/u, " ")
    .replace(noisePatterns[1] ?? /$^/u, " ")
    .replace(noisePatterns[2] ?? /$^/u, " ")
    .replace(noisePatterns[3] ?? /$^/u, " ")
    .replace(noisePatterns[4] ?? /$^/u, " ")
    .replace(noisePatterns[5] ?? /$^/u, " ")
    .replace(noisePatterns[6] ?? /$^/u, " ")
    .replace(noisePatterns[7] ?? /$^/u, " ")
    .trim();
}

function looksLikeVersionTag(value: string): boolean {
  const normalized = normalizeComparisonText(value);

  if (!normalized) {
    return false;
  }

  return extractVersionTokens(normalized).length > 0;
}

function toCanonicalMatch(
  parsed: ParsedFlashFile,
  candidate: RetrieverCandidate,
): CanonicalStreamingMatch | null {
  const title = candidate.title.trim();
  const artist = candidate.artists.join("; ").trim();

  if (!title || !artist) {
    return null;
  }

  return {
    artist,
    candidate,
    score: scoreCandidate(parsed, candidate),
    sourceIdentity: buildSourceIdentity(candidate),
    sourceKind: candidate.source,
    title,
  };
}

function scoreCandidate(parsed: ParsedFlashFile, candidate: RetrieverCandidate): MatchScore {
  const expectedTitle = parsed.titleHint ?? parsed.cleanedStem;
  const titleScore = textSimilarity(expectedTitle, candidate.title);
  const queryScore = textSimilarity(parsed.cleanedStem || parsed.query, candidateLabel(candidate));
  const artistScore = artistSimilarity(parsed.artistHints, candidate.artists);
  const versionScore = versionSimilarity(expectedTitle, candidate.title);
  const structured = parsed.artistHints.length > 0 && Boolean(parsed.titleHint);
  const confidence = structured
    ? titleScore * 0.48 + artistScore * 0.28 + versionScore * 0.16 + queryScore * 0.08
    : Math.max(titleScore, queryScore) * 0.72 + versionScore * 0.18 + artistScore * 0.1;

  return {
    artistScore,
    confidence,
    queryScore,
    structured,
    titleScore,
    versionScore,
  };
}

function isAutoMatch(parsed: ParsedFlashFile, score: MatchScore): boolean {
  const textGate = score.structured
    ? score.titleScore >= 0.74
    : Math.max(score.titleScore, score.queryScore) >= 0.84;
  const artistGate = !score.structured || score.artistScore >= 0.64;
  const versionGate = score.versionScore >= 0.55;
  const threshold = score.structured ? 0.8 : 0.9;

  return textGate && artistGate && versionGate && score.confidence >= threshold;
}

function buildSourceIdentity(candidate: RetrieverCandidate): string {
  const raw = asRecord(candidate.raw);

  if (candidate.source === "spotify") {
    const isrc = readString(raw.isrc);

    if (isrc) {
      return `isrc:${isrc}`;
    }

    const trackId = readString(raw.id);

    if (trackId) {
      return `spotify:track:${trackId}`;
    }

    return `spotify:url:${hashText(candidate.url)}`;
  }

  const trackId = readNumberish(raw.trackId);
  const albumId = readNumberish(raw.albumId);

  if (trackId && albumId) {
    return `track:${trackId}:album:${albumId}`;
  }

  if (trackId) {
    return `track:${trackId}`;
  }

  return `yandex:url:${hashText(candidate.url)}`;
}

function candidateLabel(candidate: RetrieverCandidate): string {
  return [...candidate.artists, candidate.title].filter(Boolean).join(" ");
}

function normalizeComparisonText(value: string): string {
  return normalizeAudioLookupText(value)
    .replace(/\b(feat|ft|featuring|with|prod|originally performed by)\b/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 1));
  const rightTokens = new Set(right.split(" ").filter((token) => token.length > 1));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftTokens, ...rightTokens]).size;

  return union === 0 ? 0 : intersection / union;
}

function versionSimilarity(expectedTitle: string, candidateTitle: string): number {
  const expected = extractVersionTokens(normalizeComparisonText(expectedTitle));
  const candidate = extractVersionTokens(normalizeComparisonText(candidateTitle));

  if (expected.length === 0 && candidate.length === 0) {
    return 1;
  }

  if (expected.length === 0) {
    return 0.82;
  }

  if (candidate.length === 0) {
    return 0.55;
  }

  const expectedSet = new Set(expected);
  const candidateSet = new Set(candidate);
  let intersection = 0;

  for (const token of expectedSet) {
    if (candidateSet.has(token)) {
      intersection += 1;
    }
  }

  if (intersection === 0) {
    return 0.35;
  }

  return intersection / new Set([...expectedSet, ...candidateSet]).size;
}

function extractVersionTokens(value: string): string[] {
  return value
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && versionTokens.has(token));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumberish(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
