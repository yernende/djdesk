<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";

import {
  areKeysTransitionCompatible,
  canKeysTransition,
  CIRCLE_OF_FIFTHS,
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
type PlacementLane = NonNullable<TrackView["placement"]>["lane"];

interface DraftSet {
  id: string;
  name: string;
  trackIds: string[];
}

interface CenterReadout {
  subtitle: string;
  title: string;
}

interface DraftSortItem {
  originalIndex: number;
  track: TrackView | null;
  trackId: string;
}

const DEFAULT_DRAFT_LENGTH = 6;
const DEFAULT_DRAFT_START_SECTION = 0;
const ZONE_INNER_RADIUS = 104;
const ZONE_OUTER_RADIUS = 232;
const MAIN_ZONE_HALF_WIDTH = 0.23;
const PURE_ZONE_START = 0.25;
const PURE_ZONE_END = 0.42;
const BOUNDARY_ZONE_HALF_WIDTH = 0.07;
const BPM_SCORE_HALF_LIFE = 0.06;

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
const draftSets = ref<DraftSet[]>([]);
const activeDraftSetId = ref("main");
const trackHarmony = ref<TrackHarmonyResponse | null>(null);
const draggedDraftIndex = ref<number | null>(null);
const dragOverDraftIndex = ref<number | null>(null);
const audioPlayer = ref<HTMLAudioElement | null>(null);

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
    return sortBrowserTracks(unknownKeyTracks.value);
  }

  if (selectedBoundaryIndex.value !== null) {
    return sortBrowserTracks(
      tracks.value.filter((track) => trackTouchesBoundary(track, selectedBoundaryIndex.value ?? 0)),
    );
  }

  if (selectedSectionScope.value === "section") {
    return sortBrowserTracks(getSectionTracks(selectedSection.value));
  }

  return sortBrowserTracks(
    tracks.value.filter((track) =>
      trackBelongsToSectionSlice(track, selectedSection.value, selectedSlice.value),
    ),
  );
});

const selectedLabel = computed(() => getSelectedPositionLabel());

const centerReadout = computed(() => getCenterReadout());

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

const activeDraftSet = computed(
  () =>
    draftSets.value.find((draftSet) => draftSet.id === activeDraftSetId.value) ??
    draftSets.value[0] ??
    null,
);

const activeDraftTrackIds = computed(() => activeDraftSet.value?.trackIds ?? []);

const draftTracks = computed(() =>
  activeDraftTrackIds.value
    .map((id) => tracks.value.find((track) => track.id === id))
    .filter((track): track is TrackView => Boolean(track)),
);

const lastDraftTrack = computed(() => draftTracks.value.at(-1) ?? null);

const selectedTrackInAnyDraftSet = computed(() => {
  const trackId = selectedTrack.value?.id;

  return trackId ? isTrackInAnyDraftSet(trackId) : false;
});

const isAddTransitionRisky = computed(() => {
  if (!selectedTrack.value) {
    return false;
  }

  return isTrackTransitionRisky(selectedTrack.value);
});

const addButtonLabel = computed(() => (selectedTrackInAnyDraftSet.value ? "Add again" : "Add"));

const addButtonTitle = computed(() => {
  if (isAddTransitionRisky.value) {
    return "Non-harmonic transition";
  }

  if (selectedTrackInAnyDraftSet.value) {
    return "Track already appears in at least one draft set";
  }

  return "Add to active draft set";
});

const addButtonReason = computed(() => {
  if (isAddTransitionRisky.value && selectedTrackInAnyDraftSet.value) {
    return "Already in a set; non-harmonic";
  }

  if (isAddTransitionRisky.value) {
    return "Non-harmonic";
  }

  if (selectedTrackInAnyDraftSet.value) {
    return "Already in a set";
  }

  return "";
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
    draftSets.value = buildMockDraftSets(response.tracks);
    activeDraftSetId.value = draftSets.value[0]?.id ?? "main";
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

watch(
  selectedTrack,
  async (track, previousTrack) => {
    const shouldContinuePlayback =
      Boolean(previousTrack && track && previousTrack.id !== track.id) &&
      isAudioElementPlaying(audioPlayer.value);

    if (!shouldContinuePlayback || !track?.audioUrl) {
      return;
    }

    await nextTick();
    await audioPlayer.value?.play().catch(() => undefined);
  },
  {
    flush: "sync",
  },
);

function selectSection(index: number): void {
  isUnknownKeyShelfSelected.value = false;
  selectedBoundaryIndex.value = null;
  selectedSection.value = index;
  selectedSectionScope.value = "section";
  selectPreferredBrowserTrack();
}

function isAudioElementPlaying(audioElement: HTMLAudioElement | null): boolean {
  return Boolean(audioElement && !audioElement.paused && !audioElement.ended);
}

function selectSectionSlice(index: number, slice: SectionSlice): void {
  isUnknownKeyShelfSelected.value = false;
  selectedBoundaryIndex.value = null;
  selectedSection.value = index;
  selectedSlice.value = slice;
  selectedSectionScope.value = "slice";
  selectPreferredBrowserTrack();
}

function selectBoundary(boundaryIndex: number): void {
  isUnknownKeyShelfSelected.value = false;
  selectedBoundaryIndex.value = boundaryIndex;
  selectedSection.value = Math.floor(boundaryIndex);
  selectedSlice.value = "home";
  selectedSectionScope.value = "slice";
  selectPreferredBrowserTrack();
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
  selectPreferredBrowserTrack();
}

function selectPreferredBrowserTrack(): void {
  selectedTrack.value =
    getPreferredBrowserTrack(selectedSectionTracks.value) ?? selectedTrack.value;
}

function getPreferredBrowserTrack(trackList: readonly TrackView[]): TrackView | null {
  return trackList.find((track) => !isAddButtonRedForTrack(track)) ?? trackList[0] ?? null;
}

function isAddButtonRedForTrack(track: TrackView): boolean {
  return isTrackInAnyDraftSet(track.id) || isTrackTransitionRisky(track);
}

function isTrackInAnyDraftSet(trackId: string): boolean {
  return draftSets.value.some((draftSet) => draftSet.trackIds.includes(trackId));
}

function isTrackTransitionRisky(track: TrackView): boolean {
  const previousTrack = draftTracks.value.at(-1);

  return Boolean(previousTrack && !canTracksFollow(previousTrack, track));
}

function selectDraftSet(id: string): void {
  activeDraftSetId.value = id;
}

function addSelectedTrack(): void {
  if (!selectedTrack.value || !activeDraftSet.value) {
    return;
  }

  updateActiveDraftTrackIds([...activeDraftTrackIds.value, selectedTrack.value.id]);
}

function removeFromDraftAt(index: number): void {
  updateActiveDraftTrackIds(
    activeDraftTrackIds.value.filter((_, trackIndex) => trackIndex !== index),
  );
}

function moveDraftTrack(index: number, direction: -1 | 1): void {
  reorderDraftTrack(index, index + direction);
}

function reorderDraftTrack(fromIndex: number, toIndex: number): void {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= activeDraftTrackIds.value.length ||
    toIndex >= activeDraftTrackIds.value.length
  ) {
    return;
  }

  const trackIds = [...activeDraftTrackIds.value];
  const [trackId] = trackIds.splice(fromIndex, 1);

  if (!trackId) {
    return;
  }

  trackIds.splice(toIndex, 0, trackId);
  updateActiveDraftTrackIds(trackIds);
}

function sortActiveDraftHarmonically(): void {
  const items = activeDraftTrackIds.value.map((trackId, originalIndex) => ({
    originalIndex,
    track: tracks.value.find((track) => track.id === trackId) ?? null,
    trackId,
  }));

  if (items.length < 2) {
    return;
  }

  const sortedItems = sortDraftItemsHarmonically(items);
  updateActiveDraftTrackIds(sortedItems.map((item) => item.trackId));
}

function sortDraftItemsHarmonically(items: readonly DraftSortItem[]): DraftSortItem[] {
  const candidates = items.map((_, startIndex) => buildGreedyHarmonicOrder(items, startIndex));

  return candidates.sort(compareDraftSequences)[0] ?? [...items];
}

function buildGreedyHarmonicOrder(
  items: readonly DraftSortItem[],
  startIndex: number,
): DraftSortItem[] {
  const unused = items.filter((_, index) => index !== startIndex);
  const order = [items[startIndex]].filter((item): item is DraftSortItem => Boolean(item));

  while (unused.length > 0) {
    const current = order.at(-1);
    const nextIndex = current ? pickNextHarmonicItemIndex(current, unused) : 0;
    const [nextItem] = unused.splice(nextIndex, 1);

    if (nextItem) {
      order.push(nextItem);
    }
  }

  return order;
}

function pickNextHarmonicItemIndex(
  current: DraftSortItem,
  candidates: readonly DraftSortItem[],
): number {
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  candidates.forEach((candidate, index) => {
    const score = getDraftTransitionScore(current, candidate);
    const bestCandidate = candidates[bestIndex];

    if (
      score > bestScore ||
      (score === bestScore &&
        (!bestCandidate || candidate.originalIndex < bestCandidate.originalIndex))
    ) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function compareDraftSequences(first: DraftSortItem[], second: DraftSortItem[]): number {
  const firstScore = getDraftSequenceScore(first);
  const secondScore = getDraftSequenceScore(second);

  if (firstScore !== secondScore) {
    return secondScore - firstScore;
  }

  return getDraftSequenceMovement(first) - getDraftSequenceMovement(second);
}

function getDraftSequenceScore(items: readonly DraftSortItem[]): number {
  return items.reduce((score, item, index) => {
    const previous = items[index - 1];

    return previous ? score + getDraftTransitionScore(previous, item) : score;
  }, 0);
}

function getDraftSequenceMovement(items: readonly DraftSortItem[]): number {
  return items.reduce((score, item, index) => score + Math.abs(item.originalIndex - index), 0);
}

function getDraftTransitionScore(previous: DraftSortItem, next: DraftSortItem): number {
  if (!previous.track || !next.track) {
    return -1_000;
  }

  if (canTracksFollow(previous.track, next.track)) {
    return 1_000 - getBpmDistance(previous.track, next.track);
  }

  return (
    -100 -
    getCircleDistance(previous.track, next.track) * 10 -
    getBpmDistance(previous.track, next.track)
  );
}

function getBpmDistance(previous: TrackView, next: TrackView): number {
  return Math.min(Math.abs(previous.bpm - next.bpm), 40) / 40;
}

function getCircleDistance(previous: TrackView, next: TrackView): number {
  const previousIndex = previous.placement?.displayIndex;
  const nextIndex = next.placement?.displayIndex;

  if (previousIndex === undefined || nextIndex === undefined) {
    return 12;
  }

  const distance = Math.abs(previousIndex - nextIndex);

  return Math.min(distance, 12 - distance);
}

function startDraftDrag(event: DragEvent, index: number): void {
  draggedDraftIndex.value = index;
  dragOverDraftIndex.value = index;

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  }
}

function enterDraftDropTarget(index: number): void {
  if (draggedDraftIndex.value !== null) {
    dragOverDraftIndex.value = index;
  }
}

function dropDraftTrack(event: DragEvent, index: number): void {
  event.preventDefault();

  const serializedIndex = event.dataTransfer?.getData("text/plain") ?? "";
  const parsedIndex = Number.parseInt(serializedIndex, 10);
  const fromIndex = draggedDraftIndex.value ?? parsedIndex;

  if (Number.isInteger(fromIndex)) {
    reorderDraftTrack(fromIndex, index);
  }

  endDraftDrag();
}

function endDraftDrag(): void {
  draggedDraftIndex.value = null;
  dragOverDraftIndex.value = null;
}

function updateActiveDraftTrackIds(trackIds: string[]): void {
  const activeSetId = activeDraftSet.value?.id;

  if (!activeSetId) {
    return;
  }

  draftSets.value = draftSets.value.map((draftSet) =>
    draftSet.id === activeSetId
      ? {
          ...draftSet,
          trackIds,
        }
      : draftSet,
  );
}

function buildMockDraftSets(sourceTracks: readonly TrackView[]): DraftSet[] {
  return [
    {
      id: "main",
      name: "Festival draft",
      trackIds: buildClockwiseDraft(sourceTracks, DEFAULT_DRAFT_START_SECTION),
    },
    {
      id: "warmup",
      name: "Warmup arc",
      trackIds: buildClockwiseDraft(sourceTracks, 9),
    },
    {
      id: "bridge",
      name: "Bridge ideas",
      trackIds: buildClockwiseDraft(sourceTracks, 3),
    },
  ];
}

function buildClockwiseDraft(
  sourceTracks: readonly TrackView[],
  preferredStart = DEFAULT_DRAFT_START_SECTION,
): string[] {
  const starts = [
    preferredStart,
    ...sections.value.map((section) => section.index).filter((index) => index !== preferredStart),
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
      return "natural";
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

function isDraftTransitionRisky(index: number): boolean {
  if (index <= 0) {
    return false;
  }

  const previousTrack = draftTracks.value[index - 1];
  const nextTrack = draftTracks.value[index];

  return Boolean(previousTrack && nextTrack && !canTracksFollow(previousTrack, nextTrack));
}

function sortBrowserTracks(trackList: readonly TrackView[]): TrackView[] {
  return [...trackList].sort(compareBrowserTracks);
}

function compareBrowserTracks(first: TrackView, second: TrackView): number {
  const referenceTrack = lastDraftTrack.value;

  if (referenceTrack) {
    const firstScore = getBpmCompatibilityScore(referenceTrack.bpm, first.bpm);
    const secondScore = getBpmCompatibilityScore(referenceTrack.bpm, second.bpm);

    if (firstScore !== secondScore) {
      return secondScore - firstScore;
    }

    const firstHarmonicScore = canTracksFollow(referenceTrack, first) ? 1 : 0;
    const secondHarmonicScore = canTracksFollow(referenceTrack, second) ? 1 : 0;

    if (firstHarmonicScore !== secondHarmonicScore) {
      return secondHarmonicScore - firstHarmonicScore;
    }
  }

  if (first.bpm !== second.bpm) {
    return first.bpm - second.bpm;
  }

  return first.title.localeCompare(second.title);
}

function getTrackBpmCompatibilityScore(track: TrackView): number | null {
  const referenceTrack = lastDraftTrack.value;

  return referenceTrack ? getBpmCompatibilityScore(referenceTrack.bpm, track.bpm) : null;
}

function getTrackBpmCompatibilityWidth(track: TrackView): string {
  return `${getTrackBpmCompatibilityScore(track) ?? 0}%`;
}

function getTrackBpmCompatibilityTitle(track: TrackView): string {
  const referenceTrack = lastDraftTrack.value;

  if (!referenceTrack) {
    return "No draft endpoint selected";
  }

  const deltaPercent = getBpmDeltaRatio(referenceTrack.bpm, track.bpm) * 100;
  const score = getBpmCompatibilityScore(referenceTrack.bpm, track.bpm);

  return `BPM match against ${referenceTrack.bpm} BPM: ${score}/100, ${deltaPercent.toFixed(1)}% apart`;
}

function getBpmCompatibilityScore(referenceBpm: number, candidateBpm: number): number {
  const deltaRatio = getBpmDeltaRatio(referenceBpm, candidateBpm);
  const normalizedDelta = deltaRatio / BPM_SCORE_HALF_LIFE;
  const score = 100 / (1 + normalizedDelta * normalizedDelta);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function getBpmDeltaRatio(referenceBpm: number, candidateBpm: number): number {
  if (referenceBpm <= 0 || candidateBpm <= 0) {
    return 1;
  }

  return Math.abs(candidateBpm - referenceBpm) / referenceBpm;
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

function getCenterReadout(): CenterReadout {
  if (isUnknownKeyShelfSelected.value) {
    return {
      subtitle: "Unplaced tracks",
      title: "Unknown key",
    };
  }

  if (selectedBoundaryIndex.value !== null) {
    const before = Math.floor(selectedBoundaryIndex.value);
    const after = Math.ceil(selectedBoundaryIndex.value) % 12;

    return {
      subtitle: "Boundary",
      title: `${getSectionPrimaryDisplayLabel(before)} / ${getSectionPrimaryDisplayLabel(after)}`,
    };
  }

  const sectionLabel = getSectionDisplayLabel(selectedSection.value);

  if (selectedSectionScope.value === "section") {
    return {
      subtitle: "Section",
      title: sectionLabel,
    };
  }

  switch (selectedSlice.value) {
    case "home":
      return {
        subtitle: "Natural",
        title: sectionLabel,
      };
    case "pure-clockwise":
      return {
        subtitle: "Clockwise modal",
        title: sectionLabel,
      };
    case "pure-counter":
      return {
        subtitle: "Counter modal",
        title: sectionLabel,
      };
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

function getSectionPrimaryDisplayLabel(index: number): string {
  return sections.value[index]?.label.primary ?? "La m";
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

function isSectionSliceSelected(index: number, slice: SectionSlice): boolean {
  return (
    !isUnknownKeyShelfSelected.value &&
    selectedBoundaryIndex.value === null &&
    selectedSectionScope.value === "slice" &&
    selectedSection.value === index &&
    selectedSlice.value === slice
  );
}

function isBoundarySelected(boundaryIndex: number): boolean {
  return (
    !isUnknownKeyShelfSelected.value &&
    selectedBoundaryIndex.value !== null &&
    Math.abs(selectedBoundaryIndex.value - boundaryIndex) < 0.01
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

function placementLaneLabel(lane: PlacementLane | undefined): string {
  switch (lane) {
    case "home":
      return "natural";
    case "modal-mixture":
      return "modal mixture";
    case "pure-modal":
      return "pure modal";
    case undefined:
      return "unknown key";
    default:
      return assertNever(lane);
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
                  selected: isSectionSliceSelected(zone.index, 'home'),
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
                  selected: isSectionSliceSelected(zone.index, 'pure-counter'),
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
                  selected: isSectionSliceSelected(zone.index, 'pure-clockwise'),
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
                  selected: isBoundarySelected(getBoundaryAfterIndex(zone.index)),
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
            <text class="readout-title" y="-10" text-anchor="middle">
              {{ centerReadout.title }}
            </text>
            <text class="readout-subtitle" y="16" text-anchor="middle">
              {{ centerReadout.subtitle }}
            </text>
          </g>
        </svg>
        <button
          v-if="!isLoading && !errorMessage && unknownKeyCount > 0"
          type="button"
          class="unknown-key-button unknown-key-float"
          :class="{ active: isUnknownKeyShelfSelected }"
          @click="selectUnknownKeyTracks"
        >
          ? {{ unknownKeyCount }}
        </button>
      </section>

      <aside class="set-chain" aria-label="Draft set chain">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Draft sets</p>
            <h2>{{ activeDraftSet?.name ?? "Draft set" }}</h2>
          </div>
          <strong>{{ draftTracks.length }}</strong>
        </div>
        <div class="set-tabs" aria-label="Draft set selector">
          <button
            v-for="draftSet in draftSets"
            :key="draftSet.id"
            type="button"
            class="set-tab"
            :class="{ active: draftSet.id === activeDraftSetId }"
            @click="selectDraftSet(draftSet.id)"
          >
            <span>{{ draftSet.name }}</span>
            <small>{{ draftSet.trackIds.length }}</small>
          </button>
        </div>
        <button
          type="button"
          class="sort-harmonic-button"
          :disabled="activeDraftTrackIds.length < 2"
          title="Reorder this draft set to maximize harmonic transitions"
          @click="sortActiveDraftHarmonically"
        >
          Sort harmonically
        </button>
        <ol>
          <li
            v-for="(track, index) in draftTracks"
            :key="`${track.id}-${index}`"
            :class="{
              dragging: draggedDraftIndex === index,
              'drag-over': dragOverDraftIndex === index,
            }"
            draggable="true"
            @dragstart="startDraftDrag($event, index)"
            @dragenter.prevent="enterDraftDropTarget(index)"
            @dragover.prevent="enterDraftDropTarget(index)"
            @drop="dropDraftTrack($event, index)"
            @dragend="endDraftDrag"
          >
            <div
              v-if="isDraftTransitionRisky(index)"
              class="chain-transition-divider"
              title="Non-harmonic transition between these tracks"
            >
              <span></span>
              <strong>Non-harmonic transition</strong>
              <span></span>
            </div>
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
            <div class="chain-controls" aria-label="Draft track controls">
              <button
                type="button"
                class="icon-button move-button"
                :disabled="index === 0"
                title="Move up"
                @click="moveDraftTrack(index, -1)"
              >
                ↑
              </button>
              <button
                type="button"
                class="icon-button move-button"
                :disabled="index === draftTracks.length - 1"
                title="Move down"
                @click="moveDraftTrack(index, 1)"
              >
                ↓
              </button>
              <button
                type="button"
                class="icon-button remove-button"
                title="Remove"
                @click="removeFromDraftAt(index)"
              >
                ×
              </button>
            </div>
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
              type="button"
              class="add-button"
              :class="{ risky: isAddTransitionRisky, used: selectedTrackInAnyDraftSet }"
              :disabled="!selectedTrack"
              :title="addButtonTitle"
              @click="addSelectedTrack"
            >
              {{ addButtonLabel }}
            </button>
            <span
              class="add-reason"
              :class="{ visible: addButtonReason }"
              :aria-hidden="addButtonReason ? 'false' : 'true'"
            >
              {{ addButtonReason || "Ready" }}
            </span>
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
                {{ placementLaneLabel(track.placement?.lane) }}
              </span>
              <span class="row-icon-badges">
                <span v-if="track.audioAvailable" class="audio-badge" title="Audio linked">
                  audio
                </span>
                <span
                  v-if="hasHarmonyNotes(track)"
                  class="harmony-badge"
                  title="Special harmony note"
                >
                  !
                </span>
              </span>
            </span>
            <strong>{{ track.title }}</strong>
            <small class="track-card-meta">
              <span>
                {{ track.bpm }} BPM
                <span
                  v-if="track.confidence.bpm !== 'confirmed'"
                  class="inline-confidence"
                  :class="track.confidence.bpm"
                >
                  {{ confidenceLabel(track.confidence.bpm) }}
                </span>
              </span>
              <span class="meta-separator">·</span>
              <span>
                {{ track.keyLabel }}
                <span
                  v-if="track.confidence.key !== 'confirmed'"
                  class="inline-confidence"
                  :class="track.confidence.key"
                >
                  {{ confidenceLabel(track.confidence.key) }}
                </span>
              </span>
            </small>
            <span
              v-if="lastDraftTrack"
              class="bpm-score"
              :title="getTrackBpmCompatibilityTitle(track)"
            >
              <span class="bpm-score-label">
                <span>BPM match</span>
                <span class="bpm-score-value">{{ getTrackBpmCompatibilityScore(track) }}</span>
              </span>
              <span
                class="bpm-score-meter"
                :style="{ '--bpm-score': getTrackBpmCompatibilityWidth(track) }"
                aria-hidden="true"
              >
                <span></span>
              </span>
            </span>
          </button>
        </div>
      </section>

      <aside class="focus-panel" aria-label="Selected track">
        <p class="eyebrow">Focus track</p>
        <template v-if="selectedTrack">
          <h2>{{ selectedTrack.title }}</h2>
          <p class="artist">{{ selectedTrack.artist }}</p>
          <section class="track-audio-panel" :class="{ empty: !selectedTrack.audioAvailable }">
            <div class="track-audio-heading">
              <span>Audio</span>
              <small>{{ selectedTrack.audioFileName ?? "Not linked" }}</small>
            </div>
            <audio
              v-if="selectedTrack.audioUrl"
              ref="audioPlayer"
              :key="selectedTrack.id"
              controls
              preload="metadata"
              :src="selectedTrack.audioUrl"
            ></audio>
            <p v-else class="muted">No source file path is linked yet.</p>
          </section>
          <dl>
            <div>
              <dt>Key</dt>
              <dd class="value-with-badges">
                {{ selectedTrack.keyLabel }}
                <span
                  v-if="selectedTrack.confidence.key !== 'confirmed'"
                  class="inline-confidence"
                  :class="selectedTrack.confidence.key"
                >
                  {{ confidenceLabel(selectedTrack.confidence.key) }}
                </span>
              </dd>
            </div>
            <div>
              <dt>BPM</dt>
              <dd class="value-with-badges">
                {{ selectedTrack.bpm }}
                <span
                  v-if="selectedTrack.confidence.bpm !== 'confirmed'"
                  class="inline-confidence"
                  :class="selectedTrack.confidence.bpm"
                >
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
