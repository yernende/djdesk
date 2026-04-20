<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import {
  CIRCLE_OF_FIFTHS,
  PITCH_CLASS_LABELS,
  type ModalPlacementLane,
  type VerificationState,
} from "@djdesk/domain";

import {
  fetchTrackHarmony,
  fetchTracks,
  type TrackHarmonyResponse,
  type TrackView,
} from "./api.ts";

interface TrackCluster {
  angleIndex: number;
  count: number;
  lane: ModalPlacementLane;
  radius: number;
  tracks: TrackView[];
  x: number;
  y: number;
}

const tracks = ref<TrackView[]>([]);
const errorMessage = ref("");
const isLoading = ref(true);
const harmonyErrorMessage = ref("");
const isHarmonyLoading = ref(false);
const isUnknownKeyShelfSelected = ref(false);
const selectedSection = ref(3);
const selectedTrack = ref<TrackView | null>(null);
const setDraft = ref<string[]>([]);
const trackHarmony = ref<TrackHarmonyResponse | null>(null);

const sections = computed(() =>
  CIRCLE_OF_FIFTHS.map((pitch, index) => ({
    index,
    label: PITCH_CLASS_LABELS[pitch],
    pitch,
  })),
);

const visibleTracks = computed(() => tracks.value);

const unknownKeyTracks = computed(() =>
  tracks.value.filter((track) => !track.key).sort((first, second) => first.bpm - second.bpm),
);

const selectedSectionTracks = computed(() => {
  if (isUnknownKeyShelfSelected.value) {
    return unknownKeyTracks.value;
  }

  return tracks.value
    .filter((track) => trackTouchesSection(track, selectedSection.value))
    .sort((first, second) => first.bpm - second.bpm);
});

const selectedLabel = computed(() =>
  isUnknownKeyShelfSelected.value
    ? "Unknown key"
    : (sections.value[selectedSection.value]?.label.primary ?? "Do"),
);

const browserTitle = computed(() =>
  isUnknownKeyShelfSelected.value
    ? `${unknownKeyTracks.value.length} unplaced tracks`
    : `${selectedSectionTracks.value.length} nearby tracks`,
);

const confirmedCount = computed(
  () => visibleTracks.value.filter((track) => track.confidence.key === "confirmed").length,
);

const unknownKeyCount = computed(() => unknownKeyTracks.value.length);

const mixtureCount = computed(
  () => visibleTracks.value.filter((track) => track.placement?.lane === "modal-mixture").length,
);

const draftTracks = computed(() =>
  setDraft.value
    .map((id) => tracks.value.find((track) => track.id === id))
    .filter((track): track is TrackView => Boolean(track)),
);

const selectedTrackInDraft = computed(() =>
  selectedTrack.value ? setDraft.value.includes(selectedTrack.value.id) : false,
);

const visibleChordSegments = computed(() => trackHarmony.value?.chordSegments ?? []);

const usedChordList = computed(
  () => trackHarmony.value?.usedChords ?? selectedTrack.value?.chordProgression ?? [],
);

const trackClusters = computed<TrackCluster[]>(() => {
  const grouped = new Map<string, TrackView[]>();

  for (const track of tracks.value) {
    if (!track.placement) {
      continue;
    }

    const key = `${track.placement.lane}:${track.placement.displayIndex.toFixed(1)}`;
    const group = grouped.get(key);

    if (group) {
      group.push(track);
    } else {
      grouped.set(key, [track]);
    }
  }

  return [...grouped.values()].map((group) => {
    const firstTrack = group[0];

    if (!firstTrack) {
      throw new Error("Unexpected empty cluster");
    }

    const placement = firstTrack.placement;

    if (!placement) {
      throw new Error("Unexpected unknown-key track in cluster");
    }

    const point = polarPoint(placement.displayIndex, getLaneRadius(placement.lane));

    return {
      angleIndex: placement.displayIndex,
      count: group.length,
      lane: placement.lane,
      radius: getClusterRadius(group.length),
      tracks: group,
      x: point.x,
      y: point.y,
    };
  });
});

onMounted(async () => {
  try {
    const response = await fetchTracks();

    tracks.value = response.tracks;
    selectedTrack.value = response.tracks[0] ?? null;
    selectedSection.value = selectedTrack.value?.placement
      ? Math.round(selectedTrack.value.placement.displayIndex) % 12
      : 3;
    isUnknownKeyShelfSelected.value = Boolean(selectedTrack.value && !selectedTrack.value.key);
    setDraft.value = response.tracks.slice(0, 4).map((track) => track.id);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unknown API error";
  } finally {
    isLoading.value = false;
  }
});

watch(
  selectedTrack,
  async (track) => {
    trackHarmony.value = null;
    harmonyErrorMessage.value = "";

    if (!track) {
      return;
    }

    isHarmonyLoading.value = true;

    try {
      trackHarmony.value = await fetchTrackHarmony(track.id);
    } catch (error) {
      harmonyErrorMessage.value =
        error instanceof Error ? error.message : "Unknown harmony API error";
    } finally {
      isHarmonyLoading.value = false;
    }
  },
  {
    immediate: false,
  },
);

function selectSection(index: number): void {
  isUnknownKeyShelfSelected.value = false;
  selectedSection.value = index;
  selectedTrack.value = selectedSectionTracks.value[0] ?? selectedTrack.value;
}

function selectTrack(track: TrackView): void {
  selectedTrack.value = track;

  if (track.placement) {
    isUnknownKeyShelfSelected.value = false;
    selectedSection.value = Math.round(track.placement.displayIndex) % 12;
  } else {
    isUnknownKeyShelfSelected.value = true;
  }
}

function selectCluster(cluster: TrackCluster): void {
  isUnknownKeyShelfSelected.value = false;
  selectedSection.value = Math.round(cluster.angleIndex) % 12;
  selectedTrack.value = cluster.tracks[0] ?? selectedTrack.value;
}

function selectUnknownKeyTracks(): void {
  isUnknownKeyShelfSelected.value = true;
  selectedTrack.value = unknownKeyTracks.value[0] ?? selectedTrack.value;
}

function addSelectedTrack(): void {
  if (!selectedTrack.value || selectedTrackInDraft.value) {
    return;
  }

  setDraft.value = [...setDraft.value, selectedTrack.value.id];
}

function removeFromDraft(id: string): void {
  setDraft.value = setDraft.value.filter((trackId) => trackId !== id);
}

function hasHarmonyNotes(track: TrackView): boolean {
  return Boolean(track.harmonyNotes?.trim());
}

function sectorPath(index: number): string {
  const start = indexToAngle(index - 0.5);
  const end = indexToAngle(index + 0.5);
  const outerStart = pointAt(start, 248);
  const outerEnd = pointAt(end, 248);
  const innerStart = pointAt(start, 92);
  const innerEnd = pointAt(end, 92);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A 248 248 0 0 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A 92 92 0 0 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function labelTransform(index: number, radius: number): string {
  const point = polarPoint(index, radius);

  return `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`;
}

function getLaneRadius(lane: ModalPlacementLane): number {
  switch (lane) {
    case "home":
      return 154;
    case "pure-modal":
      return 190;
    case "modal-mixture":
      return 174;
    default:
      return 154;
  }
}

function getClusterRadius(count: number): number {
  return Math.min(30, 10 + Math.sqrt(count) * 4.2);
}

function formatSeconds(value: number): string {
  return value.toFixed(2);
}

function trackTouchesSection(track: TrackView, sectionIndex: number): boolean {
  if (!track.placement) {
    return false;
  }

  return (
    circularDistance(track.placement.displayIndex, sectionIndex) <= 0.55 ||
    track.placement.homeIndex === sectionIndex ||
    track.placement.targetIndex === sectionIndex
  );
}

function circularDistance(first: number, second: number): number {
  const direct = Math.abs(first - second);

  return Math.min(direct, 12 - direct);
}

function polarPoint(index: number, radius: number): { x: number; y: number } {
  return pointAt(indexToAngle(index), radius);
}

function pointAt(angle: number, radius: number): { x: number; y: number } {
  return {
    x: Number((Math.cos(angle) * radius).toFixed(2)),
    y: Number((Math.sin(angle) * radius).toFixed(2)),
  };
}

function indexToAngle(index: number): number {
  return (index / 12) * Math.PI * 2 - Math.PI / 2;
}

function confidenceLabel(state: VerificationState): string {
  switch (state) {
    case "confirmed":
      return "confirmed";
    case "rejected":
      return "rejected";
    case "estimated":
      return "estimated";
    default:
      return state;
  }
}
</script>

<template>
  <main class="desk-shell">
    <header class="desk-header">
      <div>
        <p class="eyebrow">DJ Desk</p>
        <h1>Modal circle workspace</h1>
      </div>
      <div class="summary-strip" aria-label="Track analysis summary">
        <span>
          <strong>{{ visibleTracks.length }}</strong>
          tracks
        </span>
        <span>
          <strong>{{ confirmedCount }}</strong>
          confirmed keys
        </span>
        <span>
          <strong>{{ unknownKeyCount }}</strong>
          unknown keys
        </span>
        <span>
          <strong>{{ mixtureCount }}</strong>
          mixed modes
        </span>
      </div>
    </header>

    <section class="desk-grid">
      <section class="wheel-panel" aria-label="Circle of fifths desk">
        <div v-if="isLoading" class="state-line">Loading modal map...</div>
        <div v-else-if="errorMessage" class="state-line error">{{ errorMessage }}</div>
        <svg v-else class="circle-map" viewBox="-300 -300 600 600" role="img">
          <title>Tracks arranged by modal position on the circle of fifths</title>
          <g>
            <path
              v-for="section in sections"
              :key="section.pitch"
              class="sector"
              :class="{ active: !isUnknownKeyShelfSelected && section.index === selectedSection }"
              :d="sectorPath(section.index)"
              @click="selectSection(section.index)"
            />
          </g>

          <circle class="orbit collection" r="190" />
          <circle class="orbit bridge" r="174" />
          <circle class="orbit home" r="154" />

          <g
            v-for="section in sections"
            :key="`${section.pitch}-label`"
            class="section-label"
            :class="{ active: !isUnknownKeyShelfSelected && section.index === selectedSection }"
            :transform="labelTransform(section.index, 265)"
            @click="selectSection(section.index)"
          >
            <text class="label-main" text-anchor="middle">{{ section.label.primary }}</text>
            <text v-if="section.label.enharmonic" class="label-alt" y="17" text-anchor="middle">
              {{ section.label.enharmonic }}
            </text>
          </g>

          <g
            v-for="cluster in trackClusters"
            :key="`${cluster.lane}-${cluster.angleIndex}`"
            class="track-cluster"
            :class="[
              cluster.lane,
              {
                active: cluster.tracks.some((track) => track.id === selectedTrack?.id),
              },
            ]"
            :transform="`translate(${cluster.x} ${cluster.y})`"
            @click.stop="selectCluster(cluster)"
          >
            <circle :r="cluster.radius" />
            <text class="cluster-count" text-anchor="middle" dominant-baseline="central">
              {{ cluster.count }}
            </text>
            <title>{{ cluster.count }} tracks · {{ cluster.lane.replace("-", " ") }}</title>
          </g>

          <g class="center-readout">
            <circle r="76" />
            <text y="-12" text-anchor="middle">
              {{ selectedTrack?.key?.tonic ?? (isUnknownKeyShelfSelected ? "?" : selectedLabel) }}
            </text>
            <text y="14" text-anchor="middle">
              {{ selectedTrack?.key?.mode ?? (isUnknownKeyShelfSelected ? "unknown" : "section") }}
            </text>
          </g>
        </svg>
      </section>

      <aside class="set-chain" aria-label="Draft set chain">
        <div class="panel-heading">
          <p class="eyebrow">Draft set</p>
          <strong>{{ draftTracks.length }}</strong>
        </div>
        <ol>
          <li v-for="(track, index) in draftTracks" :key="track.id">
            <button type="button" class="chain-track" @click="selectTrack(track)">
              <span class="chain-index">{{ index + 1 }}</span>
              <strong>
                {{ track.title }}
                <span
                  v-if="hasHarmonyNotes(track)"
                  class="inline-harmony-badge"
                  title="Special harmony note"
                >
                  !
                </span>
              </strong>
              <small>{{ track.bpm }} BPM · {{ track.keyLabel }}</small>
            </button>
            <button
              type="button"
              class="icon-button"
              title="Remove"
              @click="removeFromDraft(track.id)"
            >
              ×
            </button>
          </li>
        </ol>
      </aside>

      <section class="track-browser" aria-label="Tracks in selected sector">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">{{ selectedLabel }} sector</p>
            <h2>{{ browserTitle }}</h2>
          </div>
          <div class="track-browser-actions">
            <button
              v-if="unknownKeyCount > 0"
              type="button"
              class="unknown-key-button"
              :class="{ active: isUnknownKeyShelfSelected }"
              @click="selectUnknownKeyTracks"
            >
              ? {{ unknownKeyCount }}
            </button>
            <button
              type="button"
              class="add-button"
              :disabled="!selectedTrack || selectedTrackInDraft"
              @click="addSelectedTrack"
            >
              Add
            </button>
          </div>
        </div>

        <div class="browser-grid">
          <button
            v-for="track in selectedSectionTracks"
            :key="track.id"
            type="button"
            class="track-row"
            :class="{ selected: selectedTrack?.id === track.id }"
            @click="selectTrack(track)"
          >
            <span class="row-badges">
              <span class="mode-chip" :class="track.placement?.lane ?? 'unknown-key'">
                {{ track.placement?.lane.replace("-", " ") ?? "unknown key" }}
              </span>
              <span class="confidence-badge" :class="track.confidence.key">
                Key {{ confidenceLabel(track.confidence.key) }}
              </span>
              <span class="confidence-badge" :class="track.confidence.bpm">
                BPM {{ confidenceLabel(track.confidence.bpm) }}
              </span>
              <span
                v-if="hasHarmonyNotes(track)"
                class="harmony-badge"
                title="Special harmony note"
              >
                !
              </span>
            </span>
            <strong>{{ track.title }}</strong>
            <small>{{ track.bpm }} BPM · {{ track.keyLabel }}</small>
          </button>
        </div>
      </section>

      <aside class="focus-panel" aria-label="Selected track">
        <p class="eyebrow">Focus track</p>
        <template v-if="selectedTrack">
          <h2>{{ selectedTrack.title }}</h2>
          <p class="artist">{{ selectedTrack.artist }}</p>
          <dl>
            <div>
              <dt>Key</dt>
              <dd class="value-with-badges">
                {{ selectedTrack.keyLabel }}
                <span class="confidence-badge" :class="selectedTrack.confidence.key">
                  {{ confidenceLabel(selectedTrack.confidence.key) }}
                </span>
              </dd>
            </div>
            <div>
              <dt>BPM</dt>
              <dd class="value-with-badges">
                {{ selectedTrack.bpm }}
                <span class="confidence-badge" :class="selectedTrack.confidence.bpm">
                  {{ confidenceLabel(selectedTrack.confidence.bpm) }}
                </span>
              </dd>
            </div>
            <div>
              <dt>Placement</dt>
              <dd>{{ selectedTrack.placement?.summary ?? "Not placed on circle yet" }}</dd>
            </div>
            <div>
              <dt>Used chords</dt>
              <dd>
                <span v-if="isHarmonyLoading" class="muted">Loading chords...</span>
                <span v-else-if="harmonyErrorMessage" class="muted">{{ harmonyErrorMessage }}</span>
                <span v-else class="chord-chip-list">
                  <span v-for="chord in usedChordList" :key="chord">{{ chord }}</span>
                </span>
              </dd>
            </div>
            <div v-if="visibleChordSegments.length > 0" class="full-chord-table-block">
              <dt>Full chord table</dt>
              <dd>
                <details>
                  <summary>{{ visibleChordSegments.length }} chord segments</summary>
                  <div class="segment-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Start</th>
                          <th>End</th>
                          <th>Chord</th>
                          <th>Bass</th>
                          <th>Basic</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="segment in visibleChordSegments" :key="segment.index">
                          <td>{{ segment.index }}</td>
                          <td>{{ formatSeconds(segment.startS) }}</td>
                          <td>{{ formatSeconds(segment.endS) }}</td>
                          <td>{{ segment.label }}</td>
                          <td>{{ segment.bass ?? "" }}</td>
                          <td>{{ segment.basicLabel ?? "" }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </details>
              </dd>
            </div>
            <div v-if="selectedTrack.harmonyNotes" class="harmony-note-block">
              <dt>Harmony note</dt>
              <dd>{{ selectedTrack.harmonyNotes }}</dd>
            </div>
            <div v-if="selectedTrack.comment">
              <dt>Comment</dt>
              <dd>{{ selectedTrack.comment }}</dd>
            </div>
          </dl>
          <div class="tag-row">
            <span v-for="tag in selectedTrack.tags" :key="tag">{{ tag }}</span>
          </div>
        </template>
        <p v-else class="muted">Select a dot or row.</p>
      </aside>
    </section>
  </main>
</template>
