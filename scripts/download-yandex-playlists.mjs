#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readServerConfig } from "../apps/server/src/config.ts";
import { openDatabase } from "../apps/server/src/db/database.ts";
import { runMigrations } from "../apps/server/src/db/migrations.ts";
import { analyzeAudioQuality } from "../apps/server/src/audio/quality.ts";

const args = parseArgs(process.argv.slice(2));
const serverConfig = readServerConfig();
const playlistUrls = dedupe(args.playlists.map(parseYandexPlaylistInput));
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runRoot = join(serverConfig.windowsFlashStagingDir, `yandex-playlists-${runId}`);
const downloadDir = resolve(serverConfig.audioUploadDir, `Yandex Playlists ${runId}`);
const reportCsvPath = join(runRoot, "report.csv");
const manifestCsvPath = join(runRoot, "download-manifest.csv");
const reportMarkdownPath = join(runRoot, "report.md");

await mkdir(runRoot, { recursive: true });
await mkdir(downloadDir, { recursive: true });

const database = await openDatabase(serverConfig.databasePath);

try {
  await runMigrations(database);

  const dj = await loadDj(serverConfig.djToolRoot);
  const existingTracks = readExistingTracks(database);
  const rows = [];
  const seenSources = new Set();
  const seenCanonical = new Set();

  await writeReports(rows, 0);

  const playlists = [];

  for (let playlistIndex = 0; playlistIndex < playlistUrls.length; playlistIndex += 1) {
    const input = playlistUrls[playlistIndex];
    console.log(`[yandex-playlists] fetching ${input.uuid}`);
    const playlist = await fetchYandexPlaylist(input.uuid, dj.config.yandexToken);
    playlists.push({ input, playlistIndex: playlistIndex + 1, ...playlist });
  }

  const totalTracks = playlists.reduce((sum, playlist) => sum + playlist.tracks.length, 0);
  let globalPosition = 0;
  let downloadableCount = 0;

  await writeReports(rows, totalTracks);

  for (const playlist of playlists) {
    for (const track of playlist.tracks) {
      globalPosition += 1;

      if (args.maxTracks !== null && downloadableCount >= args.maxTracks) {
        continue;
      }

      const item = normalizePlaylistTrack(track, playlist, globalPosition);
      const row = createStatusRow(item);
      rows.push(row);

      const sourceKey = `yandex|${item.sourceIdentity}`;
      const canonical = canonicalKey(item.artist, item.displayTitle);

      if (seenSources.has(sourceKey) || seenCanonical.has(canonical)) {
        row.status = "skipped-playlist-duplicate";
        row.note = "Duplicate inside requested playlist set";
        await writeReports(rows, totalTracks);
        continue;
      }

      seenSources.add(sourceKey);
      seenCanonical.add(canonical);

      const duplicate = findExistingDuplicate(existingTracks, item);

      if (duplicate) {
        row.status = "skipped-existing";
        row.existingTrackId = duplicate.id;
        row.audioPath = duplicate.audioPath;
        row.note = `Existing DJ Desk track ${duplicate.id}`;
        await writeReports(rows, totalTracks);
        continue;
      }

      if (args.dryRun) {
        row.status = "would-download";
        row.note = "Dry run";
        await writeReports(rows, totalTracks);
        continue;
      }

      downloadableCount += 1;
      console.log(
        `[yandex-playlists] ${globalPosition}/${totalTracks} ${item.artist} - ${item.displayTitle}`,
      );

      const download = await downloadBestAvailableAudio(dj, item);

      row.downloadSource = download.source;
      row.downloadQuality = download.quality;

      if (!download.audioPath) {
        row.status = "unresolved-audio";
        row.note = download.note;
        await writeReports(rows, totalTracks);
        continue;
      }

      const finalAudioPath = await placeAudioFile(download.audioPath, item);
      const quality = await analyzeAudioQuality(finalAudioPath);

      row.audioBitrateKbps = quality.bitrateKbps;
      row.audioCodec = quality.codec;
      row.audioPath = finalAudioPath;
      row.audioQualityStatus = quality.status;
      row.audioLossyHighBitrate = quality.isHighBitrateLossy ? 1 : 0;
      row.status = quality.status === "hq" ? "downloaded-hq" : "downloaded-lossy";
      row.note = quality.probeError
        ? `${download.note}; ffprobe: ${quality.probeError}`
        : download.note;

      await writeReports(rows, totalTracks);
    }
  }

  await writeReports(rows, totalTracks);
  console.log(`Run root: ${runRoot}`);
  console.log(`Manifest: ${manifestCsvPath}`);
  console.log(`Report: ${reportMarkdownPath}`);
  console.log(`Counts: ${JSON.stringify(countStatuses(rows))}`);
} finally {
  database.close();
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

async function fetchYandexPlaylist(uuid, token) {
  if (!token) {
    throw new Error("YANDEX_TOKEN is required in DJ config");
  }

  const response = await fetch(`https://api.music.yandex.net/playlist/${uuid}`, {
    headers: {
      Authorization: `OAuth ${token}`,
      "User-Agent": "Yandex-Music-API",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Yandex playlist ${uuid} failed: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  const result = payload.result;

  if (!result) {
    throw new Error(`Yandex playlist ${uuid} returned no result`);
  }

  return {
    playlistKind: String(result.kind ?? ""),
    playlistTitle: result.title ?? uuid,
    playlistUid: String(result.uid ?? result.owner?.uid ?? ""),
    playlistUuid: result.playlistUuid ?? uuid,
    tracks: Array.isArray(result.tracks) ? result.tracks : [],
  };
}

function normalizePlaylistTrack(entry, playlist, globalPosition) {
  const full = entry.track ?? entry;
  const trackId = String(full.id ?? entry.id ?? "");
  const albumId = String(entry.albumId ?? full.albumId ?? full.albums?.[0]?.id ?? "");
  const title = String(full.title ?? entry.title ?? "Untitled track").trim();
  const version = normalizeVersion(full.version ?? entry.version ?? "");
  const displayTitle = version ? `${title} (${version})` : title;
  const artists = readArtists(full.artists ?? entry.artists);
  const artist = artists.join("; ") || "Unknown Artist";
  const durationMs = Number(full.durationMs ?? entry.durationMs ?? 0) || null;

  return {
    albumId,
    artist,
    artists,
    available: full.available ?? entry.available ?? null,
    displayTitle,
    durationMs,
    globalPosition,
    playlistKind: playlist.playlistKind,
    playlistPosition:
      entry.originalIndex !== undefined ? Number(entry.originalIndex) + 1 : globalPosition,
    playlistTitle: playlist.playlistTitle,
    playlistUid: playlist.playlistUid,
    playlistUuid: playlist.playlistUuid,
    sourceIdentity: `track:${trackId}:album:${albumId}`,
    title,
    trackId,
    yandexUrl:
      albumId && trackId ? `https://music.yandex.ru/album/${albumId}/track/${trackId}` : null,
    yandexTrackId: yandexTrackId(`track:${trackId}:album:${albumId}`),
    version,
  };
}

function readArtists(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((artist) => (typeof artist === "string" ? artist : artist?.name))
    .filter(Boolean)
    .map((artist) => String(artist).trim())
    .filter(Boolean);
}

function normalizeVersion(value) {
  const text = String(value ?? "").trim();
  return text && text.toLowerCase() !== "null" ? text : "";
}

function createStatusRow(item) {
  return {
    albumId: item.albumId,
    artist: item.artist,
    audioBitrateKbps: null,
    audioCodec: null,
    audioLossyHighBitrate: null,
    audioPath: null,
    audioQualityStatus: null,
    downloadQuality: null,
    downloadSource: null,
    existingTrackId: null,
    note: "",
    playlistKind: item.playlistKind,
    playlistPosition: item.playlistPosition,
    playlistTitle: item.playlistTitle,
    playlistUid: item.playlistUid,
    playlistUuid: item.playlistUuid,
    position: item.globalPosition,
    sourceIdentity: item.sourceIdentity,
    status: "pending",
    title: item.title,
    trackId: item.yandexTrackId,
    version: item.version,
    yandexUrl: item.yandexUrl,
    yandexTrackId: item.trackId,
  };
}

async function downloadBestAvailableAudio(dj, item) {
  const yandexHq = await tryYandexDirect(dj, item, { allowLossy: false });

  if (yandexHq.audioPath) {
    return yandexHq;
  }

  const yandexSearchHq = await tryYandexSearch(dj, item, { allowLossy: false });

  if (yandexSearchHq.audioPath) {
    return yandexSearchHq;
  }

  const spotifyHq = args.skipSpotify
    ? {
        audioPath: null,
        note: "Spotify/Tidal skipped by --skip-spotify",
        quality: "hq",
        source: "spotify",
      }
    : await trySpotifyHq(dj, item);

  if (spotifyHq.audioPath) {
    return spotifyHq;
  }

  const yandexLossy = await tryYandexDirect(dj, item, { allowLossy: true });

  if (yandexLossy.audioPath) {
    console.warn(`[yandex-playlists] lossy fallback: ${item.artist} - ${item.displayTitle}`);
    return yandexLossy;
  }

  const yandexSearchLossy = await tryYandexSearch(dj, item, { allowLossy: true });

  if (yandexSearchLossy.audioPath) {
    console.warn(`[yandex-playlists] lossy search fallback: ${item.artist} - ${item.displayTitle}`);
    return yandexSearchLossy;
  }

  return {
    audioPath: null,
    note: [
      yandexHq.note,
      yandexSearchHq.note,
      spotifyHq.note,
      yandexLossy.note,
      yandexSearchLossy.note,
    ]
      .filter(Boolean)
      .join("; "),
    quality: null,
    source: null,
  };
}

async function tryYandexDirect(dj, item, { allowLossy }) {
  if (!item.yandexUrl) {
    return {
      audioPath: null,
      note: `Yandex direct ${allowLossy ? "lossy" : "HQ"}: missing track URL`,
      quality: allowLossy ? "lossy" : "hq",
      source: "yandex",
    };
  }

  const tempDir = await mkdtemp(join(tmpdir(), "djdesk-yandex-playlist-"));
  const config = { ...dj.config, outputDir: tempDir };

  try {
    const download = await dj.api.downloadYandexCandidate(
      {
        albumId: item.albumId,
        artists: item.artists,
        durationMs: item.durationMs,
        id: item.trackId,
        source: "yandex",
        title: item.title,
        trackId: item.trackId,
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
            trackId: item.trackId,
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
        quality: allowLossy ? "lossy" : "hq",
        source: "yandex",
      };
    }

    await rm(tempDir, { recursive: true, force: true });

    return {
      audioPath: null,
      note: `Yandex ${allowLossy ? "lossy" : "HQ"}: ${download.reason ?? "no file"}`,
      quality: allowLossy ? "lossy" : "hq",
      source: "yandex",
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });

    return {
      audioPath: null,
      note: `Yandex ${allowLossy ? "lossy" : "HQ"} failed: ${getErrorMessage(error)}`,
      quality: allowLossy ? "lossy" : "hq",
      source: "yandex",
    };
  }
}

async function tryYandexSearch(dj, item, { allowLossy }) {
  let search;

  try {
    search = await dj.api.searchYandexCandidates(`${item.artist} ${item.displayTitle}`, {
      allowLossy,
      config: dj.config,
    });
  } catch (error) {
    return {
      audioPath: null,
      note: `Yandex search ${allowLossy ? "lossy" : "HQ"} failed: ${getErrorMessage(error)}`,
      quality: allowLossy ? "lossy" : "hq",
      source: "yandex-search",
    };
  }

  const candidate = search.candidates?.[0];

  if (!candidate) {
    return {
      audioPath: null,
      note: `Yandex search ${allowLossy ? "lossy" : "HQ"}: ${search.reason ?? "no candidate"}`,
      quality: allowLossy ? "lossy" : "hq",
      source: "yandex-search",
    };
  }

  const tempDir = await mkdtemp(join(tmpdir(), "djdesk-yandex-search-"));
  const config = { ...dj.config, outputDir: tempDir };

  try {
    const download = await dj.api.downloadYandexCandidate(candidate, {
      allowLossy,
      config,
      track: search.track,
      yandexQuality: allowLossy ? 1 : 2,
    });
    const audioPath = download.files?.[0] ?? null;

    if (audioPath) {
      return {
        audioPath,
        note: `Yandex search ${allowLossy ? "lossy" : "HQ"} downloaded from ${candidate.url}`,
        quality: allowLossy ? "lossy" : "hq",
        source: "yandex-search",
      };
    }

    await rm(tempDir, { recursive: true, force: true });

    return {
      audioPath: null,
      note: `Yandex search ${allowLossy ? "lossy" : "HQ"}: ${download.reason ?? "no file"}`,
      quality: allowLossy ? "lossy" : "hq",
      source: "yandex-search",
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });

    return {
      audioPath: null,
      note: `Yandex search ${allowLossy ? "lossy" : "HQ"} failed: ${getErrorMessage(error)}`,
      quality: allowLossy ? "lossy" : "hq",
      source: "yandex-search",
    };
  }
}

async function trySpotifyHq(dj, item) {
  const credentials = spotifyCreds(dj.config);

  if (!credentials.clientId || !credentials.clientSecret) {
    return {
      audioPath: null,
      note: "Spotify/Tidal: no Spotify credentials",
      quality: "hq",
      source: "spotify",
    };
  }

  let matches;

  try {
    matches = await dj.spotify.searchTrack(`${item.artist} ${item.displayTitle}`, credentials);
  } catch (error) {
    return {
      audioPath: null,
      note: `Spotify search failed: ${getErrorMessage(error)}`,
      quality: "hq",
      source: "spotify",
    };
  }

  const match = chooseStreamingCandidate(matches, item);

  if (!match) {
    return {
      audioPath: null,
      note: "Spotify/Tidal: no confident Spotify match",
      quality: "hq",
      source: "spotify",
    };
  }

  const tempDir = await mkdtemp(join(tmpdir(), "djdesk-yandex-spotify-"));
  const config = { ...dj.config, outputDir: tempDir };

  try {
    const download = await dj.api.downloadSpotifyCandidate(
      {
        artists: match.artists,
        durationMs: match.durationMs,
        id: match.id,
        isrc: match.isrc,
        source: "spotify",
        title: match.title,
        url: match.url,
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
          artists: match.artists,
          durationMs: match.durationMs,
          kind: "track",
          spotify: {
            id: match.id,
            isrc: match.isrc,
            url: match.url,
          },
          title: match.title,
        },
      },
    );
    const audioPath = download.files?.[0] ?? null;

    if (audioPath) {
      return {
        audioPath,
        note: `Spotify/Tidal HQ downloaded from ${match.url}`,
        quality: "hq",
        source: "spotify",
      };
    }

    await rm(tempDir, { recursive: true, force: true });

    return {
      audioPath: null,
      note: `Spotify/Tidal: ${download.reason ?? "no file"}`,
      quality: "hq",
      source: "spotify",
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });

    return {
      audioPath: null,
      note: `Spotify/Tidal failed: ${getErrorMessage(error)}`,
      quality: "hq",
      source: "spotify",
    };
  }
}

function chooseStreamingCandidate(candidates, item) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const itemDurationSeconds = item.durationMs ? item.durationMs / 1000 : null;
  const titleTokens = significantTokens(item.displayTitle);
  const artistTokenSets = item.artists.map((artist) => significantTokens(artist));

  return (
    candidates
      .map((candidate) => {
        const candidateTokens = significantTokens(
          [candidate.title, candidate.artists?.join(" ")].filter(Boolean).join(" "),
        );
        const titleScore = tokenCoverage(titleTokens, candidateTokens);
        const artistScore = Math.max(
          0,
          ...artistTokenSets.map((tokens) => tokenCoverage(tokens, candidateTokens)),
        );
        const durationSeconds = Number(candidate.durationMs ?? 0) / 1000 || null;
        const durationOk =
          !itemDurationSeconds ||
          !durationSeconds ||
          Math.abs(durationSeconds - itemDurationSeconds) <=
            Math.max(20, itemDurationSeconds * 0.1);
        const score = titleScore * 0.7 + artistScore * 0.3;

        return {
          candidate,
          durationOk,
          score,
          titleScore,
          artistScore,
        };
      })
      .filter(
        (candidate) =>
          candidate.durationOk &&
          candidate.titleScore >= 0.7 &&
          (item.artists.length === 0 || candidate.artistScore >= 0.5),
      )
      .sort((left, right) => right.score - left.score)[0]?.candidate ?? null
  );
}

async function placeAudioFile(audioPath, item) {
  const extension = extname(audioPath) || ".mp3";
  const target = join(
    downloadDir,
    `${sanitizeFileName(`${item.artist} - ${item.displayTitle} [${item.yandexTrackId}]`)}${extension}`,
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
    existing.bySource.get(`yandex|${item.sourceIdentity}`) ??
    existing.byCanonical.get(canonicalKey(item.artist, item.displayTitle)) ??
    existing.byPrimaryTitle.get(primaryTitleKey(item.artist, item.displayTitle)) ??
    null
  );
}

function yandexTrackId(sourceIdentity) {
  return `trk-yandex-${createHash("sha256")
    .update(`yandex|${sourceIdentity}`)
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

async function writeReports(rows, playlistTotal) {
  await mkdir(dirname(reportCsvPath), { recursive: true });
  await writeFile(reportCsvPath, renderCsv(rows), "utf8");
  await writeFile(manifestCsvPath, renderCsv(rows), "utf8");
  await writeFile(reportMarkdownPath, renderMarkdown(rows, playlistTotal), "utf8");
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
      "source_identity",
      "yandex_url",
      "download_source",
      "download_quality",
      "audio_quality_status",
      "audio_lossy_high_bitrate",
      "audio_codec",
      "audio_bitrate_kbps",
      "audio_path",
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
        csvValue(row.sourceIdentity),
        csvValue(row.yandexUrl ?? ""),
        csvValue(row.downloadSource ?? ""),
        csvValue(row.downloadQuality ?? ""),
        csvValue(row.audioQualityStatus ?? ""),
        csvValue(row.audioLossyHighBitrate ?? ""),
        csvValue(row.audioCodec ?? ""),
        csvValue(row.audioBitrateKbps ?? ""),
        csvValue(row.audioPath ?? ""),
        csvValue(row.note),
      ].join(","),
    ),
  ].join("\n");
}

function renderMarkdown(rows, playlistTotal) {
  const counts = countStatuses(rows);

  return [
    "# Yandex Playlists Download",
    "",
    `Playlist tracks: ${playlistTotal}`,
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
    "| # | Playlist | Status | Track | Source | Quality | Audio | Note |",
    "| -: | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.position} | ${escapeMarkdown(row.playlistTitle)} | ${escapeMarkdown(row.status)} | ${escapeMarkdown(`${row.artist} - ${row.title}${row.version ? ` (${row.version})` : ""}`)} | ${escapeMarkdown(row.downloadSource ?? "")} | ${escapeMarkdown(row.audioQualityStatus ?? row.downloadQuality ?? "")} | ${escapeMarkdown(row.audioPath ? basename(row.audioPath) : "")} | ${escapeMarkdown(row.note)} |`,
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

function parseYandexPlaylistInput(value) {
  const trimmed = String(value ?? "").trim();

  if (!trimmed) {
    throw new Error("Empty playlist input");
  }

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return { original: trimmed, uuid: trimmed.toLowerCase() };
  }

  const url = new URL(trimmed);
  const parts = url.pathname.split("/").filter(Boolean);
  const playlistIndex = parts.indexOf("playlists");
  const uuid = playlistIndex >= 0 ? parts[playlistIndex + 1] : null;

  if (!uuid) {
    throw new Error(`Could not parse Yandex playlist uuid from ${value}`);
  }

  return { original: trimmed, uuid: uuid.toLowerCase() };
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    maxTracks: null,
    playlists: [],
    skipSpotify: false,
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

    if (arg === "--max-tracks") {
      parsed.maxTracks = parsePositiveInteger(argv[++index], arg);
      continue;
    }

    if (arg === "--skip-spotify") {
      parsed.skipSpotify = true;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    parsed.playlists.push(arg);
  }

  if (parsed.playlists.length === 0) {
    throw new Error(
      "Usage: node scripts/download-yandex-playlists.mjs <yandex-playlist-url>... [--dry-run] [--skip-spotify] [--max-tracks N]",
    );
  }

  return parsed;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }

  return parsed;
}

function dedupe(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    if (seen.has(item.uuid)) {
      continue;
    }

    seen.add(item.uuid);
    result.push(item);
  }

  return result;
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

  if (!/[",\n]/.test(text)) {
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
