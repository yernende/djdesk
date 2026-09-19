#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

const defaultPhoneRoot = "/sdcard/Music/djdesk-spotify-playlist";
const stateCsvHeader =
  "track_path,status,attempts,started_at,finished_at,exported_phone_path,local_report_dir,error,next_action";
const ytDlpStopWords = new Set([
  "audio",
  "clip",
  "hd",
  "hq",
  "lyric",
  "lyrics",
  "music",
  "official",
  "video",
  "visualizer",
  "youtube",
]);

const serverConfig = readServerConfig();
const args = parseArgs(process.argv.slice(2));
const playlistId = parseSpotifyPlaylistId(args.playlist);
const runRoot = join(
  serverConfig.windowsFlashStagingDir,
  `spotify-playlist-${playlistId}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
const downloadDir = resolve(serverConfig.audioUploadDir, `Spotify Playlist ${playlistId}`);
const reportCsvPath = join(runRoot, "report.csv");
const reportMarkdownPath = join(runRoot, "report.md");

await mkdir(runRoot, { recursive: true });
await mkdir(downloadDir, { recursive: true });

const database = await openDatabase(serverConfig.databasePath);

try {
  await runMigrations(database);

  const dj = await loadDj(serverConfig.djToolRoot, downloadDir);
  const playlist = await dj.spotify.getPlaylistTracks(playlistId, spotifyCreds(dj.config));
  const existingTracks = readExistingTracks(database);
  const rows = [];
  const seenPlaylistKeys = new Set();
  let processed = 0;

  await writeReports(rows, playlist.length);

  for (let index = 0; index < playlist.length; index += 1) {
    if (args.maxTracks !== null && processed >= args.maxTracks) {
      break;
    }

    const item = normalizePlaylistTrack(playlist[index], index + 1);
    const row = createStatusRow(item);
    rows.push(row);

    if (seenPlaylistKeys.has(item.sourceIdentity)) {
      row.status = "skipped-playlist-duplicate";
      row.note = "Duplicate source identity inside playlist";
      await writeReports(rows, playlist.length);
      continue;
    }

    seenPlaylistKeys.add(item.sourceIdentity);

    const duplicate = findExistingDuplicate(existingTracks, item);

    if (duplicate) {
      row.status = "skipped-existing";
      row.trackId = duplicate.id;
      row.audioPath = duplicate.audioPath;
      row.note = `Existing track ${duplicate.id}`;
      await writeReports(rows, playlist.length);
      continue;
    }

    if (args.dryRun) {
      row.status = "would-import";
      row.note = "Dry run";
      await writeReports(rows, playlist.length);
      continue;
    }

    processed += 1;
    console.log(
      `[spotify-playlist] ${item.position}/${playlist.length} ${item.artist} - ${item.title}`,
    );

    const download = await downloadBestAvailableAudio(dj, item);

    row.downloadSource = download.source;
    row.downloadQuality = download.quality;

    if (!download.audioPath) {
      row.status = "unresolved-audio";
      row.note = download.note;
      await writeReports(rows, playlist.length);
      continue;
    }

    const trackId = insertImportedTrack(database, item);
    const finalAudioPath = await placeAudioFile(download.audioPath, item, trackId);

    row.trackId = trackId;
    row.audioPath = finalAudioPath;

    await updateTrackAudioPath(database, trackId, finalAudioPath);
    indexTrack(existingTracks, {
      artist: item.artist,
      audioPath: finalAudioPath,
      id: trackId,
      sourceIdentity: item.sourceIdentity,
      sourceKind: "spotify",
      title: item.title,
    });

    if (args.skipAnalysis) {
      row.status = download.quality === "hq" ? "linked-hq" : "linked-lossy";
      row.note = `${download.note}; analysis skipped`;
      await writeReports(rows, playlist.length);
      continue;
    }

    const analysis = await analyzeWithChordAi(database, {
      audioPath: finalAudioPath,
      item,
      runRoot,
      trackId,
    });

    row.status =
      analysis.status === "ok"
        ? download.quality === "hq"
          ? "imported-hq"
          : "imported-lossy"
        : "audio-linked-analysis-failed";
    row.note = analysis.status === "ok" ? `${download.note}; ${analysis.note}` : analysis.note;

    await writeReports(rows, playlist.length);
  }

  await writeReports(rows, playlist.length);
  console.log(`Run root: ${runRoot}`);
  console.log(`CSV: ${reportCsvPath}`);
  console.log(`Markdown: ${reportMarkdownPath}`);
  console.log(`Counts: ${JSON.stringify(countStatuses(rows))}`);
} finally {
  database.close();
}

async function loadDj(djToolRoot, outDir) {
  const configModule = await import(pathToFileURL(join(djToolRoot, "src/config.js")).href);
  const api = await import(pathToFileURL(join(djToolRoot, "src/api/single-track.js")).href);
  const spotify = await import(pathToFileURL(join(djToolRoot, "src/lib/spotify/client.js")).href);

  return {
    api,
    config: configModule.loadConfig({ outOverride: outDir }),
    spotify,
  };
}

function spotifyCreds(config) {
  return {
    accessToken: config.spotifyAccessToken,
    clientId: config.spotifyClientId,
    clientSecret: config.spotifyClientSecret,
    market: config.spotifyMarket,
    refreshToken: config.spotifyRefreshToken,
  };
}

function normalizePlaylistTrack(track, position) {
  const sourceIdentity = track.isrc ? `isrc:${track.isrc}` : `track:${track.id}`;

  return {
    artist: track.artists.join("; "),
    artists: track.artists,
    durationMs: track.durationMs ?? null,
    isrc: track.isrc ?? null,
    position,
    sourceIdentity,
    spotifyId: track.id,
    spotifyUrl: track.url,
    title: track.title,
  };
}

function createStatusRow(item) {
  return {
    audioPath: null,
    downloadQuality: null,
    downloadSource: null,
    note: "",
    position: item.position,
    sourceIdentity: item.sourceIdentity,
    status: "pending",
    title: item.title,
    artist: item.artist,
    trackId: spotifyTrackId(item.sourceIdentity),
  };
}

async function downloadBestAvailableAudio(dj, item) {
  const yandexHq = await tryYandex(dj, item, { allowLossy: false });

  if (yandexHq.audioPath) {
    return yandexHq;
  }

  const spotifyHq = args.skipSpotify
    ? {
        audioPath: null,
        note: "Spotify/Tidal skipped by --skip-spotify",
        quality: "hq",
        source: "spotify",
      }
    : await trySpotify(dj, item);

  if (spotifyHq.audioPath) {
    return spotifyHq;
  }

  const yandexLossy = await tryYandex(dj, item, { allowLossy: true });

  if (yandexLossy.audioPath) {
    console.warn(`[spotify-playlist] lossy fallback: ${item.artist} - ${item.title}`);
    return yandexLossy;
  }

  const ytDlpLossy = args.ytDlpFallback
    ? await tryYtDlp(item)
    : {
        audioPath: null,
        note: "yt-dlp lossy fallback skipped",
        quality: "lossy",
        source: "yt-dlp",
      };

  if (ytDlpLossy.audioPath) {
    console.warn(`[spotify-playlist] yt-dlp lossy fallback: ${item.artist} - ${item.title}`);
    return ytDlpLossy;
  }

  return {
    audioPath: null,
    note: [yandexHq.note, spotifyHq.note, yandexLossy.note, ytDlpLossy.note]
      .filter(Boolean)
      .join("; "),
    quality: null,
    source: null,
  };
}

async function tryYandex(dj, item, { allowLossy }) {
  let search;

  try {
    search = await dj.api.searchYandexCandidates(item.spotifyUrl, {
      allowLossy,
      config: dj.config,
    });
  } catch (error) {
    return {
      audioPath: null,
      note: `Yandex ${allowLossy ? "lossy" : "HQ"} search failed: ${getErrorMessage(error)}`,
      quality: allowLossy ? "lossy" : "hq",
      source: "yandex",
    };
  }

  const candidate = search.candidates?.[0];

  if (!candidate) {
    return {
      audioPath: null,
      note: `Yandex ${allowLossy ? "lossy" : "HQ"}: ${search.reason ?? "no candidate"}`,
      quality: allowLossy ? "lossy" : "hq",
      source: "yandex",
    };
  }

  try {
    const download = await dj.api.downloadYandexCandidate(candidate, {
      allowLossy,
      config: dj.config,
      track: search.track,
      yandexQuality: allowLossy ? 1 : 2,
    });
    const audioPath = download.files?.[0] ?? null;

    return {
      audioPath,
      note: audioPath
        ? `Yandex ${allowLossy ? "lossy" : "HQ"} attached`
        : `Yandex ${allowLossy ? "lossy" : "HQ"}: ${download.reason ?? "no file"}`,
      quality: allowLossy ? "lossy" : "hq",
      source: "yandex",
    };
  } catch (error) {
    return {
      audioPath: null,
      note: `Yandex ${allowLossy ? "lossy" : "HQ"} download failed: ${getErrorMessage(error)}`,
      quality: allowLossy ? "lossy" : "hq",
      source: "yandex",
    };
  }
}

async function trySpotify(dj, item) {
  const candidate = {
    artists: item.artists,
    durationMs: item.durationMs,
    id: "spotify-0",
    isrc: item.isrc,
    source: "spotify",
    title: item.title,
    url: item.spotifyUrl,
  };

  try {
    const download = await dj.api.downloadSpotifyCandidate(candidate, {
      config: dj.config,
      onMessage: (message) => {
        const trimmed = String(message).trim();

        if (trimmed) {
          console.log(`  SpotiFLAC ${trimmed}`);
        }
      },
      track: {
        artists: item.artists,
        durationMs: item.durationMs,
        kind: "track",
        spotify: {
          id: item.spotifyId,
          isrc: item.isrc,
          url: item.spotifyUrl,
        },
        title: item.title,
      },
    });
    const audioPath = download.files?.[0] ?? null;

    return {
      audioPath,
      note: audioPath
        ? "Spotify/Tidal HQ attached"
        : `Spotify/Tidal: ${download.reason ?? "no file"}`,
      quality: "hq",
      source: "spotify",
    };
  } catch (error) {
    return {
      audioPath: null,
      note: `Spotify/Tidal failed: ${getErrorMessage(error)}`,
      quality: "hq",
      source: "spotify",
    };
  }
}

async function tryYtDlp(item) {
  const ytDlpPath = args.ytDlpPath;

  const executable = await runCommand(ytDlpPath, ["--version"], {
    check: false,
    timeoutMs: 10_000,
  }).catch(() => null);

  if (!executable || executable.code !== 0) {
    return {
      audioPath: null,
      note: `yt-dlp fallback unavailable at ${ytDlpPath}`,
      quality: "lossy",
      source: "yt-dlp",
    };
  }

  const query = `${item.artist} ${item.title} audio`;
  const notes = [];

  for (const searchPrefix of ["scsearch5", "ytsearch5"]) {
    let search;

    try {
      search = await runCommand(
        ytDlpPath,
        ["--dump-single-json", "--no-warnings", `${searchPrefix}:${query}`],
        { check: false, timeoutMs: 120_000 },
      );
    } catch (error) {
      notes.push(`${searchPrefix} search failed: ${getErrorMessage(error)}`);
      continue;
    }

    if (search.code !== 0) {
      notes.push(`${searchPrefix} search failed: ${compactCommandOutput(search)}`);
      continue;
    }

    let parsed;

    try {
      parsed = JSON.parse(search.stdout);
    } catch (error) {
      notes.push(`${searchPrefix} search JSON parse failed: ${getErrorMessage(error)}`);
      continue;
    }

    const entries = Array.isArray(parsed.entries) ? parsed.entries.filter(Boolean) : [parsed];
    const candidate = chooseYtDlpCandidate(entries, item);

    if (!candidate) {
      notes.push(`${searchPrefix}: no confident lossy match`);
      continue;
    }

    const tempDir = await mkdtemp(join(tmpdir(), "djdesk-spotify-yt-"));
    const outputTemplate = join(tempDir, "audio.%(ext)s");
    const url = candidate.webpage_url ?? candidate.url;
    const download = await runCommand(
      ytDlpPath,
      [
        "--no-playlist",
        "--no-warnings",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",
        "--extractor-args",
        "youtube:player_client=android",
        "-o",
        outputTemplate,
        url,
      ],
      { check: false, timeoutMs: 300_000 },
    );

    if (download.code !== 0) {
      notes.push(`${searchPrefix} download failed: ${compactCommandOutput(download)}`);
      continue;
    }

    const files = await readdir(tempDir);
    const audioFile = files.find((file) => file.toLowerCase().endsWith(".mp3"));

    if (!audioFile) {
      notes.push(`${searchPrefix} download produced no mp3`);
      continue;
    }

    return {
      audioPath: join(tempDir, audioFile),
      note: `yt-dlp lossy attached from ${url} (${candidate.title ?? "untitled"})`,
      quality: "lossy",
      source: "yt-dlp",
    };
  }

  return {
    audioPath: null,
    note: `yt-dlp fallback failed: ${notes.join("; ")}`,
    quality: "lossy",
    source: "yt-dlp",
  };
}

function chooseYtDlpCandidate(entries, item) {
  const itemDurationSeconds = item.durationMs ? item.durationMs / 1000 : null;
  const titleTokens = significantTokens(item.title);
  const artistTokenSets = item.artists.map((artist) => significantTokens(artist));

  return entries
    .map((entry) => {
      const candidateText = [entry.title, entry.channel, entry.uploader].filter(Boolean).join(" ");
      const candidateTokens = significantTokens(candidateText);
      const titleScore = tokenCoverage(titleTokens, candidateTokens);
      const artistScore = Math.max(
        0,
        ...artistTokenSets.map((tokens) => tokenCoverage(tokens, candidateTokens)),
      );
      const durationSeconds = Number(entry.duration ?? 0) || null;
      const durationOk =
        !itemDurationSeconds ||
        !durationSeconds ||
        Math.abs(durationSeconds - itemDurationSeconds) <= Math.max(45, itemDurationSeconds * 0.25);
      const score = titleScore * 0.7 + artistScore * 0.3;

      return {
        durationOk,
        entry,
        score,
        titleScore,
        artistScore,
      };
    })
    .filter(
      (candidate) =>
        candidate.durationOk && candidate.titleScore >= 0.6 && candidate.artistScore >= 0.5,
    )
    .sort((left, right) => right.score - left.score)[0]?.entry;
}

function significantTokens(value) {
  const tokens = normalizeText(value).split(" ").filter(Boolean);
  const filtered = tokens.filter((token) => token.length >= 3 && !ytDlpStopWords.has(token));

  return filtered.length > 0 ? filtered : tokens.filter((token) => !ytDlpStopWords.has(token));
}

function tokenCoverage(expectedTokens, candidateTokens) {
  if (expectedTokens.length === 0) {
    return 0;
  }

  const candidateSet = new Set(candidateTokens);
  const matched = expectedTokens.filter((token) => candidateSet.has(token)).length;

  return matched / expectedTokens.length;
}

async function placeAudioFile(audioPath, item, trackId) {
  const extension = extname(audioPath) || ".mp3";
  const target = join(
    downloadDir,
    `${sanitizeFileName(`${item.artist} - ${item.title} [${trackId}]`)}${extension}`,
  );

  if (resolve(audioPath) === resolve(target)) {
    return target;
  }

  await mkdir(dirname(target), { recursive: true });

  if (existsSync(target)) {
    await unlink(audioPath).catch(() => undefined);
    return target;
  }

  await rename(audioPath, target);

  return target;
}

function insertImportedTrack(database, item) {
  const trackId = spotifyTrackId(item.sourceIdentity);

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
        ) VALUES (?, ?, ?, NULL, 'C', 'major', 'diatonic', 'estimated', 'estimated', 'estimated', NULL, ?, 'spotify', ?, datetime('now'), 1, ?)
      `,
    )
    .run(
      trackId,
      item.title,
      item.artist,
      item.durationMs ? Math.round(item.durationMs / 1000) : null,
      item.sourceIdentity,
      `Spotify playlist ${playlistId}, position ${item.position}. Spotify: ${item.spotifyUrl}`,
    );

  return trackId;
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

async function analyzeWithChordAi(database, { audioPath, item, runRoot, trackId }) {
  await ensurePhoneReady();
  await ensurePhoneStorage();

  const phonePath = `${defaultPhoneRoot}/${playlistId}/${asciiFileName(`${item.artist} - ${item.title}${extname(audioPath) || ".mp3"}`)}`;
  const kitBatchDir = join(serverConfig.chordAiKitRoot, "batch");
  const kitInputPath = join(kitBatchDir, "input_tracks.txt");
  const kitStatePath = join(kitBatchDir, "batch_state.csv");

  await mkdir(kitBatchDir, { recursive: true });
  await writeFile(kitInputPath, `${phonePath}\n`, "utf8");
  await writeFile(
    kitStatePath,
    [stateCsvHeader, `${csvValue(phonePath)},pending,0,,,,,,queue`].join("\n"),
    "utf8",
  );

  try {
    await adbRemove([phonePath]);
    await adbPush(audioPath, phonePath);

    const scriptPath = join(serverConfig.chordAiKitRoot, "scripts", "run_batch_chordai.py");
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
        String(args.analysisTimeoutSeconds),
        "--max-consecutive-failures",
        "99",
      ],
      {
        check: false,
        cwd: serverConfig.chordAiKitRoot,
        timeoutMs: (args.analysisTimeoutSeconds + 600) * 1000,
      },
    );
    const stateText = await readFile(kitStatePath, "utf8");
    const stateRow = parseCsv(stateText).find((row) => row.track_path?.trim() === phonePath);
    const workRoot = join(runRoot, "tracks", trackId);
    const manifestPath = join(workRoot, "manifest.csv");
    const statePath = join(workRoot, "batch_state.csv");

    await mkdir(workRoot, { recursive: true });
    await writeFile(
      manifestPath,
      [
        "playlist_position,track_id,title,artist,local_audio_path,phone_path",
        [
          "1",
          trackId,
          csvValue(item.title),
          csvValue(item.artist),
          csvValue(audioPath),
          csvValue(phonePath),
        ].join(","),
      ].join("\n"),
      "utf8",
    );
    await writeFile(statePath, stateText, "utf8");

    if (!stateRow) {
      return {
        note: `Missing ChordAI state row. ${compactCommandOutput(command)}`,
        status: "failed",
      };
    }

    if (stateRow.status?.trim() !== "extracted") {
      const reason = [stateRow.error, compactCommandOutput(command)].filter(Boolean).join(" | ");

      return {
        note: reason || `ChordAI state is ${stateRow.status ?? "empty"}`,
        status: "failed",
      };
    }

    const result = await importChordAiChordsOnlyIntoDatabase(database, {
      databasePath: serverConfig.databasePath,
      manifestPath,
      statePath,
    });

    await adbRemove([stateRow.exported_phone_path?.trim() ?? ""]);

    if (result.errors.length > 0) {
      return {
        note: result.errors.map((error) => error.error).join("; "),
        status: "failed",
      };
    }

    if (result.importedCount === 0) {
      return {
        note: result.skipped[0]?.reason ?? "ChordAI import produced no updates",
        status: "failed",
      };
    }

    return {
      note: stateRow.local_report_dir?.trim()
        ? `ChordAI imported from ${stateRow.local_report_dir.trim()}`
        : "ChordAI imported",
      status: "ok",
    };
  } finally {
    await adbRemove([phonePath]).catch(() => undefined);
    await adbCleanupChordAiExports();
  }
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
    `[spotify-playlist] ADB ok, thermal ${thermalStatus}, battery ${batteryTempTenths ? `${(batteryTempTenths / 10).toFixed(1)}C` : "unknown"}`,
  );

  if (thermalStatus <= 1) {
    return;
  }

  console.warn(`[spotify-playlist] phone is warm (thermal ${thermalStatus}), cooling down`);
  await sleep(120_000);
  await ensurePhoneReady();
}

async function ensurePhoneStorage() {
  const freeKilobytes = await readPhoneFreeKilobytes();

  if (freeKilobytes === null || freeKilobytes >= 2_000_000) {
    return;
  }

  await adbCleanupManagedMedia();
}

function readExistingTracks(database) {
  const rows = database
    .prepare(
      `
        SELECT
          tracks.id,
          tracks.title,
          tracks.artist,
          tracks.audio_path AS audioPath,
          tracks.source_kind AS sourceKind,
          tracks.source_identity AS sourceIdentity
        FROM tracks
      `,
    )
    .all();

  return {
    byCanonical: new Map(rows.map((row) => [canonicalKey(row.artist, row.title), row])),
    byPrimaryTitle: new Map(rows.map((row) => [primaryTitleKey(row.artist, row.title), row])),
    bySource: new Map(
      rows
        .filter((row) => row.sourceKind && row.sourceIdentity)
        .map((row) => [`${row.sourceKind}|${row.sourceIdentity}`, row]),
    ),
    rows,
  };
}

function findExistingDuplicate(existing, item) {
  return (
    existing.bySource.get(`spotify|${item.sourceIdentity}`) ??
    existing.byCanonical.get(canonicalKey(item.artist, item.title)) ??
    existing.byPrimaryTitle.get(primaryTitleKey(item.artist, item.title)) ??
    null
  );
}

function indexTrack(existing, row) {
  existing.rows.push(row);
  existing.bySource.set(`${row.sourceKind}|${row.sourceIdentity}`, row);
  existing.byCanonical.set(canonicalKey(row.artist, row.title), row);
  existing.byPrimaryTitle.set(primaryTitleKey(row.artist, row.title), row);
}

function spotifyTrackId(sourceIdentity) {
  return `trk-spotify-${createHash("sha256")
    .update(`spotify|${sourceIdentity}`)
    .digest("hex")
    .slice(0, 12)}`;
}

function canonicalKey(artist, title) {
  return `${normalizeText(title)}|${normalizeText(artist)}`;
}

function primaryTitleKey(artist, title) {
  return `${normalizeText(title)}|${normalizeText(String(artist ?? "").split(";")[0] ?? "")}`;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ё/g, "е")
    .toLowerCase()
    .replace(/\b(feat|ft|featuring|with|prod|originally performed by)\b/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9а-я]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function writeReports(rows, playlistTotal) {
  await mkdir(dirname(reportCsvPath), { recursive: true });
  await writeFile(reportCsvPath, renderCsv(rows), "utf8");
  await writeFile(reportMarkdownPath, renderMarkdown(rows, playlistTotal), "utf8");
}

function renderCsv(rows) {
  return [
    [
      "position",
      "status",
      "track_id",
      "artist",
      "title",
      "source_identity",
      "download_source",
      "download_quality",
      "audio_path",
      "note",
    ].join(","),
    ...rows.map((row) =>
      [
        row.position,
        row.status,
        csvValue(row.trackId ?? ""),
        csvValue(row.artist),
        csvValue(row.title),
        csvValue(row.sourceIdentity),
        csvValue(row.downloadSource ?? ""),
        csvValue(row.downloadQuality ?? ""),
        csvValue(row.audioPath ?? ""),
        csvValue(row.note),
      ].join(","),
    ),
  ].join("\n");
}

function renderMarkdown(rows, playlistTotal) {
  const counts = countStatuses(rows);

  return [
    `# Spotify Playlist Import ${playlistId}`,
    "",
    `Playlist tracks: ${playlistTotal}`,
    `Rows processed: ${rows.length}`,
    "",
    "## Counts",
    "",
    ...Object.entries(counts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => `- ${status}: ${count}`),
    "",
    "## Rows",
    "",
    "| # | Status | Track | Source | Quality | Note |",
    "| -: | --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.position} | ${escapeMarkdown(row.status)} | ${escapeMarkdown(`${row.artist} - ${row.title}`)} | ${escapeMarkdown(row.downloadSource ?? "")} | ${escapeMarkdown(row.downloadQuality ?? "")} | ${escapeMarkdown(row.note)} |`,
    ),
    "",
  ].join("\n");
}

function countStatuses(rows) {
  const counts = {};

  for (const row of rows) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  return counts;
}

function parseSpotifyPlaylistId(value) {
  const trimmed = String(value ?? "").trim();

  if (!trimmed) {
    throw new Error("Playlist URL or id is required");
  }

  if (/^[A-Za-z0-9]{10,}$/.test(trimmed) && !trimmed.includes("/")) {
    return trimmed;
  }

  const url = new URL(trimmed);
  const parts = url.pathname.split("/").filter(Boolean);
  const playlistIndex = parts.indexOf("playlist");
  const id = playlistIndex >= 0 ? parts[playlistIndex + 1] : null;

  if (!id) {
    throw new Error(`Could not parse Spotify playlist id from ${value}`);
  }

  return id;
}

function parseArgs(argv) {
  const parsed = {
    analysisTimeoutSeconds: 900,
    dryRun: false,
    maxTracks: null,
    playlist: null,
    skipAnalysis: false,
    skipSpotify: false,
    ytDlpFallback: false,
    ytDlpPath: process.env.YTDLP_PATH || "yt-dlp",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "--analysis-timeout-seconds") {
      parsed.analysisTimeoutSeconds = parsePositiveInteger(argv[++index], arg);
      continue;
    }

    if (arg === "--max-tracks") {
      parsed.maxTracks = parsePositiveInteger(argv[++index], arg);
      continue;
    }

    if (arg === "--skip-analysis") {
      parsed.skipAnalysis = true;
      continue;
    }

    if (arg === "--skip-spotify") {
      parsed.skipSpotify = true;
      continue;
    }

    if (arg === "--yt-dlp-fallback") {
      parsed.ytDlpFallback = true;
      continue;
    }

    if (arg === "--yt-dlp-path") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} expects an executable path or command`);
      }
      parsed.ytDlpPath = value;
      continue;
    }

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    parsed.playlist = arg;
  }

  if (!parsed.playlist) {
    throw new Error(
      "Usage: node scripts/import-spotify-playlist.mjs <spotify-playlist-url> [--dry-run] [--skip-analysis] [--skip-spotify] [--yt-dlp-fallback] [--yt-dlp-path executable] [--max-tracks N]",
    );
  }

  return parsed;
}

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} expects a positive integer`);
  }

  return parsed;
}

function sanitizeFileName(value) {
  return String(value)
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function asciiFileName(value) {
  const extension = extname(value);
  const stem = basename(value, extension)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._ -]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  return `${stem || "track"}${extension || ".mp3"}`;
}

function csvValue(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function escapeMarkdown(value) {
  return String(value ?? "")
    .replace(/[|]/g, "\\|")
    .replace(/\n/g, " ");
}

function compactCommandOutput(command) {
  return [command.stdout, command.stderr]
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join(" | ");
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
