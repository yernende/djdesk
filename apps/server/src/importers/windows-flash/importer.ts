import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { normalizeAudioLookupText } from "../../audio/linker.ts";
import { analyzeAudioQuality } from "../../audio/quality.ts";
import { writeTrackAudioQuality } from "../../audio/quality-backfill.ts";
import { openDatabase } from "../../db/database.ts";
import { runMigrations } from "../../db/migrations.ts";
import { createDjToolRetriever } from "../../retrieval/dj-tool.ts";
import type { RetrieverCandidate, RetrieverDownloadResult } from "../../retrieval/types.ts";
import { importChordAiChordsOnlyIntoDatabase } from "../chordai/chords-only.ts";
import { parseCsv } from "../chordai/csv.ts";
import {
  compareMatches,
  findExistingDuplicate,
  matchesAreCompatible,
  parseFlashFileName,
  rankStreamingMatches,
  shouldReuseExistingForAnalysis,
  type CanonicalStreamingMatch,
  type ExistingTrackSummary,
} from "./matching.ts";
import {
  adbCleanupChordAiExports,
  adbCleanupManagedMedia,
  adbPush,
  adbRemove,
  adbShell,
  downloadRemoteFile,
  listRemoteFiles,
  readPhoneFreeKilobytes,
  runCommand,
} from "./shell.ts";
import {
  decideThermalAction,
  parseBatteryTemperatureC,
  parseThermalStatus,
  type ThermalMode,
  type ThermalSnapshot,
} from "./thermal.ts";

const supportedAudioExtensions = new Set([
  ".aac",
  ".aif",
  ".aiff",
  ".flac",
  ".m4a",
  ".mp3",
  ".wav",
]);
const preferredAudioExtensions = [".flac", ".wav", ".aiff", ".aif", ".m4a", ".mp3", ".aac"];
const defaultBatchPauseSeconds = 120;
const defaultBatchSize = 10;
const defaultPhoneBatchRoot = "/sdcard/Music/djdesk-windows-import";
const defaultPerTrackPauseSeconds = 15;
const defaultPhoneMinFreeKilobytes = 2_000_000;
const defaultSingleTrackPauseSeconds = 120;
const spotifySearchMinIntervalMs = 1_200;
const spotifyRateLimitRetryDelaysMs = [45_000, 90_000, 150_000] as const;
let lastSpotifySearchAt = 0;
let spotifyRateLimitedUntil = 0;

export const defaultWindowsFlashFolders = [
  "/E:/Любимые",
  "/E:/Зук общее",
  "/E:/Зук Новинки",
  "/E:/Зук Телега",
] as const;

export const defaultZoukFlashFolders = [
  "/E:/Зук общее",
  "/E:/Зук Новинки",
  "/E:/Зук Телега",
] as const;

export interface WindowsFlashImportOptions {
  analysisTimeoutSeconds?: number;
  audioUploadDir: string;
  batchPauseSeconds?: number;
  batchSize?: number;
  chordAiKitRoot: string;
  databasePath: string;
  djToolRoot: string;
  folders?: readonly string[];
  folderStartIndexes?: Readonly<Record<string, number>>;
  hqMode?: HqMode;
  localFallback?: boolean;
  matchQueryLimit?: number;
  maxFiles?: number;
  onlyRemotePaths?: readonly string[];
  perTrackPauseSeconds?: number;
  phoneBatchRoot?: string;
  phoneMinFreeKilobytes?: number;
  singleTrackPauseSeconds?: number;
  startIndex?: number;
  stagingRoot: string;
  windowsHost: string;
  spotifyMode?: SpotifyMode;
}

export type HqMode = "download" | "none" | "reuse";
export type SpotifyMode = "auto" | "off";

export interface WindowsFlashImportResult {
  folderResults: FolderImportResult[];
  runRoot: string;
  stoppedReason: string | null;
  summaryPath: string;
}

export interface FolderImportResult {
  counts: Record<string, number>;
  folder: string;
  reportCsvPath: string;
  reportMarkdownPath: string;
  remainingRemotePaths: string[];
  rows: FolderStatusRow[];
  stopReason: string | null;
  thermalEvents: ThermalEvent[];
}

export interface FolderStatusRow {
  analysisSource: "hq" | "lowres" | null;
  audioPath: string | null;
  batteryTemperatureC: number | null;
  canonicalArtist: string | null;
  canonicalTitle: string | null;
  fileName: string;
  lucidaUrl: string | null;
  note: string;
  query: string;
  remotePath: string;
  sourceIdentity: string | null;
  sourceKind: string | null;
  status:
    | "blocked-by-thermal"
    | "blocked-other"
    | "done"
    | "imported-lowres-analysis"
    | "manual-review"
    | "pending"
    | "skipped-existing";
  thermalStatus: number | null;
  trackId: string | null;
}

interface ResolvedSearchMatch extends CanonicalStreamingMatch {
  trackContext: unknown;
}

interface PreparedTrack {
  analysisPath: string;
  analysisSource: "hq" | "lowres";
  audioPath: string | null;
  canonical: ResolvedSearchMatch;
  phonePath: string;
  remotePath: string;
  row: FolderStatusRow;
  trackId: string;
}

interface ThermalEvent {
  batteryTemperatureC: number | null;
  label: string;
  reason: string;
  thermalStatus: number | null;
}

interface ExistingTrackIndex {
  entries: ExistingTrackSummary[];
}

interface AudioFileCandidate {
  audioPath: string;
  extensionRank: number;
  normalizedName: string;
}

class AudioLibraryIndex {
  private readonly candidates: AudioFileCandidate[] = [];
  private readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  static async create(root: string): Promise<AudioLibraryIndex> {
    const index = new AudioLibraryIndex(resolve(root));
    await index.load();
    return index;
  }

  findBestMatch(artist: string, title: string): string | null {
    const normalizedArtist = normalizeAudioLookupText(artist);
    const normalizedTitle = normalizeAudioLookupText(title);
    const query = {
      fullKeys: [
        normalizeAudioLookupText(`${artist} ${title}`),
        normalizeAudioLookupText(`${title} ${artist}`),
      ].filter(Boolean),
      titleKey: normalizedTitle,
      titleTokenCount: countAudioLookupTokens(normalizedTitle),
    };
    let best: AudioFileCandidate | null = null;
    let bestScore = 0;

    for (const candidate of this.candidates) {
      const score = scoreAudioCandidate(candidate, query);

      if (score < bestScore) {
        continue;
      }

      if (score === bestScore && best && candidate.extensionRank >= best.extensionRank) {
        continue;
      }

      bestScore = score;
      best = candidate;
    }

    return bestScore > 0 && normalizedArtist ? (best?.audioPath ?? null) : null;
  }

  remember(audioPath: string): void {
    const extension = extname(audioPath).toLocaleLowerCase();

    if (!supportedAudioExtensions.has(extension)) {
      return;
    }

    const normalizedName = normalizeAudioLookupText(basename(audioPath, extension));

    if (!normalizedName) {
      return;
    }

    if (this.candidates.some((candidate) => candidate.audioPath === audioPath)) {
      return;
    }

    this.candidates.push({
      audioPath,
      extensionRank: getExtensionRank(extension),
      normalizedName,
    });
  }

  private async load(): Promise<void> {
    await collectAudioFiles(this.root, this.candidates).catch(() => undefined);
  }
}

class KitBatchGuard {
  private originalInput: string | null = null;
  private originalState: string | null = null;
  private readonly kitRoot: string;

  constructor(kitRoot: string) {
    this.kitRoot = kitRoot;
  }

  async initialize(): Promise<void> {
    this.originalInput = await readOptionalText(this.inputTracksPath);
    this.originalState = await readOptionalText(this.statePath);
  }

  async restore(): Promise<void> {
    if (this.originalInput === null) {
      await writeFile(this.inputTracksPath, "", "utf8");
    } else {
      await writeFile(this.inputTracksPath, this.originalInput, "utf8");
    }

    if (this.originalState === null) {
      await writeFile(this.statePath, stateCsvHeader, "utf8");
    } else {
      await writeFile(this.statePath, this.originalState, "utf8");
    }
  }

  async writeSingleTrack(phonePath: string): Promise<void> {
    await mkdir(join(this.kitRoot, "batch"), {
      recursive: true,
    });
    await writeFile(this.inputTracksPath, `${phonePath}\n`, "utf8");
    await writeFile(
      this.statePath,
      [stateCsvHeader, `${csvValue(phonePath)},pending,0,,,,,,queue`].join("\n"),
      "utf8",
    );
  }

  get inputTracksPath(): string {
    return join(this.kitRoot, "batch", "input_tracks.txt");
  }

  get statePath(): string {
    return join(this.kitRoot, "batch", "batch_state.csv");
  }
}

const stateCsvHeader =
  "track_path,status,attempts,started_at,finished_at,exported_phone_path,local_report_dir,error,next_action";

export async function importWindowsFlashFolders(
  options: WindowsFlashImportOptions,
): Promise<WindowsFlashImportResult> {
  const database = await openDatabase(options.databasePath);

  try {
    await runMigrations(database);

    return await importWindowsFlashFoldersIntoDatabase(database, options);
  } finally {
    database.close();
  }
}

export async function importWindowsFlashFoldersIntoDatabase(
  database: DatabaseSync,
  options: WindowsFlashImportOptions,
): Promise<WindowsFlashImportResult> {
  const resolvedOptions = normalizeOptions(options);
  const runRoot = await createRunRoot(resolvedOptions.stagingRoot);
  const summaryPath = join(runRoot, "summary.md");
  const retriever = createDjToolRetriever({
    audioUploadDir: resolvedOptions.audioUploadDir,
    djToolRoot: resolvedOptions.djToolRoot,
  });
  const audioLibrary = await AudioLibraryIndex.create(resolvedOptions.audioUploadDir);
  const existingTracks = readExistingTracks(database);
  const kitGuard = new KitBatchGuard(resolvedOptions.chordAiKitRoot);
  const folderResults: FolderImportResult[] = [];
  let stoppedReason: string | null = null;

  await kitGuard.initialize();

  try {
    for (const folder of resolvedOptions.folders) {
      const folderResult = await processFolder(database, {
        audioLibrary,
        existingTracks,
        folder,
        options: resolvedOptions,
        retriever,
        runRoot,
        kitGuard,
      });

      folderResults.push(folderResult);
      await writeRunSummary(summaryPath, folderResults, stoppedReason);

      if (folderResult.stopReason) {
        stoppedReason = folderResult.stopReason;
        break;
      }
    }
  } finally {
    await kitGuard.restore();
    await writeRunSummary(summaryPath, folderResults, stoppedReason);
  }

  return {
    folderResults,
    runRoot,
    stoppedReason,
    summaryPath,
  };
}

async function processFolder(
  database: DatabaseSync,
  input: {
    audioLibrary: AudioLibraryIndex;
    existingTracks: ExistingTrackIndex;
    folder: string;
    kitGuard: KitBatchGuard;
    options: RequiredImportOptions;
    retriever: ReturnType<typeof createDjToolRetriever>;
    runRoot: string;
  },
): Promise<FolderImportResult> {
  const folderSlug = slugifyFolder(input.folder);
  const reportCsvPath = join(input.runRoot, "folders", `${folderSlug}.csv`);
  const reportMarkdownPath = join(input.runRoot, "folders", `${folderSlug}.md`);
  const rows: FolderStatusRow[] = [];
  const thermalEvents: ThermalEvent[] = [];
  const listedRemoteFiles = (await listRemoteFiles(input.options.windowsHost, input.folder)).filter(
    (remotePath) => supportedAudioExtensions.has(extname(remotePath).toLocaleLowerCase()),
  );
  const onlyRemotePaths = input.options.onlyRemotePaths;
  const allRemoteFiles =
    onlyRemotePaths === null
      ? listedRemoteFiles
      : listedRemoteFiles.filter((remotePath) => onlyRemotePaths.has(remotePath));
  const startIndex = Math.min(
    input.options.folderStartIndexes[input.folder] ?? input.options.startIndex,
    allRemoteFiles.length,
  );
  const remoteFiles = allRemoteFiles.slice(
    startIndex,
    Math.min(startIndex + input.options.maxFiles, allRemoteFiles.length),
  );
  const pendingBatch: PreparedTrack[] = [];
  let mode: ThermalMode = "normal";
  let stopReason: string | null = null;
  let batchProcessed = 0;
  let cursor = 0;

  for (; cursor < remoteFiles.length; cursor += 1) {
    const remotePath = remoteFiles[cursor] ?? "";

    if (!remotePath) {
      continue;
    }

    const row: FolderStatusRow = {
      analysisSource: null,
      audioPath: null,
      batteryTemperatureC: null,
      canonicalArtist: null,
      canonicalTitle: null,
      fileName: basename(remotePath),
      lucidaUrl: null,
      note: "",
      query: "",
      remotePath,
      sourceIdentity: null,
      sourceKind: null,
      status: "pending",
      thermalStatus: null,
      trackId: null,
    };
    rows.push(row);

    try {
      console.log(
        `[windows-flash] prepare ${input.folder} ${cursor + 1}/${remoteFiles.length}: ${basename(remotePath)}`,
      );
      const prepared = await prepareTrack(database, {
        audioLibrary: input.audioLibrary,
        existingTracks: input.existingTracks,
        folderSlug,
        options: input.options,
        remotePath,
        retriever: input.retriever,
        row,
        runRoot: input.runRoot,
      });

      await writeFolderReport(
        reportCsvPath,
        reportMarkdownPath,
        input.folder,
        rows,
        thermalEvents,
        [],
      );

      if (!prepared) {
        continue;
      }

      pendingBatch.push(prepared);

      if (pendingBatch.length < input.options.batchSize) {
        continue;
      }

      const batchResult = await processPreparedBatch(database, {
        folder: input.folder,
        folderSlug,
        kitGuard: input.kitGuard,
        mode,
        options: input.options,
        preparedTracks: pendingBatch.splice(0, pendingBatch.length),
        reportMarkdownPath,
        runRoot: input.runRoot,
        rows,
        thermalEvents,
      });

      mode = batchResult.mode;
      batchProcessed += batchResult.completedCount;

      await writeFolderReport(
        reportCsvPath,
        reportMarkdownPath,
        input.folder,
        rows,
        thermalEvents,
        remoteFiles.slice(cursor + 1),
      );

      if (batchResult.stopReason) {
        stopReason = batchResult.stopReason;
        break;
      }

      const hasRemainingRemoteFiles = cursor + 1 < remoteFiles.length;

      if (mode === "normal" && batchProcessed > 0 && hasRemainingRemoteFiles) {
        await recordThermalEvent(thermalEvents, "batch-boundary", "Completed a 10-track batch");
        await sleep(input.options.batchPauseSeconds * 1000);
        batchProcessed = 0;
      }
    } catch (error) {
      row.status = "blocked-other";
      row.note = getErrorMessage(error);
      await writeFolderReport(
        reportCsvPath,
        reportMarkdownPath,
        input.folder,
        rows,
        thermalEvents,
        remoteFiles.slice(cursor + 1),
      );
    }
  }

  if (!stopReason && pendingBatch.length > 0) {
    const batchResult = await processPreparedBatch(database, {
      folder: input.folder,
      folderSlug,
      kitGuard: input.kitGuard,
      mode,
      options: input.options,
      preparedTracks: pendingBatch.splice(0, pendingBatch.length),
      reportMarkdownPath,
      runRoot: input.runRoot,
      rows,
      thermalEvents,
    });

    mode = batchResult.mode;
    stopReason = batchResult.stopReason;
  }

  const remainingRemotePaths =
    stopReason === null ? [] : remoteFiles.slice(Math.min(cursor + 1, remoteFiles.length));

  await writeFolderReport(
    reportCsvPath,
    reportMarkdownPath,
    input.folder,
    rows,
    thermalEvents,
    remainingRemotePaths,
  );

  return {
    counts: countStatuses(rows),
    folder: input.folder,
    reportCsvPath,
    reportMarkdownPath,
    remainingRemotePaths,
    rows,
    stopReason,
    thermalEvents,
  };
}

async function prepareTrack(
  database: DatabaseSync,
  input: {
    audioLibrary: AudioLibraryIndex;
    existingTracks: ExistingTrackIndex;
    folderSlug: string;
    options: RequiredImportOptions;
    remotePath: string;
    retriever: ReturnType<typeof createDjToolRetriever>;
    row: FolderStatusRow;
    runRoot: string;
  },
): Promise<PreparedTrack | null> {
  const parsed = parseFlashFileName(input.remotePath);

  input.row.query = parsed.query;

  if (!parsed.query) {
    input.row.status = "manual-review";
    input.row.note = "Could not build a usable query from the file name";
    return null;
  }

  const { lucidaUrl, matches, note } = await resolveMatches(
    parsed,
    input.retriever,
    input.options.matchQueryLimit,
    input.options.spotifyMode,
  );

  input.row.lucidaUrl = lucidaUrl;

  if (matches.length === 0 && !input.options.localFallback) {
    input.row.status = "manual-review";
    input.row.note = note;
    return null;
  }

  let chosen = matches[0] ?? null;

  if (!chosen && input.options.localFallback) {
    chosen = buildLocalFallbackMatch(parsed, input.remotePath, note);
  }

  if (!chosen) {
    input.row.status = "manual-review";
    input.row.note = note;
    return null;
  }

  input.row.canonicalArtist = chosen.artist;
  input.row.canonicalTitle = chosen.title;
  input.row.sourceIdentity = chosen.sourceIdentity;
  input.row.sourceKind = chosen.sourceKind;

  let duplicate = findExistingDuplicate(input.existingTracks.entries, chosen);

  if (duplicate && !shouldReuseExistingForAnalysis(duplicate, chosen)) {
    input.row.status = "skipped-existing";
    input.row.trackId = duplicate.id;
    input.row.note = `Matched existing track ${duplicate.id}`;
    return null;
  }

  let hqAudioPath: string | null = null;
  let downloadNote = note;
  const alternate = matches[1] ?? null;

  if (input.options.hqMode === "download") {
    const primaryDownload = await attemptHighQualityDownload(
      input.audioLibrary,
      input.retriever,
      chosen,
    );

    hqAudioPath = primaryDownload.audioPath;
    downloadNote = primaryDownload.note;

    if (
      !hqAudioPath &&
      alternate &&
      matchesAreCompatible(chosen, alternate) &&
      compareMatches(alternate, chosen) <= 0
    ) {
      const alternateDownload = await attemptHighQualityDownload(
        input.audioLibrary,
        input.retriever,
        alternate,
      );

      if (alternateDownload.audioPath) {
        chosen = alternate;
        hqAudioPath = alternateDownload.audioPath;
        downloadNote = alternateDownload.note;
      }
    }
  } else if (input.options.hqMode === "reuse") {
    hqAudioPath = input.audioLibrary.findBestMatch(chosen.artist, chosen.title);
    downloadNote = hqAudioPath ? "HQ reused from library" : "HQ download skipped";
  } else {
    downloadNote = "HQ download skipped";
  }

  input.row.canonicalArtist = chosen.artist;
  input.row.canonicalTitle = chosen.title;
  input.row.sourceIdentity = chosen.sourceIdentity;
  input.row.sourceKind = chosen.sourceKind;
  duplicate = findExistingDuplicate(input.existingTracks.entries, chosen);

  let analysisPath = hqAudioPath;
  let analysisSource: "hq" | "lowres" = "hq";
  let trackId: string;

  if (duplicate) {
    trackId = duplicate.id;

    if (!analysisPath && duplicate.audioPath) {
      analysisPath = duplicate.audioPath;
      analysisSource = "hq";
    }

    if (hqAudioPath) {
      await updateTrackAudioPath(database, trackId, hqAudioPath);
      analysisPath = hqAudioPath;
      analysisSource = "hq";
    }

    input.row.note = `${downloadNote}; resuming incomplete track ${duplicate.id}`;
  } else {
    trackId = insertImportedTrack(database, chosen);

    if (hqAudioPath) {
      await updateTrackAudioPath(database, trackId, hqAudioPath);
    }

    indexTrack(input.existingTracks, {
      artist: chosen.artist,
      audioPath: hqAudioPath,
      bpm: null,
      hasChords: false,
      id: trackId,
      keyUnknown: 1,
      sourceIdentity: chosen.sourceIdentity,
      sourceKind: chosen.sourceKind,
      title: chosen.title,
    });
    input.row.note = downloadNote;
  }

  if (!analysisPath) {
    analysisSource = "lowres";
    analysisPath = await copyLowResSource(
      input.remotePath,
      input.runRoot,
      input.options.windowsHost,
      {
        artist: chosen.artist,
        title: chosen.title,
      },
    );
  }

  input.row.trackId = trackId;
  input.row.analysisSource = analysisSource;
  input.row.audioPath = analysisSource === "hq" ? analysisPath : null;

  return {
    analysisPath,
    analysisSource,
    audioPath: analysisSource === "hq" ? analysisPath : null,
    canonical: chosen,
    phonePath: buildPhonePath(input.options.phoneBatchRoot, input.folderSlug, chosen, analysisPath),
    remotePath: input.remotePath,
    row: input.row,
    trackId,
  };
}

async function resolveMatches(
  parsed: ReturnType<typeof parseFlashFileName>,
  retriever: ReturnType<typeof createDjToolRetriever>,
  matchQueryLimit: number,
  spotifyMode: SpotifyMode,
): Promise<{
  lucidaUrl: string | null;
  matches: ResolvedSearchMatch[];
  note: string;
}> {
  let bestSpotify: ResolvedSearchMatch | null = null;
  let bestYandex: ResolvedSearchMatch | null = null;
  let lucidaUrl: string | null = null;

  for (const query of parsed.queryVariants.slice(0, matchQueryLimit)) {
    const yandexResult = await retriever.searchYandexCandidates(query);
    const yandexMatches = rankStreamingMatches(parsed, yandexResult.candidates).map((match) => ({
      ...match,
      trackContext: yandexResult.trackContext,
    }));

    const currentBestYandex = yandexMatches[0] ?? null;
    bestYandex = chooseBetterMatch(bestYandex, currentBestYandex);

    if (currentBestYandex) {
      break;
    }

    if (spotifyMode === "off") {
      continue;
    }

    let spotifyResult: Awaited<ReturnType<typeof retriever.searchSpotifyCandidates>>;

    try {
      spotifyResult = await searchSpotifyCandidatesWithBackoff(retriever, query, {
        trackContext: yandexResult.trackContext,
      });
    } catch (error) {
      if (isSpotifyRateLimitError(error) && bestYandex) {
        console.warn(`[windows-flash] spotify rate-limited for "${query}", using Yandex candidate`);
        break;
      }

      throw error;
    }

    const spotifyMatches = rankStreamingMatches(parsed, spotifyResult.candidates).map((match) => ({
      ...match,
      trackContext: spotifyResult.trackContext,
    }));

    bestSpotify = chooseBetterMatch(bestSpotify, spotifyMatches[0] ?? null);
  }

  const matches = [bestYandex, bestSpotify]
    .filter((match): match is ResolvedSearchMatch => match !== null)
    .sort((first, second) => compareMatches(first, second));

  if (matches.length === 0) {
    try {
      const lucida = await retriever.getLucidaFallback(parsed.query, {
        trackContext: null,
      });
      lucidaUrl = lucida.url;
    } catch {
      lucidaUrl = null;
    }
  }

  const bestMatch = matches[0];
  const fallbackMatch = matches[1];
  const note = bestMatch
    ? [
        `${bestMatch.sourceKind} ${Math.round(bestMatch.score.confidence * 100)}%`,
        fallbackMatch
          ? `fallback ${fallbackMatch.sourceKind} ${Math.round(fallbackMatch.score.confidence * 100)}%`
          : null,
      ]
        .filter(Boolean)
        .join(", ")
    : "No confident Yandex/Spotify match";

  return {
    lucidaUrl,
    matches,
    note,
  };
}

async function searchSpotifyCandidatesWithBackoff(
  retriever: ReturnType<typeof createDjToolRetriever>,
  query: string,
  options: { trackContext: unknown },
): ReturnType<typeof retriever.searchSpotifyCandidates> {
  for (let attempt = 0; ; attempt += 1) {
    await waitForSpotifySearchSlot();

    try {
      return await retriever.searchSpotifyCandidates(query, options);
    } catch (error) {
      if (!isSpotifyRateLimitError(error) || attempt >= spotifyRateLimitRetryDelaysMs.length) {
        throw error;
      }

      const delayMs = spotifyRateLimitRetryDelaysMs[attempt] ?? 150_000;
      spotifyRateLimitedUntil = Math.max(spotifyRateLimitedUntil, Date.now() + delayMs);
      console.warn(
        `[windows-flash] spotify 429 for "${query}", retrying in ${Math.round(delayMs / 1000)}s`,
      );
    }
  }
}

async function waitForSpotifySearchSlot(): Promise<void> {
  const waitUntil = Math.max(
    lastSpotifySearchAt + spotifySearchMinIntervalMs,
    spotifyRateLimitedUntil,
  );
  const delayMs = waitUntil - Date.now();

  if (delayMs > 0) {
    await sleep(delayMs);
  }

  lastSpotifySearchAt = Date.now();
}

function isSpotifyRateLimitError(error: unknown): boolean {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : null;

  return (
    status === 429 ||
    getErrorMessage(error).includes("-> 429") ||
    getErrorMessage(error).toLocaleLowerCase().includes("too many requests")
  );
}

async function attemptHighQualityDownload(
  audioLibrary: AudioLibraryIndex,
  retriever: ReturnType<typeof createDjToolRetriever>,
  match: ResolvedSearchMatch,
): Promise<{
  audioPath: string | null;
  note: string;
}> {
  if (match.sourceKind === "windows-flash") {
    return {
      audioPath: null,
      note: "Local filename fallback; HQ unavailable",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20 * 60 * 1000);
  timeout.unref?.();
  let result: RetrieverDownloadResult;

  try {
    if (match.sourceKind === "yandex") {
      result = await retriever.downloadYandexCandidate(match.candidate, {
        onMessage: () => undefined,
        signal: controller.signal,
        trackContext: match.trackContext,
      });
    } else {
      result = await retriever.downloadSpotifyCandidate(match.candidate, {
        onMessage: () => undefined,
        signal: controller.signal,
        trackContext: match.trackContext,
      });
    }
  } finally {
    clearTimeout(timeout);
  }

  const downloaded = result.files[0] ?? null;

  if (downloaded) {
    audioLibrary.remember(downloaded);
    return {
      audioPath: downloaded,
      note: `${match.sourceKind} HQ attached`,
    };
  }

  const existing = audioLibrary.findBestMatch(match.artist, match.title);

  if (existing) {
    return {
      audioPath: existing,
      note: `${match.sourceKind} HQ reused from library`,
    };
  }

  return {
    audioPath: null,
    note: result.reason
      ? `${match.sourceKind} download: ${result.reason}`
      : `${match.sourceKind} HQ unavailable`,
  };
}

async function copyLowResSource(
  remotePath: string,
  runRoot: string,
  windowsHost: string,
  canonical: {
    artist: string;
    title: string;
  },
): Promise<string> {
  const extension = extname(remotePath) || ".mp3";
  const fileName = sanitizeFileName(`${canonical.artist} - ${canonical.title}${extension}`);
  const localPath = join(runRoot, "analysis-lowres", fileName);

  await downloadRemoteFile(windowsHost, remotePath, localPath);

  return localPath;
}

async function processPreparedBatch(
  database: DatabaseSync,
  input: {
    folder: string;
    folderSlug: string;
    kitGuard: KitBatchGuard;
    mode: ThermalMode;
    options: RequiredImportOptions;
    preparedTracks: PreparedTrack[];
    reportMarkdownPath: string;
    rows: FolderStatusRow[];
    runRoot: string;
    thermalEvents: ThermalEvent[];
  },
): Promise<{
  completedCount: number;
  mode: ThermalMode;
  stopReason: string | null;
}> {
  let mode = input.mode;
  let completedCount = 0;

  for (let index = 0; index < input.preparedTracks.length; index += 1) {
    const prepared = input.preparedTracks[index];

    if (!prepared) {
      continue;
    }

    const thermalGate = await waitForThermalWindow(mode, prepared.row, input.thermalEvents);

    mode = thermalGate.mode;

    if (thermalGate.stopReason) {
      prepared.row.status = "blocked-by-thermal";
      prepared.row.note = thermalGate.stopReason;

      for (const pending of input.preparedTracks.slice(index + 1)) {
        pending.row.status = "blocked-by-thermal";
        pending.row.note = thermalGate.stopReason;
      }

      return {
        completedCount,
        mode,
        stopReason: thermalGate.stopReason,
      };
    }

    try {
      await ensurePhoneStorage(input.options.phoneMinFreeKilobytes);
      await pushTrackToPhone(prepared);
      const trackRun = await runSingleTrackThroughPhone(database, {
        folderSlug: input.folderSlug,
        kitGuard: input.kitGuard,
        options: input.options,
        prepared,
        runRoot: input.runRoot,
      });

      if (trackRun.status === "ok") {
        prepared.row.status =
          prepared.analysisSource === "hq" ? "done" : "imported-lowres-analysis";
        prepared.row.note = trackRun.note;
        completedCount += 1;
      } else {
        prepared.row.status = "blocked-other";
        prepared.row.note = trackRun.note;
      }
    } catch (error) {
      prepared.row.status = "blocked-other";
      prepared.row.note = getErrorMessage(error);
    } finally {
      await adbRemove([prepared.phonePath]).catch(() => undefined);
      await adbCleanupChordAiExports();
    }

    if (index >= input.preparedTracks.length - 1) {
      continue;
    }

    const pauseSeconds =
      mode === "single-track"
        ? input.options.singleTrackPauseSeconds
        : input.options.perTrackPauseSeconds;

    await sleep(pauseSeconds * 1000);
  }

  await recordThermalEvent(input.thermalEvents, "batch-finished", `Finished ${input.folder}`);

  return {
    completedCount,
    mode,
    stopReason: null,
  };
}

async function waitForThermalWindow(
  mode: ThermalMode,
  row: FolderStatusRow,
  thermalEvents: ThermalEvent[],
): Promise<{
  mode: ThermalMode;
  stopReason: string | null;
}> {
  let currentMode = mode;

  for (;;) {
    const snapshot = await readThermalSnapshot();

    row.thermalStatus = snapshot.thermalStatus;
    row.batteryTemperatureC = snapshot.batteryTemperatureC;

    const decision = decideThermalAction(snapshot, currentMode);

    if (decision.action === "continue") {
      if (decision.reason) {
        thermalEvents.push({
          batteryTemperatureC: snapshot.batteryTemperatureC,
          label: "thermal-check",
          reason: decision.reason,
          thermalStatus: snapshot.thermalStatus,
        });
      }

      return {
        mode: decision.mode,
        stopReason: null,
      };
    }

    if (decision.action === "stop") {
      thermalEvents.push({
        batteryTemperatureC: snapshot.batteryTemperatureC,
        label: "thermal-stop",
        reason: decision.reason,
        thermalStatus: snapshot.thermalStatus,
      });

      return {
        mode: decision.mode,
        stopReason: decision.reason,
      };
    }

    thermalEvents.push({
      batteryTemperatureC: snapshot.batteryTemperatureC,
      label: "thermal-cooldown",
      reason: decision.reason,
      thermalStatus: snapshot.thermalStatus,
    });
    currentMode = decision.mode;
    await sleep(decision.cooldownSeconds * 1000);
  }
}

async function ensurePhoneStorage(minFreeKilobytes: number): Promise<void> {
  const freeKilobytes = await readPhoneFreeKilobytes();

  if (freeKilobytes !== null && freeKilobytes >= minFreeKilobytes) {
    return;
  }

  await adbCleanupManagedMedia();
}

async function pushTrackToPhone(prepared: PreparedTrack): Promise<void> {
  try {
    await adbRemove([prepared.phonePath]);
    await adbPush(prepared.analysisPath, prepared.phonePath);
  } catch (error) {
    await adbCleanupManagedMedia();
    await adbPush(prepared.analysisPath, prepared.phonePath).catch(() => {
      throw error;
    });
  }
}

async function runSingleTrackThroughPhone(
  database: DatabaseSync,
  input: {
    folderSlug: string;
    kitGuard: KitBatchGuard;
    options: RequiredImportOptions;
    prepared: PreparedTrack;
    runRoot: string;
  },
): Promise<{
  note: string;
  status: "failed" | "ok";
}> {
  await input.kitGuard.writeSingleTrack(input.prepared.phonePath);

  const scriptPath = join(input.options.chordAiKitRoot, "scripts", "run_batch_chordai.py");
  const command = await runCommand(
    "python3",
    [
      scriptPath,
      "--limit",
      "1",
      "--success-pause",
      "0",
      "--failure-pause",
      "0",
      "--analysis-timeout",
      String(input.options.analysisTimeoutSeconds),
      "--max-consecutive-failures",
      "99",
    ],
    {
      check: false,
      cwd: input.options.chordAiKitRoot,
      timeoutMs: (input.options.analysisTimeoutSeconds + 600) * 1000,
    },
  );

  const stateRows = parseCsv(await readFile(input.kitGuard.statePath, "utf8"));
  const stateRow = stateRows.find((row) => row.track_path?.trim() === input.prepared.phonePath);
  const workRoot = join(input.runRoot, "tracks", input.prepared.trackId);

  await mkdir(workRoot, {
    recursive: true,
  });

  const manifestPath = join(workRoot, "manifest.csv");
  const statePath = join(workRoot, "batch_state.csv");

  await writeFile(
    manifestPath,
    [
      "playlist_position,track_id,title,artist,local_audio_path,phone_path",
      [
        "1",
        input.prepared.trackId,
        csvValue(input.prepared.canonical.title),
        csvValue(input.prepared.canonical.artist),
        csvValue(input.prepared.analysisPath),
        csvValue(input.prepared.phonePath),
      ].join(","),
    ].join("\n"),
    "utf8",
  );
  await writeFile(statePath, await readFile(input.kitGuard.statePath, "utf8"), "utf8");

  if (!stateRow) {
    return {
      note: `Missing batch state row. ${compactCommandOutput(command)}`,
      status: "failed",
    };
  }

  if (stateRow.status?.trim() !== "extracted") {
    const reason = [stateRow.error, compactCommandOutput(command)].filter(Boolean).join(" | ");

    return {
      note: reason || `Batch state is ${stateRow.status ?? "empty"}`,
      status: "failed",
    };
  }

  const result = await importChordAiChordsOnlyIntoDatabase(database, {
    databasePath: input.options.databasePath,
    manifestPath,
    statePath,
  });

  if (result.errors.length > 0) {
    return {
      note: result.errors.map((error) => error.error).join("; "),
      status: "failed",
    };
  }

  if (result.importedCount === 0) {
    const skipReason = result.skipped[0]?.reason ?? "ChordAI import produced no updates";

    return {
      note: skipReason,
      status: "failed",
    };
  }

  await adbRemove([stateRow.exported_phone_path?.trim() ?? ""]);

  return {
    note: stateRow.local_report_dir?.trim()
      ? `Imported from ${stateRow.local_report_dir.trim()}`
      : "Imported from ChordAI report",
    status: "ok",
  };
}

async function readThermalSnapshot(): Promise<ThermalSnapshot> {
  const [thermalOutput, batteryOutput] = await Promise.all([
    adbShell(["dumpsys", "thermalservice"], {
      check: false,
      timeoutMs: 30_000,
    }),
    adbShell(["dumpsys", "battery"], {
      check: false,
      timeoutMs: 30_000,
    }),
  ]);

  return {
    batteryTemperatureC: parseBatteryTemperatureC(batteryOutput),
    thermalStatus: parseThermalStatus(thermalOutput),
  };
}

function readExistingTracks(database: DatabaseSync): ExistingTrackIndex {
  return {
    entries: (
      database
        .prepare(
          `
            SELECT
              tracks.id,
              tracks.title,
              tracks.artist,
              tracks.audio_path AS audioPath,
              tracks.bpm,
              tracks.key_unknown AS keyUnknown,
              tracks.source_kind AS sourceKind,
              tracks.source_identity AS sourceIdentity,
              EXISTS (
                SELECT 1
                FROM track_chords
                WHERE track_chords.track_id = tracks.id
              ) AS hasChords
            FROM tracks
          `,
        )
        .all() as unknown as ExistingTrackSummary[]
    ).map((row) => ({
      artist: row.artist,
      audioPath: row.audioPath ?? null,
      bpm: row.bpm ?? null,
      hasChords: Boolean(row.hasChords),
      id: row.id,
      keyUnknown: row.keyUnknown ?? 0,
      sourceIdentity: row.sourceIdentity,
      sourceKind: row.sourceKind,
      title: row.title,
    })),
  };
}

function indexTrack(index: ExistingTrackIndex, track: ExistingTrackSummary): void {
  index.entries.push(track);
}

function insertImportedTrack(database: DatabaseSync, match: CanonicalStreamingMatch): string {
  const trackId = `trk-${match.sourceKind}-${createHash("sha256")
    .update(`${match.sourceKind}|${match.sourceIdentity}`)
    .digest("hex")
    .slice(0, 12)}`;

  try {
    database
      .prepare(
        `
          INSERT INTO tracks (
            id,
            title,
            artist,
            bpm,
            tonic,
            mode,
            modal_variant,
            key_confidence,
            bpm_confidence,
            chords_confidence,
            raw_key,
            source_kind,
            source_identity,
            imported_at,
            key_unknown
          ) VALUES (?, ?, ?, NULL, 'C', 'major', 'diatonic', 'estimated', 'estimated', 'estimated', NULL, ?, ?, datetime('now'), 1)
        `,
      )
      .run(trackId, match.title, match.artist, match.sourceKind, match.sourceIdentity);
  } catch (error) {
    const existing = database
      .prepare(
        `
          SELECT id
          FROM tracks
          WHERE source_kind = ? AND source_identity = ?
        `,
      )
      .get(match.sourceKind, match.sourceIdentity) as { id: string } | undefined;

    if (existing?.id) {
      return existing.id;
    }

    throw error;
  }

  return trackId;
}

function buildLocalFallbackMatch(
  parsed: ReturnType<typeof parseFlashFileName>,
  remotePath: string,
  reason: string,
): ResolvedSearchMatch | null {
  const title = (parsed.titleHint ?? parsed.cleanedStem ?? parsed.fileName).trim();

  if (!title) {
    return null;
  }

  const artist = parsed.artistHints.length > 0 ? parsed.artistHints.join("; ") : "Unknown Artist";
  const remoteHash = createHash("sha256").update(remotePath).digest("hex").slice(0, 24);
  const candidate: RetrieverCandidate = {
    artists: artist === "Unknown Artist" ? [] : parsed.artistHints,
    durationMs: null,
    id: `windows-flash-${remoteHash}`,
    lossless: false,
    matchPercent: null,
    raw: {
      reason,
      remotePath,
    },
    source: "yandex",
    title,
    url: "",
  };

  return {
    artist,
    candidate,
    score: {
      artistScore: parsed.artistHints.length > 0 ? 1 : 0,
      confidence: 0,
      queryScore: 0,
      structured: parsed.artistHints.length > 0,
      titleScore: 1,
      versionScore: 1,
    },
    sourceIdentity: `remote:${remoteHash}`,
    sourceKind: "windows-flash",
    title,
    trackContext: null,
  };
}

async function updateTrackAudioPath(
  database: DatabaseSync,
  trackId: string,
  audioPath: string,
): Promise<void> {
  database
    .prepare(
      `
        UPDATE tracks
        SET
          audio_path = ?,
          audio_codec = NULL,
          audio_container = NULL,
          audio_sample_rate_hz = NULL,
          audio_bit_depth = NULL,
          audio_bitrate_kbps = NULL,
          audio_bitrate_mode = 'unknown',
          audio_quality_status = 'unknown',
          audio_lossy_high_bitrate = 0,
          audio_quality_analyzed_at = NULL,
          audio_quality_probe_error = NULL,
          updated_at = datetime('now')
        WHERE id = ?
      `,
    )
    .run(audioPath, trackId);

  const quality = await analyzeAudioQuality(audioPath);

  writeTrackAudioQuality(database, trackId, quality);
}

function countStatuses(rows: readonly FolderStatusRow[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const row of rows) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  return counts;
}

async function writeFolderReport(
  csvPath: string,
  markdownPath: string,
  folder: string,
  rows: readonly FolderStatusRow[],
  thermalEvents: readonly ThermalEvent[],
  remainingRemotePaths: readonly string[],
): Promise<void> {
  await mkdir(dirname(csvPath), {
    recursive: true,
  }).catch(() => undefined);
  await writeFile(csvPath, renderFolderCsv(rows), "utf8");
  await writeFile(
    markdownPath,
    renderFolderMarkdown(folder, rows, thermalEvents, remainingRemotePaths),
    "utf8",
  );
}

async function writeRunSummary(
  summaryPath: string,
  folderResults: readonly FolderImportResult[],
  stoppedReason: string | null,
): Promise<void> {
  await mkdir(dirname(summaryPath), {
    recursive: true,
  }).catch(() => undefined);
  const lines = ["# Windows Flash Import", ""];

  if (stoppedReason) {
    lines.push(`Stopped: ${stoppedReason}`, "");
  }

  for (const folderResult of folderResults) {
    lines.push(`## ${folderResult.folder}`, "");
    lines.push(
      Object.entries(folderResult.counts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([status, count]) => `- ${status}: ${count}`)
        .join("\n") || "- no rows yet",
    );
    lines.push("");
    lines.push(`- CSV: ${folderResult.reportCsvPath}`);
    lines.push(`- Markdown: ${folderResult.reportMarkdownPath}`);

    if (folderResult.stopReason) {
      lines.push(`- stop: ${folderResult.stopReason}`);
    }

    if (folderResult.remainingRemotePaths.length > 0) {
      lines.push(`- remaining: ${folderResult.remainingRemotePaths.length}`);
    }

    lines.push("");
  }

  await writeFile(summaryPath, lines.join("\n"), "utf8");
}

function renderFolderCsv(rows: readonly FolderStatusRow[]): string {
  return [
    [
      "status",
      "remote_path",
      "file_name",
      "query",
      "canonical_artist",
      "canonical_title",
      "source_kind",
      "source_identity",
      "track_id",
      "analysis_source",
      "audio_path",
      "lucida_url",
      "thermal_status",
      "battery_temperature_c",
      "note",
    ].join(","),
    ...rows.map((row) =>
      [
        row.status,
        row.remotePath,
        row.fileName,
        row.query,
        row.canonicalArtist ?? "",
        row.canonicalTitle ?? "",
        row.sourceKind ?? "",
        row.sourceIdentity ?? "",
        row.trackId ?? "",
        row.analysisSource ?? "",
        row.audioPath ?? "",
        row.lucidaUrl ?? "",
        row.thermalStatus === null ? "" : String(row.thermalStatus),
        row.batteryTemperatureC === null ? "" : row.batteryTemperatureC.toFixed(1),
        row.note,
      ]
        .map(csvValue)
        .join(","),
    ),
  ].join("\n");
}

function renderFolderMarkdown(
  folder: string,
  rows: readonly FolderStatusRow[],
  thermalEvents: readonly ThermalEvent[],
  remainingRemotePaths: readonly string[],
): string {
  const counts = countStatuses(rows);
  const lines = [`# ${folder}`, ""];

  lines.push("## Counts", "");

  if (rows.length === 0) {
    lines.push("- No tracks processed yet", "");
  } else {
    for (const [status, count] of Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      lines.push(`- ${status}: ${count}`);
    }

    lines.push("");
  }

  if (thermalEvents.length > 0) {
    lines.push("## Thermal", "");

    for (const event of thermalEvents) {
      lines.push(
        `- ${event.label}: ${event.reason} (status ${event.thermalStatus ?? "n/a"}, battery ${
          event.batteryTemperatureC === null ? "n/a" : `${event.batteryTemperatureC.toFixed(1)}C`
        })`,
      );
    }

    lines.push("");
  }

  const manual = rows.filter((row) => row.status === "manual-review");

  if (manual.length > 0) {
    lines.push("## Manual Review", "", "| File | Query | Lucida | Note |", "|---|---|---|---|");

    for (const row of manual) {
      lines.push(
        `| ${escapeMarkdown(row.fileName)} | ${escapeMarkdown(row.query)} | ${
          row.lucidaUrl ? `[link](${row.lucidaUrl})` : ""
        } | ${escapeMarkdown(row.note)} |`,
      );
    }

    lines.push("");
  }

  const blocked = rows.filter((row) => row.status.startsWith("blocked"));

  if (blocked.length > 0) {
    lines.push("## Blocked", "", "| File | Status | Note |", "|---|---|---|");

    for (const row of blocked) {
      lines.push(
        `| ${escapeMarkdown(row.fileName)} | ${row.status} | ${escapeMarkdown(row.note)} |`,
      );
    }

    lines.push("");
  }

  if (remainingRemotePaths.length > 0) {
    lines.push("## Remaining Queue", "");

    for (const remotePath of remainingRemotePaths) {
      lines.push(`- ${remotePath}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

function compactCommandOutput(command: { stderr: string; stdout: string }): string {
  return [command.stdout.trim(), command.stderr.trim()].filter(Boolean).join(" | ").slice(0, 600);
}

function chooseBetterMatch(
  current: ResolvedSearchMatch | null,
  candidate: ResolvedSearchMatch | null,
): ResolvedSearchMatch | null {
  if (!candidate) {
    return current;
  }

  if (!current) {
    return candidate;
  }

  return compareMatches(candidate, current) < 0 ? candidate : current;
}

function buildPhonePath(
  phoneBatchRoot: string,
  folderSlug: string,
  match: CanonicalStreamingMatch,
  localPath: string,
): string {
  const extension = extname(localPath) || ".mp3";
  const fileName = sanitizeFileName(`${match.artist} - ${match.title}${extension}`);

  return `${phoneBatchRoot}/${folderSlug}/${fileName}`;
}

function csvValue(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[|]/g, "\\|");
}

function normalizeOptions(options: WindowsFlashImportOptions): RequiredImportOptions {
  return {
    analysisTimeoutSeconds: options.analysisTimeoutSeconds ?? 900,
    audioUploadDir: resolve(options.audioUploadDir),
    batchPauseSeconds: options.batchPauseSeconds ?? defaultBatchPauseSeconds,
    batchSize: options.batchSize ?? defaultBatchSize,
    chordAiKitRoot: resolve(options.chordAiKitRoot),
    databasePath: resolve(options.databasePath),
    djToolRoot: resolve(options.djToolRoot),
    folders: [...(options.folders ?? defaultWindowsFlashFolders)],
    folderStartIndexes: normalizeFolderStartIndexes(options.folderStartIndexes),
    hqMode: options.hqMode ?? "download",
    localFallback: options.localFallback ?? false,
    matchQueryLimit: Math.max(1, Math.floor(options.matchQueryLimit ?? 3)),
    maxFiles: options.maxFiles ?? Number.MAX_SAFE_INTEGER,
    onlyRemotePaths:
      options.onlyRemotePaths === undefined
        ? null
        : new Set(options.onlyRemotePaths.filter(Boolean)),
    perTrackPauseSeconds: options.perTrackPauseSeconds ?? defaultPerTrackPauseSeconds,
    phoneBatchRoot: options.phoneBatchRoot ?? defaultPhoneBatchRoot,
    phoneMinFreeKilobytes: options.phoneMinFreeKilobytes ?? defaultPhoneMinFreeKilobytes,
    singleTrackPauseSeconds: options.singleTrackPauseSeconds ?? defaultSingleTrackPauseSeconds,
    startIndex: Math.max(0, options.startIndex ?? 0),
    stagingRoot: resolve(options.stagingRoot),
    windowsHost: options.windowsHost,
    spotifyMode: options.spotifyMode ?? "auto",
  };
}

type RequiredImportOptions = {
  analysisTimeoutSeconds: number;
  audioUploadDir: string;
  batchPauseSeconds: number;
  batchSize: number;
  chordAiKitRoot: string;
  databasePath: string;
  djToolRoot: string;
  folders: string[];
  folderStartIndexes: Record<string, number>;
  hqMode: HqMode;
  localFallback: boolean;
  matchQueryLimit: number;
  maxFiles: number;
  onlyRemotePaths: Set<string> | null;
  perTrackPauseSeconds: number;
  phoneBatchRoot: string;
  phoneMinFreeKilobytes: number;
  singleTrackPauseSeconds: number;
  startIndex: number;
  stagingRoot: string;
  windowsHost: string;
  spotifyMode: SpotifyMode;
};

function normalizeFolderStartIndexes(
  value: Readonly<Record<string, number>> | undefined,
): Record<string, number> {
  const normalized: Record<string, number> = {};

  for (const [folder, index] of Object.entries(value ?? {})) {
    if (!folder) {
      continue;
    }

    normalized[folder] = Math.max(0, Math.floor(index));
  }

  return normalized;
}

async function createRunRoot(stagingRoot: string): Promise<string> {
  const runRoot = join(stagingRoot, `run-${new Date().toISOString().replace(/[:]/g, "-")}`);

  await mkdir(join(runRoot, "folders"), {
    recursive: true,
  });

  return runRoot;
}

async function recordThermalEvent(
  thermalEvents: ThermalEvent[],
  label: string,
  reason: string,
): Promise<void> {
  const snapshot = await readThermalSnapshot().catch(() => ({
    batteryTemperatureC: null,
    thermalStatus: null,
  }));

  thermalEvents.push({
    batteryTemperatureC: snapshot.batteryTemperatureC,
    label,
    reason,
    thermalStatus: snapshot.thermalStatus,
  });
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function collectAudioFiles(directory: string, target: AudioFileCandidate[]): Promise<void> {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      await collectAudioFiles(path, target).catch(() => undefined);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = extname(entry.name).toLocaleLowerCase();

    if (!supportedAudioExtensions.has(extension)) {
      continue;
    }

    target.push({
      audioPath: path,
      extensionRank: getExtensionRank(extension),
      normalizedName: normalizeAudioLookupText(basename(entry.name, extension)),
    });
  }
}

function scoreAudioCandidate(
  candidate: AudioFileCandidate,
  query: {
    fullKeys: readonly string[];
    titleKey: string;
    titleTokenCount: number;
  },
): number {
  let best = 0;

  for (const key of query.fullKeys) {
    if (!key) {
      continue;
    }

    if (candidate.normalizedName === key) {
      best = Math.max(best, 140 - candidate.extensionRank);
      continue;
    }

    if (candidate.normalizedName.endsWith(` ${key}`)) {
      best = Math.max(best, 115 - candidate.extensionRank);
    }
  }

  if (!query.titleKey) {
    return best;
  }

  const safeTitleOnly = query.titleTokenCount >= 2 || query.titleKey.length >= 10;

  if (safeTitleOnly && candidate.normalizedName === query.titleKey) {
    best = Math.max(best, 95 - candidate.extensionRank);
  }

  if (
    safeTitleOnly &&
    query.titleTokenCount >= 3 &&
    candidate.normalizedName.endsWith(` ${query.titleKey}`)
  ) {
    best = Math.max(best, 70 - candidate.extensionRank);
  }

  return best;
}

function countAudioLookupTokens(value: string): number {
  return value.split(/\s+/u).filter(Boolean).length;
}

function getExtensionRank(extension: string): number {
  const index = preferredAudioExtensions.indexOf(extension);

  return index === -1 ? preferredAudioExtensions.length : index;
}

function sanitizeFileName(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugifyFolder(folder: string): string {
  return folder
    .replace(/^\/[A-Za-z]:\//, "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLocaleLowerCase();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
