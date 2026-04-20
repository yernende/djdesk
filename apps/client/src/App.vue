<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import {
  areKeysTransitionCompatible,
  canKeysTransition,
  CIRCLE_OF_FIFTHS,
  getKeyTonicLabel,
  getModeLabel,
  getTransitionProfile,
  PITCH_CLASS_LABELS,
  type VerificationState,
} from "@djdesk/domain";

import {
  fetchTrackHarmony,
  fetchTracks,
  type TrackHarmonyResponse,
  type TrackView,
} from "./api.ts";

type SectionSlice = "home" | "pure-clockwise" | "pure-counter";
type SectionSelectionScope = "section" | "slice";
type CompatibilityClass = "compatible" | "incompatible" | null;

const DEFAULT_DRAFT_LENGTH = 6;
const DEFAULT_DRAFT_START_SECTION = 0;
const ZONE_INNER_RADIUS = 104;
const ZONE_OUTER_RADIUS = 232;
const MAIN_ZONE_HALF_WIDTH = 0.23;
const PURE_ZONE_START = 0.25;
const PURE_ZONE_END = 0.42;
const BOUNDARY_ZONE_HALF_WIDTH = 0.07;

const tracks = ref<TrackView[]>([]);
const errorMessage = ref("");
const isLoading = ref(true);
const harmonyErrorMessage = ref("");
const isHarmonyLoading = ref(false);
const isUnknownKeyShelfSelected = ref(false);
const selectedBoundaryIndex = ref<number | null>(null);
const selectedSection = ref(DEFAULT_DRAFT_START_SECTION);
const selectedSlice = ref<SectionSlice>("home");
const selectedSectionScope = ref<SectionSelectionScope>("section");
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

  if (selectedBoundaryIndex.value !== null) {
    return tracks.value
      .filter((track) => trackTouchesBoundary(track, selectedBoundaryIndex.value ?? 0))
      .sort((first, second) => first.bpm - second.bpm);
  }

  if (selectedSectionScope.value === "section") {
    return getSectionTracks(selectedSection.value).sort((first, second) => first.bpm - second.bpm);
  }

  return tracks.value
    .filter((track) =>
      trackBelongsToSectionSlice(track, selectedSection.value, selectedSlice.value),
    )
    .sort((first, second) => first.bpm - second.bpm);
});

const selectedLabel = computed(() => getSelectedPositionLabel());

const browserTitle = computed(() =>
  isUnknownKeyShelfSelected.value
    ? `${unknownKeyTracks.value.length} unplaced tracks`
    : selectedBoundaryIndex.value !== null
      ? `${selectedSectionTracks.value.length} boundary tracks`
      : selectedSectionScope.value === "section"
        ? `${selectedSectionTracks.value.length} section tracks`
        : `${selectedSectionTracks.value.length} ${getSliceBrowserLabel(selectedSlice.value)} tracks`,
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

const lastDraftTrack = computed(() => draftTracks.value.at(-1) ?? null);

const selectedTrackInDraft = computed(() =>
  selectedTrack.value ? setDraft.value.includes(selectedTrack.value.id) : false,
);

const isAddTransitionRisky = computed(() => {
  if (!selectedTrack.value || selectedTrackInDraft.value) {
    return false;
  }

  const previousTrack = draftTracks.value.at(-1);

  if (!previousTrack) {
    return false;
  }

  return !canTracksFollow(previousTrack, selectedTrack.value);
});

const visibleChordSegments = computed(() => trackHarmony.value?.chordSegments ?? []);

const usedChordList = computed(
  () => trackHarmony.value?.usedChords ?? selectedTrack.value?.chordProgression ?? [],
);

const sectionZoneSummaries = computed(() =>
  sections.value.map((section) => ({
    boundaryAfterCount: getBoundaryTracks(getBoundaryAfterIndex(section.index)).length,
    boundaryAfterLabelPoint: polarPoint(section.index + 0.5, 214),
    boundaryAfterPath: boundaryZonePath(section.index),
    homeCount: getSectionSliceTracks(section.index, "home").length,
    homeLabelPoint: polarPoint(section.index, 168),
    index: section.index,
    mainPath: subsectionPath(section.index, -MAIN_ZONE_HALF_WIDTH, MAIN_ZONE_HALF_WIDTH),
    pureClockwiseCount: getSectionSliceTracks(section.index, "pure-clockwise").length,
    pureClockwiseLabelPoint: polarPoint(section.index + 0.37, 196),
    pureClockwisePath: subsectionPath(section.index, PURE_ZONE_START, PURE_ZONE_END),
    pureCounterCount: getSectionSliceTracks(section.index, "pure-counter").length,
    pureCounterLabelPoint: polarPoint(section.index - 0.37, 196),
    pureCounterPath: subsectionPath(section.index, -PURE_ZONE_END, -PURE_ZONE_START),
    section,
  })),
);

onMounted(async () => {
  try {
    const response = await fetchTracks();

    tracks.value = response.tracks;
    selectedTrack.value = response.tracks[0] ?? null;
    selectedSection.value = selectedTrack.value?.placement
      ? Math.round(selectedTrack.value.placement.displayIndex) % 12
      : DEFAULT_DRAFT_START_SECTION;
    selectedBoundaryIndex.value = selectedTrack.value?.placement
      ? getBoundaryIndex(selectedTrack.value.placement)
      : null;
    selectedSlice.value = selectedTrack.value ? getTrackSectionSlice(selectedTrack.value) : "home";
    isUnknownKeyShelfSelected.value = Boolean(selectedTrack.value && !selectedTrack.value.key);
    setDraft.value = buildClockwiseDraft(response.tracks);
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
  selectedBoundaryIndex.value = null;
  selectedSection.value = index;
  selectedSectionScope.value = "section";
  selectedTrack.value = selectedSectionTracks.value[0] ?? selectedTrack.value;
}

function selectSectionSlice(index: number, slice: SectionSlice): void {
  isUnknownKeyShelfSelected.value = false;
  selectedBoundaryIndex.value = null;
  selectedSection.value = index;
  selectedSlice.value = slice;
  selectedSectionScope.value = "slice";
  selectedTrack.value = selectedSectionTracks.value[0] ?? selectedTrack.value;
}

function selectBoundary(boundaryIndex: number): void {
  isUnknownKeyShelfSelected.value = false;
  selectedBoundaryIndex.value = boundaryIndex;
  selectedSection.value = Math.floor(boundaryIndex);
  selectedSlice.value = "home";
  selectedSectionScope.value = "slice";
  selectedTrack.value = selectedSectionTracks.value[0] ?? selectedTrack.value;
}

function selectTrack(track: TrackView): void {
  selectedTrack.value = track;

  if (track.placement) {
    isUnknownKeyShelfSelected.value = false;
    selectedBoundaryIndex.value = getBoundaryIndex(track.placement);
    selectedSection.value = getTrackSectionIndex(track) ?? track.placement.homeIndex;
    selectedSlice.value = getTrackSectionSlice(track);
    selectedSectionScope.value = "slice";
  } else {
    isUnknownKeyShelfSelected.value = true;
    selectedBoundaryIndex.value = null;
    selectedSlice.value = "home";
    selectedSectionScope.value = "section";
  }
}

function selectUnknownKeyTracks(): void {
  isUnknownKeyShelfSelected.value = true;
  selectedBoundaryIndex.value = null;
  selectedSlice.value = "home";
  selectedSectionScope.value = "section";
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

function buildClockwiseDraft(sourceTracks: readonly TrackView[]): string[] {
  const starts = [
    DEFAULT_DRAFT_START_SECTION,
    ...sections.value
      .map((section) => section.index)
      .filter((index) => index !== DEFAULT_DRAFT_START_SECTION),
  ];
  let bestDraft: string[] = [];

  for (const start of starts) {
    const usedTrackIds = new Set<string>();
    const draft: string[] = [];

    for (let offset = 0; offset < DEFAULT_DRAFT_LENGTH; offset += 1) {
      const sectionIndex = (start + offset) % 12;
      const track = pickDraftTrackForSection(sourceTracks, sectionIndex, usedTrackIds);

      if (!track) {
        break;
      }

      usedTrackIds.add(track.id);
      draft.push(track.id);
    }

    if (draft.length > bestDraft.length) {
      bestDraft = draft;
    }

    if (draft.length === DEFAULT_DRAFT_LENGTH) {
      return draft;
    }
  }

  return bestDraft;
}

function pickDraftTrackForSection(
  sourceTracks: readonly TrackView[],
  sectionIndex: number,
  usedTrackIds: ReadonlySet<string>,
): TrackView | null {
  const candidates = sourceTracks
    .filter((track) => !usedTrackIds.has(track.id) && getTrackSectionIndex(track) === sectionIndex)
    .sort(compareDraftCandidates);

  return candidates[0] ?? null;
}

function compareDraftCandidates(first: TrackView, second: TrackView): number {
  const firstScore = getDraftCandidateScore(first);
  const secondScore = getDraftCandidateScore(second);

  if (firstScore !== secondScore) {
    return secondScore - firstScore;
  }

  if (first.bpm !== second.bpm) {
    return first.bpm - second.bpm;
  }

  return first.title.localeCompare(second.title);
}

function getDraftCandidateScore(track: TrackView): number {
  let score = 0;

  if (track.placement?.lane === "home") {
    score += 2;
  }

  if (track.confidence.key === "confirmed") {
    score += 1;
  }

  if (track.confidence.bpm === "confirmed") {
    score += 1;
  }

  return score;
}

function hasHarmonyNotes(track: TrackView): boolean {
  return Boolean(track.harmonyNotes?.trim());
}

function sectorPath(index: number): string {
  return annularSectorPath(index - 0.5, index + 0.5, 92, 248);
}

function subsectionPath(index: number, startOffset: number, endOffset: number): string {
  return annularSectorPath(
    index + startOffset,
    index + endOffset,
    ZONE_INNER_RADIUS,
    ZONE_OUTER_RADIUS,
  );
}

function boundaryZonePath(index: number): string {
  return annularSectorPath(
    index + 0.5 - BOUNDARY_ZONE_HALF_WIDTH,
    index + 0.5 + BOUNDARY_ZONE_HALF_WIDTH,
    ZONE_INNER_RADIUS,
    ZONE_OUTER_RADIUS,
  );
}

function annularSectorPath(
  startIndex: number,
  endIndex: number,
  innerRadius: number,
  outerRadius: number,
): string {
  const start = indexToAngle(startIndex);
  const end = indexToAngle(endIndex);
  const outerStart = pointAt(start, outerRadius);
  const outerEnd = pointAt(end, outerRadius);
  const innerStart = pointAt(start, innerRadius);
  const innerEnd = pointAt(end, innerRadius);
  const largeArcFlag = Math.abs(endIndex - startIndex) > 6 ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function labelTransform(index: number, radius: number): string {
  const point = polarPoint(index, radius);

  return `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`;
}

function formatSeconds(value: number): string {
  return value.toFixed(2);
}

function trackBelongsToSectionSlice(
  track: TrackView,
  sectionIndex: number,
  slice: SectionSlice,
): boolean {
  if (!track.placement) {
    return false;
  }

  if (slice === "home") {
    return track.placement.lane === "home" && track.placement.homeIndex === sectionIndex;
  }

  if (track.placement.lane !== "pure-modal") {
    return false;
  }

  return getTrackSectionIndex(track) === sectionIndex && getPureModalSide(track) === slice;
}

function getSectionSliceTracks(sectionIndex: number, slice: SectionSlice): TrackView[] {
  return tracks.value.filter((track) => trackBelongsToSectionSlice(track, sectionIndex, slice));
}

function getSectionTracks(sectionIndex: number): TrackView[] {
  return tracks.value.filter((track) => trackBelongsToSection(track, sectionIndex));
}

function trackBelongsToSection(track: TrackView, sectionIndex: number): boolean {
  return getTrackTouchedSections(track).includes(sectionIndex);
}

function getBoundaryTracks(boundaryIndex: number): TrackView[] {
  return tracks.value.filter((track) => trackTouchesBoundary(track, boundaryIndex));
}

function trackTouchesBoundary(track: TrackView, boundaryIndex: number): boolean {
  if (!track.placement) {
    return false;
  }

  return Math.abs(track.placement.displayIndex - boundaryIndex) < 0.01;
}

function getTrackSectionIndex(track: TrackView): number | null {
  if (!track.placement) {
    return null;
  }

  return Math.round(track.placement.displayIndex) % 12;
}

function getTrackSectionSlice(track: TrackView): SectionSlice {
  const pureSide = getPureModalSide(track);

  return pureSide ?? "home";
}

function getPureModalSide(track: TrackView): Exclude<SectionSlice, "home"> | null {
  if (!track.placement || track.placement.lane !== "pure-modal") {
    return null;
  }

  const sectionIndex = getTrackSectionIndex(track);

  if (sectionIndex === null) {
    return null;
  }

  return getSignedCircularOffset(sectionIndex, track.placement.displayIndex) > 0
    ? "pure-clockwise"
    : "pure-counter";
}

function getBoundaryAfterIndex(index: number): number {
  return index === 11 ? 11.5 : index + 0.5;
}

function getSliceBrowserLabel(slice: SectionSlice): string {
  switch (slice) {
    case "home":
      return "home";
    case "pure-clockwise":
      return "clockwise pure modal";
    case "pure-counter":
      return "counter pure modal";
    default:
      return assertNever(slice);
  }
}

function canTracksFollow(previousTrack: TrackView, nextTrack: TrackView): boolean {
  return canKeysTransition(previousTrack.key, nextTrack.key);
}

function getTrackTouchedSections(track: TrackView): number[] {
  const profile = getTransitionProfile(track.key);

  if (!profile) {
    return [];
  }

  if (profile.kind === "home") {
    return [profile.section];
  }

  if (profile.kind === "pure-modal") {
    return [profile.targetSection];
  }

  return [...profile.boundarySections];
}

function getSectionSliceCompatibilityClass(index: number, slice: SectionSlice): CompatibilityClass {
  return getCompatibilityClass(getSectionSliceTracks(index, slice));
}

function getBoundaryCompatibilityClass(boundaryIndex: number): CompatibilityClass {
  return getCompatibilityClass(getBoundaryTracks(boundaryIndex));
}

function getCompatibilityClass(candidateTracks: readonly TrackView[]): CompatibilityClass {
  const referenceKey = lastDraftTrack.value?.key ?? null;

  if (!referenceKey || candidateTracks.length === 0) {
    return null;
  }

  return candidateTracks.some(
    (track) => track.key && areKeysTransitionCompatible(referenceKey, track.key),
  )
    ? "compatible"
    : "incompatible";
}

function getBoundaryIndex(placement: TrackView["placement"]): number | null {
  if (!placement || placement.lane !== "modal-mixture") {
    return null;
  }

  const nearestHalf = Math.round(placement.displayIndex * 2) / 2;

  return Math.abs(nearestHalf % 1) === 0.5 && Math.abs(placement.displayIndex - nearestHalf) < 0.01
    ? nearestHalf
    : null;
}

function getSelectedPositionLabel(): string {
  if (isUnknownKeyShelfSelected.value) {
    return "Unknown key";
  }

  if (selectedBoundaryIndex.value !== null) {
    const before = Math.floor(selectedBoundaryIndex.value);
    const after = Math.ceil(selectedBoundaryIndex.value) % 12;
    const beforeLabel = getSectionDisplayLabel(before);
    const afterLabel = getSectionDisplayLabel(after);

    return `${beforeLabel} / ${afterLabel} boundary`;
  }

  const sectionLabel = getSectionDisplayLabel(selectedSection.value);

  if (selectedSectionScope.value === "section") {
    return `${sectionLabel} section`;
  }

  switch (selectedSlice.value) {
    case "home":
      return sectionLabel;
    case "pure-clockwise":
      return `${sectionLabel} clockwise modal`;
    case "pure-counter":
      return `${sectionLabel} counter modal`;
    default:
      return assertNever(selectedSlice.value);
  }
}

function getSectionDisplayLabel(index: number): string {
  const label = sections.value[index]?.label;

  if (!label) {
    return "La m";
  }

  return label.enharmonic ? `${label.primary} / ${label.enharmonic}` : label.primary;
}

function isSubsectionActive(index: number, slice: SectionSlice): boolean {
  return isLastDraftSectionSlice(index, slice);
}

function isBoundaryActive(boundaryIndex: number): boolean {
  return isLastDraftBoundary(boundaryIndex);
}

function isSectionSelected(index: number): boolean {
  return (
    !isUnknownKeyShelfSelected.value &&
    selectedBoundaryIndex.value === null &&
    selectedSectionScope.value === "section" &&
    selectedSection.value === index
  );
}

function isLastDraftSection(index: number): boolean {
  return lastDraftTrack.value
    ? getTrackTouchedSections(lastDraftTrack.value).includes(index)
    : false;
}

function isLastDraftSectionSlice(index: number, slice: SectionSlice): boolean {
  return lastDraftTrack.value
    ? trackBelongsToSectionSlice(lastDraftTrack.value, index, slice)
    : false;
}

function isLastDraftBoundary(boundaryIndex: number): boolean {
  return lastDraftTrack.value ? trackTouchesBoundary(lastDraftTrack.value, boundaryIndex) : false;
}

function getSignedCircularOffset(from: number, to: number): number {
  let delta = to - from;

  if (delta > 6) {
    delta -= 12;
  } else if (delta < -6) {
    delta += 12;
  }

  return delta;
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
      return "unverified";
    default:
      return state;
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
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
              :class="{ selected: isSectionSelected(section.index) }"
              :d="sectorPath(section.index)"
              @click="selectSection(section.index)"
            />
          </g>

          <g>
            <g v-for="zone in sectionZoneSummaries" :key="`${zone.section.pitch}-subsections`">
              <path
                class="subsection home"
                :class="{
                  active: isSubsectionActive(zone.index, 'home'),
                  compatible:
                    getSectionSliceCompatibilityClass(zone.index, 'home') === 'compatible',
                  incompatible:
                    getSectionSliceCompatibilityClass(zone.index, 'home') === 'incompatible',
                  'last-draft': isLastDraftSectionSlice(zone.index, 'home'),
                }"
                :d="zone.mainPath"
                @click.stop="selectSectionSlice(zone.index, 'home')"
              />
              <path
                class="subsection pure-modal"
                :class="{
                  active: isSubsectionActive(zone.index, 'pure-counter'),
                  compatible:
                    getSectionSliceCompatibilityClass(zone.index, 'pure-counter') === 'compatible',
                  empty: zone.pureCounterCount === 0,
                  incompatible:
                    getSectionSliceCompatibilityClass(zone.index, 'pure-counter') ===
                    'incompatible',
                  'last-draft': isLastDraftSectionSlice(zone.index, 'pure-counter'),
                }"
                :d="zone.pureCounterPath"
                @click.stop="selectSectionSlice(zone.index, 'pure-counter')"
              />
              <path
                class="subsection pure-modal"
                :class="{
                  active: isSubsectionActive(zone.index, 'pure-clockwise'),
                  compatible:
                    getSectionSliceCompatibilityClass(zone.index, 'pure-clockwise') ===
                    'compatible',
                  empty: zone.pureClockwiseCount === 0,
                  incompatible:
                    getSectionSliceCompatibilityClass(zone.index, 'pure-clockwise') ===
                    'incompatible',
                  'last-draft': isLastDraftSectionSlice(zone.index, 'pure-clockwise'),
                }"
                :d="zone.pureClockwisePath"
                @click.stop="selectSectionSlice(zone.index, 'pure-clockwise')"
              />

              <text
                v-if="zone.homeCount > 0"
                class="zone-count home"
                :x="zone.homeLabelPoint.x"
                :y="zone.homeLabelPoint.y"
                text-anchor="middle"
                dominant-baseline="central"
              >
                {{ zone.homeCount }}
              </text>
              <text
                v-if="zone.pureCounterCount > 0"
                class="zone-count pure-modal"
                :x="zone.pureCounterLabelPoint.x"
                :y="zone.pureCounterLabelPoint.y"
                text-anchor="middle"
                dominant-baseline="central"
              >
                {{ zone.pureCounterCount }}
              </text>
              <text
                v-if="zone.pureClockwiseCount > 0"
                class="zone-count pure-modal"
                :x="zone.pureClockwiseLabelPoint.x"
                :y="zone.pureClockwiseLabelPoint.y"
                text-anchor="middle"
                dominant-baseline="central"
              >
                {{ zone.pureClockwiseCount }}
              </text>
            </g>

            <g v-for="zone in sectionZoneSummaries" :key="`${zone.section.pitch}-boundary`">
              <path
                class="boundary-zone"
                :class="{
                  active: isBoundaryActive(getBoundaryAfterIndex(zone.index)),
                  compatible:
                    getBoundaryCompatibilityClass(getBoundaryAfterIndex(zone.index)) ===
                    'compatible',
                  empty: zone.boundaryAfterCount === 0,
                  incompatible:
                    getBoundaryCompatibilityClass(getBoundaryAfterIndex(zone.index)) ===
                    'incompatible',
                  'last-draft': isLastDraftBoundary(getBoundaryAfterIndex(zone.index)),
                }"
                :d="zone.boundaryAfterPath"
                @click.stop="selectBoundary(getBoundaryAfterIndex(zone.index))"
              />
              <text
                v-if="zone.boundaryAfterCount > 0"
                class="zone-count boundary"
                :x="zone.boundaryAfterLabelPoint.x"
                :y="zone.boundaryAfterLabelPoint.y"
                text-anchor="middle"
                dominant-baseline="central"
              >
                {{ zone.boundaryAfterCount }}
              </text>
            </g>
          </g>

          <g
            v-for="section in sections"
            :key="`${section.pitch}-label`"
            class="section-label"
            :class="{
              active: isLastDraftSection(section.index),
              'last-draft': isLastDraftSection(section.index),
              selected: isSectionSelected(section.index),
            }"
            :transform="labelTransform(section.index, 265)"
            @click="selectSection(section.index)"
          >
            <text class="label-main" text-anchor="middle">{{ section.label.primary }}</text>
            <text v-if="section.label.enharmonic" class="label-alt" y="17" text-anchor="middle">
              {{ section.label.enharmonic }}
            </text>
          </g>

          <g class="center-readout">
            <circle r="76" />
            <text y="-12" text-anchor="middle">
              {{
                selectedTrack?.key
                  ? getKeyTonicLabel(selectedTrack.key)
                  : isUnknownKeyShelfSelected
                    ? "?"
                    : selectedLabel
              }}
            </text>
            <text y="14" text-anchor="middle">
              {{
                selectedTrack?.key
                  ? getModeLabel(selectedTrack.key.mode)
                  : isUnknownKeyShelfSelected
                    ? "unknown"
                    : "section"
              }}
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
              :class="{ risky: isAddTransitionRisky || selectedTrackInDraft }"
              :disabled="!selectedTrack"
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
