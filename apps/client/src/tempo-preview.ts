export interface TempoPreviewInput {
  enabled: boolean;
  sourceBpm: number | null | undefined;
  targetBpm: number;
}

const MIN_ACTIVE_RATE_DELTA = 0.005;

export function getTempoPreviewRate(input: TempoPreviewInput): number {
  if (
    !input.enabled ||
    !isPositiveFiniteNumber(input.sourceBpm) ||
    !isPositiveFiniteNumber(input.targetBpm)
  ) {
    return 1;
  }

  const rate = input.targetBpm / input.sourceBpm;

  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

export function isTempoPreviewRateActive(rate: number): boolean {
  return Math.abs(rate - 1) > MIN_ACTIVE_RATE_DELTA;
}

function isPositiveFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
