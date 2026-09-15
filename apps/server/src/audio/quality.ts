import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

import type { TrackAudioQuality, TrackAudioQualityStatus, TrackBitrateMode } from "@djdesk/domain";

export interface AnalyzeAudioQualityOptions {
  ffprobePath?: string;
  now?: Date;
  timeoutMs?: number;
}

export interface AudioQualityClassificationInput {
  bitDepth: number | null;
  bitrateKbps: number | null;
  codec: string | null;
  sampleRateHz: number | null;
}

export interface AudioQualityClassification {
  isHighBitrateLossy: boolean;
  status: TrackAudioQualityStatus;
}

interface FfprobeJson {
  format?: {
    bit_rate?: unknown;
    duration?: unknown;
    format_name?: unknown;
  };
  packets?: ProbePacket[];
  streams?: ProbeStream[];
}

interface ProbeStream {
  bit_rate?: unknown;
  bits_per_raw_sample?: unknown;
  bits_per_sample?: unknown;
  codec_name?: unknown;
  codec_type?: unknown;
  sample_rate?: unknown;
}

interface ProbePacket {
  duration_time?: unknown;
  size?: unknown;
}

const highBitrateLossyThresholdKbps = 256;
const defaultProbeTimeoutMs = 30_000;
const lossyCodecs = new Set([
  "aac",
  "aac_latm",
  "ac3",
  "eac3",
  "mp1",
  "mp2",
  "mp3",
  "opus",
  "vorbis",
  "wma",
  "wmav1",
  "wmav2",
]);

export async function analyzeAudioQuality(
  audioPath: string,
  options: AnalyzeAudioQualityOptions = {},
): Promise<TrackAudioQuality> {
  const analyzedAt = getAnalyzedAt(options);
  const fileStats = await stat(audioPath).catch(() => null);

  if (!fileStats?.isFile()) {
    return createUnknownAudioQuality(analyzedAt, "Audio file was not found");
  }

  try {
    const probe = await runFfprobe(audioPath, options);
    const parsed = JSON.parse(probe.stdout) as FfprobeJson;
    const stream = getFirstAudioStream(parsed);

    if (!stream) {
      return createUnknownAudioQuality(analyzedAt, "FFprobe did not find an audio stream");
    }

    const codec = readOptionalText(stream.codec_name);
    const container = readOptionalText(parsed.format?.format_name);
    const sampleRateHz = readPositiveInteger(stream.sample_rate);
    const bitDepth = readBitDepth(stream);
    const bitrateKbps = readBitrateKbps(stream, parsed.format);
    const bitrateMode = detectBitrateMode(parsed.packets ?? []);
    const classification = classifyAudioQuality({
      bitDepth,
      bitrateKbps,
      codec,
      sampleRateHz,
    });

    return {
      analyzedAt,
      bitDepth,
      bitrateKbps,
      bitrateMode,
      codec,
      container,
      isHighBitrateLossy: classification.isHighBitrateLossy,
      probeError: null,
      sampleRateHz,
      status: classification.status,
    };
  } catch (error) {
    return createUnknownAudioQuality(analyzedAt, getErrorMessage(error));
  }
}

export function classifyAudioQuality(
  input: AudioQualityClassificationInput,
): AudioQualityClassification {
  const isStrictHq =
    input.sampleRateHz !== null &&
    input.sampleRateHz >= 44_100 &&
    input.bitDepth !== null &&
    input.bitDepth >= 16;
  const status: TrackAudioQualityStatus = isStrictHq ? "hq" : "lossy";

  return {
    isHighBitrateLossy:
      status === "lossy" &&
      input.sampleRateHz !== null &&
      input.sampleRateHz >= 44_100 &&
      input.bitrateKbps !== null &&
      input.bitrateKbps >= highBitrateLossyThresholdKbps &&
      isLossyCodec(input.codec),
    status,
  };
}

function getAnalyzedAt(options: AnalyzeAudioQualityOptions): string {
  return (options.now ?? new Date()).toISOString();
}

function createUnknownAudioQuality(analyzedAt: string, probeError: string): TrackAudioQuality {
  return {
    analyzedAt,
    bitDepth: null,
    bitrateKbps: null,
    bitrateMode: "unknown",
    codec: null,
    container: null,
    isHighBitrateLossy: false,
    probeError,
    sampleRateHz: null,
    status: "unknown",
  };
}

async function runFfprobe(
  audioPath: string,
  options: AnalyzeAudioQualityOptions,
): Promise<{ stderr: string; stdout: string }> {
  const ffprobePath = options.ffprobePath ?? process.env.FFPROBE_PATH ?? "ffprobe";
  const timeoutMs = options.timeoutMs ?? defaultProbeTimeoutMs;
  const args = [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-read_intervals",
    "%+#64",
    "-show_entries",
    [
      "stream=codec_name,codec_type,sample_rate,bits_per_sample,bits_per_raw_sample,bit_rate",
      "format=format_name,bit_rate,duration",
      "packet=size,duration_time",
    ].join(":"),
    "-show_packets",
    "-of",
    "json",
    audioPath,
  ];

  return await new Promise((resolve, reject) => {
    const child = spawn(ffprobePath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let didTimeout = false;
    const timeout = setTimeout(() => {
      didTimeout = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

      if (didTimeout) {
        reject(new Error(`ffprobe timed out after ${timeoutMs}ms`));
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `ffprobe exited with ${code ?? signal ?? "unknown"}${stderr ? `: ${stderr}` : ""}`,
          ),
        );
        return;
      }

      resolve({
        stderr,
        stdout,
      });
    });
  });
}

function getFirstAudioStream(probe: FfprobeJson): ProbeStream | null {
  return (
    probe.streams?.find((stream) => readOptionalText(stream.codec_type) === "audio") ??
    probe.streams?.[0] ??
    null
  );
}

function readBitDepth(stream: ProbeStream): number | null {
  return (
    readPositiveInteger(stream.bits_per_raw_sample) ?? readPositiveInteger(stream.bits_per_sample)
  );
}

function readBitrateKbps(
  stream: ProbeStream,
  format: FfprobeJson["format"] | undefined,
): number | null {
  const bitrate = readPositiveInteger(format?.bit_rate) ?? readPositiveInteger(stream.bit_rate);

  return bitrate === null ? null : Math.max(1, Math.round(bitrate / 1000));
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function readOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLocaleLowerCase() : null;
}

function detectBitrateMode(packets: readonly ProbePacket[]): TrackBitrateMode {
  const packetRates = packets
    .map((packet) => {
      const size = readPositiveInteger(packet.size);
      const durationSeconds = readPositiveFloat(packet.duration_time);

      return size !== null && durationSeconds !== null && durationSeconds > 0
        ? size / durationSeconds
        : null;
    })
    .filter((rate): rate is number => rate !== null);

  if (packetRates.length < 8) {
    return "unknown";
  }

  const average = packetRates.reduce((sum, rate) => sum + rate, 0) / packetRates.length;

  if (average <= 0) {
    return "unknown";
  }

  const min = Math.min(...packetRates);
  const max = Math.max(...packetRates);
  const spread = (max - min) / average;

  return spread > 0.08 ? "vbr" : "cbr";
}

function readPositiveFloat(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isLossyCodec(codec: string | null): boolean {
  return codec !== null && lossyCodecs.has(codec.toLocaleLowerCase());
}

function getErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message.length > 1_000 ? `${message.slice(0, 997)}...` : message;
}
