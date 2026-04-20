<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import { CIRCLE_OF_FIFTHS, PITCH_CLASS_LABELS } from "@djdesk/domain";

import { fetchTracks, type TrackView } from "./api.ts";

interface TrackPoint {
  angleIndex: number;
  radius: number;
  track: TrackView;
  x: number;
  y: number;
}

const tracks = ref<TrackView[]>([]);
const errorMessage = ref("");
const isLoading = ref(true);
const selectedSection = ref(3);
const selectedTrack = ref<TrackView | null>(null);
const setDraft = ref<string[]>([]);

const sections = computed(() =>
  CIRCLE_OF_FIFTHS.map((pitch, index) => ({
    index,
    label: PITCH_CLASS_LABELS[pitch],
    pitch,
  })),
);

const visibleTracks = computed(() => tracks.value);

const selectedSectionTracks = computed(() =>
  tracks.value
    .filter((track) => trackTouchesSection(track, selectedSection.value))
    .sort((first, second) => first.bpm - second.bpm),
);

const selectedLabel = computed(() => sections.value[selectedSection.value]?.label.primary ?? "Do");

const confirmedCount = computed(
  () => visibleTracks.value.filter((track) => track.confidence.key === "confirmed").length,
);

const mixtureCount = computed(
  () => visibleTracks.value.filter((track) => track.placement.lane === "modal-mixture").length,
);

const harmonyNoteCount = computed(
  () => visibleTracks.value.filter((track) => hasHarmonyNotes(track)).length,
);

const draftTracks = computed(() =>
  setDraft.value
    .map((id) => tracks.value.find((track) => track.id === id))
    .filter((track): track is TrackView => Boolean(track)),
);

const selectedTrackInDraft = computed(() =>
  selectedTrack.value ? setDraft.value.includes(selectedTrack.value.id) : false,
);

const trackPoints = computed<TrackPoint[]>(() => {
  const grouped = new Map<string, TrackView[]>();

  for (const track of tracks.value) {
    const key = track.placement.displayIndex.toFixed(1);
    const group = grouped.get(key);

    if (group) {
      group.push(track);
    } else {
      grouped.set(key, [track]);
    }
  }

  return [...grouped.values()].flatMap((group) =>
    group.map((track, index) => {
      const laneRadius = getLaneRadius(track);
      const row = Math.floor(index / 5);
      const column = index % 5;
      const angleIndex = track.placement.displayIndex + (column - 2) * 0.035;
      const radius = laneRadius - row * 16 + (column % 2) * 4;
      const point = polarPoint(angleIndex, radius);

      return {
        angleIndex,
        radius,
        track,
        x: point.x,
        y: point.y,
      };
    }),
  );
});

onMounted(async () => {
  try {
    const response = await fetchTracks();

    tracks.value = response.tracks;
    selectedTrack.value = response.tracks[0] ?? null;
    setDraft.value = response.tracks.slice(0, 4).map((track) => track.id);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unknown API error";
  } finally {
    isLoading.value = false;
  }
});

function selectSection(index: number): void {
  selectedSection.value = index;
  selectedTrack.value = selectedSectionTracks.value[0] ?? selectedTrack.value;
}

function selectTrack(track: TrackView): void {
  selectedTrack.value = track;
  selectedSection.value = Math.round(track.placement.displayIndex) % 12;
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

function getLaneRadius(track: TrackView): number {
  switch (track.placement.lane) {
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

function trackTouchesSection(track: TrackView, sectionIndex: number): boolean {
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
          <strong>{{ mixtureCount }}</strong>
          mixed modes
        </span>
        <span>
          <strong>{{ harmonyNoteCount }}</strong>
          harmony notes
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
              :class="{ active: section.index === selectedSection }"
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
            :class="{ active: section.index === selectedSection }"
            :transform="labelTransform(section.index, 265)"
            @click="selectSection(section.index)"
          >
            <text class="label-main" text-anchor="middle">{{ section.label.primary }}</text>
            <text v-if="section.label.enharmonic" class="label-alt" y="17" text-anchor="middle">
              {{ section.label.enharmonic }}
            </text>
          </g>

          <g
            v-for="point in trackPoints"
            :key="point.track.id"
            class="track-point"
            :class="[
              point.track.placement.lane,
              point.track.confidence.key,
              {
                selected: selectedTrack?.id === point.track.id,
                'has-harmony-notes': hasHarmonyNotes(point.track),
              },
            ]"
            :transform="`translate(${point.x} ${point.y})`"
            @click.stop="selectTrack(point.track)"
          >
            <circle r="7" />
            <text
              v-if="hasHarmonyNotes(point.track)"
              class="harmony-marker"
              text-anchor="middle"
              dominant-baseline="central"
            >
              !
            </text>
            <title>{{ point.track.title }} - {{ point.track.keyLabel }}</title>
          </g>

          <g class="center-readout">
            <circle r="76" />
            <text y="-12" text-anchor="middle">
              {{ selectedTrack?.key.tonic ?? selectedLabel }}
            </text>
            <text y="14" text-anchor="middle">
              {{ selectedTrack?.key.mode ?? "section" }}
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
            <h2>{{ selectedSectionTracks.length }} nearby tracks</h2>
          </div>
          <button
            type="button"
            class="add-button"
            :disabled="!selectedTrack || selectedTrackInDraft"
            @click="addSelectedTrack"
          >
            Add
          </button>
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
              <span class="mode-chip" :class="track.placement.lane">
                {{ track.placement.lane.replace("-", " ") }}
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
              <dd>{{ selectedTrack.keyLabel }}</dd>
            </div>
            <div>
              <dt>Placement</dt>
              <dd>{{ selectedTrack.placement.summary }}</dd>
            </div>
            <div>
              <dt>Chords</dt>
              <dd>{{ selectedTrack.chordProgression.join(" - ") }}</dd>
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
