import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";

import { createServer } from "./server.ts";
import type { TrackRetriever } from "./retrieval/types.ts";

test("production editing routes persist sets, track edits, and uploaded audio", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "djdesk-routes-"));
  const databasePath = join(rootPath, "test.sqlite");
  const audioUploadDir = join(rootPath, "audio");
  const app = await createServer({
    audioUploadDir,
    databasePath,
    djToolRoot: "/tmp/dj-tool",
    host: "127.0.0.1",
    port: 0,
    seedSampleData: false,
  });

  try {
    const initialSets = await injectJson<{ sets: unknown[] }>(app, {
      method: "GET",
      url: "/api/sets",
    });

    assert.deepEqual(initialSets.sets, []);

    const createdTrack = await injectJson<TrackResponse>(app, {
      method: "POST",
      payload: {
        title: "Manual title-only track",
      },
      url: "/api/tracks",
    });

    assert.equal(createdTrack.title, "Manual title-only track");
    assert.equal(createdTrack.bpm, null);
    assert.equal(createdTrack.key, null);
    assert.equal(createdTrack.keyLabel, "Unknown key");

    const set = await injectJson<SetResponse>(app, {
      method: "POST",
      payload: {
        name: "Evening plan",
      },
      url: "/api/sets",
    });

    assert.equal(set.name, "Evening plan");
    assert.deepEqual(set.trackIds, []);

    const repeatedSet = await injectJson<SetResponse>(app, {
      method: "PUT",
      payload: {
        trackIds: [createdTrack.id, createdTrack.id],
      },
      url: `/api/sets/${encodeURIComponent(set.id)}/tracks`,
    });

    assert.deepEqual(repeatedSet.trackIds, [createdTrack.id, createdTrack.id]);

    const patchedTrack = await injectJson<TrackResponse>(app, {
      method: "PATCH",
      payload: {
        bpm: 127,
        confidence: {
          bpm: "confirmed",
          key: "confirmed",
        },
        harmonyNotes: "Manual note",
        key: {
          mode: "dorian",
          tonic: "A",
          variant: "diatonic",
        },
        tags: ["manual", "manual", "tonight"],
      },
      url: `/api/tracks/${encodeURIComponent(createdTrack.id)}/analysis`,
    });

    assert.equal(patchedTrack.bpm, 127);
    assert.equal(patchedTrack.keyLabel, "La Dorian");
    assert.equal(patchedTrack.confidence.bpm, "confirmed");
    assert.equal(patchedTrack.confidence.key, "confirmed");
    assert.deepEqual(patchedTrack.tags, ["manual", "tonight"]);

    const upload = await app.inject({
      payload: createMultipartPayload({
        content: Buffer.from("fake flac bytes"),
        fieldName: "audio",
        fileName: "Город 312 - Останусь.flac",
      }),
      headers: {
        "content-type": `multipart/form-data; boundary=${multipartBoundary}`,
      },
      method: "POST",
      url: `/api/tracks/${encodeURIComponent(createdTrack.id)}/audio`,
    });

    assert.equal(upload.statusCode, 200, upload.body);

    const uploadedTrack = JSON.parse(upload.body) as TrackResponse;

    assert.equal(uploadedTrack.audioAvailable, true);
    assert.equal(uploadedTrack.audioFileName, "Город 312 - Останусь.flac");
    assert.equal((await stat(join(audioUploadDir, "Город 312 - Останусь.flac"))).isFile(), true);
    assert.deepEqual(
      await readFile(join(audioUploadDir, "Город 312 - Останусь.flac"), "utf8"),
      "fake flac bytes",
    );

    const audio = await app.inject({
      headers: {
        range: "bytes=0-3",
      },
      method: "GET",
      url: uploadedTrack.audioUrl,
    });

    assert.equal(audio.statusCode, 206);
    assert.equal(audio.headers["content-range"], "bytes 0-3/15");
    assert.match(String(audio.headers["content-disposition"]), /filename\*=UTF-8''/);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/sets/${encodeURIComponent(set.id)}`,
    });

    assert.equal(deleted.statusCode, 200);

    const finalSets = await injectJson<{ sets: unknown[] }>(app, {
      method: "GET",
      url: "/api/sets",
    });

    assert.deepEqual(finalSets.sets, []);
  } finally {
    await app.close();
    await rm(rootPath, {
      force: true,
      recursive: true,
    });
  }
});

test("retrieval routes select candidates, link audio, retry, cancel, and expose library dir", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "djdesk-retrieval-"));
  const databasePath = join(rootPath, "test.sqlite");
  const audioUploadDir = join(rootPath, "audio");
  const yandexFilePath = join(audioUploadDir, "Yandex Result.flac");
  const spotifyFilePath = join(audioUploadDir, "Spotify Result.flac");
  const retriever = createFakeRetriever({
    spotifyFilePath,
    yandexFilePath,
  });
  const app = await createServer(
    {
      audioUploadDir,
      databasePath,
      djToolRoot: "/tmp/dj-tool",
      host: "127.0.0.1",
      port: 0,
      seedSampleData: false,
    },
    {
      retriever,
    },
  );

  try {
    const library = await injectJson<{ audioUploadDir: string }>(app, {
      method: "GET",
      url: "/api/audio-library",
    });

    assert.equal(library.audioUploadDir, audioUploadDir);

    const yandexTrack = await injectJson<TrackResponse>(app, {
      method: "POST",
      payload: {
        title: "Yandex title",
      },
      url: "/api/tracks",
    });
    const yandexJob = await injectJson<RetrievalResponse>(app, {
      method: "POST",
      payload: {},
      url: `/api/tracks/${encodeURIComponent(yandexTrack.id)}/retrievals`,
    });

    assert.equal(yandexJob.stage, "yandex-candidates");
    assert.equal(yandexJob.yandexCandidates.length, 1);
    const yandexCandidate = yandexJob.yandexCandidates[0];

    assert.ok(yandexCandidate);

    const yandexLinkedJob = await injectJson<RetrievalResponse>(app, {
      method: "POST",
      payload: {
        candidateId: yandexCandidate.id,
      },
      url: `/api/retrievals/${encodeURIComponent(yandexJob.id)}/yandex/select`,
    });

    assert.equal(yandexLinkedJob.stage, "downloading-yandex");
    const completedYandexJob = await waitForRetrievalStage(app, yandexJob.id, "linked");

    assert.equal(completedYandexJob.linkedTrack?.audioFileName, "Yandex Result.flac");

    const yandexAudio = await app.inject({
      headers: {
        range: "bytes=0-3",
      },
      method: "GET",
      url: completedYandexJob.linkedTrack?.audioUrl ?? "",
    });

    assert.equal(yandexAudio.statusCode, 206);

    const spotifyTrack = await injectJson<TrackResponse>(app, {
      method: "POST",
      payload: {
        title: "Spotify title",
      },
      url: "/api/tracks",
    });
    const spotifyJob = await injectJson<RetrievalResponse>(app, {
      method: "POST",
      payload: {},
      url: `/api/tracks/${encodeURIComponent(spotifyTrack.id)}/retrievals`,
    });

    assert.equal(spotifyJob.stage, "spotify-candidates");
    assert.equal(spotifyJob.spotifyCandidates.length, 1);
    const spotifyCandidate = spotifyJob.spotifyCandidates[0];

    assert.ok(spotifyCandidate);

    const spotifyLinkedJob = await injectJson<RetrievalResponse>(app, {
      method: "POST",
      payload: {
        candidateId: spotifyCandidate.id,
      },
      url: `/api/retrievals/${encodeURIComponent(spotifyJob.id)}/spotify/select`,
    });

    assert.equal(spotifyLinkedJob.stage, "downloading-spotify");
    const completedSpotifyJob = await waitForRetrievalStage(app, spotifyJob.id, "linked");

    assert.equal(completedSpotifyJob.linkedTrack?.audioFileName, "Spotify Result.flac");

    const spotifySkipTrack = await injectJson<TrackResponse>(app, {
      method: "POST",
      payload: {
        title: "Spotify skip title",
      },
      url: "/api/tracks",
    });
    const spotifySkipJob = await injectJson<RetrievalResponse>(app, {
      method: "POST",
      payload: {},
      url: `/api/tracks/${encodeURIComponent(spotifySkipTrack.id)}/retrievals`,
    });
    const spotifySkipCandidate = spotifySkipJob.spotifyCandidates[0];

    assert.ok(spotifySkipCandidate);

    const spotifyDownloadingJob = await injectJson<RetrievalResponse>(app, {
      method: "POST",
      payload: {
        candidateId: spotifySkipCandidate.id,
      },
      url: `/api/retrievals/${encodeURIComponent(spotifySkipJob.id)}/spotify/select`,
    });

    assert.equal(spotifyDownloadingJob.stage, "downloading-spotify");

    const skippedSpotifyJob = await injectJson<RetrievalResponse>(app, {
      method: "POST",
      payload: {
        candidateId: null,
      },
      url: `/api/retrievals/${encodeURIComponent(spotifySkipJob.id)}/spotify/select`,
    });

    assert.equal(skippedSpotifyJob.stage, "lucida");
    await sleep(50);

    const skippedSpotifyFinalJob = await injectJson<RetrievalResponse>(app, {
      method: "GET",
      url: `/api/retrievals/${encodeURIComponent(spotifySkipJob.id)}`,
    });

    assert.equal(skippedSpotifyFinalJob.stage, "lucida");
    assert.equal(skippedSpotifyFinalJob.linkedTrack, null);

    const lucidaTrack = await injectJson<TrackResponse>(app, {
      method: "POST",
      payload: {
        title: "Lucida title",
      },
      url: "/api/tracks",
    });
    const lucidaJob = await injectJson<RetrievalResponse>(app, {
      method: "POST",
      payload: {},
      url: `/api/tracks/${encodeURIComponent(lucidaTrack.id)}/retrievals`,
    });

    assert.equal(lucidaJob.stage, "lucida");
    assert.equal(lucidaJob.lucidaUrl, "https://lucida.test/search");

    const retriedJob = await injectJson<RetrievalResponse>(app, {
      method: "POST",
      url: `/api/retrievals/${encodeURIComponent(lucidaJob.id)}/retry`,
    });

    assert.equal(retriedJob.stage, "lucida");

    const cancelledJob = await injectJson<RetrievalResponse>(app, {
      method: "POST",
      url: `/api/retrievals/${encodeURIComponent(lucidaJob.id)}/cancel`,
    });

    assert.equal(cancelledJob.stage, "cancelled");
  } finally {
    await app.close();
    await rm(rootPath, {
      force: true,
      recursive: true,
    });
  }
});

interface InjectJsonOptions {
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  payload?: unknown;
  url: string;
}

interface SetResponse {
  id: string;
  name: string;
  trackIds: string[];
}

interface TrackResponse {
  audioAvailable: boolean;
  audioFileName: string | null;
  audioUrl: string;
  bpm: number | null;
  confidence: {
    bpm: string;
    key: string;
  };
  id: string;
  key: unknown;
  keyLabel: string;
  tags: string[];
  title: string;
}

interface RetrievalResponse {
  id: string;
  linkedTrack: TrackResponse | null;
  lucidaUrl: string | null;
  spotifyCandidates: RetrievalCandidateResponse[];
  stage: string;
  yandexCandidates: RetrievalCandidateResponse[];
}

interface RetrievalCandidateResponse {
  id: string;
  title: string;
}

const multipartBoundary = "----djdesk-test-boundary";

async function injectJson<Response>(
  app: Awaited<ReturnType<typeof createServer>>,
  options: InjectJsonOptions,
): Promise<Response> {
  const response = await (options.payload
    ? app.inject({
        headers: {
          "content-type": "application/json",
        },
        method: options.method,
        payload: JSON.stringify(options.payload),
        url: options.url,
      })
    : app.inject({
        method: options.method,
        url: options.url,
      }));

  assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);

  return JSON.parse(response.body) as Response;
}

async function waitForRetrievalStage(
  app: Awaited<ReturnType<typeof createServer>>,
  jobId: string,
  stage: string,
): Promise<RetrievalResponse> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const job = await injectJson<RetrievalResponse>(app, {
      method: "GET",
      url: `/api/retrievals/${encodeURIComponent(jobId)}`,
    });

    if (job.stage === stage) {
      return job;
    }

    await sleep(10);
  }

  throw new Error(`Retrieval job ${jobId} did not reach ${stage}`);
}

function createFakeRetriever(input: {
  spotifyFilePath: string;
  yandexFilePath: string;
}): TrackRetriever {
  return {
    async downloadSpotifyCandidate(_candidate, options) {
      options.onMessage("Songlink: retrying fixture request");
      await sleep(25);
      await writeFakeAudioFile(input.spotifyFilePath);

      return {
        files: [input.spotifyFilePath],
        ok: true,
        reason: null,
      };
    },
    async downloadYandexCandidate(_candidate, options) {
      options.onMessage("download started");
      await sleep(25);
      await writeFakeAudioFile(input.yandexFilePath);

      return {
        files: [input.yandexFilePath],
        ok: true,
        reason: null,
      };
    },
    async getLucidaFallback() {
      return {
        url: "https://lucida.test/search",
      };
    },
    async searchSpotifyCandidates(inputValue) {
      return {
        candidates: inputValue.includes("Spotify")
          ? [
              {
                artists: ["Artist"],
                durationMs: 180_000,
                id: "spotify-0",
                lossless: null,
                matchPercent: null,
                raw: {
                  url: "https://open.spotify.com/track/fixture",
                },
                source: "spotify",
                title: "Spotify Result",
                url: "https://open.spotify.com/track/fixture",
              },
            ]
          : [],
        reason: null,
        trackContext: {
          inputValue,
        },
      };
    },
    async searchYandexCandidates(inputValue) {
      return {
        candidates: inputValue.includes("Yandex")
          ? [
              {
                artists: ["Artist"],
                durationMs: 180_000,
                id: "yandex-0",
                lossless: true,
                matchPercent: 100,
                raw: {
                  url: "https://music.yandex.ru/album/1/track/2",
                },
                source: "yandex",
                title: "Yandex Result",
                url: "https://music.yandex.ru/album/1/track/2",
              },
            ]
          : [],
        reason: null,
        trackContext: {
          inputValue,
        },
      };
    },
  };
}

async function writeFakeAudioFile(path: string): Promise<void> {
  await mkdir(dirname(path), {
    recursive: true,
  });
  await writeFile(path, Buffer.from("fake flac bytes"));
}

function createMultipartPayload(input: {
  content: Buffer;
  fieldName: string;
  fileName: string;
}): Buffer {
  return Buffer.concat([
    Buffer.from(
      [
        `--${multipartBoundary}`,
        `Content-Disposition: form-data; name="${input.fieldName}"; filename="${input.fileName}"`,
        "Content-Type: audio/flac",
        "",
        "",
      ].join("\r\n"),
    ),
    input.content,
    Buffer.from(["", `--${multipartBoundary}--`, ""].join("\r\n")),
  ]);
}
