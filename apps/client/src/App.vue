<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

import {
  areKeysTransitionCompatible,
  canKeysTransition,
  CIRCLE_OF_FIFTHS,
  getTransitionProfile,
  describeKey,
  getModalPlacement,
  PITCH_CLASSES,
  PITCH_CLASS_LABELS,
  sampleTracks,
  type DiatonicMode,
  type ModalVariant,
  type PitchClass,
  type TrackKey,
  type VerificationState,
} from "@djdesk/domain";

import {
  cancelRetrievalJob,
  createSet,
  createTrack,
  deleteSet,
  fetchAudioLibrary,
  fetchRetrievalJob,
  fetchSets,
  fetchTrackHarmony,
  fetchTracks,
  renameSet,
  replaceSetTracks,
  retryRetrievalJob,
  selectSpotifyRetrievalCandidate,
  selectYandexRetrievalCandidate,
  startTrackRetrieval,
  updateTrackAnalysis,
  uploadTrackAudio,
  type CreateTrackInput,
  type RetrievalCandidateView,
  type RetrievalJobView,
  type SetDraftView,
  type TrackAnalysisPatchInput,
  type TrackHarmonyResponse,
  type TrackView,
} from "./api.ts";

type SectionSlice = "home" | "pure-clockwise" | "pure-counter";
type CompatibilityClass = "compatible" | "incompatible" | null;
type MobilePanel = "focus" | "map" | "set" | "tracks";
type PlacementLane = NonNullable<TrackView["placement"]>["lane"];
type CircleSelection =
  | { kind: "unknown" }
  | { kind: "section"; section: number }
  | { kind: "slice"; section: number; slice: SectionSlice }
  | { kind: "boundary"; boundaryIndex: number };

interface DraftSet extends SetDraftView {
  isDemo?: boolean;
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

type AudioFilter = "all" | "linked" | "missing";
type HarmonyNotesFilter = "all" | "with-notes" | "without-notes";
type KeyStatusFilter = "all" | "known" | "unknown";
type SetPresenceFilter = "all" | "in-set" | "not-in-set";
type VerificationFilter = "all" | "confirmed" | "unverified";

interface TrackFilters {
  audio: AudioFilter;
  bpmMax: string;
  bpmMin: string;
  bpmVerification: VerificationFilter;
  harmonyNotes: HarmonyNotesFilter;
  keyStatus: KeyStatusFilter;
  keyVerification: VerificationFilter;
  setPresence: SetPresenceFilter;
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
const ENABLE_DEMO_DATA = import.meta.env.VITE_ENABLE_DEMO_DATA === "true";
const MODE_OPTIONS = [
  "major",
  "natural-minor",
  "dorian",
  "phrygian",
  "lydian",
  "mixolydian",
] as const satisfies readonly DiatonicMode[];
const VARIANT_OPTIONS = [
  "diatonic",
  "raised-leading-tone",
  "variable-degree",
] as const satisfies readonly ModalVariant[];
const VERIFICATION_OPTIONS = [
  "estimated",
  "confirmed",
] as const satisfies readonly VerificationState[];
const KEY_UNKNOWN_VALUE = "__unknown__";

type KeyTonicDraft = PitchClass | typeof KEY_UNKNOWN_VALUE;

const tracks = ref<TrackView[]>([]);
const errorMessage = ref("");
const isLoading = ref(true);
const harmonyErrorMessage = ref("");
const isHarmonyLoading = ref(false);
const circleSelection = ref<CircleSelection | null>(null);
const selectedTrack = ref<TrackView | null>(null);
const draftSets = ref<DraftSet[]>([]);
const activeDraftSetId = ref("");
const trackHarmony = ref<TrackHarmonyResponse | null>(null);
const draggedDraftIndex = ref<number | null>(null);
const dragOverDraftIndex = ref<number | null>(null);
const audioPlayer = ref<HTMLAudioElement | null>(null);
const activeMobilePanel = ref<MobilePanel>("map");
const setErrorMessage = ref("");
const isSetSaving = ref(false);
const newSetName = ref("");
const renameSetName = ref("");
const isTrackSaving = ref(false);
const trackEditErrorMessage = ref("");
const bpmDraft = ref("");
const harmonyNotesDraft = ref("");
const commentDraft = ref("");
const chordsDraft = ref("");
const tagsDraft = ref("");
const isNewTrackDialogOpen = ref(false);
const isCreatingTrack = ref(false);
const createTrackErrorMessage = ref("");
const newTrackAudioFile = ref<File | null>(null);
const focusAudioFile = ref<File | null>(null);
const isUploadingAudio = ref(false);
const isBpmInputFocused = ref(false);
const audioUploadDir = ref("");
const retrievalJob = ref<RetrievalJobView | null>(null);
const retrievalInputDraft = ref("");
const isRetrievalBusy = ref(false);
const isRetrievalDialogOpen = ref(false);
const retrievalErrorMessage = ref("");
const openedLucidaUrl = ref("");
const trackSearchQuery = ref("");
const areTrackFiltersOpen = ref(false);
const trackFilters = ref<TrackFilters>(getDefaultTrackFilters());
let retrievalPollTimer: number | null = null;
let trackPatchQueue = Promise.resolve();
const newTrackForm = ref({
  artist: "",
  bpm: "",
  chords: "",
  comment: "",
  harmonyNotes: "",
  keyMode: "natural-minor" as DiatonicMode,
  keyTonic: KEY_UNKNOWN_VALUE as KeyTonicDraft,
  keyVariant: "diatonic" as ModalVariant,
  nonStandardTuning: false,
  shouldRetrieveAudio: false,
  tags: "",
  title: "",
});

const sections = computed(() =>
  CIRCLE_OF_FIFTHS.map((pitch, index) => ({
    index,
    label: PITCH_CLASS_LABELS[pitch],
    pitch,
  })),
);

const visibleTracks = computed(() => tracks.value);

const normalizedTrackSearchQuery = computed(() => normalizeSearchText(trackSearchQuery.value));

const activeTrackFiltersCount = computed(() => getActiveTrackFiltersCount(trackFilters.value));

const isTrackSearchActive = computed(
  () => normalizedTrackSearchQuery.value.length > 0 || activeTrackFiltersCount.value > 0,
);

const hasActiveCircleSelection = computed(() => circleSelection.value !== null);

const isBrowserFiltered = computed(
  () =>
    hasActiveCircleSelection.value ||
    normalizedTrackSearchQuery.value.length > 0 ||
    activeTrackFiltersCount.value > 0,
);

const unknownKeyTracks = computed(() =>
  tracks.value.filter((track) => !track.key).sort(compareNullableBpmThenTitle),
);

const browserTracks = computed(() => {
  const query = normalizedTrackSearchQuery.value;
  const filteredTracks = tracks.value
    .filter((track) => matchesCircleSelection(track, circleSelection.value))
    .filter((track) => trackMatchesFilters(track, trackFilters.value))
    .filter((track) => !query || getTrackSearchScore(track, query) > 0);

  if (!query) {
    return sortBrowserTracks(filteredTracks);
  }

  return [...filteredTracks].sort((first, second) =>
    compareSearchResultTracks(first, second, query),
  );
});

const selectedLabel = computed(() => getSelectedPositionLabel());

const centerReadout = computed(() => getCenterReadout());

const browserTitle = computed(() => `${browserTracks.value.length} tracks`);

const browserEyebrow = computed(() => selectedLabel.value);

const adjustableBpmDraft = computed(() => {
  try {
    return parseOptionalNumberInput(bpmDraft.value);
  } catch {
    return null;
  }
});

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
  if (!activeDraftSet.value) {
    return "Create a set before adding tracks";
  }

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

const mobileTabs = computed(() => [
  {
    count: visibleTracks.value.length,
    id: "map" as const,
    label: "Map",
  },
  {
    count: browserTracks.value.length,
    id: "tracks" as const,
    label: isTrackSearchActive.value ? "Search" : "Tracks",
  },
  {
    count: selectedTrack.value?.audioAvailable ? "audio" : "info",
    id: "focus" as const,
    label: "Focus",
  },
  {
    count: draftTracks.value.length,
    id: "set" as const,
    label: "Set",
  },
]);

onMounted(async () => {
  try {
    const [trackResponse, setResponse, audioLibraryResponse] = await Promise.all([
      fetchTracks(),
      fetchSets(),
      fetchAudioLibrary(),
    ]);
    const loadedTracks = ENABLE_DEMO_DATA
      ? [...trackResponse.tracks, ...buildDemoTrackViews()]
      : trackResponse.tracks;

    audioUploadDir.value = audioLibraryResponse.audioUploadDir;
    tracks.value = loadedTracks;
    selectedTrack.value = loadedTracks[0] ?? null;
    draftSets.value = ENABLE_DEMO_DATA
      ? [...setResponse.sets, ...buildMockDraftSets(loadedTracks)]
      : [...setResponse.sets];
    activeDraftSetId.value = draftSets.value[0]?.id ?? "";
    renameSetName.value = activeDraftSet.value?.name ?? "";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unknown API error";
  } finally {
    isLoading.value = false;
  }
});

onUnmounted(() => {
  clearRetrievalPolling();
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

watch(
  selectedTrack,
  (track) => {
    if (!isBpmInputFocused.value) {
      bpmDraft.value = track?.bpm ? String(track.bpm) : "";
    }

    harmonyNotesDraft.value = track?.harmonyNotes ?? "";
    commentDraft.value = track?.comment ?? "";
    chordsDraft.value = track?.chordProgression.join(", ") ?? "";
    tagsDraft.value = track?.tags.join(", ") ?? "";

    retrievalInputDraft.value = track ? getDefaultRetrievalInput(track) : "";
    if (track && retrievalJob.value?.trackId !== track.id) {
      retrievalJob.value = null;
      retrievalErrorMessage.value = "";
    }

    focusAudioFile.value = null;
    trackEditErrorMessage.value = "";
  },
  {
    immediate: true,
  },
);

watch(isTrackSearchActive, (isActive) => {
  if (isActive) {
    setActiveMobilePanel("tracks");
  }
});

watch(
  activeDraftSet,
  (setDraft) => {
    renameSetName.value = setDraft?.name ?? "";
  },
  {
    immediate: true,
  },
);

function selectSection(index: number): void {
  setCircleSelection({ kind: "section", section: index });
}

function isAudioElementPlaying(audioElement: HTMLAudioElement | null): boolean {
  return Boolean(audioElement && !audioElement.paused && !audioElement.ended);
}

function selectSectionSlice(index: number, slice: SectionSlice): void {
  setCircleSelection({ kind: "slice", section: index, slice });
}

function selectBoundary(boundaryIndex: number): void {
  setCircleSelection({ kind: "boundary", boundaryIndex });
}

function selectTrack(track: TrackView): void {
  selectedTrack.value = track;
  syncCircleSelectionToTrack(track);
  setActiveMobilePanel("focus");
}

function selectUnknownKeyTracks(): void {
  setCircleSelection({ kind: "unknown" });
}

function setCircleSelection(selection: CircleSelection | null): void {
  circleSelection.value = selection;
  selectPreferredBrowserTrack();
  setActiveMobilePanel("tracks");
}

function clearCircleSelection(): void {
  setCircleSelection(null);
}

function setActiveMobilePanel(panel: MobilePanel): void {
  activeMobilePanel.value = panel;
}

function updateTrackSearchQuery(event: Event): void {
  trackSearchQuery.value = getValueFromEvent(event);

  if (trackSearchQuery.value.trim()) {
    setActiveMobilePanel("tracks");
  }
}

function clearTrackSearch(): void {
  trackSearchQuery.value = "";
}

function clearTrackSearchMode(): void {
  trackSearchQuery.value = "";
  resetTrackFilters();
  areTrackFiltersOpen.value = false;
}

function resetTrackFilters(): void {
  trackFilters.value = getDefaultTrackFilters();
}

function selectFirstSearchResult(): void {
  if (!isTrackSearchActive.value) {
    return;
  }

  const track = browserTracks.value[0];

  if (track) {
    selectTrack(track);
  }
}

function selectPreferredBrowserTrack(): void {
  const currentTrack = selectedTrack.value;

  if (currentTrack && browserTracks.value.some((track) => track.id === currentTrack.id)) {
    return;
  }

  selectedTrack.value = getPreferredBrowserTrack(browserTracks.value) ?? currentTrack;
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

async function createDraftSetFromInput(): Promise<void> {
  const name = newSetName.value.trim();

  if (!name) {
    setErrorMessage.value = "Set name is required";
    return;
  }

  setErrorMessage.value = "";
  isSetSaving.value = true;

  try {
    const setDraft = await createSet(name);

    draftSets.value = [...draftSets.value, setDraft];
    activeDraftSetId.value = setDraft.id;
    newSetName.value = "";
  } catch (error) {
    setErrorMessage.value = error instanceof Error ? error.message : "Could not create set";
  } finally {
    isSetSaving.value = false;
  }
}

async function saveActiveSetName(): Promise<void> {
  const activeSet = activeDraftSet.value;
  const name = renameSetName.value.trim();

  if (!activeSet || activeSet.isDemo || name === activeSet.name) {
    return;
  }

  if (!name) {
    setErrorMessage.value = "Set name is required";
    renameSetName.value = activeSet.name;
    return;
  }

  setErrorMessage.value = "";
  isSetSaving.value = true;

  try {
    const updated = await renameSet(activeSet.id, name);

    replaceDraftSet(updated);
  } catch (error) {
    setErrorMessage.value = error instanceof Error ? error.message : "Could not rename set";
    renameSetName.value = activeSet.name;
  } finally {
    isSetSaving.value = false;
  }
}

async function deleteActiveSet(): Promise<void> {
  const activeSet = activeDraftSet.value;

  if (!activeSet) {
    return;
  }

  if (!window.confirm(`Delete set "${activeSet.name}"?`)) {
    return;
  }

  setErrorMessage.value = "";
  isSetSaving.value = true;

  try {
    if (!activeSet.isDemo) {
      await deleteSet(activeSet.id);
    }

    draftSets.value = draftSets.value.filter((setDraft) => setDraft.id !== activeSet.id);
    activeDraftSetId.value = draftSets.value[0]?.id ?? "";
  } catch (error) {
    setErrorMessage.value = error instanceof Error ? error.message : "Could not delete set";
  } finally {
    isSetSaving.value = false;
  }
}

async function addSelectedTrack(): Promise<void> {
  if (!selectedTrack.value || !activeDraftSet.value) {
    return;
  }

  await updateActiveDraftTrackIds([...activeDraftTrackIds.value, selectedTrack.value.id]);
}

async function removeFromDraftAt(index: number): Promise<void> {
  await updateActiveDraftTrackIds(
    activeDraftTrackIds.value.filter((_, trackIndex) => trackIndex !== index),
  );
}

async function moveDraftTrack(index: number, direction: -1 | 1): Promise<void> {
  await reorderDraftTrack(index, index + direction);
}

async function reorderDraftTrack(fromIndex: number, toIndex: number): Promise<void> {
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
  await updateActiveDraftTrackIds(trackIds);
}

async function sortActiveDraftHarmonically(): Promise<void> {
  const items = activeDraftTrackIds.value.map((trackId, originalIndex) => ({
    originalIndex,
    track: tracks.value.find((track) => track.id === trackId) ?? null,
    trackId,
  }));

  if (items.length < 2) {
    return;
  }

  const sortedItems = sortDraftItemsHarmonically(items);
  await updateActiveDraftTrackIds(sortedItems.map((item) => item.trackId));
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
  if (previous.bpm === null || next.bpm === null) {
    return 1;
  }

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
    void reorderDraftTrack(fromIndex, index);
  }

  endDraftDrag();
}

function endDraftDrag(): void {
  draggedDraftIndex.value = null;
  dragOverDraftIndex.value = null;
}

async function updateActiveDraftTrackIds(trackIds: string[]): Promise<void> {
  const activeSetId = activeDraftSet.value?.id;

  if (!activeSetId) {
    return;
  }

  const previousDraftSets = draftSets.value;
  const activeSet = activeDraftSet.value;
  const optimisticSet = activeSet
    ? {
        ...activeSet,
        trackIds,
      }
    : null;

  if (!optimisticSet) {
    return;
  }

  replaceDraftSet(optimisticSet);
  setErrorMessage.value = "";

  if (activeSet.isDemo) {
    return;
  }

  isSetSaving.value = true;

  try {
    const persistedSet = await replaceSetTracks(activeSetId, trackIds);

    replaceDraftSet(persistedSet);
  } catch (error) {
    draftSets.value = previousDraftSets;
    setErrorMessage.value = error instanceof Error ? error.message : "Could not save set";
  } finally {
    isSetSaving.value = false;
  }
}

function replaceDraftSet(setDraft: DraftSet): void {
  draftSets.value = draftSets.value.map((candidate) =>
    candidate.id === setDraft.id
      ? {
          ...candidate,
          ...setDraft,
        }
      : candidate,
  );
}

async function patchSelectedTrack(input: TrackAnalysisPatchInput): Promise<boolean> {
  const track = selectedTrack.value;

  if (!track) {
    return false;
  }

  const operation = trackPatchQueue.then(() => patchTrackAnalysis(track.id, input));

  trackPatchQueue = operation.then(
    () => undefined,
    () => undefined,
  );

  return operation;
}

async function patchTrackAnalysis(
  trackId: string,
  input: TrackAnalysisPatchInput,
): Promise<boolean> {
  trackEditErrorMessage.value = "";
  isTrackSaving.value = true;

  try {
    const updatedTrack = await updateTrackAnalysis(trackId, input);

    updateTrackInState(updatedTrack);

    if (selectedTrack.value?.id === trackId) {
      selectedTrack.value = updatedTrack;
      syncCircleSelectionToTrack(updatedTrack);
    }

    return true;
  } catch (error) {
    trackEditErrorMessage.value =
      error instanceof Error ? error.message : "Could not save track changes";
    return false;
  } finally {
    isTrackSaving.value = false;
  }
}

async function saveBpmDraft(value = bpmDraft.value): Promise<void> {
  let nextBpm: number | null;

  try {
    nextBpm = parseOptionalNumberInput(value);
  } catch (error) {
    trackEditErrorMessage.value = error instanceof Error ? error.message : "Invalid BPM";
    return;
  }

  if (selectedTrack.value?.bpm === nextBpm) {
    return;
  }

  await patchSelectedTrack({
    bpm: nextBpm,
  });
}

async function adjustSelectedBpm(multiplier: number): Promise<void> {
  const currentBpm = adjustableBpmDraft.value;

  if (currentBpm === null) {
    return;
  }

  const nextValue = formatEditableBpm(currentBpm * multiplier);

  bpmDraft.value = nextValue;
  await saveBpmDraft(nextValue);
}

async function saveBpmDraftFromEvent(event: Event): Promise<void> {
  const value = getValueFromEvent(event);

  bpmDraft.value = value;
  await saveBpmDraft(value);
}

function focusBpmDraft(): void {
  isBpmInputFocused.value = true;
}

async function blurBpmDraft(event: Event): Promise<void> {
  isBpmInputFocused.value = false;
  await saveBpmDraftFromEvent(event);
}

async function updateSelectedKeyTonic(event: Event): Promise<void> {
  const tonic = getValueFromEvent(event);

  if (tonic === KEY_UNKNOWN_VALUE) {
    await patchSelectedTrack({
      confidence: {
        key: selectedTrack.value?.confidence.key ?? "estimated",
      },
      key: null,
    });
    return;
  }

  await patchSelectedTrack({
    key: {
      ...getSelectedKeyOrDefault(),
      tonic: tonic as PitchClass,
    },
  });
}

async function updateSelectedKeyMode(event: Event): Promise<void> {
  await patchSelectedTrack({
    key: {
      ...getSelectedKeyOrDefault(),
      mode: getValueFromEvent(event) as DiatonicMode,
    },
  });
}

async function updateSelectedKeyVariant(event: Event): Promise<void> {
  await patchSelectedTrack({
    key: {
      ...getSelectedKeyOrDefault(),
      variant: getValueFromEvent(event) as ModalVariant,
    },
  });
}

async function updateSelectedConfidence(field: "bpm" | "key", event: Event): Promise<void> {
  await patchSelectedTrack({
    confidence: {
      [field]: getValueFromEvent(event) as VerificationState,
    },
  });
}

async function updateSelectedNonStandardTuning(event: Event): Promise<void> {
  await patchSelectedTrack({
    nonStandardTuning: getCheckedFromEvent(event),
  });
}

async function saveHarmonyNotesDraft(): Promise<void> {
  await patchSelectedTrack({
    harmonyNotes: harmonyNotesDraft.value,
  });
}

async function saveCommentDraft(): Promise<void> {
  await patchSelectedTrack({
    comment: commentDraft.value,
  });
}

async function saveChordsDraft(): Promise<void> {
  await patchSelectedTrack({
    chords: parseDelimitedText(chordsDraft.value),
  });
}

async function saveTagsDraft(): Promise<void> {
  await patchSelectedTrack({
    tags: parseDelimitedText(tagsDraft.value),
  });
}

function openNewTrackDialog(): void {
  createTrackErrorMessage.value = "";
  newTrackAudioFile.value = null;
  newTrackForm.value = {
    artist: "",
    bpm: "",
    chords: "",
    comment: "",
    harmonyNotes: "",
    keyMode: "natural-minor",
    keyTonic: KEY_UNKNOWN_VALUE,
    keyVariant: "diatonic",
    nonStandardTuning: false,
    shouldRetrieveAudio: false,
    tags: "",
    title: "",
  };
  isNewTrackDialogOpen.value = true;
}

function closeNewTrackDialog(): void {
  if (!isCreatingTrack.value) {
    isNewTrackDialogOpen.value = false;
  }
}

function setNewTrackAudioFile(event: Event): void {
  newTrackAudioFile.value = getFileFromEvent(event);
}

async function submitNewTrack(): Promise<void> {
  const title = newTrackForm.value.title.trim();

  if (!title) {
    createTrackErrorMessage.value = "Track title is required";
    return;
  }

  createTrackErrorMessage.value = "";
  isCreatingTrack.value = true;

  try {
    const input: CreateTrackInput = {
      title,
    };
    const artist = newTrackForm.value.artist.trim();
    const harmonyNotes = newTrackForm.value.harmonyNotes.trim();
    const comment = newTrackForm.value.comment.trim();
    const bpm = parseOptionalNumberInput(newTrackForm.value.bpm);
    const chords = parseDelimitedText(newTrackForm.value.chords);
    const tags = parseDelimitedText(newTrackForm.value.tags);
    const shouldRetrieveAudio = newTrackForm.value.shouldRetrieveAudio;

    if (artist) {
      input.artist = artist;
    }

    if (bpm !== null) {
      input.bpm = bpm;
    }

    if (newTrackForm.value.keyTonic !== KEY_UNKNOWN_VALUE) {
      input.key = {
        mode: newTrackForm.value.keyMode,
        tonic: newTrackForm.value.keyTonic as PitchClass,
        variant: newTrackForm.value.keyVariant,
      };
    }

    if (newTrackForm.value.nonStandardTuning) {
      input.nonStandardTuning = true;
    }

    if (harmonyNotes) {
      input.harmonyNotes = harmonyNotes;
    }

    if (comment) {
      input.comment = comment;
    }

    if (chords.length > 0) {
      input.chords = chords;
    }

    if (tags.length > 0) {
      input.tags = tags;
    }

    let createdTrack = await createTrack(input);

    tracks.value = [...tracks.value, createdTrack].sort((first, second) =>
      first.title.localeCompare(second.title),
    );

    if (newTrackAudioFile.value) {
      createdTrack = await uploadTrackAudio(createdTrack.id, newTrackAudioFile.value);
      updateTrackInState(createdTrack);
    }

    selectTrack(createdTrack);
    isNewTrackDialogOpen.value = false;

    if (shouldRetrieveAudio) {
      await startRetrievalForTrack(createdTrack, getDefaultRetrievalInput(createdTrack));
    }
  } catch (error) {
    createTrackErrorMessage.value =
      error instanceof Error ? error.message : "Could not create track";
  } finally {
    isCreatingTrack.value = false;
  }
}

function setFocusAudioFile(event: Event): void {
  focusAudioFile.value = getFileFromEvent(event);
}

async function uploadFocusAudioFile(): Promise<void> {
  if (!selectedTrack.value || !focusAudioFile.value) {
    return;
  }

  trackEditErrorMessage.value = "";
  isUploadingAudio.value = true;

  try {
    const updatedTrack = await uploadTrackAudio(selectedTrack.value.id, focusAudioFile.value);

    updateTrackInState(updatedTrack);
    selectedTrack.value = updatedTrack;
    focusAudioFile.value = null;
  } catch (error) {
    trackEditErrorMessage.value = error instanceof Error ? error.message : "Could not upload audio";
  } finally {
    isUploadingAudio.value = false;
  }
}

async function startSelectedTrackAudioRetrieval(): Promise<void> {
  if (!selectedTrack.value) {
    return;
  }

  await startRetrievalForTrack(selectedTrack.value, retrievalInputDraft.value);
}

async function startRetrievalForTrack(track: TrackView, input: string): Promise<void> {
  isRetrievalDialogOpen.value = true;
  await runRetrievalMutation(async () =>
    startTrackRetrieval(track.id, input.trim() || getDefaultRetrievalInput(track)),
  );
}

function closeRetrievalDialog(): void {
  isRetrievalDialogOpen.value = false;
}

async function refreshRetrievalJob(): Promise<void> {
  if (!retrievalJob.value) {
    return;
  }

  await runRetrievalMutation(async () => fetchRetrievalJob(retrievalJob.value?.id ?? ""));
}

async function chooseYandexRetrievalCandidate(candidateId: string | null): Promise<void> {
  if (!retrievalJob.value) {
    return;
  }

  await runRetrievalMutation(async () =>
    selectYandexRetrievalCandidate(retrievalJob.value?.id ?? "", candidateId),
  );
}

async function chooseSpotifyRetrievalCandidate(candidateId: string | null): Promise<void> {
  if (!retrievalJob.value) {
    return;
  }

  await runRetrievalMutation(async () =>
    selectSpotifyRetrievalCandidate(retrievalJob.value?.id ?? "", candidateId),
  );
}

async function retryCurrentRetrieval(): Promise<void> {
  if (!retrievalJob.value) {
    return;
  }

  await runRetrievalMutation(async () => retryRetrievalJob(retrievalJob.value?.id ?? ""));
}

async function cancelCurrentRetrieval(): Promise<void> {
  if (!retrievalJob.value) {
    return;
  }

  await runRetrievalMutation(async () => cancelRetrievalJob(retrievalJob.value?.id ?? ""));
}

async function runRetrievalMutation(
  action: () => Promise<RetrievalJobView>,
): Promise<RetrievalJobView | null> {
  retrievalErrorMessage.value = "";
  isRetrievalBusy.value = true;

  try {
    const job = await action();

    applyRetrievalJob(job);

    return job;
  } catch (error) {
    retrievalErrorMessage.value =
      error instanceof Error ? error.message : "Could not run audio retrieval";

    return null;
  } finally {
    isRetrievalBusy.value = false;
  }
}

function applyRetrievalJob(job: RetrievalJobView): void {
  retrievalJob.value = job;
  isRetrievalDialogOpen.value = true;

  if (job.linkedTrack) {
    updateTrackInState(job.linkedTrack);

    if (selectedTrack.value?.id === job.linkedTrack.id) {
      selectedTrack.value = job.linkedTrack;
    }
  }

  if (job.lucidaUrl && openedLucidaUrl.value !== job.lucidaUrl) {
    openedLucidaUrl.value = job.lucidaUrl;
    window.open(job.lucidaUrl, "_blank", "noopener");
  }

  scheduleRetrievalPolling(job);
}

function openCurrentLucidaUrl(): void {
  if (retrievalJob.value?.lucidaUrl) {
    window.open(retrievalJob.value.lucidaUrl, "_blank", "noopener");
  }
}

function getDefaultRetrievalInput(track: TrackView): string {
  return [track.artist, track.title].filter(Boolean).join(" ").trim() || track.title;
}

function getRetrievalStageLabel(stage: RetrievalJobView["stage"]): string {
  switch (stage) {
    case "cancelled":
      return "Cancelled";
    case "downloading-spotify":
      return "Downloading from SpotiFLAC";
    case "downloading-yandex":
      return "Downloading from Yandex";
    case "failed":
      return "Failed";
    case "linked":
      return "Audio linked";
    case "lucida":
      return "Lucida fallback";
    case "searching-spotify":
      return "Searching Spotify";
    case "searching-yandex":
      return "Searching Yandex";
    case "spotify-candidates":
      return "Select from SpotiFLAC";
    case "yandex-candidates":
      return "Select from Yandex";
  }
}

function isRetrievalWorking(stage: RetrievalJobView["stage"] | undefined): boolean {
  return Boolean(stage && (stage.startsWith("searching") || stage.startsWith("downloading")));
}

function scheduleRetrievalPolling(job: RetrievalJobView): void {
  clearRetrievalPolling();

  if (!isRetrievalWorking(job.stage)) {
    return;
  }

  retrievalPollTimer = window.setTimeout(() => {
    void refreshRetrievalJob();
  }, 1000);
}

function clearRetrievalPolling(): void {
  if (retrievalPollTimer !== null) {
    window.clearTimeout(retrievalPollTimer);
    retrievalPollTimer = null;
  }
}

function getRetrievalCandidateMeta(candidate: RetrievalCandidateView): string {
  return [
    candidate.artists.join(", "),
    formatCandidateDuration(candidate.durationMs),
    candidate.lossless === true ? "FLAC" : null,
    candidate.matchPercent === null ? null : `${candidate.matchPercent}% match`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatCandidateDuration(durationMs: number | null): string | null {
  if (!durationMs) {
    return null;
  }

  const seconds = Math.round(durationMs / 1000);

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function updateTrackInState(track: TrackView): void {
  tracks.value = tracks.value.map((candidate) => (candidate.id === track.id ? track : candidate));
}

function syncCircleSelectionToTrack(track: TrackView): void {
  circleSelection.value = getCircleSelectionForTrack(track);
}

function getSelectedKeyOrDefault(): TrackKey {
  return (
    selectedTrack.value?.key ?? {
      mode: "natural-minor",
      tonic: "A",
      variant: "diatonic",
    }
  );
}

function getValueFromEvent(event: Event): string {
  return event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement
    ? event.target.value
    : "";
}

function getCheckedFromEvent(event: Event): boolean {
  return event.target instanceof HTMLInputElement ? event.target.checked : false;
}

function getFileFromEvent(event: Event): File | null {
  if (!(event.target instanceof HTMLInputElement)) {
    return null;
  }

  return event.target.files?.[0] ?? null;
}

function parseOptionalNumberInput(value: string): number | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("BPM must be a positive number");
  }

  return parsed;
}

function parseDelimitedText(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildDemoTrackViews(): TrackView[] {
  return sampleTracks.map((track) => ({
    ...track,
    audioAvailable: false,
    audioFileName: null,
    audioUrl: null,
    keyLabel: describeKey(track.key),
    placement: track.key ? getModalPlacement(track.key) : null,
  }));
}

function buildMockDraftSets(sourceTracks: readonly TrackView[]): DraftSet[] {
  return [
    {
      comment: "Local demo set",
      id: "main",
      isDemo: true,
      name: "Festival draft",
      trackIds: buildClockwiseDraft(sourceTracks, DEFAULT_DRAFT_START_SECTION),
    },
    {
      comment: "Local demo set",
      id: "warmup",
      isDemo: true,
      name: "Warmup arc",
      trackIds: buildClockwiseDraft(sourceTracks, 9),
    },
    {
      comment: "Local demo set",
      id: "bridge",
      isDemo: true,
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

  const bpmComparison = compareNullableBpmThenTitle(first, second);

  if (bpmComparison !== 0) {
    return bpmComparison;
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

function getCircleSelectionForTrack(track: TrackView): CircleSelection {
  if (!track.placement) {
    return {
      kind: "unknown",
    };
  }

  const boundaryIndex = getBoundaryIndex(track.placement);

  if (boundaryIndex !== null) {
    return {
      boundaryIndex,
      kind: "boundary",
    };
  }

  const section = getTrackSectionIndex(track) ?? track.placement.homeIndex;
  const slice = getTrackSectionSlice(track);
  return {
    kind: "slice",
    section,
    slice,
  };
}

function matchesCircleSelection(track: TrackView, selection: CircleSelection | null): boolean {
  if (!selection) {
    return true;
  }

  switch (selection.kind) {
    case "unknown":
      return !track.key;
    case "section":
      return trackBelongsToSection(track, selection.section);
    case "slice":
      return trackBelongsToSectionSlice(track, selection.section, selection.slice);
    case "boundary":
      return trackTouchesBoundary(track, selection.boundaryIndex);
    default:
      return assertNever(selection);
  }
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

function getDefaultTrackFilters(): TrackFilters {
  return {
    audio: "all",
    bpmMax: "",
    bpmMin: "",
    bpmVerification: "all",
    harmonyNotes: "all",
    keyStatus: "all",
    keyVerification: "all",
    setPresence: "all",
  };
}

function getActiveTrackFiltersCount(filters: TrackFilters): number {
  return [
    filters.audio !== "all",
    filters.bpmMin.trim() !== "",
    filters.bpmMax.trim() !== "",
    filters.bpmVerification !== "all",
    filters.harmonyNotes !== "all",
    filters.keyStatus !== "all",
    filters.keyVerification !== "all",
    filters.setPresence !== "all",
  ].filter(Boolean).length;
}

function trackMatchesFilters(track: TrackView, filters: TrackFilters): boolean {
  const bpmMin = parseOptionalFilterNumber(filters.bpmMin);
  const bpmMax = parseOptionalFilterNumber(filters.bpmMax);

  if (filters.keyStatus === "known" && !track.key) {
    return false;
  }

  if (filters.keyStatus === "unknown" && track.key) {
    return false;
  }

  if (bpmMin !== null && (track.bpm === null || track.bpm < bpmMin)) {
    return false;
  }

  if (bpmMax !== null && (track.bpm === null || track.bpm > bpmMax)) {
    return false;
  }

  if (filters.audio === "linked" && !track.audioAvailable) {
    return false;
  }

  if (filters.audio === "missing" && track.audioAvailable) {
    return false;
  }

  if (filters.keyVerification === "confirmed" && track.confidence.key !== "confirmed") {
    return false;
  }

  if (filters.keyVerification === "unverified" && track.confidence.key === "confirmed") {
    return false;
  }

  if (filters.bpmVerification === "confirmed" && track.confidence.bpm !== "confirmed") {
    return false;
  }

  if (filters.bpmVerification === "unverified" && track.confidence.bpm === "confirmed") {
    return false;
  }

  if (filters.harmonyNotes === "with-notes" && !hasHarmonyNotes(track)) {
    return false;
  }

  if (filters.harmonyNotes === "without-notes" && hasHarmonyNotes(track)) {
    return false;
  }

  if (filters.setPresence === "in-set" && !isTrackInAnyDraftSet(track.id)) {
    return false;
  }

  if (filters.setPresence === "not-in-set" && isTrackInAnyDraftSet(track.id)) {
    return false;
  }

  return true;
}

function compareSearchResultTracks(first: TrackView, second: TrackView, query: string): number {
  const firstScore = getTrackSearchScore(first, query);
  const secondScore = getTrackSearchScore(second, query);

  if (firstScore !== secondScore) {
    return secondScore - firstScore;
  }

  const firstIsCleanAdd = isAddButtonRedForTrack(first) ? 0 : 1;
  const secondIsCleanAdd = isAddButtonRedForTrack(second) ? 0 : 1;

  if (firstIsCleanAdd !== secondIsCleanAdd) {
    return secondIsCleanAdd - firstIsCleanAdd;
  }

  const referenceTrack = lastDraftTrack.value;

  if (referenceTrack) {
    const firstBpmScore = getBpmCompatibilityScore(referenceTrack.bpm, first.bpm);
    const secondBpmScore = getBpmCompatibilityScore(referenceTrack.bpm, second.bpm);

    if (firstBpmScore !== null && secondBpmScore !== null && firstBpmScore !== secondBpmScore) {
      return secondBpmScore - firstBpmScore;
    }

    if (firstBpmScore !== secondBpmScore) {
      return firstBpmScore === null ? 1 : -1;
    }
  }

  return first.title.localeCompare(second.title);
}

function getTrackSearchScore(track: TrackView, query: string): number {
  const title = normalizeSearchText(track.title);
  const artist = normalizeSearchText(track.artist ?? "");
  const keyLabel = normalizeSearchText(track.keyLabel);
  const tags = track.tags.map((tag) => normalizeSearchText(tag));
  const combined = [title, artist, keyLabel, ...tags].filter(Boolean).join(" ");

  if (title === query) {
    return 1000;
  }

  if (title.startsWith(query)) {
    return 900;
  }

  if (title.includes(query)) {
    return 800;
  }

  if (artist.startsWith(query)) {
    return 700;
  }

  if (artist.includes(query)) {
    return 600;
  }

  if (tags.some((tag) => tag.includes(query))) {
    return 500;
  }

  if (keyLabel.includes(query)) {
    return 400;
  }

  const queryParts = query.split(/\s+/).filter(Boolean);

  return queryParts.length > 1 && queryParts.every((part) => combined.includes(part)) ? 300 : 0;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ё/g, "е")
    .toLocaleLowerCase()
    .trim();
}

function parseOptionalFilterNumber(value: string): number | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number.parseFloat(trimmed);

  return Number.isFinite(parsed) ? parsed : null;
}

function compareBrowserTracks(first: TrackView, second: TrackView): number {
  const referenceTrack = lastDraftTrack.value;

  if (referenceTrack) {
    const firstScore = getBpmCompatibilityScore(referenceTrack.bpm, first.bpm);
    const secondScore = getBpmCompatibilityScore(referenceTrack.bpm, second.bpm);

    if (firstScore !== null && secondScore !== null && firstScore !== secondScore) {
      return secondScore - firstScore;
    }

    if (firstScore !== secondScore) {
      return firstScore === null ? 1 : -1;
    }

    const firstHarmonicScore = canTracksFollow(referenceTrack, first) ? 1 : 0;
    const secondHarmonicScore = canTracksFollow(referenceTrack, second) ? 1 : 0;

    if (firstHarmonicScore !== secondHarmonicScore) {
      return secondHarmonicScore - firstHarmonicScore;
    }
  }

  const bpmComparison = compareNullableBpmThenTitle(first, second);

  if (bpmComparison !== 0) {
    return bpmComparison;
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

function getTrackBpmCompatibilityScoreLabel(track: TrackView): string {
  return String(getTrackBpmCompatibilityScore(track) ?? "n/a");
}

function getTrackBpmCompatibilityTitle(track: TrackView): string {
  const referenceTrack = lastDraftTrack.value;

  if (!referenceTrack) {
    return "No draft endpoint selected";
  }

  if (referenceTrack.bpm === null || track.bpm === null) {
    return "BPM match unavailable";
  }

  const deltaPercent = getBpmDeltaRatio(referenceTrack.bpm, track.bpm) * 100;
  const score = getBpmCompatibilityScore(referenceTrack.bpm, track.bpm);

  return `BPM match against ${referenceTrack.bpm} BPM: ${score}/100, ${deltaPercent.toFixed(1)}% apart`;
}

function getBpmCompatibilityScore(
  referenceBpm: number | null,
  candidateBpm: number | null,
): number | null {
  if (referenceBpm === null || candidateBpm === null) {
    return null;
  }

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

function compareNullableBpmThenTitle(first: TrackView, second: TrackView): number {
  if (first.bpm === null && second.bpm !== null) {
    return 1;
  }

  if (first.bpm !== null && second.bpm === null) {
    return -1;
  }

  if (first.bpm !== null && second.bpm !== null && first.bpm !== second.bpm) {
    return first.bpm - second.bpm;
  }

  return first.title.localeCompare(second.title);
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
  if (!circleSelection.value) {
    return "All tracks";
  }

  switch (circleSelection.value.kind) {
    case "unknown":
      return "Unknown key";
    case "boundary": {
      const before = Math.floor(circleSelection.value.boundaryIndex);
      const after = Math.ceil(circleSelection.value.boundaryIndex) % 12;
      const beforeLabel = getSectionDisplayLabel(before);
      const afterLabel = getSectionDisplayLabel(after);

      return `${beforeLabel} / ${afterLabel} boundary`;
    }
    case "section":
      return `${getSectionDisplayLabel(circleSelection.value.section)} section`;
    case "slice": {
      const sectionLabel = getSectionDisplayLabel(circleSelection.value.section);

      switch (circleSelection.value.slice) {
        case "home":
          return sectionLabel;
        case "pure-clockwise":
          return `${sectionLabel} clockwise modal`;
        case "pure-counter":
          return `${sectionLabel} counter modal`;
        default:
          return assertNever(circleSelection.value.slice);
      }
    }
    default:
      return assertNever(circleSelection.value);
  }
}

function getCenterReadout(): CenterReadout {
  if (!circleSelection.value) {
    return {
      subtitle: "Circle filter off",
      title: "All tracks",
    };
  }

  switch (circleSelection.value.kind) {
    case "unknown":
      return {
        subtitle: "Unplaced tracks",
        title: "Unknown key",
      };
    case "boundary": {
      const before = Math.floor(circleSelection.value.boundaryIndex);
      const after = Math.ceil(circleSelection.value.boundaryIndex) % 12;

      return {
        subtitle: "Boundary",
        title: `${getSectionPrimaryDisplayLabel(before)} / ${getSectionPrimaryDisplayLabel(after)}`,
      };
    }
    case "section":
      return {
        subtitle: "Section",
        title: getSectionDisplayLabel(circleSelection.value.section),
      };
    case "slice": {
      const sectionLabel = getSectionDisplayLabel(circleSelection.value.section);

      switch (circleSelection.value.slice) {
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
          return assertNever(circleSelection.value.slice);
      }
    }
    default:
      return assertNever(circleSelection.value);
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
  return Boolean(
    circleSelection.value &&
    circleSelection.value.kind === "section" &&
    circleSelection.value.section === index,
  );
}

function isSectionSliceSelected(index: number, slice: SectionSlice): boolean {
  return Boolean(
    circleSelection.value &&
    circleSelection.value.kind === "slice" &&
    circleSelection.value.section === index &&
    circleSelection.value.slice === slice,
  );
}

function isBoundarySelected(boundaryIndex: number): boolean {
  return Boolean(
    circleSelection.value &&
    circleSelection.value.kind === "boundary" &&
    Math.abs(circleSelection.value.boundaryIndex - boundaryIndex) < 0.01,
  );
}

function isUnknownKeySelected(): boolean {
  return circleSelection.value?.kind === "unknown";
}

function getBrowserEmptyTitle(): string {
  return isBrowserFiltered.value ? "No tracks found" : "No tracks yet";
}

function getBrowserEmptyCopy(): string {
  if (isTrackSearchActive.value) {
    return "Try a different query or filter set.";
  }

  if (hasActiveCircleSelection.value) {
    return selectedLabel.value;
  }

  return "Add or import tracks to start browsing the catalog.";
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
    case "estimated":
      return "unverified";
    default:
      return state;
  }
}

function formatBpm(bpm: number | null): string {
  return bpm === null ? "Unknown BPM" : `${bpm} BPM`;
}

function formatBpmValue(bpm: number | null): string {
  return bpm === null ? "Unknown" : String(bpm);
}

function formatEditableBpm(bpm: number): string {
  return String(Number(bpm.toFixed(3)));
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
      <div class="track-search-area" role="search">
        <label class="track-search-field">
          <span class="visually-hidden">Search tracks</span>
          <input
            :value="trackSearchQuery"
            type="search"
            placeholder="Search tracks"
            @input="updateTrackSearchQuery"
            @keydown.enter.prevent="selectFirstSearchResult"
            @keydown.escape.prevent="clearTrackSearch"
          />
          <button
            v-if="trackSearchQuery"
            type="button"
            class="icon-button search-clear-button"
            title="Clear search"
            @click="clearTrackSearch"
          >
            ×
          </button>
        </label>
        <div class="track-filter-shell">
          <button
            type="button"
            class="filter-toggle-button"
            :class="{ active: areTrackFiltersOpen || activeTrackFiltersCount > 0 }"
            @click="areTrackFiltersOpen = !areTrackFiltersOpen"
          >
            Filters
            <span v-if="activeTrackFiltersCount > 0">{{ activeTrackFiltersCount }}</span>
          </button>
          <div v-if="areTrackFiltersOpen" class="track-filter-panel">
            <div class="filter-grid">
              <label>
                <span>Key</span>
                <select v-model="trackFilters.keyStatus" @change="setActiveMobilePanel('tracks')">
                  <option value="all">Any key</option>
                  <option value="known">Known key</option>
                  <option value="unknown">Unknown key</option>
                </select>
              </label>
              <label>
                <span>Audio</span>
                <select v-model="trackFilters.audio" @change="setActiveMobilePanel('tracks')">
                  <option value="all">Any audio</option>
                  <option value="linked">Audio linked</option>
                  <option value="missing">Audio missing</option>
                </select>
              </label>
              <label>
                <span>BPM min</span>
                <input
                  v-model="trackFilters.bpmMin"
                  type="number"
                  min="1"
                  step="0.01"
                  placeholder="Any"
                  @input="setActiveMobilePanel('tracks')"
                />
              </label>
              <label>
                <span>BPM max</span>
                <input
                  v-model="trackFilters.bpmMax"
                  type="number"
                  min="1"
                  step="0.01"
                  placeholder="Any"
                  @input="setActiveMobilePanel('tracks')"
                />
              </label>
              <label>
                <span>Key state</span>
                <select
                  v-model="trackFilters.keyVerification"
                  @change="setActiveMobilePanel('tracks')"
                >
                  <option value="all">Any key state</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="unverified">Unverified</option>
                </select>
              </label>
              <label>
                <span>BPM state</span>
                <select
                  v-model="trackFilters.bpmVerification"
                  @change="setActiveMobilePanel('tracks')"
                >
                  <option value="all">Any BPM state</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="unverified">Unverified</option>
                </select>
              </label>
              <label>
                <span>Harmony</span>
                <select
                  v-model="trackFilters.harmonyNotes"
                  @change="setActiveMobilePanel('tracks')"
                >
                  <option value="all">Any notes</option>
                  <option value="with-notes">Has notes</option>
                  <option value="without-notes">No notes</option>
                </select>
              </label>
              <label>
                <span>Sets</span>
                <select v-model="trackFilters.setPresence" @change="setActiveMobilePanel('tracks')">
                  <option value="all">Any set use</option>
                  <option value="in-set">Already in set</option>
                  <option value="not-in-set">Not in set</option>
                </select>
              </label>
            </div>
            <div class="filter-actions">
              <button
                type="button"
                class="secondary-action-button"
                :disabled="activeTrackFiltersCount === 0"
                @click="resetTrackFilters"
              >
                Reset filters
              </button>
            </div>
          </div>
        </div>
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
      <section
        class="wheel-panel"
        :class="{ 'mobile-active': activeMobilePanel === 'map' }"
        aria-label="Circle of fifths desk"
        @click="clearCircleSelection"
      >
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
              @click.stop="selectSection(section.index)"
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
            @click.stop="selectSection(section.index)"
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
          :class="{ active: isUnknownKeySelected() }"
          @click.stop="selectUnknownKeyTracks"
        >
          ? {{ unknownKeyCount }}
        </button>
      </section>

      <aside
        class="set-chain"
        :class="{ 'mobile-active': activeMobilePanel === 'set' }"
        aria-label="Draft set chain"
      >
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Sets</p>
            <h2>{{ activeDraftSet?.name ?? "No set yet" }}</h2>
          </div>
          <strong>{{ draftTracks.length }}</strong>
        </div>
        <form class="new-set-form" @submit.prevent="createDraftSetFromInput">
          <input v-model="newSetName" type="text" placeholder="New set name" />
          <button type="submit" :disabled="isSetSaving">Create</button>
        </form>
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
        <div v-if="activeDraftSet" class="set-edit-row">
          <input
            v-model="renameSetName"
            type="text"
            :disabled="activeDraftSet.isDemo"
            @blur="saveActiveSetName"
            @keydown.enter.prevent="saveActiveSetName"
          />
          <button
            type="button"
            class="icon-button remove-button"
            :disabled="isSetSaving"
            title="Delete set"
            @click="deleteActiveSet"
          >
            ×
          </button>
        </div>
        <p v-if="setErrorMessage" class="mutation-error">{{ setErrorMessage }}</p>
        <button
          type="button"
          class="sort-harmonic-button"
          :disabled="activeDraftTrackIds.length < 2 || isSetSaving"
          title="Reorder this draft set to maximize harmonic transitions"
          @click="sortActiveDraftHarmonically"
        >
          Sort harmonically
        </button>
        <p v-if="draftSets.length === 0" class="empty-state">
          Create a set to start saving a real running order.
        </p>
        <ol v-else>
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
              <small>{{ formatBpm(track.bpm) }} · {{ track.keyLabel }}</small>
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

      <section
        class="track-browser"
        :class="{ 'mobile-active': activeMobilePanel === 'tracks' }"
        aria-label="Tracks browser"
      >
        <div class="panel-heading browser-panel-heading">
          <div class="browser-heading-copy">
            <div class="browser-heading-topline">
              <p class="eyebrow">{{ browserEyebrow }}</p>
              <button
                v-if="hasActiveCircleSelection"
                type="button"
                class="browser-reset-chip"
                @click="clearCircleSelection"
              >
                All tracks
              </button>
            </div>
            <h2>{{ browserTitle }}</h2>
          </div>
          <div class="track-browser-actions">
            <button type="button" class="secondary-action-button" @click="openNewTrackDialog">
              New track
            </button>
            <button
              type="button"
              class="add-button"
              :class="{ risky: isAddTransitionRisky, used: selectedTrackInAnyDraftSet }"
              :disabled="!selectedTrack || !activeDraftSet || isSetSaving"
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

        <div v-if="browserTracks.length === 0" class="browser-empty-state">
          <strong>{{ getBrowserEmptyTitle() }}</strong>
          <p>{{ getBrowserEmptyCopy() }}</p>
          <button
            v-if="isTrackSearchActive"
            type="button"
            class="secondary-action-button"
            @click="clearTrackSearchMode"
          >
            Clear search
          </button>
        </div>
        <div v-else class="browser-grid">
          <button
            v-for="track in browserTracks"
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
                {{ formatBpm(track.bpm) }}
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
                <span
                  v-if="track.nonStandardTuning"
                  class="inline-confidence non-standard-tuning"
                  title="Not aligned to standard A=440 Hz tuning"
                >
                  non-440
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
                <span class="bpm-score-value">{{ getTrackBpmCompatibilityScoreLabel(track) }}</span>
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

      <aside
        class="focus-panel"
        :class="{ 'mobile-active': activeMobilePanel === 'focus' }"
        aria-label="Selected track"
      >
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
            <div class="audio-upload-row">
              <input type="file" accept="audio/*" @change="setFocusAudioFile" />
              <button
                type="button"
                class="secondary-action-button"
                :disabled="!focusAudioFile || isUploadingAudio"
                @click="uploadFocusAudioFile"
              >
                Upload
              </button>
            </div>
            <div class="retrieval-launch-row">
              <label>
                <span>Retrieval input</span>
                <input
                  v-model="retrievalInputDraft"
                  type="text"
                  :placeholder="getDefaultRetrievalInput(selectedTrack)"
                />
              </label>
              <button
                type="button"
                class="secondary-action-button"
                :disabled="isRetrievalBusy || isRetrievalWorking(retrievalJob?.stage)"
                @click="startSelectedTrackAudioRetrieval"
              >
                {{ selectedTrack.audioAvailable ? "Replace audio" : "Retrieve audio" }}
              </button>
            </div>
            <small v-if="audioUploadDir" class="audio-folder-path">{{ audioUploadDir }}</small>
          </section>
          <section class="track-edit-panel" aria-label="Track editor">
            <div class="editor-grid">
              <label>
                <span>BPM</span>
                <div class="bpm-input-row">
                  <input
                    v-model="bpmDraft"
                    type="number"
                    min="1"
                    step="0.01"
                    placeholder="Unknown"
                    :disabled="isTrackSaving"
                    @focus="focusBpmDraft"
                    @blur="blurBpmDraft"
                    @change="saveBpmDraftFromEvent"
                    @keydown.enter.prevent="saveBpmDraftFromEvent"
                  />
                  <button
                    type="button"
                    class="bpm-adjust-button"
                    :disabled="adjustableBpmDraft === null || isTrackSaving"
                    title="Halve BPM"
                    @mousedown.prevent
                    @click="adjustSelectedBpm(0.5)"
                  >
                    ÷2
                  </button>
                  <button
                    type="button"
                    class="bpm-adjust-button"
                    :disabled="adjustableBpmDraft === null || isTrackSaving"
                    title="Double BPM"
                    @mousedown.prevent
                    @click="adjustSelectedBpm(2)"
                  >
                    ×2
                  </button>
                </div>
              </label>
              <label>
                <span>BPM state</span>
                <select
                  :value="selectedTrack.confidence.bpm"
                  :disabled="isTrackSaving"
                  @change="updateSelectedConfidence('bpm', $event)"
                >
                  <option v-for="state in VERIFICATION_OPTIONS" :key="state" :value="state">
                    {{ confidenceLabel(state) }}
                  </option>
                </select>
              </label>
              <label>
                <span>Tonic</span>
                <select
                  :value="selectedTrack.key?.tonic ?? KEY_UNKNOWN_VALUE"
                  :disabled="isTrackSaving"
                  @change="updateSelectedKeyTonic"
                >
                  <option :value="KEY_UNKNOWN_VALUE">Unknown key</option>
                  <option v-for="pitch in PITCH_CLASSES" :key="pitch" :value="pitch">
                    {{ PITCH_CLASS_LABELS[pitch].primary }}
                  </option>
                </select>
              </label>
              <label>
                <span>Mode</span>
                <select
                  :value="getSelectedKeyOrDefault().mode"
                  :disabled="!selectedTrack.key || isTrackSaving"
                  @change="updateSelectedKeyMode"
                >
                  <option v-for="mode in MODE_OPTIONS" :key="mode" :value="mode">
                    {{ mode }}
                  </option>
                </select>
              </label>
              <label>
                <span>Variant</span>
                <select
                  :value="getSelectedKeyOrDefault().variant"
                  :disabled="!selectedTrack.key || isTrackSaving"
                  @change="updateSelectedKeyVariant"
                >
                  <option v-for="variant in VARIANT_OPTIONS" :key="variant" :value="variant">
                    {{ variant }}
                  </option>
                </select>
              </label>
              <label>
                <span>Key state</span>
                <select
                  :value="selectedTrack.confidence.key"
                  :disabled="isTrackSaving"
                  @change="updateSelectedConfidence('key', $event)"
                >
                  <option v-for="state in VERIFICATION_OPTIONS" :key="state" :value="state">
                    {{ confidenceLabel(state) }}
                  </option>
                </select>
              </label>
              <label class="checkbox-field">
                <input
                  type="checkbox"
                  :checked="Boolean(selectedTrack.nonStandardTuning)"
                  :disabled="isTrackSaving"
                  @change="updateSelectedNonStandardTuning"
                />
                <span>Non-440 tuning</span>
              </label>
            </div>
            <label>
              <span>Harmony notes</span>
              <textarea
                v-model="harmonyNotesDraft"
                rows="2"
                :disabled="isTrackSaving"
                @blur="saveHarmonyNotesDraft"
              ></textarea>
            </label>
            <label>
              <span>Comment</span>
              <textarea
                v-model="commentDraft"
                rows="2"
                :disabled="isTrackSaving"
                @blur="saveCommentDraft"
              ></textarea>
            </label>
            <label>
              <span>Compact chords</span>
              <input
                v-model="chordsDraft"
                type="text"
                placeholder="Am, C, D, F"
                :disabled="isTrackSaving"
                @blur="saveChordsDraft"
                @keydown.enter.prevent="saveChordsDraft"
              />
            </label>
            <label>
              <span>Tags</span>
              <input
                v-model="tagsDraft"
                type="text"
                placeholder="tag, another tag"
                :disabled="isTrackSaving"
                @blur="saveTagsDraft"
                @keydown.enter.prevent="saveTagsDraft"
              />
            </label>
            <p v-if="isTrackSaving || isUploadingAudio" class="muted">Saving...</p>
            <p v-if="trackEditErrorMessage" class="mutation-error">{{ trackEditErrorMessage }}</p>
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
                <span
                  v-if="selectedTrack.nonStandardTuning"
                  class="inline-confidence non-standard-tuning"
                  title="Not aligned to standard A=440 Hz tuning"
                >
                  non-440
                </span>
              </dd>
            </div>
            <div>
              <dt>BPM</dt>
              <dd class="value-with-badges">
                {{ formatBpmValue(selectedTrack.bpm) }}
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
    <div
      v-if="isNewTrackDialogOpen"
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Create track"
    >
      <form class="track-create-dialog" @submit.prevent="submitNewTrack">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Library</p>
            <h2>New track</h2>
          </div>
          <button type="button" class="icon-button" title="Close" @click="closeNewTrackDialog">
            ×
          </button>
        </div>
        <div class="editor-grid">
          <label>
            <span>Title</span>
            <input v-model="newTrackForm.title" type="text" required />
          </label>
          <label>
            <span>Artist</span>
            <input v-model="newTrackForm.artist" type="text" />
          </label>
          <label>
            <span>BPM</span>
            <input
              v-model="newTrackForm.bpm"
              type="number"
              min="1"
              step="0.01"
              placeholder="Unknown"
            />
          </label>
          <label>
            <span>Tonic</span>
            <select v-model="newTrackForm.keyTonic">
              <option :value="KEY_UNKNOWN_VALUE">Unknown key</option>
              <option v-for="pitch in PITCH_CLASSES" :key="pitch" :value="pitch">
                {{ PITCH_CLASS_LABELS[pitch].primary }}
              </option>
            </select>
          </label>
          <label>
            <span>Mode</span>
            <select
              v-model="newTrackForm.keyMode"
              :disabled="newTrackForm.keyTonic === KEY_UNKNOWN_VALUE"
            >
              <option v-for="mode in MODE_OPTIONS" :key="mode" :value="mode">{{ mode }}</option>
            </select>
          </label>
          <label>
            <span>Variant</span>
            <select
              v-model="newTrackForm.keyVariant"
              :disabled="newTrackForm.keyTonic === KEY_UNKNOWN_VALUE"
            >
              <option v-for="variant in VARIANT_OPTIONS" :key="variant" :value="variant">
                {{ variant }}
              </option>
            </select>
          </label>
          <label class="checkbox-field">
            <input v-model="newTrackForm.nonStandardTuning" type="checkbox" />
            <span>Non-440 tuning</span>
          </label>
          <label>
            <span>Audio</span>
            <input type="file" accept="audio/*" @change="setNewTrackAudioFile" />
          </label>
        </div>
        <label>
          <span>Harmony notes</span>
          <textarea v-model="newTrackForm.harmonyNotes" rows="2"></textarea>
        </label>
        <label>
          <span>Comment</span>
          <textarea v-model="newTrackForm.comment" rows="2"></textarea>
        </label>
        <label>
          <span>Compact chords</span>
          <input v-model="newTrackForm.chords" type="text" placeholder="Am, C, D, F" />
        </label>
        <label>
          <span>Tags</span>
          <input v-model="newTrackForm.tags" type="text" placeholder="manual, tonight" />
        </label>
        <label class="checkbox-field retrieval-checkbox">
          <input v-model="newTrackForm.shouldRetrieveAudio" type="checkbox" />
          <span>Try to retrieve audio automatically</span>
        </label>
        <p v-if="createTrackErrorMessage" class="mutation-error">{{ createTrackErrorMessage }}</p>
        <div class="dialog-actions">
          <button type="button" class="secondary-action-button" @click="closeNewTrackDialog">
            Cancel
          </button>
          <button type="submit" class="add-button" :disabled="isCreatingTrack">
            {{ isCreatingTrack ? "Creating..." : "Create track" }}
          </button>
        </div>
      </form>
    </div>
    <div
      v-if="isRetrievalDialogOpen"
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Audio retrieval"
    >
      <section class="retrieval-dialog">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Audio retrieval</p>
            <h2>
              {{ retrievalJob ? getRetrievalStageLabel(retrievalJob.stage) : "Retrieve audio" }}
            </h2>
          </div>
          <button type="button" class="icon-button" title="Close" @click="closeRetrievalDialog">
            ×
          </button>
        </div>
        <div class="retrieval-modal-grid">
          <section class="retrieval-control-panel">
            <label>
              <span>Input</span>
              <input v-model="retrievalInputDraft" type="text" />
            </label>
            <label>
              <span>Output folder</span>
              <input :value="audioUploadDir" type="text" readonly />
            </label>
            <div class="retrieval-stage-card" :class="retrievalJob?.stage ?? 'idle'">
              <span
                v-if="retrievalJob && isRetrievalWorking(retrievalJob.stage)"
                class="busy-dot"
              ></span>
              <strong>
                {{ retrievalJob ? getRetrievalStageLabel(retrievalJob.stage) : "Ready" }}
              </strong>
              <small>{{ retrievalJob?.input ?? "No retrieval has been started yet." }}</small>
            </div>
            <p v-if="retrievalErrorMessage" class="mutation-error">{{ retrievalErrorMessage }}</p>
            <p v-if="retrievalJob?.error" class="mutation-error">{{ retrievalJob.error }}</p>
            <div class="retrieval-action-grid">
              <button
                type="button"
                class="add-button"
                :disabled="
                  !selectedTrack || isRetrievalBusy || isRetrievalWorking(retrievalJob?.stage)
                "
                @click="startSelectedTrackAudioRetrieval"
              >
                {{ selectedTrack?.audioAvailable ? "Replace audio" : "Retrieve audio" }}
              </button>
              <button
                v-if="retrievalJob"
                type="button"
                class="secondary-action-button"
                :disabled="isRetrievalBusy"
                @click="refreshRetrievalJob"
              >
                Refresh
              </button>
              <button
                v-if="
                  retrievalJob &&
                  ['failed', 'cancelled', 'lucida', 'linked'].includes(retrievalJob.stage)
                "
                type="button"
                class="secondary-action-button"
                :disabled="isRetrievalBusy"
                @click="retryCurrentRetrieval"
              >
                Retry
              </button>
              <button
                v-if="retrievalJob?.stage === 'downloading-yandex'"
                type="button"
                class="secondary-action-button"
                :disabled="isRetrievalBusy"
                @click="chooseYandexRetrievalCandidate(null)"
              >
                Skip Yandex
              </button>
              <button
                v-if="retrievalJob?.stage === 'downloading-spotify'"
                type="button"
                class="secondary-action-button"
                :disabled="isRetrievalBusy"
                @click="chooseSpotifyRetrievalCandidate(null)"
              >
                Skip SpotiFLAC
              </button>
              <button
                v-if="retrievalJob && isRetrievalWorking(retrievalJob.stage)"
                type="button"
                class="secondary-action-button"
                @click="cancelCurrentRetrieval"
              >
                Cancel
              </button>
            </div>
          </section>
          <section v-if="retrievalJob" class="retrieval-choice-panel">
            <div v-if="retrievalJob.stage === 'yandex-candidates'" class="candidate-list">
              <button
                v-for="candidate in retrievalJob.yandexCandidates"
                :key="candidate.id"
                type="button"
                class="candidate-button"
                :disabled="isRetrievalBusy"
                @click="chooseYandexRetrievalCandidate(candidate.id)"
              >
                <span>{{ candidate.title }}</span>
                <small>{{ getRetrievalCandidateMeta(candidate) }}</small>
              </button>
              <button
                type="button"
                class="secondary-action-button"
                :disabled="isRetrievalBusy"
                @click="chooseYandexRetrievalCandidate(null)"
              >
                Skip Yandex
              </button>
            </div>
            <div v-else-if="retrievalJob.stage === 'spotify-candidates'" class="candidate-list">
              <button
                v-for="candidate in retrievalJob.spotifyCandidates"
                :key="candidate.id"
                type="button"
                class="candidate-button"
                :disabled="isRetrievalBusy"
                @click="chooseSpotifyRetrievalCandidate(candidate.id)"
              >
                <span>{{ candidate.title }}</span>
                <small>{{ getRetrievalCandidateMeta(candidate) }}</small>
              </button>
              <button
                type="button"
                class="secondary-action-button"
                :disabled="isRetrievalBusy"
                @click="chooseSpotifyRetrievalCandidate(null)"
              >
                Skip SpotiFLAC
              </button>
            </div>
            <div v-else-if="retrievalJob.stage === 'lucida'" class="retrieval-empty-state">
              <strong>Manual fallback is ready</strong>
              <p>Lucida opened in the browser. Download the FLAC into the folder shown here.</p>
              <button type="button" class="add-button" @click="openCurrentLucidaUrl">
                Open Lucida
              </button>
            </div>
            <div v-else-if="retrievalJob.stage === 'linked'" class="retrieval-empty-state">
              <strong>Audio linked</strong>
              <p>
                {{ retrievalJob.linkedTrack?.audioFileName ?? "The track now has a source file." }}
              </p>
            </div>
            <div v-else class="retrieval-empty-state">
              <strong>Working</strong>
              <p>Keep this window open to watch search and download progress.</p>
            </div>
          </section>
          <section v-else class="retrieval-choice-panel retrieval-empty-state">
            <strong>Ready</strong>
            <p>Start retrieval to search Yandex first, then SpotiFLAC, then Lucida.</p>
          </section>
        </div>
        <section class="retrieval-log-panel">
          <div class="retrieval-status-row">
            <strong>Status log</strong>
            <small>{{ retrievalJob?.messages.length ?? 0 }} messages</small>
          </div>
          <ol v-if="retrievalJob?.messages.length" class="retrieval-message-list">
            <li v-for="(message, index) in retrievalJob.messages" :key="`${index}-${message}`">
              {{ message }}
            </li>
          </ol>
          <p v-else class="muted">No retrieval messages yet.</p>
        </section>
      </section>
    </div>
    <nav class="mobile-tab-bar" aria-label="Mobile workspace sections">
      <button
        v-for="tab in mobileTabs"
        :key="tab.id"
        type="button"
        :class="{ active: activeMobilePanel === tab.id }"
        @click="setActiveMobilePanel(tab.id)"
      >
        <span>{{ tab.label }}</span>
        <small>{{ tab.count }}</small>
      </button>
    </nav>
  </main>
</template>
