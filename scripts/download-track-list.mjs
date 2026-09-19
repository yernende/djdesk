#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readServerConfig } from "../apps/server/src/config.ts";
import { openDatabase } from "../apps/server/src/db/database.ts";
import { runMigrations } from "../apps/server/src/db/migrations.ts";
import { analyzeAudioQuality } from "../apps/server/src/audio/quality.ts";

const serverConfig = readServerConfig();
const args = parseArgs(process.argv.slice(2));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runRoot = join(serverConfig.windowsFlashStagingDir, `track-list-${runId}`);
const downloadDir = resolve(serverConfig.audioUploadDir, `Track List ${runId}`);
const manifestCsvPath = join(runRoot, "download-manifest.csv");
const reportCsvPath = join(runRoot, "report.csv");
const reportMarkdownPath = join(runRoot, "report.md");

await mkdir(runRoot, { recursive: true });
await mkdir(downloadDir, { recursive: true });

const database = await openDatabase(serverConfig.databasePath);

try {
  await runMigrations(database);

  const queries = await readQueries(args);
  const dj = await loadDj(serverConfig.djToolRoot);
  const existingTracks = readExistingTracks(database);
  const seenCanonical = new Set();
  const seenSources = new Set();
  const rows = [];

  await writeReports(rows, queries.length);

  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index];
    const row = createStatusRow(query, index + 1);
    rows.push(row);

    console.log(`[track-list] ${index + 1}/${queries.length} ${query}`);

    const result = await resolveAndDownload(
      dj,
      query,
      row,
      existingTracks,
      seenSources,
      seenCanonical,
    );

    Object.assign(row, result);
    await writeReports(rows, queries.length);
  }

  await writeReports(rows, queries.length);
  console.log(`Run root: ${runRoot}`);
  console.log(`Manifest: ${manifestCsvPath}`);
  console.log(`Report: ${reportMarkdownPath}`);
  console.log(`Counts: ${JSON.stringify(countStatuses(rows))}`);
} finally {
  database.close();
}

async function readQueries(parsedArgs) {
  const raw = [];

  if (parsedArgs.inputPath) {
    raw.push(...(await readFile(parsedArgs.inputPath, "utf8")).split(/\r?\n/u));
  }

  raw.push(...parsedArgs.queries);

  const queries = raw.map((line) => line.trim()).filter(Boolean);

  if (queries.length === 0) {
    throw new Error("No track queries provided");
  }

  return queries;
}

async function loadDj(djToolRoot) {
  const configModule = await import(pathToFileURL(join(djToolRoot, "src/config.js")).href);
  const api = await import(pathToFileURL(join(djToolRoot, "src/api/single-track.js")).href);
  const spotify = await import(pathToFileURL(join(djToolRoot, "src/lib/spotify/client.js")).href);

  return {
    api,
    config: configModule.loadConfig({ outOverride: downloadDir }),
    spotify,
  };
}

function createStatusRow(query, position) {
  return {
    albumId: "",
    artist: "",
    audioBitrateKbps: null,
    audioCodec: null,
    audioLossyHighBitrate: null,
    audioPath: null,
    audioQualityStatus: null,
    downloadQuality: null,
    downloadSource: null,
    existingTrackId: null,
    note: "",
    playlistKind: "track-list",
    playlistPosition: position,
    playlistTitle: "Ad hoc track list",
    playlistUid: "",
    playlistUuid: `track-list-${runId}`,
    position,
    query,
    sourceIdentity: "",
    sourceKind: "",
    status: "pending",
    title: "",
    trackId: "",
    version: "",
    yandexTrackId: "",
    yandexUrl: "",
  };
}

async function resolveAndDownload(dj, query, row, existingTracks, seenSources, seenCanonical) {
  const attempts = [];
  const yandexHq = await findYandexMatch(dj, query, { allowLossy: false });

  if (yandexHq.item) {
    const result = await maybeDownloadMatch({
      allowLossy: false,
      dj,
      existingTracks,
      item: yandexHq.item,
      row,
      seenCanonical,
      seenSources,
      sourceLabel: "yandex",
    });

    if (result.done) {
      return result.row;
    }

    attempts.push(result.note);
  } else {
    attempts.push(yandexHq.note);
  }

  if (!args.skipSpotify) {
    const spotify = await findSpotifyMatch(dj, query);

    if (spotify.item) {
      const result = await maybeDownloadMatch({
        allowLossy: false,
        dj,
        existingTracks,
        item: spotify.item,
        row,
        seenCanonical,
        seenSources,
        sourceLabel: "spotify",
      });

      if (result.done) {
        return result.row;
      }

      attempts.push(result.note);
    } else {
      attempts.push(spotify.note);
    }
  }

  const yandexLossy = await findYandexMatch(dj, query, { allowLossy: true });

  if (yandexLossy.item) {
    const result = await maybeDownloadMatch({
      allowLossy: true,
      dj,
      existingTracks,
      item: yandexLossy.item,
      row,
      seenCanonical,
      seenSources,
      sourceLabel: "yandex",
    });

    if (result.done) {
      return result.row;
    }

    attempts.push(result.note);
  } else {
    attempts.push(yandexLossy.note);
  }

  if (args.ytDlpFallback) {
    const ytDlp = await tryYtDlp(query);

    if (ytDlp.item && ytDlp.audioPath) {
      const result = await maybeAttachDownloadedAudio({
        audioPath: ytDlp.audioPath,
        downloadQuality: "lossy",
        downloadSource: "yt-dlp",
        existingTracks,
        item: ytDlp.item,
        note: ytDlp.note,
        row,
        seenCanonical,
        seenSources,
      });

      if (result.done) {
        return result.row;
      }

      attempts.push(result.note);
    } else {
      attempts.push(ytDlp.note);
    }
  }

  return {
    ...row,
    note: attempts.filter(Boolean).join("; "),
    status: "unresolved-audio",
  };
}

async function findYandexMatch(dj, query, { allowLossy }) {
  try {
    const search = await dj.api.searchYandexCandidates(query, {
      allowLossy,
      config: dj.config,
    });
    const candidate = search.candidates?.[0];

    if (!candidate) {
      return {
        item: null,
        note: `Yandex ${allowLossy ? "lossy" : "HQ"}: ${search.reason ?? "no confident match"}`,
      };
    }

    return {
      item: yandexItemFromCandidate(candidate, query),
      note: null,
    };
  } catch (error) {
    return {
      item: null,
      note: `Yandex ${allowLossy ? "lossy" : "HQ"} search failed: ${getErrorMessage(error)}`,
    };
  }
}

async function findSpotifyMatch(dj, query) {
  const credentials = spotifyCreds(dj.config);

  if (!credentials.clientId || !credentials.clientSecret) {
    return { item: null, note: "Spotify/Tidal: no Spotify credentials" };
  }

  try {
    const candidates = await dj.spotify.searchTrack(query, credentials);
    const match = chooseSpotifyCandidate(candidates, query);

    if (!match) {
      return { item: null, note: "Spotify/Tidal: no confident Spotify match" };
    }

    return {
      item: spotifyItemFromCandidate(match, query),
      note: null,
    };
  } catch (error) {
    return { item: null, note: `Spotify search failed: ${getErrorMessage(error)}` };
  }
}

async function maybeDownloadMatch({
  allowLossy,
  dj,
  existingTracks,
  item,
  row,
  seenCanonical,
  seenSources,
  sourceLabel,
}) {
  const sourceKey = `${item.sourceKind}|${item.sourceIdentity}`;
  const canonical = canonicalKey(item.artist, item.displayTitle);
  const duplicate = findExistingDuplicate(existingTracks, item);

  Object.assign(row, rowFromItem(row, item));

  if (seenSources.has(sourceKey) || seenCanonical.has(canonical)) {
    return {
      done: true,
      row: {
        ...row,
        note: "Duplicate inside this track list",
        status: "skipped-playlist-duplicate",
      },
    };
  }

  if (duplicate) {
    return {
      done: true,
      row: {
        ...row,
        audioPath: duplicate.audioPath,
        existingTrackId: duplicate.id,
        note: `Existing DJ Desk track ${duplicate.id}`,
        status: "skipped-existing",
      },
    };
  }

  if (args.dryRun) {
    return {
      done: true,
      row: {
        ...row,
        note: "Dry run",
        status: "would-download",
      },
    };
  }

  const download =
    sourceLabel === "spotify"
      ? await trySpotifyHq(dj, item)
      : await tryYandex(dj, item, { allowLossy });

  if (!download.audioPath) {
    return {
      done: false,
      note: download.note,
      row,
    };
  }

  return await maybeAttachDownloadedAudio({
    audioPath: download.audioPath,
    downloadQuality: allowLossy ? "lossy" : "hq",
    downloadSource: download.source,
    existingTracks,
    item,
    note: download.note,
    row,
    seenCanonical,
    seenSources,
  });
}

async function maybeAttachDownloadedAudio({
  audioPath,
  downloadQuality,
  downloadSource,
  existingTracks,
  item,
  note,
  row,
  seenCanonical,
  seenSources,
}) {
  const sourceKey = `${item.sourceKind}|${item.sourceIdentity}`;
  const canonical = canonicalKey(item.artist, item.displayTitle);
  const duplicate = findExistingDuplicate(existingTracks, item);

  Object.assign(row, rowFromItem(row, item));

  if (seenSources.has(sourceKey) || seenCanonical.has(canonical)) {
    await unlink(audioPath).catch(() => undefined);

    return {
      done: true,
      row: {
        ...row,
        note: "Duplicate inside this track list",
        status: "skipped-playlist-duplicate",
      },
    };
  }

  if (duplicate) {
    await unlink(audioPath).catch(() => undefined);

    return {
      done: true,
      row: {
        ...row,
        audioPath: duplicate.audioPath,
        existingTrackId: duplicate.id,
        note: `Existing DJ Desk track ${duplicate.id}`,
        status: "skipped-existing",
      },
    };
  }

  const finalAudioPath = await placeAudioFile(audioPath, item);
  const quality = await analyzeAudioQuality(finalAudioPath);

  seenSources.add(sourceKey);
  seenCanonical.add(canonical);
  indexTrack(existingTracks, {
    artist: item.artist,
    audioPath: finalAudioPath,
    id: item.trackId,
    sourceIdentity: item.sourceIdentity,
    sourceKind: item.sourceKind,
    title: item.displayTitle,
  });

  return {
    done: true,
    row: {
      ...row,
      audioBitrateKbps: quality.bitrateKbps,
      audioCodec: quality.codec,
      audioLossyHighBitrate: quality.isHighBitrateLossy ? 1 : 0,
      audioPath: finalAudioPath,
      audioQualityStatus: quality.status,
      downloadQuality,
      downloadSource,
      note: quality.probeError ? `${note}; ffprobe: ${quality.probeError}` : note,
      status: quality.status === "hq" ? "downloaded-hq" : "downloaded-lossy",
    },
  };
}

async function tryYandex(dj, item, { allowLossy }) {
  const tempDir = await mkdtemp(join(tmpdir(), "djdesk-track-list-yandex-"));
  const config = { ...dj.config, outputDir: tempDir };

  try {
    const download = await dj.api.downloadYandexCandidate(
      {
        albumId: item.albumId,
        artists: item.artists,
        durationMs: item.durationMs,
        id: item.yandexTrackId,
        source: "yandex",
        title: item.title,
        trackId: item.yandexTrackId,
        url: item.yandexUrl,
      },
      {
        allowLossy,
        config,
        track: {
          artists: item.artists,
          durationMs: item.durationMs,
          kind: "track",
          title: item.title,
          yandex: {
            albumId: item.albumId,
            kind: "track",
            trackId: item.yandexTrackId,
            url: item.yandexUrl,
          },
        },
        yandexQuality: allowLossy ? 1 : 2,
      },
    );
    const audioPath = download.files?.[0] ?? null;

    if (audioPath) {
      return {
        audioPath,
        note: `Yandex ${allowLossy ? "lossy" : "HQ"} downloaded`,
        source: "yandex",
      };
    }

    await rm(tempDir, { recursive: true, force: true });

    return {
      audioPath: null,
      note: `Yandex ${allowLossy ? "lossy" : "HQ"}: ${download.reason ?? "no file"}`,
      source: "yandex",
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });

    return {
      audioPath: null,
      note: `Yandex ${allowLossy ? "lossy" : "HQ"} failed: ${getErrorMessage(error)}`,
      source: "yandex",
    };
  }
}

async function trySpotifyHq(dj, item) {
  const tempDir = await mkdtemp(join(tmpdir(), "djdesk-track-list-spotify-"));
  const config = { ...dj.config, outputDir: tempDir };

  try {
    const download = await dj.api.downloadSpotifyCandidate(
      {
        artists: item.artists,
        durationMs: item.durationMs,
        id: item.spotifyId,
        isrc: item.isrc,
        source: "spotify",
        title: item.title,
        url: item.spotifyUrl,
      },
      {
        config,
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
      },
    );
    const audioPath = download.files?.[0] ?? null;

    if (audioPath) {
      return {
        audioPath,
        note: `Spotify/Tidal HQ downloaded from ${item.spotifyUrl}`,
        source: "spotify",
      };
    }

    await rm(tempDir, { recursive: true, force: true });

    return {
      audioPath: null,
      note: `Spotify/Tidal: ${download.reason ?? "no file"}`,
      source: "spotify",
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });

    return {
      audioPath: null,
      note: `Spotify/Tidal failed: ${getErrorMessage(error)}`,
      source: "spotify",
    };
  }
}

async function tryYtDlp(query) {
  const executable = await runProcess(args.ytDlpPath, ["--version"], {
    timeoutMs: 10_000,
  }).catch(() => null);

  if (!executable || executable.code !== 0) {
    return {
      audioPath: null,
      item: null,
      note: `yt-dlp fallback unavailable at ${args.ytDlpPath}`,
    };
  }

  const notes = [];

  for (const searchPrefix of ["ytsearch5", "scsearch5"]) {
    let search;

    try {
      search = await runProcess(
        args.ytDlpPath,
        ["--dump-single-json", "--no-warnings", `${searchPrefix}:${query} audio`],
        { timeoutMs: 120_000 },
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
    const candidate = chooseYtDlpCandidate(entries, query);

    if (!candidate) {
      notes.push(`${searchPrefix}: no confident lossy match`);
      continue;
    }

    const tempDir = await mkdtemp(join(tmpdir(), "djdesk-track-list-ytdlp-"));
    const outputTemplate = join(tempDir, "audio.%(ext)s");
    const url = candidate.webpage_url ?? candidate.url;
    const download = await runProcess(
      args.ytDlpPath,
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
      { timeoutMs: 300_000 },
    );

    if (download.code !== 0) {
      await rm(tempDir, { recursive: true, force: true });
      notes.push(`${searchPrefix} download failed: ${compactCommandOutput(download)}`);
      continue;
    }

    const files = await readdir(tempDir);
    const audioFile = files.find((file) => file.toLowerCase().endsWith(".mp3"));

    if (!audioFile) {
      await rm(tempDir, { recursive: true, force: true });
      notes.push(`${searchPrefix} download produced no mp3`);
      continue;
    }

    return {
      audioPath: join(tempDir, audioFile),
      item: ytDlpItemFromCandidate(candidate, query),
      note: `yt-dlp lossy downloaded from ${url} (${candidate.title ?? "untitled"})`,
    };
  }

  return {
    audioPath: null,
    item: null,
    note: `yt-dlp fallback failed: ${notes.join("; ")}`,
  };
}

function chooseYtDlpCandidate(entries, query) {
  const expectedTokens = significantTokens(query);
  const queryAllowsCover = /\b(cover|acoustic|acústico|karaoke)\b/iu.test(query);

  return (
    entries
      .map((entry) => {
        const candidateText = [entry.title, entry.channel, entry.uploader]
          .filter(Boolean)
          .join(" ");
        const candidateTokens = significantTokens(candidateText);
        const coverage = tokenCoverage(expectedTokens, candidateTokens);
        const reverseCoverage = tokenCoverage(candidateTokens, expectedTokens);
        const duration = Number(entry.duration ?? 0) || null;
        const durationOk = !duration || (duration >= 80 && duration <= 420);
        const disallowedVersion =
          !queryAllowsCover &&
          /\b(cover|acoustic|acústico|karaoke|bass boosted|8d)\b/iu.test(candidateText);
        const score = coverage * 0.75 + reverseCoverage * 0.25;

        return {
          disallowedVersion,
          durationOk,
          entry,
          score,
          coverage,
          reverseCoverage,
        };
      })
      .filter(
        (candidate) =>
          candidate.durationOk &&
          !candidate.disallowedVersion &&
          candidate.coverage >= 0.65 &&
          candidate.reverseCoverage >= 0.35 &&
          candidate.score >= 0.58,
      )
      .sort((left, right) => right.score - left.score)[0]?.entry ?? null
  );
}

async function placeAudioFile(audioPath, item) {
  const extension = extname(audioPath) || ".mp3";
  const target = join(
    downloadDir,
    `${sanitizeFileName(`${item.artist} - ${item.displayTitle} [${item.trackId}]`)}${extension}`,
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

function yandexItemFromCandidate(candidate, query) {
  const trackId = String(candidate.trackId ?? "");
  const albumId = String(candidate.albumId ?? "");
  const sourceIdentity =
    trackId && albumId ? `track:${trackId}:album:${albumId}` : `url:${candidate.url}`;
  const title = String(candidate.title ?? query).trim();
  const artists = Array.isArray(candidate.artists)
    ? candidate.artists.map((artist) => String(artist).trim()).filter(Boolean)
    : [];
  const artist = artists.join("; ") || "Unknown Artist";

  return {
    albumId,
    artist,
    artists,
    displayTitle: title,
    durationMs: Number(candidate.durationMs ?? 0) || null,
    query,
    sourceIdentity,
    sourceKind: "yandex",
    title,
    trackId: yandexTrackId(sourceIdentity),
    yandexTrackId: trackId,
    yandexUrl: candidate.url,
  };
}

function spotifyItemFromCandidate(candidate, query) {
  const sourceIdentity = candidate.isrc ? `isrc:${candidate.isrc}` : `track:${candidate.id}`;
  const artists = Array.isArray(candidate.artists)
    ? candidate.artists.map((artist) => String(artist).trim()).filter(Boolean)
    : [];
  const title = String(candidate.title ?? query).trim();
  const artist = artists.join("; ") || "Unknown Artist";

  return {
    albumId: "",
    artist,
    artists,
    displayTitle: title,
    durationMs: Number(candidate.durationMs ?? 0) || null,
    isrc: candidate.isrc ?? null,
    query,
    sourceIdentity,
    sourceKind: "spotify",
    spotifyId: candidate.id,
    spotifyUrl: candidate.url,
    title,
    trackId: spotifyTrackId(sourceIdentity),
    yandexTrackId: "",
    yandexUrl: "",
  };
}

function ytDlpItemFromCandidate(candidate, query) {
  const parsed = parseArtistTitle(candidate.title ?? query);
  const url = candidate.webpage_url ?? candidate.url ?? query;
  const sourceIdentity = `url:${url}`;

  return {
    albumId: "",
    artist: parsed.artist,
    artists: parsed.artist ? parsed.artist.split(/\s*[;&]\s*/u).filter(Boolean) : [],
    displayTitle: parsed.title,
    durationMs: candidate.duration ? Math.round(Number(candidate.duration) * 1000) : null,
    query,
    sourceIdentity,
    sourceKind: "yt-dlp",
    title: parsed.title,
    trackId: ytDlpTrackId(sourceIdentity),
    yandexTrackId: "",
    yandexUrl: "",
  };
}

function parseArtistTitle(value) {
  const cleaned = String(value ?? "")
    .replace(/\[[^\]]*\]/gu, " ")
    .replace(/\b(official|audio|video|lyrics?|letra|visualizer)\b/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const separators = [" - ", " – ", " — "];

  for (const separator of separators) {
    if (cleaned.includes(separator)) {
      const [artist, ...titleParts] = cleaned.split(separator);
      const title = titleParts.join(separator).trim();

      if (artist.trim() && title) {
        return {
          artist: artist.trim(),
          title,
        };
      }
    }
  }

  return {
    artist: "Unknown Artist",
    title: cleaned || "Untitled track",
  };
}

function rowFromItem(row, item) {
  return {
    ...row,
    albumId: item.albumId,
    artist: item.artist,
    sourceIdentity: item.sourceIdentity,
    sourceKind: item.sourceKind,
    title: item.title,
    trackId: item.trackId,
    version: "",
    yandexTrackId: item.yandexTrackId,
    yandexUrl: item.yandexUrl,
  };
}

function chooseSpotifyCandidate(candidates, query) {
  const expectedTokens = significantTokens(query);

  return (
    (Array.isArray(candidates) ? candidates : [])
      .map((candidate) => {
        const candidateText = [candidate.artists?.join(" "), candidate.title]
          .filter(Boolean)
          .join(" ");
        const candidateTokens = significantTokens(candidateText);
        const coverage = tokenCoverage(expectedTokens, candidateTokens);
        const reverseCoverage = tokenCoverage(candidateTokens, expectedTokens);
        const score = coverage * 0.7 + reverseCoverage * 0.3;

        return {
          candidate,
          coverage,
          reverseCoverage,
          score,
        };
      })
      .filter(
        (entry) => entry.coverage >= 0.65 && entry.reverseCoverage >= 0.45 && entry.score >= 0.6,
      )
      .sort((left, right) => right.score - left.score)[0]?.candidate ?? null
  );
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
    existing.bySource.get(`${item.sourceKind}|${item.sourceIdentity}`) ??
    existing.byCanonical.get(canonicalKey(item.artist, item.displayTitle)) ??
    existing.byPrimaryTitle.get(primaryTitleKey(item.artist, item.displayTitle)) ??
    null
  );
}

function indexTrack(existing, row) {
  existing.rows.push(row);
  existing.bySource.set(`${row.sourceKind}|${row.sourceIdentity}`, row);
  existing.byCanonical.set(canonicalKey(row.artist, row.title), row);
  existing.byPrimaryTitle.set(primaryTitleKey(row.artist, row.title), row);
}

function yandexTrackId(sourceIdentity) {
  return `trk-yandex-${createHash("sha256")
    .update(`yandex|${sourceIdentity}`)
    .digest("hex")
    .slice(0, 12)}`;
}

function spotifyTrackId(sourceIdentity) {
  return `trk-spotify-${createHash("sha256")
    .update(`spotify|${sourceIdentity}`)
    .digest("hex")
    .slice(0, 12)}`;
}

function ytDlpTrackId(sourceIdentity) {
  return `trk-ytdlp-${createHash("sha256")
    .update(`yt-dlp|${sourceIdentity}`)
    .digest("hex")
    .slice(0, 12)}`;
}

function canonicalKey(artist, title) {
  return `${normalizeText(title)}|${normalizeText(artist)}`;
}

function primaryTitleKey(artist, title) {
  return `${normalizeText(title)}|${normalizeText(String(artist ?? "").split(";")[0] ?? "")}`;
}

function significantTokens(value) {
  const stopWords = new Set([
    "audio",
    "clip",
    "feat",
    "featuring",
    "ft",
    "hd",
    "hq",
    "lyrics",
    "official",
    "remake",
    "remaster",
    "video",
    "visualizer",
  ]);
  const tokens = normalizeText(value).split(" ").filter(Boolean);
  const filtered = tokens.filter((token) => token.length >= 3 && !stopWords.has(token));

  return filtered.length > 0 ? filtered : tokens.filter((token) => !stopWords.has(token));
}

function tokenCoverage(expectedTokens, candidateTokens) {
  if (expectedTokens.length === 0) {
    return 0;
  }

  const candidateSet = new Set(candidateTokens);
  const matched = expectedTokens.filter((token) => candidateSet.has(token)).length;

  return matched / expectedTokens.length;
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

async function writeReports(rows, total) {
  await mkdir(dirname(reportCsvPath), { recursive: true });
  await writeFile(reportCsvPath, renderCsv(rows), "utf8");
  await writeFile(manifestCsvPath, renderCsv(rows), "utf8");
  await writeFile(reportMarkdownPath, renderMarkdown(rows, total), "utf8");
}

function renderCsv(rows) {
  return [
    [
      "position",
      "playlist_uuid",
      "playlist_title",
      "playlist_position",
      "status",
      "track_id",
      "existing_track_id",
      "artist",
      "title",
      "version",
      "yandex_track_id",
      "album_id",
      "source_kind",
      "source_identity",
      "yandex_url",
      "download_source",
      "download_quality",
      "audio_quality_status",
      "audio_lossy_high_bitrate",
      "audio_codec",
      "audio_bitrate_kbps",
      "audio_path",
      "query",
      "note",
    ].join(","),
    ...rows.map((row) =>
      [
        row.position,
        csvValue(row.playlistUuid),
        csvValue(row.playlistTitle),
        row.playlistPosition,
        row.status,
        csvValue(row.trackId),
        csvValue(row.existingTrackId ?? ""),
        csvValue(row.artist),
        csvValue(row.title),
        csvValue(row.version),
        csvValue(row.yandexTrackId),
        csvValue(row.albumId),
        csvValue(row.sourceKind),
        csvValue(row.sourceIdentity),
        csvValue(row.yandexUrl ?? ""),
        csvValue(row.downloadSource ?? ""),
        csvValue(row.downloadQuality ?? ""),
        csvValue(row.audioQualityStatus ?? ""),
        csvValue(row.audioLossyHighBitrate ?? ""),
        csvValue(row.audioCodec ?? ""),
        csvValue(row.audioBitrateKbps ?? ""),
        csvValue(row.audioPath ?? ""),
        csvValue(row.query),
        csvValue(row.note),
      ].join(","),
    ),
  ].join("\n");
}

function renderMarkdown(rows, total) {
  const counts = countStatuses(rows);

  return [
    "# Track List Download",
    "",
    `Requested tracks: ${total}`,
    `Rows processed: ${rows.length}`,
    `Download dir: ${downloadDir}`,
    "",
    "## Counts",
    "",
    ...Object.entries(counts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => `- ${status}: ${count}`),
    "",
    "## Rows",
    "",
    "| # | Status | Query | Match | Source | Quality | Audio | Note |",
    "| -: | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.position} | ${escapeMarkdown(row.status)} | ${escapeMarkdown(row.query)} | ${escapeMarkdown(row.artist && row.title ? `${row.artist} - ${row.title}` : "")} | ${escapeMarkdown(row.downloadSource ?? row.sourceKind ?? "")} | ${escapeMarkdown(row.audioQualityStatus ?? row.downloadQuality ?? "")} | ${escapeMarkdown(row.audioPath ? basename(row.audioPath) : "")} | ${escapeMarkdown(row.note)} |`,
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

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    inputPath: null,
    queries: [],
    skipSpotify: false,
    ytDlpFallback: false,
    ytDlpPath: process.env.YTDLP_PATH || "yt-dlp",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (arg === "--input") {
      parsed.inputPath = argv[++index];
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

    if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    parsed.queries.push(arg);
  }

  return parsed;
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

function sanitizeFileName(value) {
  return String(value)
    .replace(/[/:*?"<>|\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
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

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function runProcess(command, commandArgs, { timeoutMs }) {
  const { spawn } = await import("node:child_process");

  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, {
      env: process.env,
      stdio: "pipe",
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGKILL");
      reject(
        new Error(`Command timed out after ${timeoutMs}ms: ${command} ${commandArgs.join(" ")}`),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
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
      resolvePromise({
        code: code ?? 1,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      });
    });
  });
}

function compactCommandOutput(result) {
  return [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 300);
}
