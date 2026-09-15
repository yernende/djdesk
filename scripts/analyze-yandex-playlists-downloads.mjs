#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

import { readServerConfig } from "../apps/server/src/config.ts";
import { openDatabase } from "../apps/server/src/db/database.ts";
import { runMigrations } from "../apps/server/src/db/migrations.ts";
import { analyzeAudioQuality } from "../apps/server/src/audio/quality.ts";
import { writeTrackAudioQuality } from "../apps/server/src/audio/quality-backfill.ts";
import { importChordAiChordsOnlyIntoDatabase } from "../apps/server/src/importers/chordai/chords-only.ts";
import { parseCsv } from "../apps/server/src/importers/chordai/csv.ts";
import {
  adbCleanupChordAiExports,
  adbCleanupManagedMedia,
  adbPush,
  adbRemove,
  readPhoneFreeKilobytes,
  runCommand,
} from "../apps/server/src/importers/windows-flash/shell.ts";

const downloadableStatuses = new Set(["downloaded-hq", "downloaded-lossy"]);
const stateCsvHeader =
  "track_path,status,attempts,started_at,finished_at,exported_phone_path,local_report_dir,error,next_action";

const args = parseArgs(process.argv.slice(2));
const serverConfig = readServerConfig();
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runRoot = join(serverConfig.windowsFlashStagingDir, `yandex-playlists-analysis-${runId}`);
const reportCsvPath = join(runRoot, "analysis-report.csv");
const reportMarkdownPath = join(runRoot, "analysis-report.md");
const phoneRoot = `${args.phoneRoot.replace(/\/+$/u, "")}/${runId}`;

await mkdir(runRoot, { recursive: true });

const manifestPath = await resolveManifestPath(args.manifestPath);
const manifestRows = await readDownloadManifest(manifestPath);
const downloadRows = manifestRows.filter(
  (row) => downloadableStatuses.has(row.status) && row.audioPath,
);

if (downloadRows.length === 0) {
  throw new Error(`No downloaded rows found in manifest: ${manifestPath}`);
}

const database = await openDatabase(serverConfig.databasePath);
let batchExitCode = 0;
let phonePaths = [];

try {
  await runMigrations(database);

  const importRows = [];

  console.log(`[yandex-analysis] manifest: ${manifestPath}`);
  console.log(`[yandex-analysis] downloaded tracks: ${downloadRows.length}`);

  for (const row of downloadRows) {
    const importRow = await upsertTrackAudio(database, row);
    importRows.push(importRow);
  }

  const analysisRows = importRows
    .filter((row) => row.needsAnalysis)
    .slice(0, args.maxTracks ?? undefined);

  await writeReports(importRows, [], null, "prepared");

  if (analysisRows.length === 0) {
    console.log("[yandex-analysis] all downloaded tracks already have BPM/key/chords");
    await writeReports(importRows, [], null, "complete");
    process.exitCode = 0;
  } else {
    console.log(`[yandex-analysis] ChordAI analysis candidates: ${analysisRows.length}`);
    await ensurePhoneReady();
    await ensurePhoneStorage(analysisRows);
    await adbCleanupChordAiExports();

    const batch = await prepareChordAiBatch(analysisRows);
    phonePaths = batch.phonePaths;

    for (let index = 0; index < batch.items.length; index += 1) {
      const item = batch.items[index];
      console.log(
        `[yandex-analysis] push ${index + 1}/${batch.items.length}: ${item.row.artist} - ${item.row.displayTitle}`,
      );
      await adbRemove([item.phonePath]);
      await adbPush(item.row.audioPath, item.phonePath);
    }

    console.log("[yandex-analysis] starting ChordAI batch");
    batchExitCode = await runChordAiBatch(batch.items.length);

    const stateText = await readFile(batch.kitStatePath, "utf8");
    await writeFile(batch.statePath, stateText, "utf8");

    const stateRows = parseCsv(stateText);
    const result = await importChordAiChordsOnlyIntoDatabase(database, {
      databasePath: serverConfig.databasePath,
      manifestPath: batch.manifestPath,
      statePath: batch.statePath,
    });

    await writeReports(importRows, stateRows, result, batchExitCode === 0 ? "complete" : "partial");
    await printVerification(database, analysisRows);

    if (batchExitCode !== 0) {
      console.warn(`[yandex-analysis] ChordAI batch exited with code ${batchExitCode}`);
      process.exitCode = batchExitCode;
    }
  }
} finally {
  if (phonePaths.length > 0) {
    await adbRemove(phonePaths).catch(() => undefined);
  }
  await adbCleanupChordAiExports().catch(() => undefined);
  await runCommand("adb", ["shell", "am", "force-stop", "com.chordai"], {
    check: false,
    timeoutMs: 30_000,
  }).catch(() => undefined);
  await runCommand("adb", ["shell", "am", "force-stop", "dev.codex.chordexportreceiver"], {
    check: false,
    timeoutMs: 30_000,
  }).catch(() => undefined);
  database.close();
}

async function resolveManifestPath(explicitPath) {
  if (explicitPath) {
    return resolve(explicitPath);
  }

  const entries = await readdir(serverConfig.windowsFlashStagingDir, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("yandex-playlists-")) {
      continue;
    }

    const candidate = join(
      serverConfig.windowsFlashStagingDir,
      entry.name,
      "download-manifest.csv",
    );

    if (!existsSync(candidate)) {
      continue;
    }

    const info = await stat(candidate);
    candidates.push({ mtimeMs: info.mtimeMs, path: candidate });
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);

  if (!candidates[0]) {
    throw new Error(
      `No yandex-playlists-*/download-manifest.csv found in ${serverConfig.windowsFlashStagingDir}`,
    );
  }

  return candidates[0].path;
}

async function readDownloadManifest(path) {
  const rows = parseCsv(await readFile(path, "utf8"));

  return rows.map((row, index) => {
    const title = requiredString(row.title, "title", index);
    const version = row.version?.trim() ?? "";

    return {
      albumId: row.album_id?.trim() ?? "",
      artist: requiredString(row.artist, "artist", index),
      audioPath: row.audio_path?.trim() ?? "",
      displayTitle: version ? `${title} (${version})` : title,
      downloadQuality: row.download_quality?.trim() ?? "",
      downloadSource: row.download_source?.trim() ?? "",
      note: row.note?.trim() ?? "",
      playlistPosition: toInteger(row.playlist_position, index, "playlist_position"),
      playlistTitle: row.playlist_title?.trim() ?? "",
      playlistUuid: row.playlist_uuid?.trim() ?? "",
      position: toInteger(row.position, index, "position"),
      sourceKind: row.source_kind?.trim() || "yandex",
      sourceIdentity: requiredString(row.source_identity, "source_identity", index),
      status: requiredString(row.status, "status", index),
      title,
      trackId: requiredString(row.track_id, "track_id", index),
      version,
      yandexTrackId: row.yandex_track_id?.trim() ?? "",
      yandexUrl: row.yandex_url?.trim() ?? "",
    };
  });
}

async function upsertTrackAudio(database, row) {
  if (!existsSync(row.audioPath)) {
    throw new Error(`Audio file is missing for ${row.trackId}: ${row.audioPath}`);
  }

  const sourceTrack = readTrackBySource(database, row.sourceKind, row.sourceIdentity);
  const existingTrack = readTrack(database, sourceTrack?.id ?? row.trackId);

  if (!existingTrack) {
    insertTrack(database, row);
  }

  const trackId = existingTrack?.id ?? row.trackId;
  const afterInsert = existingTrack ?? readTrack(database, trackId);

  if (!afterInsert) {
    throw new Error(`Could not create track ${trackId}`);
  }

  if (afterInsert.audio_path !== row.audioPath || !afterInsert.audio_quality_analyzed_at) {
    await updateTrackAudioPath(database, trackId, row.audioPath);
  }

  const state = readAnalysisState(database, trackId);
  const needsAnalysis =
    !state || state.chordCount === 0 || state.bpm === null || state.key_unknown === 1;

  return {
    ...row,
    action: existingTrack ? "updated-existing-track" : "inserted-track",
    dbTrackId: trackId,
    needsAnalysis,
  };
}

function readTrack(database, trackId) {
  return database
    .prepare(
      `
        SELECT id, audio_path, audio_quality_analyzed_at
        FROM tracks
        WHERE id = ?
      `,
    )
    .get(trackId);
}

function readTrackBySource(database, sourceKind, sourceIdentity) {
  return database
    .prepare(
      `
        SELECT id
        FROM tracks
        WHERE source_kind = ?
          AND source_identity = ?
      `,
    )
    .get(sourceKind, sourceIdentity);
}

function readAnalysisState(database, trackId) {
  return database
    .prepare(
      `
        SELECT
          tracks.bpm,
          tracks.key_unknown,
          (
            SELECT COUNT(*)
            FROM track_chords
            WHERE track_chords.track_id = tracks.id
          ) AS chordCount
        FROM tracks
        WHERE tracks.id = ?
      `,
    )
    .get(trackId);
}

function insertTrack(database, row) {
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
          duration_seconds,
          source_kind,
          source_identity,
          imported_at,
          key_unknown,
          comment
        ) VALUES (?, ?, ?, NULL, 'C', 'major', 'diatonic', 'estimated', 'estimated', 'estimated', NULL, NULL, ?, ?, datetime('now'), 1, ?)
      `,
    )
    .run(
      row.trackId,
      row.displayTitle,
      row.artist,
      row.sourceKind,
      row.sourceIdentity,
      makeComment(row),
    );
}

function makeComment(row) {
  return [
    `Yandex playlist import ${runId}`,
    row.playlistTitle ? `playlist "${row.playlistTitle}"` : "",
    row.playlistUuid ? `uuid ${row.playlistUuid}` : "",
    row.playlistPosition ? `position ${row.playlistPosition}` : "",
    row.yandexUrl ? `Yandex: ${row.yandexUrl}` : "",
    row.sourceKind ? `source ${row.sourceKind}:${row.sourceIdentity}` : "",
    row.downloadQuality ? `download quality ${row.downloadQuality}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

async function updateTrackAudioPath(database, trackId, audioPath) {
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

  writeTrackAudioQuality(database, trackId, await analyzeAudioQuality(audioPath));
}

async function ensurePhoneReady() {
  const state = await runCommand("adb", ["get-state"], { check: false, timeoutMs: 30_000 });

  if (!state.stdout.includes("device")) {
    throw new Error(`ADB is not ready: ${state.stdout.trim() || state.stderr.trim()}`);
  }

  await runCommand("adb", ["shell", "settings", "put", "global", "stay_on_while_plugged_in", "7"], {
    check: false,
    timeoutMs: 30_000,
  });

  const [thermal, battery, windowState] = await Promise.all([
    runCommand("adb", ["shell", "dumpsys", "thermalservice"], {
      check: false,
      timeoutMs: 30_000,
    }),
    runCommand("adb", ["shell", "dumpsys", "battery"], {
      check: false,
      timeoutMs: 30_000,
    }),
    runCommand("adb", ["shell", "dumpsys", "window"], {
      check: false,
      timeoutMs: 30_000,
    }),
  ]);

  if (
    /mDreamingLockscreen=true|mShowingLockscreen=true|isStatusBarKeyguard=true/i.test(
      windowState.stdout,
    )
  ) {
    throw new Error("Phone appears to be locked");
  }

  const thermalStatus = Number.parseInt(
    thermal.stdout.match(/Thermal Status:\s*(\d+)/)?.[1] ?? "0",
    10,
  );
  const batteryTempTenths = Number.parseInt(
    battery.stdout.match(/temperature:\s*(\d+)/)?.[1] ?? "0",
    10,
  );

  console.log(
    `[yandex-analysis] ADB ok, thermal ${thermalStatus}, battery ${batteryTempTenths ? `${(batteryTempTenths / 10).toFixed(1)}C` : "unknown"}`,
  );

  if (thermalStatus <= 1) {
    return;
  }

  console.warn(`[yandex-analysis] phone is warm (thermal ${thermalStatus}), cooling down`);
  await sleep(120_000);
  await ensurePhoneReady();
}

async function ensurePhoneStorage(rows) {
  const freeKilobytes = await readPhoneFreeKilobytes();

  if (freeKilobytes === null) {
    return;
  }

  const requiredKilobytes = Math.max(2_000_000, Math.ceil(totalAudioBytes(rows) / 1024) * 2);

  if (freeKilobytes >= requiredKilobytes) {
    return;
  }

  console.log(
    `[yandex-analysis] phone free space ${freeKilobytes}KB, cleaning old managed media before push`,
  );
  await adbCleanupManagedMedia();
}

function totalAudioBytes(rows) {
  return rows.reduce((sum, row) => {
    try {
      return sum + statSync(row.audioPath).size;
    } catch {
      return sum;
    }
  }, 0);
}

async function prepareChordAiBatch(rows) {
  const kitBatchDir = join(serverConfig.chordAiKitRoot, "batch");
  const kitInputPath = join(kitBatchDir, "input_tracks.txt");
  const kitStatePath = join(kitBatchDir, "batch_state.csv");
  const manifestPath = join(runRoot, "manifest.csv");
  const statePath = join(runRoot, "batch_state.csv");
  const items = rows.map((row, index) => {
    const phonePath = `${phoneRoot}/${asciiFileName(`${String(index + 1).padStart(3, "0")} ${row.artist} - ${row.displayTitle} ${row.dbTrackId}${extname(row.audioPath) || ".mp3"}`)}`;

    return { phonePath, row };
  });

  await mkdir(kitBatchDir, { recursive: true });
  await mkdir(dirname(manifestPath), { recursive: true });

  await writeFile(kitInputPath, `${items.map((item) => item.phonePath).join("\n")}\n`, "utf8");
  await writeFile(
    kitStatePath,
    [
      stateCsvHeader,
      ...items.map((item) => `${csvValue(item.phonePath)},pending,0,,,,,,queue`),
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    manifestPath,
    [
      "playlist_position,track_id,title,artist,local_audio_path,phone_path",
      ...items.map((item, index) =>
        [
          index + 1,
          csvValue(item.row.dbTrackId),
          csvValue(item.row.displayTitle),
          csvValue(item.row.artist),
          csvValue(item.row.audioPath),
          csvValue(item.phonePath),
        ].join(","),
      ),
    ].join("\n"),
    "utf8",
  );

  return {
    items,
    kitInputPath,
    kitStatePath,
    manifestPath,
    phonePaths: items.map((item) => item.phonePath),
    statePath,
  };
}

async function runChordAiBatch(trackCount) {
  const scriptPath = join(serverConfig.chordAiKitRoot, "scripts", "run_batch_chordai.py");
  const timeoutMs = (args.analysisTimeoutSeconds + 480) * Math.max(1, trackCount) * 1000;

  return await runStreamingCommand(
    "python3",
    [
      scriptPath,
      "--success-pause",
      String(args.successPauseSeconds),
      "--failure-pause",
      String(args.failurePauseSeconds),
      "--analysis-timeout",
      String(args.analysisTimeoutSeconds),
      "--max-consecutive-failures",
      String(args.maxConsecutiveFailures),
    ],
    {
      cwd: serverConfig.chordAiKitRoot,
      timeoutMs,
    },
  );
}

async function runStreamingCommand(command, commandArgs, options) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd,
      env: process.env,
      stdio: "inherit",
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`Command timed out: ${command} ${commandArgs.join(" ")}`));
    }, options.timeoutMs);

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolvePromise(code ?? 1);
    });
  });
}

async function writeReports(rows, stateRows, importResult, phase) {
  const stateByPhonePath = new Map(stateRows.map((row) => [row.track_path, row]));
  const verification = rows.map((row) => {
    const db = readVerification(database, row.dbTrackId);
    const state = [...stateByPhonePath.values()].find((stateRow) =>
      String(stateRow.track_path ?? "").includes(row.dbTrackId),
    );

    return {
      ...row,
      batchStatus: state?.status ?? (row.needsAnalysis ? "" : "skipped-already-analyzed"),
      bpm: db?.bpm ?? null,
      chordCount: db?.chordCount ?? 0,
      keyUnknown: db?.key_unknown ?? null,
      mode: db?.mode ?? "",
      quality: db?.audio_quality_status ?? "",
      tonic: db?.tonic ?? "",
    };
  });

  await writeFile(reportCsvPath, renderCsv(verification), "utf8");
  await writeFile(reportMarkdownPath, renderMarkdown(verification, importResult, phase), "utf8");
}

function readVerification(database, trackId) {
  return database
    .prepare(
      `
        SELECT
          tracks.bpm,
          tracks.tonic,
          tracks.mode,
          tracks.key_unknown,
          tracks.audio_quality_status,
          (
            SELECT COUNT(*)
            FROM track_chords
            WHERE track_chords.track_id = tracks.id
          ) AS chordCount
        FROM tracks
        WHERE tracks.id = ?
      `,
    )
    .get(trackId);
}

function renderCsv(rows) {
  return [
    [
      "position",
      "status",
      "track_id",
      "artist",
      "title",
      "download_quality",
      "audio_quality_status",
      "needs_analysis",
      "batch_status",
      "bpm",
      "tonic",
      "mode",
      "key_unknown",
      "chord_count",
      "audio_path",
    ].join(","),
    ...rows.map((row) =>
      [
        row.position,
        csvValue(row.status),
        csvValue(row.dbTrackId),
        csvValue(row.artist),
        csvValue(row.displayTitle),
        csvValue(row.downloadQuality),
        csvValue(row.quality),
        row.needsAnalysis ? "1" : "0",
        csvValue(row.batchStatus),
        row.bpm ?? "",
        csvValue(row.tonic),
        csvValue(row.mode),
        row.keyUnknown ?? "",
        row.chordCount ?? "",
        csvValue(row.audioPath),
      ].join(","),
    ),
  ].join("\n");
}

function renderMarkdown(rows, importResult, phase) {
  const counts = countBy(
    rows,
    (row) => row.batchStatus || (row.needsAnalysis ? "pending" : "skipped"),
  );
  const qualityCounts = countBy(rows, (row) => row.quality || "unknown");

  return [
    "# Yandex Playlist Analysis",
    "",
    `Phase: ${phase}`,
    `Manifest: ${manifestPath}`,
    `Rows: ${rows.length}`,
    importResult ? `ChordAI imported: ${importResult.importedCount}` : "",
    importResult ? `ChordAI skipped: ${importResult.skipped.length}` : "",
    importResult ? `ChordAI errors: ${importResult.errors.length}` : "",
    "",
    "## Batch Counts",
    "",
    ...Object.entries(counts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => `- ${status}: ${count}`),
    "",
    "## Audio Quality",
    "",
    ...Object.entries(qualityCounts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => `- ${status}: ${count}`),
    "",
    "## Tracks",
    "",
    "| # | Status | Track | BPM | Key | Chords | Quality |",
    "| -: | --- | --- | ---: | --- | ---: | --- |",
    ...rows.map(
      (row) =>
        `| ${row.position} | ${escapeMarkdown(row.batchStatus || "")} | ${escapeMarkdown(`${row.artist} - ${row.displayTitle}`)} | ${row.bpm ?? ""} | ${escapeMarkdown(row.keyUnknown === 0 ? `${row.tonic} ${row.mode}` : "")} | ${row.chordCount ?? 0} | ${escapeMarkdown(row.quality || "")} |`,
    ),
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

async function printVerification(database, rows) {
  const total = rows.length;
  let complete = 0;

  for (const row of rows) {
    const verified = readVerification(database, row.dbTrackId);

    if (
      verified?.bpm !== null &&
      verified?.key_unknown === 0 &&
      Number(verified?.chordCount ?? 0) > 0
    ) {
      complete += 1;
    }
  }

  console.log(`[yandex-analysis] verified complete ${complete}/${total}`);
  console.log(`[yandex-analysis] report: ${reportMarkdownPath}`);
}

function countBy(rows, fn) {
  const counts = {};

  for (const row of rows) {
    const key = fn(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

function parseArgs(argv) {
  const parsed = {
    analysisTimeoutSeconds: 900,
    failurePauseSeconds: 30,
    manifestPath: null,
    maxConsecutiveFailures: 5,
    maxTracks: null,
    phoneRoot: "/sdcard/Music/djdesk-yandex-playlists",
    successPauseSeconds: 0,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "--analysis-timeout-seconds") {
      parsed.analysisTimeoutSeconds = positiveInteger(argv[++index], arg);
      continue;
    }

    if (arg === "--failure-pause-seconds") {
      parsed.failurePauseSeconds = positiveInteger(argv[++index], arg);
      continue;
    }

    if (arg === "--manifest") {
      parsed.manifestPath = argv[++index];
      continue;
    }

    if (arg === "--max-consecutive-failures") {
      parsed.maxConsecutiveFailures = positiveInteger(argv[++index], arg);
      continue;
    }

    if (arg === "--max-tracks") {
      parsed.maxTracks = positiveInteger(argv[++index], arg);
      continue;
    }

    if (arg === "--phone-root") {
      parsed.phoneRoot = argv[++index];
      continue;
    }

    if (arg === "--success-pause-seconds") {
      parsed.successPauseSeconds = positiveInteger(argv[++index], arg);
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    parsed.manifestPath = arg;
  }

  return parsed;
}

function requiredString(value, field, rowIndex) {
  const text = String(value ?? "").trim();

  if (!text) {
    throw new Error(`Missing ${field} in manifest row ${rowIndex + 2}`);
  }

  return text;
}

function toInteger(value, rowIndex, field) {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${field} in manifest row ${rowIndex + 2}`);
  }

  return parsed;
}

function positiveInteger(value, flag) {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} expects a positive integer`);
  }

  return parsed;
}

function asciiFileName(value) {
  const extension = extname(value);
  const stem = value.slice(0, extension ? -extension.length : undefined);
  const safeStem =
    stem
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._ -]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120)
      .replace(/[ ._-]+$/g, "") || "track";
  const safeExtension =
    extension
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9.]+/g, "")
      .toLowerCase() || ".mp3";

  return `${safeStem}${safeExtension}`;
}

function csvValue(value) {
  const text = String(value ?? "");

  if (!/[",\n\r]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function escapeMarkdown(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
