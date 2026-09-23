<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import Sortable, { type SortableEvent } from "sortablejs";

import {
  canKeysTransition,
  CIRCLE_OF_FIFTHS,
  getTransitionProfile,
  formatKeyNotation,
  formatCircleNotation,
  describePlacement,
  KEY_NOTATIONS,
  type KeyNotation,
  PITCH_CLASSES,
  PITCH_CLASS_LABELS,
  type DiatonicMode,
  type ModalVariant,
  type PitchClass,
  type TrackKey,
  type VerificationState,
} from "@djdesk/domain";

import {
  ApiError,
  fetchAppConfig,
  fetchWorkspaceSession,
  exchangeWorkspaceLink,
  rotateWorkspaceLink,
  takeNewWorkspaceSecret,
  saveSetSnapshot,
  cancelRetrievalJob,
  createSet,
  createTrack,
  deleteSet,
  fetchAudioLibrary,
  fetchRetrievalJob,
  fetchSets,
  fetchTrackHarmony,
  fetchTracks,
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
import { SetSaveQueue } from "./set-saving.ts";
import { mergeLoadedSets } from "./set-loading.ts";
import { resolveSetRows } from "./set-rows.ts";
import { DEFAULT_TARGET_BPM } from "./bpm-sorting.ts";
import {
  getPriorityBpmTarget,
  matchesBrowserPriority,
  normalizeSearchText,
  rankBrowserTracks,
  type BrowserPriority,
} from "./browser-search.ts";
import {
  readNavigation,
  updateNavigationUrl,
  trackHref,
  trackShareUrl,
  type NavigationState,
} from "./navigation.ts";
import {
  formatDraftCompatibilityReason,
  getDraftCandidateCompatibility,
  getDraftTransitionContext,
  type DraftCandidateCompatibility,
} from "./draft-slot.ts";
import { getNextPlaybackIntentForAudioEvent } from "./playback-intent.ts";
import { getTempoPreviewRate, isTempoPreviewRateActive } from "./tempo-preview.ts";
import { locale, t, message, trackCount, segmentCount } from "./locale.ts";
import HelpDialog from "./HelpDialog.vue";

type SectionSlice = "home" | "pure-clockwise" | "pure-counter";
type CompatibilityClass = "compatible" | "incompatible" | null;
type MobilePanel = "focus" | "map" | "set" | "tracks";
type PlacementLane = NonNullable<TrackView["placement"]>["lane"];
type PitchPreservingAudioElement = HTMLAudioElement & {
  mozPreservesPitch?: boolean;
  preservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
};
type CircleSelection =
  | { kind: "unknown" }
  | { kind: "section"; section: number }
  | { kind: "boundary"; boundaryIndex: number };

type DraftSet = SetDraftView;

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
type QualityFilter = "all" | "hq" | "lossy" | "lossy-plus" | "not-analyzed";
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
  quality: QualityFilter;
  setPresence: SetPresenceFilter;
}

const ZONE_INNER_RADIUS = 104;
const ZONE_OUTER_RADIUS = 232;
const MAIN_ZONE_HALF_WIDTH = 0.23;
const PURE_ZONE_START = 0.25;
const PURE_ZONE_END = 0.42;
const BOUNDARY_ZONE_HALF_WIDTH = 0.07;
const BPM_SCORE_HALF_LIFE = 0.06;
const TARGET_BPM_SCROLL_DURATION_MS = 180;
const canEditCatalog = ref(false);
const isPublicMode = ref(false);
const isWorkspaceReady = ref(false);
const hasWorkspace = ref(false);
const accessLink = ref("");
const accessMessage = ref<unknown>("");
const isAccessBusy = ref(false);
const workspaceError = ref<unknown>("");
const keyNotation = ref<KeyNotation>("letters");
const saveQueue = new SetSaveQueue();
const pendingSetWrites = ref(0);
const saveFailures = ref<Record<string, { message: unknown; conflict: boolean }>>({});
const activeSaveFailure = computed(() => saveFailures.value[activeDraftSetId.value]);
const hasUnsavedSetName = computed(
  () => Boolean(activeDraftSet.value) && renameSetName.value.trim() !== activeDraftSet.value?.name,
);
const saveStatus = computed(() =>
  activeSaveFailure.value
    ? t("Could not save")
    : isSetSaving.value || hasUnsavedSetName.value
      ? t("Saving…")
      : t("Saved"),
);
let setNameSaveTimer: ReturnType<typeof setTimeout> | undefined;
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
const errorMessage = ref<unknown>("");
const isLoading = ref(true);
const harmonyErrorMessage = ref<unknown>("");
const isHarmonyLoading = ref(false);
const circleSelection = ref<CircleSelection | null>(null);
const selectedTrack = ref<TrackView | null>(null);
const draftSets = ref<DraftSet[]>([]);
const activeDraftSetId = ref("");
const selectedDraftIndex = ref<number | null>(null);
const trackHarmony = ref<TrackHarmonyResponse | null>(null);
const draggedDraftIndex = ref<number | null>(null);
const dragOverDraftIndex = ref<number | null>(null);
const setChainList = ref<HTMLElement | null>(null);
const audioPlayer = ref<HTMLAudioElement | null>(null);
const audioCurrentTime = ref(0);
const audioDuration = ref(0);
const isAudioPlaying = ref(false);
const playbackIntent = ref(false);
const isTempoPreviewEnabled = ref(false);
const tempoPreviewTargetBpmDraft = ref<string | number>(String(DEFAULT_TARGET_BPM));
const targetBpmDraft = ref<string | number>(String(DEFAULT_TARGET_BPM));
const browserGrid = ref<HTMLElement | null>(null);
const activeMobilePanel = ref<MobilePanel>("map");
const setErrorMessage = ref<unknown>("");
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
const compatibleOnly = ref(false);
const compatibilityNotice = ref("");
const isSetPickerOpen = ref(false);
const isSetCreatorOpen = ref(false);
const hasLoadedSets = ref(false);
const isLoadingSets = ref(false);
const unavailableTrackId = ref<string | null>(null);
const trackLinkMessage = ref("");
const trackLinkFallback = ref("");
let navigationRevision = 0;
let harmonyRevision = 0;
const hasPendingTargetBpmJump = ref(false);
let retrievalPollTimer: number | null = null;
let targetBpmScrollAnimationFrame: number | null = null;
let setChainSortable: Sortable | null = null;
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
    label: formatCircleNotation(pitch, keyNotation.value, locale.value),
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
    compatibleOnly.value ||
    normalizedTrackSearchQuery.value.length > 0 ||
    activeTrackFiltersCount.value > 0,
);

const unknownKeyTracks = computed(() =>
  tracks.value.filter((track) => !track.key).sort(compareNullableBpmThenTitle),
);

const browserPriority = computed<BrowserPriority>(() => {
  const selection = circleSelection.value;
  if (!selection || selection.kind === "unknown") return selection;
  return {
    kind: "sections",
    sections:
      selection.kind === "section"
        ? [selection.section]
        : [Math.floor(selection.boundaryIndex), Math.ceil(selection.boundaryIndex) % 12],
  };
});
const browserTracks = computed(() =>
  rankBrowserTracks(
    tracks.value
      .filter((track) => trackMatchesFilters(track, trackFilters.value))
      .filter((track) => !compatibleOnly.value || !getTrackDraftCompatibility(track).isRisky),
    {
      query: normalizedTrackSearchQuery.value,
      priority: browserPriority.value,
      keyLabel: displayKey,
    },
  ),
);
const hasPreferredMatches = computed(() =>
  browserTracks.value.some((track) => matchesBrowserPriority(track, browserPriority.value)),
);

const selectedLabel = computed(() => getSelectedPositionLabel());

const centerReadout = computed(() => getCenterReadout());

const browserTitle = computed(() => trackCount(browserTracks.value.length));

const browserEyebrow = computed(() =>
  compatibleOnly.value ? t("Only compatible") : t("All tracks"),
);

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
  () => draftSets.value.find((draftSet) => draftSet.id === activeDraftSetId.value) ?? null,
);

const activeDraftTrackIds = computed(() => activeDraftSet.value?.trackIds ?? []);

const draftTracks = computed(() =>
  resolveSetRows(activeDraftTrackIds.value, tracks.value, unavailableTrack),
);

const draftTransitionContext = computed(() =>
  getDraftTransitionContext(draftTracks.value, selectedDraftIndex.value),
);
const hasCompatibilityReference = computed(() =>
  Boolean(draftTransitionContext.value.previousTrack || draftTransitionContext.value.nextTrack),
);
const compatibilityContextLabel = computed(() => {
  const { previousTrack, nextTrack } = draftTransitionContext.value;
  if (previousTrack && nextTrack)
    return t("Compatible between {previous} and {next}", {
      previous: previousTrack.title,
      next: nextTrack.title,
    });
  if (previousTrack) return t("Compatible after {track}", { track: previousTrack.title });
  if (nextTrack) return t("Compatible before {track}", { track: nextTrack.title });
  return t("Add a track to a set to compare harmony.");
});
const hasHiddenSaveFailures = computed(() =>
  Object.keys(saveFailures.value).some((id) => id !== activeDraftSetId.value),
);

const isReplaceMode = computed(() => draftTransitionContext.value.mode === "replace");

const selectedDraftSlotTrack = computed(() =>
  selectedDraftIndex.value === null ? null : (draftTracks.value[selectedDraftIndex.value] ?? null),
);

const replaceModeTitle = computed(() =>
  selectedDraftIndex.value === null
    ? ""
    : t("Replacing #{position}", { position: selectedDraftIndex.value + 1 }),
);

const replaceModeSubtitle = computed(() => {
  const context = draftTransitionContext.value;

  if (context.mode !== "replace" || context.selectedIndex === null) {
    return "";
  }

  const parts = [
    context.previousTrack
      ? t("after #{position}", { position: context.selectedIndex })
      : t("start of set"),
    context.nextTrack
      ? t("before #{position}", { position: context.selectedIndex + 2 })
      : t("end of set"),
  ];

  return parts.join(" · ");
});

const selectedTrackInAnyDraftSet = computed(() => {
  const trackId = selectedTrack.value?.id;

  return trackId ? isTrackInAnyDraftSet(trackId) : false;
});

const selectedTrackDraftCompatibility = computed<DraftCandidateCompatibility | null>(() =>
  selectedTrack.value ? getTrackDraftCompatibility(selectedTrack.value) : null,
);

const isAddTransitionRisky = computed(() => {
  return selectedTrackDraftCompatibility.value?.isRisky ?? false;
});

const addButtonLabel = computed(() => {
  if (isReplaceMode.value) {
    return t("Replace");
  }

  return selectedTrackInAnyDraftSet.value ? t("Add again") : t("Add");
});

const addButtonTitle = computed(() => {
  if (!activeDraftSet.value) {
    return isPublicMode.value
      ? t("Start and save your first set")
      : t("Create a set before adding tracks");
  }

  if (isReplaceMode.value) {
    const reason = formatDraftCompatibilityReason(
      draftTransitionContext.value,
      selectedTrackDraftCompatibility.value,
    );

    return reason
      ? t("Replace anyway: {reason}", { reason: message(reason) })
      : t("Replace selected set slot");
  }

  if (isAddTransitionRisky.value) {
    return t("Non-harmonic transition");
  }

  if (selectedTrackInAnyDraftSet.value) {
    return t("Track already appears in at least one draft set");
  }

  return t("Add to active draft set");
});

const addButtonReason = computed(() => {
  const reasons = [
    selectedTrackInAnyDraftSet.value ? "Already in a set" : "",
    formatDraftCompatibilityReason(
      draftTransitionContext.value,
      selectedTrackDraftCompatibility.value,
    ),
  ].filter(Boolean);

  if (reasons.length > 0) {
    return reasons.map((reason) => message(reason)).join("; ");
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
    label: t("Map"),
  },
  {
    count: browserTracks.value.length,
    id: "tracks" as const,
    label: isTrackSearchActive.value ? t("Search") : t("Tracks"),
  },
  {
    count: selectedTrack.value?.audioAvailable ? t("audio") : t("info"),
    id: "focus" as const,
    label: t("Focus"),
  },
  {
    count: draftTracks.value.length,
    id: "set" as const,
    label: t("Set"),
  },
]);

const canControlSelectedAudio = computed(() => Boolean(selectedTrack.value?.audioUrl));

const globalPlayerTitle = computed(() => selectedTrack.value?.title ?? t("No track selected"));

const globalPlayerArtist = computed(() => selectedTrack.value?.artist || t("Select a track"));

const globalPlayerMeta = computed(() => {
  const track = selectedTrack.value;

  if (!track) {
    return t("No track selected");
  }

  if (!track.audioAvailable) {
    return t("No audio linked");
  }

  return joinAudioQualityParts([
    track.audioFileName ?? t("Audio linked"),
    formatTrackAudioQualitySummary(track),
  ]);
});

const globalPlayerStatus = computed(() => {
  const track = selectedTrack.value;

  if (!track) {
    return t("No track selected");
  }

  if (!track.audioUrl) {
    return playbackIntent.value ? t("Waiting for audio") : t("No audio linked");
  }

  if (isAudioPlaying.value) {
    return t("Playing");
  }

  return playbackIntent.value ? t("Waiting for audio") : t("Paused");
});

const globalPlayerTimeLabel = computed(
  () =>
    `${formatPlaybackTime(audioCurrentTime.value)} / ${formatPlaybackTime(audioDuration.value)}`,
);

const browserTargetBpm = computed(
  () => parseOptionalPositiveNumber(targetBpmDraft.value) ?? DEFAULT_TARGET_BPM,
);

const tempoPreviewTargetBpm = computed(
  () => parseOptionalPositiveNumber(tempoPreviewTargetBpmDraft.value) ?? DEFAULT_TARGET_BPM,
);

const tempoPreviewRate = computed(() =>
  getTempoPreviewRate({
    enabled: isTempoPreviewEnabled.value,
    sourceBpm: selectedTrack.value?.bpm ?? null,
    targetBpm: tempoPreviewTargetBpm.value,
  }),
);

const isTempoPreviewActive = computed(() => isTempoPreviewRateActive(tempoPreviewRate.value));

const tempoPreviewStatus = computed(() => {
  const track = selectedTrack.value;

  if (!track) {
    return t("Select a track");
  }

  if (!track.audioUrl) {
    return t("No audio linked");
  }

  if (!isTempoPreviewEnabled.value) {
    return t("Original tempo");
  }

  if (!track.bpm) {
    return t("Unknown BPM");
  }

  if (!isTempoPreviewActive.value) {
    return t("{bpm} BPM is already near playback target", {
      bpm: formatEditableBpm(track.bpm),
    });
  }

  return `${formatEditableBpm(track.bpm)} -> ${formatEditableBpm(tempoPreviewTargetBpm.value)} BPM · ${tempoPreviewRate.value.toFixed(2)}x`;
});

onMounted(async () => {
  try {
    const config = await fetchAppConfig();
    isPublicMode.value = config.mode === "public";
    canEditCatalog.value = !isPublicMode.value;
    try {
      const savedNotation = localStorage.getItem("djdesk.key-notation");
      keyNotation.value = KEY_NOTATIONS.includes(savedNotation as KeyNotation)
        ? (savedNotation as KeyNotation)
        : isPublicMode.value
          ? "letters"
          : "solfege";
    } catch {
      /* Storage preferences are optional. */
    }
    await initializeWorkspace();
    const [trackResponse, audioLibraryResponse] = await Promise.all([
      fetchTracks(),
      canEditCatalog.value ? fetchAudioLibrary() : Promise.resolve({ audioUploadDir: "" }),
    ]);
    audioUploadDir.value = audioLibraryResponse.audioUploadDir;
    tracks.value = trackResponse.tracks;
    await applyNavigation();
  } catch (error) {
    errorMessage.value = error;
  } finally {
    isLoading.value = false;
  }
  window.addEventListener("beforeunload", warnUnsavedChanges);
  window.addEventListener("hashchange", handleWorkspaceLinkChange);
  window.addEventListener("popstate", handleNavigationChange);
});

onUnmounted(() => {
  clearTimeout(setNameSaveTimer);
  window.removeEventListener("beforeunload", warnUnsavedChanges);
  window.removeEventListener("hashchange", handleWorkspaceLinkChange);
  window.removeEventListener("popstate", handleNavigationChange);
  clearRetrievalPolling();
  cancelTargetBpmScroll();
  destroySetChainSortable();
});

watch(keyNotation, (value) => {
  try {
    localStorage.setItem("djdesk.key-notation", value);
  } catch {
    /* Keep the in-memory preference. */
  }
});

function displayKey(track: TrackView): string {
  return formatKeyNotation(track.key, keyNotation.value, locale.value);
}

function displayPlacement(track: TrackView): string {
  return track.key ? describePlacement(track.key, locale.value) : t("Not placed on circle yet");
}

function unavailableTrack(id: string): TrackView {
  return {
    id,
    title: t("Track unavailable"),
    bpm: null,
    key: null,
    chordProgression: [],
    tags: [],
    confidence: { bpm: "estimated", key: "estimated", chords: "estimated" },
    audioAvailable: false,
    audioFileName: null,
    audioUrl: null,
    keyLabel: t("Unknown key"),
    placement: null,
  };
}

function warnUnsavedChanges(event: BeforeUnloadEvent): void {
  if (
    !pendingSetWrites.value &&
    !hasUnsavedSetName.value &&
    !Object.keys(saveFailures.value).length
  )
    return;
  event.preventDefault();
}

async function handleWorkspaceLinkChange(): Promise<void> {
  const route = readNavigation(window.location.href);
  if (!isPublicMode.value || !route.secret) return;
  const revision = ++navigationRevision;
  // Keep credentials only in this operation, including when a pending save blocks exchange.
  window.history.replaceState(
    null,
    "",
    updateNavigationUrl(window.location.href, {}, { stripSecret: true }),
  );
  await saveActiveSetName();
  await saveQueue.flush();
  if (
    revision !== navigationRevision ||
    isSetSaving.value ||
    hasUnsavedSetName.value ||
    Object.keys(saveFailures.value).length
  )
    return;
  if (await initializeWorkspace(route, revision)) {
    if (revision === navigationRevision) await applyNavigation();
  }
}

let currentWorkspaceId: string | null = null;
let workspaceGeneration = 0;
let workspaceInitializationTail: Promise<unknown> = Promise.resolve();
let savedSetsLoad: { generation: number; promise: Promise<void> } | null = null;
const deletedSetIds = new Set<string>();

function setCurrentWorkspace(workspaceId: string | null): void {
  hasWorkspace.value = Boolean(workspaceId);
  if (currentWorkspaceId === workspaceId) return;
  currentWorkspaceId = workspaceId;
  workspaceGeneration++;
  deletedSetIds.clear();
  savedSetsLoad = null;
  isLoadingSets.value = false;
  draftSets.value = [];
  activeDraftSetId.value = "";
  selectedDraftIndex.value = null;
  hasLoadedSets.value = false;
  saveFailures.value = {};
  accessLink.value = "";
  accessMessage.value = "";
}

async function initializeWorkspace(
  route: NavigationState = readNavigation(window.location.href),
  revision = navigationRevision,
): Promise<boolean> {
  // Exchange requests change the cookie and API session as well as the view. Serialize them.
  const initialization = workspaceInitializationTail.then(async () => {
    if (revision !== navigationRevision) return false;
    isWorkspaceReady.value = false;
    if (!isPublicMode.value) {
      isWorkspaceReady.value = true;
      return true;
    }
    const { workspaceId, secret } = route;
    window.history.replaceState(
      null,
      "",
      updateNavigationUrl(window.location.href, {}, { stripSecret: true }),
    );
    const session =
      workspaceId && secret
        ? await exchangeWorkspaceLink(workspaceId, secret)
        : await fetchWorkspaceSession();
    if (workspaceId && session.workspaceId !== workspaceId)
      throw new Error("Open the complete secret access link for this workspace.");
    setCurrentWorkspace(session.workspaceId);
    isWorkspaceReady.value = true;
    if (revision !== navigationRevision) return false;
    workspaceError.value = "";
    if (workspaceId && !route.setId) {
      await loadSavedSets();
      if (revision !== navigationRevision) return false;
      isSetPickerOpen.value = true;
    }
    return true;
  });
  workspaceInitializationTail = initialization.catch(() => undefined);
  try {
    return await initialization;
  } catch (error) {
    if (revision === navigationRevision) workspaceError.value = error;
    return false;
  }
}

async function loadSavedSets(): Promise<void> {
  if (hasLoadedSets.value || (isPublicMode.value && !hasWorkspace.value)) return;
  const generation = workspaceGeneration;
  if (savedSetsLoad?.generation === generation) return savedSetsLoad.promise;
  isLoadingSets.value = true;
  const promise = fetchSets()
    .then((result) => {
      if (generation !== workspaceGeneration) return;
      const existingIds = new Set(draftSets.value.map((set) => set.id));
      draftSets.value = mergeLoadedSets(draftSets.value, result.sets, deletedSetIds);
      for (const set of draftSets.value) {
        if (!existingIds.has(set.id)) {
          saveQueue.remember(set.id, set.revision);
        }
      }
      hasLoadedSets.value = true;
    })
    .catch((error: unknown) => {
      if (generation === workspaceGeneration) throw error;
    })
    .finally(() => {
      if (savedSetsLoad?.promise === promise) {
        savedSetsLoad = null;
        isLoadingSets.value = false;
      }
    });
  savedSetsLoad = { generation, promise };
  return promise;
}

function writeNavigation(
  patch: { trackId?: string | null; setId?: string | null },
  replace = false,
  revision = ++navigationRevision,
): void {
  if (revision !== navigationRevision) return;
  // A newer click can interrupt pending history restoration. Keep both selections in sync.
  const url = updateNavigationUrl(window.location.href, {
    trackId: selectedTrack.value?.id ?? unavailableTrackId.value,
    setId: activeDraftSetId.value || null,
    ...patch,
  });
  if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", url);
}

function beginSelectionIntent(): number {
  const revision = ++navigationRevision;
  writeNavigation({}, true, revision);
  return revision;
}

function handleNavigationChange(): void {
  void applyNavigation();
}

async function applyNavigation(): Promise<void> {
  if (isPublicMode.value && readNavigation(window.location.href).secret) {
    await handleWorkspaceLinkChange();
    return;
  }
  const revision = ++navigationRevision;
  const route = readNavigation(window.location.href);
  await saveActiveSetName();
  if (revision !== navigationRevision) return;
  if (hasUnsavedSetName.value) {
    writeNavigation(
      {
        setId: activeDraftSetId.value || null,
        trackId: selectedTrack.value?.id ?? null,
      },
      true,
      revision,
    );
    return;
  }
  let setLoadError: unknown;
  if (route.setId) {
    try {
      await loadSavedSets();
    } catch (error) {
      setLoadError = error;
    }
    if (revision !== navigationRevision) return;
  }
  const set = route.setId
    ? draftSets.value.find((candidate) => candidate.id === route.setId)
    : null;
  activeDraftSetId.value = set?.id ?? "";
  selectedDraftIndex.value = null;
  if (setLoadError) setErrorMessage.value = setLoadError;
  else if (route.setId && !set) setErrorMessage.value = "Set unavailable";
  else setErrorMessage.value = "";
  const track = route.trackId
    ? tracks.value.find((candidate) => candidate.id === route.trackId)
    : null;
  if (selectedTrack.value?.id !== track?.id) {
    playbackIntent.value = false;
    audioPlayer.value?.pause();
    selectedTrack.value = track ?? null;
  }
  unavailableTrackId.value = route.trackId && !track ? route.trackId : null;
  if (route.trackId) setActiveMobilePanel("focus");
  else if (set) setActiveMobilePanel("set");
}

async function openSetPicker(): Promise<void> {
  const revision = beginSelectionIntent();
  setActiveMobilePanel("set");
  isSetPickerOpen.value = !isSetPickerOpen.value;
  if (!isSetPickerOpen.value) return;
  try {
    await loadSavedSets();
  } catch (error) {
    if (revision === navigationRevision) setErrorMessage.value = error;
  }
}

async function closeDraftSet(): Promise<void> {
  const revision = beginSelectionIntent();
  await saveActiveSetName();
  if (revision !== navigationRevision || hasUnsavedSetName.value) return;
  activeDraftSetId.value = "";
  selectedDraftIndex.value = null;
  accessLink.value = "";
  isSetPickerOpen.value = false;
  writeNavigation({ setId: null }, false, revision);
}

async function copyTrackLink(): Promise<void> {
  if (!selectedTrack.value) return;
  const revision = navigationRevision;
  const link = trackShareUrl(window.location.origin, selectedTrack.value.id);
  try {
    await navigator.clipboard.writeText(link);
    if (revision !== navigationRevision) return;
    trackLinkMessage.value = t("Track link copied.");
    trackLinkFallback.value = "";
  } catch {
    if (revision !== navigationRevision) return;
    trackLinkMessage.value = t("Copy this track link:");
    trackLinkFallback.value = link;
  }
}

function showNewAccessLink(activate = true): void {
  const result = takeNewWorkspaceSecret();
  if (!result) return;
  setCurrentWorkspace(result.workspaceId);
  if (activate) activeMobilePanel.value = "set";
  accessLink.value = `${window.location.origin}/w/${result.workspaceId}#key=${result.secret}`;
  accessMessage.value =
    "Save this link now. Anyone with it can edit all your sets. Without the link or an active browser session, access cannot be recovered.";
}

async function copyAccessLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(accessLink.value);
    accessMessage.value = "Link copied. Keep it somewhere private.";
  } catch {
    accessMessage.value = "Select and copy the link below.";
  }
}

async function replaceAccessLink(): Promise<void> {
  if (
    !window.confirm(
      t(
        "Replace your secret link? The old link and other devices will lose access. Your sets will remain saved.",
      ),
    )
  )
    return;
  const revision = navigationRevision;
  isAccessBusy.value = true;
  try {
    await rotateWorkspaceLink();
    showNewAccessLink(revision === navigationRevision);
  } catch (error) {
    accessMessage.value = error;
  } finally {
    isAccessBusy.value = false;
  }
}

async function persistDraftSnapshot(set: DraftSet): Promise<void> {
  const snapshot = { ...set, trackIds: [...set.trackIds] };
  pendingSetWrites.value++;
  isSetSaving.value = true;
  try {
    await saveQueue.save(
      set.id,
      (revision) => saveSetSnapshot(snapshot, revision),
      replaceDraftSet,
    );
  } catch (error) {
    saveFailures.value = {
      ...saveFailures.value,
      [set.id]: {
        message: error,
        conflict: error instanceof ApiError && error.status === 409,
      },
    };
  } finally {
    pendingSetWrites.value--;
    isSetSaving.value = pendingSetWrites.value > 0;
  }
}

async function retryActiveSetSave(): Promise<void> {
  const set = activeDraftSet.value;
  if (!set) return;
  delete saveFailures.value[set.id];
  saveQueue.unblock(set.id);
  await persistDraftSnapshot(set);
}

async function reloadActiveSet(): Promise<void> {
  const set = activeDraftSet.value;
  if (
    !set ||
    !window.confirm(t("Load the saved version? Unsaved changes to this set will be discarded."))
  )
    return;
  const revision = beginSelectionIntent();
  const generation = workspaceGeneration;
  const requestedName = renameSetName.value;
  try {
    const saved = (await fetchSets()).sets.find((candidate) => candidate.id === set.id);
    if (generation !== workspaceGeneration) return;
    // The confirmation covers only the draft that existed when this read started.
    if (
      draftSets.value.find((candidate) => candidate.id === set.id) !== set ||
      (activeDraftSetId.value === set.id && renameSetName.value !== requestedName)
    )
      return;
    if (!saved) {
      if (revision === navigationRevision)
        setErrorMessage.value =
          "This set was deleted on another device. Save your version as a copy.";
      return;
    }
    saveQueue.remember(set.id, saved.revision);
    saveQueue.unblock(set.id);
    delete saveFailures.value[set.id];
    replaceDraftSet(saved);
    if (revision === navigationRevision && activeDraftSetId.value === set.id)
      renameSetName.value = saved.name;
  } catch (error) {
    if (revision === navigationRevision) setErrorMessage.value = error;
  }
}

async function copyUnsavedSet(): Promise<void> {
  const set = activeDraftSet.value;
  if (!set || isSetSaving.value) return;
  const revision = beginSelectionIntent();
  const generation = workspaceGeneration;
  isSetSaving.value = true;
  try {
    const copy = await createSet(
      t("{name} (copy)", { name: set.name.slice(0, 110) }),
      set.trackIds,
    );
    if (generation !== workspaceGeneration) return;
    draftSets.value.push(copy);
    saveQueue.remember(copy.id, copy.revision);
    if (revision === navigationRevision) {
      activeDraftSetId.value = copy.id;
      selectedDraftIndex.value = null;
      writeNavigation({ setId: copy.id }, false, revision);
    }
    const saved = (await fetchSets()).sets.find((candidate) => candidate.id === set.id);
    if (generation !== workspaceGeneration) return;
    // A copy owns only its captured snapshot. Preserve edits made while it was saving.
    if (
      draftSets.value.find((candidate) => candidate.id === set.id) !== set ||
      (activeDraftSetId.value === set.id && hasUnsavedSetName.value)
    )
      return;
    if (saved) {
      replaceDraftSet(saved);
      saveQueue.remember(saved.id, saved.revision);
    } else draftSets.value = draftSets.value.filter((candidate) => candidate.id !== set.id);
    delete saveFailures.value[set.id];
    saveQueue.unblock(set.id);
  } catch (error) {
    if (revision === navigationRevision) setErrorMessage.value = error;
  } finally {
    isSetSaving.value = pendingSetWrites.value > 0;
  }
}

watch(setChainList, (element) => {
  setupSetChainSortable(element);
});

watch(activeDraftTrackIds, (trackIds) => {
  if (selectedDraftIndex.value !== null && selectedDraftIndex.value >= trackIds.length) {
    selectedDraftIndex.value = null;
  }
});

watch(
  selectedTrack,
  async (track) => {
    const revision = ++harmonyRevision;
    trackHarmony.value = null;
    harmonyErrorMessage.value = "";
    isHarmonyLoading.value = false;

    if (!track) {
      return;
    }

    isHarmonyLoading.value = true;

    try {
      const harmony = await fetchTrackHarmony(track.id);
      if (revision === harmonyRevision) trackHarmony.value = harmony;
    } catch (error) {
      if (revision === harmonyRevision) harmonyErrorMessage.value = error;
    } finally {
      if (revision === harmonyRevision) isHarmonyLoading.value = false;
    }
  },
  {
    immediate: false,
  },
);

watch(
  selectedTrack,
  async (track, previousTrack) => {
    const trackChanged = Boolean(previousTrack && track && previousTrack.id !== track.id);
    const wasPlaying = trackChanged && isAudioElementPlaying(audioPlayer.value);

    if (wasPlaying) {
      playbackIntent.value = true;
    }

    if (!playbackIntent.value || !track?.audioUrl) {
      return;
    }

    await nextTick();
    if (!playbackIntent.value || selectedTrack.value?.id !== track.id) return;
    applyAudioTempoPreview(audioPlayer.value);
    await audioPlayer.value?.play().catch(() => undefined);
  },
  {
    flush: "sync",
  },
);

watch(
  [audioPlayer, tempoPreviewRate],
  async () => {
    await nextTick();
    applyAudioTempoPreview(audioPlayer.value);
  },
  {
    flush: "post",
  },
);

watch(
  selectedTrack,
  (track, previousTrack) => {
    if (track?.id !== previousTrack?.id) {
      trackLinkMessage.value = "";
      trackLinkFallback.value = "";
    }
    if (track?.id !== previousTrack?.id || track?.audioUrl !== previousTrack?.audioUrl) {
      resetAudioPlaybackState();
    }

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

watch(hasCompatibilityReference, (hasReference) => {
  if (!hasReference && compatibleOnly.value) {
    compatibleOnly.value = false;
    compatibilityNotice.value = "Compatibility was turned off because there is no reference track.";
  }
});

watch([normalizedTrackSearchQuery, compatibleOnly], () => {
  cancelTargetBpmScroll();
  hasPendingTargetBpmJump.value = false;
  void nextTick(() => {
    if (browserGrid.value) browserGrid.value.scrollTop = 0;
  });
});

watch(
  () => trackFilters.value.setPresence,
  async (value) => {
    if (value === "all") return;
    try {
      await loadSavedSets();
    } catch (error) {
      setErrorMessage.value = error;
    }
  },
);

watch(activeMobilePanel, (panel) => {
  if (panel === "tracks" && hasPendingTargetBpmJump.value) {
    requestTargetBpmJump();
  }
});

watch(
  activeDraftSet,
  (setDraft, previous) => {
    // An in-flight order save must not replace a name that is still being typed.
    if (setDraft?.id !== previous?.id || renameSetName.value === (previous?.name ?? ""))
      renameSetName.value = setDraft?.name ?? "";
  },
  {
    immediate: true,
  },
);

function selectSection(index: number): void {
  setCircleSelection({ kind: "section", section: index }, { jumpToTargetBpm: true });
}

function isAudioElementPlaying(audioElement: HTMLAudioElement | null): boolean {
  return Boolean(audioElement && !audioElement.paused && !audioElement.ended);
}

function resetAudioPlaybackState(): void {
  audioCurrentTime.value = 0;
  audioDuration.value = 0;
  isAudioPlaying.value = false;
}

function applyAudioTempoPreview(audioElement: HTMLAudioElement | null): void {
  if (!audioElement) {
    return;
  }

  const pitchElement = audioElement as PitchPreservingAudioElement;

  if ("preservesPitch" in pitchElement) {
    pitchElement.preservesPitch = true;
  }

  if ("mozPreservesPitch" in pitchElement) {
    pitchElement.mozPreservesPitch = true;
  }

  if ("webkitPreservesPitch" in pitchElement) {
    pitchElement.webkitPreservesPitch = true;
  }

  const rate = tempoPreviewRate.value;
  audioElement.defaultPlaybackRate = rate;
  audioElement.playbackRate = rate;
}

function syncAudioPlaybackState(audioElement: HTMLAudioElement | null): void {
  if (!audioElement) {
    resetAudioPlaybackState();
    return;
  }

  audioCurrentTime.value = Number.isFinite(audioElement.currentTime) ? audioElement.currentTime : 0;
  audioDuration.value = Number.isFinite(audioElement.duration) ? audioElement.duration : 0;
  isAudioPlaying.value = isAudioElementPlaying(audioElement);
}

function getAudioEventTrackId(event: Event): string | null {
  const audioElement = event.currentTarget as HTMLAudioElement | null;
  return audioElement?.dataset.trackId ?? null;
}

function handleAudioPlay(event: Event): void {
  const audioElement = event.currentTarget as HTMLAudioElement | null;

  applyAudioTempoPreview(audioElement);
  syncAudioPlaybackState(audioElement);
  playbackIntent.value = getNextPlaybackIntentForAudioEvent({
    activeTrackId: selectedTrack.value?.id,
    currentIntent: playbackIntent.value,
    eventTrackId: getAudioEventTrackId(event),
    eventType: "play",
  });
}

function handleAudioPause(event: Event): void {
  syncAudioPlaybackState(event.currentTarget as HTMLAudioElement | null);
  playbackIntent.value = getNextPlaybackIntentForAudioEvent({
    activeTrackId: selectedTrack.value?.id,
    currentIntent: playbackIntent.value,
    eventTrackId: getAudioEventTrackId(event),
    eventType: "pause",
  });
}

function handleAudioEnded(event: Event): void {
  syncAudioPlaybackState(event.currentTarget as HTMLAudioElement | null);
  playbackIntent.value = false;
}

function handleAudioMetadataChange(event: Event): void {
  const audioElement = event.currentTarget as HTMLAudioElement | null;

  applyAudioTempoPreview(audioElement);
  syncAudioPlaybackState(audioElement);
}

function handleAudioTimeUpdate(event: Event): void {
  syncAudioPlaybackState(event.currentTarget as HTMLAudioElement | null);
}

async function toggleGlobalPlayerPlayback(): Promise<void> {
  if (!selectedTrack.value?.audioUrl) {
    return;
  }

  await nextTick();

  const audioElement = audioPlayer.value;

  if (!audioElement) {
    return;
  }

  applyAudioTempoPreview(audioElement);

  if (isAudioElementPlaying(audioElement)) {
    playbackIntent.value = false;
    audioElement.pause();
    syncAudioPlaybackState(audioElement);
    return;
  }

  playbackIntent.value = true;
  await audioElement.play().catch(() => undefined);
  syncAudioPlaybackState(audioElement);
}

function toggleTempoPreview(): void {
  if (!selectedTrack.value?.audioUrl) {
    return;
  }

  isTempoPreviewEnabled.value = !isTempoPreviewEnabled.value;
}

function seekGlobalPlayer(event: Event): void {
  const audioElement = audioPlayer.value;
  const nextTime = Number((event.currentTarget as HTMLInputElement | null)?.value);

  if (!audioElement || !Number.isFinite(nextTime)) {
    return;
  }

  audioElement.currentTime = Math.max(0, Math.min(nextTime, audioDuration.value || nextTime));
  syncAudioPlaybackState(audioElement);
}

function selectSectionSlice(index: number): void {
  selectSection(index);
}

function selectBoundary(boundaryIndex: number): void {
  setCircleSelection({ kind: "boundary", boundaryIndex }, { jumpToTargetBpm: true });
}

function selectTrack(track: TrackView): void {
  const revision = beginSelectionIntent();
  selectedTrack.value = track;
  unavailableTrackId.value = null;
  writeNavigation({ trackId: track.id }, false, revision);
  setActiveMobilePanel("focus");
}

function selectBrowserTrack(track: TrackView): void {
  selectTrack(track);
  setActiveMobilePanel(isReplaceMode.value ? "tracks" : "focus");
}

function openTrackLink(event: MouseEvent, track: TrackView): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  selectBrowserTrack(track);
}

function selectDraftReplacementTarget(index: number, track: TrackView): void {
  selectedDraftIndex.value = index;
  selectTrack(track);
  setActiveMobilePanel("tracks");
}

function clearSelectedDraftSlot(): void {
  selectedDraftIndex.value = null;
}

function selectUnknownKeyTracks(): void {
  setCircleSelection({ kind: "unknown" }, { jumpToTargetBpm: true });
}

function setCircleSelection(
  selection: CircleSelection | null,
  options: { jumpToTargetBpm?: boolean } = {},
): void {
  circleSelection.value = selection;
  setActiveMobilePanel("tracks");

  if (options.jumpToTargetBpm && !normalizedTrackSearchQuery.value) {
    requestTargetBpmJump();
  } else {
    cancelTargetBpmScroll();
    hasPendingTargetBpmJump.value = false;
    void nextTick(() => {
      if (browserGrid.value) browserGrid.value.scrollTop = 0;
    });
  }
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
    selectBrowserTrack(track);
  }
}

function jumpToTargetBpm(): void {
  cancelTargetBpmScroll();
  const closestTrack = getPriorityBpmTarget(
    browserTargetBpm.value,
    browserTracks.value,
    browserPriority.value,
  );

  if (!closestTrack) {
    if (browserGrid.value) browserGrid.value.scrollTop = 0;
    return;
  }

  void nextTick(() => {
    const trackRow = browserGrid.value?.querySelector<HTMLElement>(
      `[data-track-id="${CSS.escape(closestTrack.id)}"]`,
    );

    if (trackRow) {
      scrollBrowserTrackIntoView(trackRow);
    }
  });
}

function requestTargetBpmJump(): void {
  void nextTick(() => {
    if (!isBrowserGridVisible()) {
      hasPendingTargetBpmJump.value = true;
      return;
    }

    hasPendingTargetBpmJump.value = false;
    jumpToTargetBpm();
  });
}

function isBrowserGridVisible(): boolean {
  const grid = browserGrid.value;

  return Boolean(
    grid && grid.offsetParent !== null && grid.clientWidth > 0 && grid.clientHeight > 0,
  );
}

function scrollBrowserTrackIntoView(trackRow: HTMLElement): void {
  const scroller = browserGrid.value;

  if (!scroller) {
    trackRow.scrollIntoView({ behavior: "auto", block: "center" });
    return;
  }

  cancelTargetBpmScroll();

  const scrollerRect = scroller.getBoundingClientRect();
  const rowRect = trackRow.getBoundingClientRect();
  const rowTop = rowRect.top - scrollerRect.top + scroller.scrollTop;
  const targetTop = clampNumber(
    rowTop - (scroller.clientHeight - rowRect.height) / 2,
    0,
    Math.max(0, scroller.scrollHeight - scroller.clientHeight),
  );
  const startTop = scroller.scrollTop;
  const distance = targetTop - startTop;

  if (Math.abs(distance) < 1) {
    return;
  }

  const startTime = window.performance.now();

  const animate = (timestamp: number): void => {
    const progress = clampNumber((timestamp - startTime) / TARGET_BPM_SCROLL_DURATION_MS, 0, 1);
    const easedProgress = 1 - (1 - progress) ** 3;

    scroller.scrollTop = startTop + distance * easedProgress;

    if (progress < 1) {
      targetBpmScrollAnimationFrame = window.requestAnimationFrame(animate);
      return;
    }

    targetBpmScrollAnimationFrame = null;
  };

  targetBpmScrollAnimationFrame = window.requestAnimationFrame(animate);
}

function cancelTargetBpmScroll(): void {
  if (targetBpmScrollAnimationFrame === null) {
    return;
  }

  window.cancelAnimationFrame(targetBpmScrollAnimationFrame);
  targetBpmScrollAnimationFrame = null;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isAddButtonRedForTrack(track: TrackView): boolean {
  return isTrackInAnyDraftSet(track.id) || isTrackTransitionRisky(track);
}

function isTrackInAnyDraftSet(trackId: string): boolean {
  return draftSets.value.some((draftSet) => draftSet.trackIds.includes(trackId));
}

function isTrackTransitionRisky(track: TrackView): boolean {
  return getTrackDraftCompatibility(track).isRisky;
}

function getTrackDraftCompatibility(track: TrackView): DraftCandidateCompatibility {
  return getDraftCandidateCompatibility(draftTransitionContext.value, track, canTracksFollow);
}

async function selectDraftSet(id: string): Promise<void> {
  const revision = beginSelectionIntent();
  await saveActiveSetName();
  if (revision !== navigationRevision || hasUnsavedSetName.value) return;
  activeDraftSetId.value = id;
  selectedDraftIndex.value = null;
  isSetPickerOpen.value = false;
  setErrorMessage.value = "";
  writeNavigation({ setId: id }, false, revision);
}

async function createDraftSetFromInput(): Promise<void> {
  if (!isWorkspaceReady.value || isSetSaving.value) return;
  const revision = beginSelectionIntent();
  const name = newSetName.value.trim();
  await saveActiveSetName();
  if (revision !== navigationRevision || hasUnsavedSetName.value) return;

  if (!name) {
    setErrorMessage.value = "Set name is required";
    return;
  }

  setErrorMessage.value = "";
  isSetSaving.value = true;

  try {
    const setDraft = await createSet(name);
    saveQueue.remember(setDraft.id, setDraft.revision);
    showNewAccessLink(revision === navigationRevision);

    draftSets.value = [...draftSets.value, setDraft];
    if (revision !== navigationRevision) return;
    activeDraftSetId.value = setDraft.id;
    writeNavigation({ setId: setDraft.id }, false, revision);
    selectedDraftIndex.value = null;
    newSetName.value = "";
    isSetCreatorOpen.value = false;
    isSetPickerOpen.value = false;
  } catch (error) {
    if (revision === navigationRevision) setErrorMessage.value = error;
  } finally {
    isSetSaving.value = pendingSetWrites.value > 0;
  }
}

function scheduleSetNameSave(): void {
  beginSelectionIntent();
  clearTimeout(setNameSaveTimer);
  setNameSaveTimer = setTimeout(() => void saveActiveSetName(), 350);
}

async function saveActiveSetName(): Promise<void> {
  clearTimeout(setNameSaveTimer);
  const activeSet = activeDraftSet.value;
  const name = renameSetName.value.trim();

  if (!activeSet || name === activeSet.name) {
    return;
  }

  if (!name) {
    setErrorMessage.value = "Set name is required";
    renameSetName.value = activeSet.name;
    return;
  }

  setErrorMessage.value = "";
  const updated = { ...activeSet, name };
  replaceDraftSet(updated);
  await persistDraftSnapshot(updated);
}

async function deleteActiveSet(): Promise<void> {
  const activeSet = activeDraftSet.value;

  if (!activeSet || isSetSaving.value) {
    return;
  }

  if (!window.confirm(t("Delete set “{name}”?", { name: activeSet.name }))) {
    return;
  }

  const revision = beginSelectionIntent();
  const generation = workspaceGeneration;
  setErrorMessage.value = "";
  isSetSaving.value = true;
  clearTimeout(setNameSaveTimer);

  try {
    await deleteSet(activeSet.id, saveQueue.revision(activeSet.id));
    if (generation !== workspaceGeneration) return;

    deletedSetIds.add(activeSet.id);
    draftSets.value = draftSets.value.filter((setDraft) => setDraft.id !== activeSet.id);
    delete saveFailures.value[activeSet.id];
    saveQueue.unblock(activeSet.id);
    if (activeDraftSetId.value === activeSet.id) {
      activeDraftSetId.value = "";
      selectedDraftIndex.value = null;
    }
    if (readNavigation(window.location.href).setId === activeSet.id)
      writeNavigation({ setId: null }, revision !== navigationRevision, navigationRevision);
  } catch (error) {
    if (revision === navigationRevision) setErrorMessage.value = error;
    if (error instanceof ApiError && error.status === 409)
      saveFailures.value[activeSet.id] = { message: error, conflict: true };
  } finally {
    isSetSaving.value = pendingSetWrites.value > 0;
  }
}

async function addSelectedTrack(): Promise<void> {
  if (
    !selectedTrack.value ||
    !isWorkspaceReady.value ||
    !tracks.value.some((track) => track.id === selectedTrack.value?.id)
  )
    return;
  if (!activeDraftSet.value) {
    if (isSetSaving.value) return;
    const revision = beginSelectionIntent();
    const trackId = selectedTrack.value.id;
    isSetSaving.value = true;
    try {
      const set = await createSet(t("My first set"), [trackId]);
      showNewAccessLink(revision === navigationRevision);
      draftSets.value.push(set);
      saveQueue.remember(set.id, set.revision);
      if (revision !== navigationRevision) return;
      activeDraftSetId.value = set.id;
      writeNavigation({ setId: set.id }, false, revision);
    } catch (error) {
      if (revision === navigationRevision) setErrorMessage.value = error;
    } finally {
      isSetSaving.value = pendingSetWrites.value > 0;
    }
    return;
  }

  if (
    selectedDraftIndex.value !== null &&
    selectedDraftIndex.value >= 0 &&
    selectedDraftIndex.value < activeDraftTrackIds.value.length
  ) {
    const trackIds = [...activeDraftTrackIds.value];

    trackIds[selectedDraftIndex.value] = selectedTrack.value.id;
    await updateActiveDraftTrackIds(trackIds);
    return;
  }

  await updateActiveDraftTrackIds([...activeDraftTrackIds.value, selectedTrack.value.id]);
}

async function removeFromDraftAt(index: number): Promise<void> {
  selectedDraftIndex.value = getSelectedDraftIndexAfterRemoval(index);
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
  selectedDraftIndex.value = getSelectedDraftIndexAfterReorder(
    selectedDraftIndex.value,
    fromIndex,
    toIndex,
  );
  await updateActiveDraftTrackIds(trackIds);
}

function getSelectedDraftIndexAfterRemoval(removedIndex: number): number | null {
  if (selectedDraftIndex.value === null) {
    return null;
  }

  if (selectedDraftIndex.value === removedIndex) {
    return null;
  }

  return selectedDraftIndex.value > removedIndex
    ? selectedDraftIndex.value - 1
    : selectedDraftIndex.value;
}

function getSelectedDraftIndexAfterReorder(
  selectedIndex: number | null,
  fromIndex: number,
  toIndex: number,
): number | null {
  if (selectedIndex === null) {
    return null;
  }

  if (selectedIndex === fromIndex) {
    return toIndex;
  }

  if (fromIndex < selectedIndex && selectedIndex <= toIndex) {
    return selectedIndex - 1;
  }

  if (toIndex <= selectedIndex && selectedIndex < fromIndex) {
    return selectedIndex + 1;
  }

  return selectedIndex;
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

function setupSetChainSortable(element: HTMLElement | null): void {
  destroySetChainSortable();

  if (!element) {
    return;
  }

  setChainSortable = Sortable.create(element, {
    animation: 140,
    chosenClass: "dragging",
    dragClass: "dragging",
    ghostClass: "drag-over",
    handle: ".drag-handle",
    onChange(event: SortableEvent) {
      dragOverDraftIndex.value = event.newIndex ?? null;
    },
    onEnd(event: SortableEvent) {
      const fromIndex = event.oldIndex;
      const toIndex = event.newIndex;

      clearDraftDragState();

      if (fromIndex === undefined || toIndex === undefined || fromIndex === toIndex) {
        return;
      }

      void reorderDraftTrack(fromIndex, toIndex);
    },
    onStart(event: SortableEvent) {
      draggedDraftIndex.value = event.oldIndex ?? null;
      dragOverDraftIndex.value = event.oldIndex ?? null;
    },
  });
}

function destroySetChainSortable(): void {
  setChainSortable?.destroy();
  setChainSortable = null;
}

function clearDraftDragState(): void {
  draggedDraftIndex.value = null;
  dragOverDraftIndex.value = null;
}

async function updateActiveDraftTrackIds(trackIds: string[]): Promise<void> {
  const activeSet = activeDraftSet.value;
  if (!activeSet) return;
  const updated = { ...activeSet, trackIds };
  replaceDraftSet(updated);
  setErrorMessage.value = "";
  await persistDraftSnapshot(updated);
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
      return t("Audio linked");
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

function parseOptionalPositiveNumber(value: string | number): number | null {
  const trimmed = String(value).trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseDelimitedText(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
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

function formatPlaybackTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }

  return `${minutes}:${paddedSeconds}`;
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

function getDefaultTrackFilters(): TrackFilters {
  return {
    audio: "all",
    bpmMax: "",
    bpmMin: "",
    bpmVerification: "all",
    harmonyNotes: "all",
    keyStatus: "all",
    keyVerification: "all",
    quality: "all",
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
    filters.quality !== "all",
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

  if (filters.quality === "hq" && track.audioQuality?.status !== "hq") {
    return false;
  }

  if (filters.quality === "lossy" && track.audioQuality?.status !== "lossy") {
    return false;
  }

  if (filters.quality === "lossy-plus" && !track.audioQuality?.isHighBitrateLossy) {
    return false;
  }

  if (
    filters.quality === "not-analyzed" &&
    track.audioQuality &&
    track.audioQuality.status !== "unknown"
  ) {
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

function parseOptionalFilterNumber(value: string): number | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = Number.parseFloat(trimmed);

  return Number.isFinite(parsed) ? parsed : null;
}

function getTrackBpmCompatibilityScore(track: TrackView): number | null {
  const referenceTrack = draftTransitionContext.value.referenceTrack;

  return referenceTrack ? getBpmCompatibilityScore(referenceTrack.bpm, track.bpm) : null;
}

function getTrackBpmCompatibilityWidth(track: TrackView): string {
  return `${getTrackBpmCompatibilityScore(track) ?? 0}%`;
}

function getTrackBpmCompatibilityScoreLabel(track: TrackView): string {
  return String(getTrackBpmCompatibilityScore(track) ?? "—");
}

function getTrackBpmCompatibilityTitle(track: TrackView): string {
  const referenceTrack = draftTransitionContext.value.referenceTrack;

  if (!referenceTrack) {
    return isReplaceMode.value
      ? t("No previous track in selected slot")
      : t("No draft endpoint selected");
  }

  if (referenceTrack.bpm === null || track.bpm === null) {
    return t("BPM match unavailable");
  }

  const deltaPercent = getBpmDeltaRatio(referenceTrack.bpm, track.bpm) * 100;
  const score = getBpmCompatibilityScore(referenceTrack.bpm, track.bpm);

  return t("BPM match against {bpm} BPM: {score}/100, {delta}% apart", {
    bpm: referenceTrack.bpm,
    score: score ?? 0,
    delta: deltaPercent.toFixed(1),
  });
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
  const context = draftTransitionContext.value;

  if ((!context.previousTrack && !context.nextTrack) || candidateTracks.length === 0) {
    return null;
  }

  return candidateTracks.some((track) => !getTrackDraftCompatibility(track).isRisky)
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
    return t("All tracks");
  }

  switch (circleSelection.value.kind) {
    case "unknown":
      return t("Unknown key");
    case "boundary": {
      const before = Math.floor(circleSelection.value.boundaryIndex);
      const after = Math.ceil(circleSelection.value.boundaryIndex) % 12;
      const beforeLabel = getSectionDisplayLabel(before);
      const afterLabel = getSectionDisplayLabel(after);

      return t("{keys} boundary", { keys: `${beforeLabel} / ${afterLabel}` });
    }
    case "section":
      return t("{key} section", {
        key: getSectionDisplayLabel(circleSelection.value.section),
      });
    default:
      return assertNever(circleSelection.value);
  }
}

function getCenterReadout(): CenterReadout {
  if (!circleSelection.value) {
    return {
      subtitle: t("No sector priority"),
      title: t("All tracks"),
    };
  }

  switch (circleSelection.value.kind) {
    case "unknown":
      return {
        subtitle: t("Unplaced tracks"),
        title: t("Unknown key"),
      };
    case "boundary": {
      const before = Math.floor(circleSelection.value.boundaryIndex);
      const after = Math.ceil(circleSelection.value.boundaryIndex) % 12;

      return {
        subtitle: t("Boundary"),
        title: `${getSectionPrimaryDisplayLabel(before)} / ${getSectionPrimaryDisplayLabel(after)}`,
      };
    }
    case "section":
      return {
        subtitle: t("Section"),
        title: getSectionDisplayLabel(circleSelection.value.section),
      };
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
  return (
    browserPriority.value?.kind === "sections" && browserPriority.value.sections.includes(index)
  );
}

function isSectionSliceSelected(index: number): boolean {
  return isSectionSelected(index);
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
  if (isLoading.value) return t("Loading tracks…");
  return isBrowserFiltered.value ? t("No tracks found") : t("No tracks yet");
}

function getBrowserEmptyCopy(): string {
  if (isLoading.value) return t("Opening the catalog.");
  if (compatibleOnly.value)
    return t("No compatible matches. Turn off compatibility to search all tracks.");
  if (isTrackSearchActive.value) {
    return t("Try a different query or filter set.");
  }

  return isPublicMode.value
    ? t("The public catalog is not available yet. Please check back later.")
    : "Add or import tracks to start browsing the catalog.";
}

function isLastDraftSection(index: number): boolean {
  return draftTransitionContext.value.referenceTrack
    ? getTrackTouchedSections(draftTransitionContext.value.referenceTrack).includes(index)
    : false;
}

function isLastDraftSectionSlice(index: number, slice: SectionSlice): boolean {
  return draftTransitionContext.value.referenceTrack
    ? trackBelongsToSectionSlice(draftTransitionContext.value.referenceTrack, index, slice)
    : false;
}

function isLastDraftBoundary(boundaryIndex: number): boolean {
  return draftTransitionContext.value.referenceTrack
    ? trackTouchesBoundary(draftTransitionContext.value.referenceTrack, boundaryIndex)
    : false;
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
      return t("confirmed");
    case "estimated":
      return t("unverified");
    default:
      return state;
  }
}

function formatBpm(bpm: number | null): string {
  return bpm === null ? t("Unknown BPM") : `${bpm} BPM`;
}

function formatBpmValue(bpm: number | null): string {
  return bpm === null ? t("Unknown") : String(bpm);
}

function shouldShowTrackAudioBadge(track: TrackView): boolean {
  return !track.audioAvailable || track.audioQuality?.status !== undefined;
}

function getTrackAudioBadgeLabel(track: TrackView): string {
  if (!track.audioAvailable) {
    return t("No audio");
  }

  const quality = track.audioQuality;

  if (!quality || quality.status === "unknown") {
    return t("Unknown");
  }

  return getAudioQualityBadgeLabel(quality);
}

function getTrackAudioBadgeClass(track: TrackView): string {
  if (!track.audioAvailable) {
    return "audio-quality-missing";
  }

  const quality = track.audioQuality;

  if (!quality) {
    return "audio-quality-unknown";
  }

  if (quality.isHighBitrateLossy) {
    return "audio-quality-lossy-plus";
  }

  return `audio-quality-${quality.status}`;
}

function getAudioQualityBadgeLabel(quality: NonNullable<TrackView["audioQuality"]>): string {
  if (quality.isHighBitrateLossy) {
    return t("Lossy+");
  }

  switch (quality.status) {
    case "hq":
      return "HQ";
    case "lossy":
      return t("Lossy");
    case "unknown":
      return t("Unknown");
    default:
      return assertNever(quality.status);
  }
}

function formatTrackAudioQualitySummary(track: TrackView): string {
  if (!track.audioAvailable) {
    return t("No audio linked");
  }

  return formatAudioQualitySummary(track.audioQuality);
}

function formatAudioQualitySummary(quality: TrackView["audioQuality"]): string {
  if (!quality) {
    return t("Not analyzed");
  }

  if (quality.status === "unknown") {
    return quality.probeError ? t("Probe failed") : t("Unknown");
  }

  const label = getAudioQualityLabel(quality);
  const sampleRate = formatSampleRate(quality.sampleRateHz);
  const codec = formatCodecLabel(quality.codec ?? getPrimaryContainer(quality.container));

  if (quality.status === "hq") {
    return joinAudioQualityParts([
      label,
      joinAudioQualityParts([formatBitDepth(quality.bitDepth), sampleRate], " / "),
      codec,
    ]);
  }

  return joinAudioQualityParts([
    label,
    joinAudioQualityParts(
      [
        joinAudioQualityParts(
          [codec, formatBitrateMode(quality.bitrateMode), formatBitrate(quality)],
          " ",
        ),
        sampleRate,
      ],
      " / ",
    ),
  ]);
}

function getAudioQualityLabel(quality: NonNullable<TrackView["audioQuality"]>): string {
  if (quality.isHighBitrateLossy) {
    return t("LOSSY+");
  }

  switch (quality.status) {
    case "hq":
      return "HQ";
    case "lossy":
      return t("LOSSY");
    case "unknown":
      return t("Unknown");
    default:
      return assertNever(quality.status);
  }
}

function formatBitDepth(bitDepth: number | null): string | null {
  return bitDepth === null ? null : t("{bits}-bit", { bits: bitDepth });
}

function formatSampleRate(sampleRateHz: number | null): string | null {
  if (sampleRateHz === null) {
    return null;
  }

  const kiloHertz = sampleRateHz / 1000;
  const rounded = Number(kiloHertz.toFixed(1));

  return t("{rate} kHz", {
    rate: Number.isInteger(kiloHertz) ? kiloHertz : rounded,
  });
}

function formatBitrate(quality: NonNullable<TrackView["audioQuality"]>): string | null {
  if (quality.bitrateKbps === null) {
    return null;
  }

  return t("{rate} kbps", {
    rate: `${quality.bitrateMode === "vbr" ? "~" : ""}${quality.bitrateKbps}`,
  });
}

function formatBitrateMode(
  mode: NonNullable<TrackView["audioQuality"]>["bitrateMode"],
): string | null {
  switch (mode) {
    case "cbr":
      return "CBR";
    case "vbr":
      return "VBR";
    case "unknown":
      return null;
    default:
      return assertNever(mode);
  }
}

function formatCodecLabel(codec: string | null): string | null {
  if (!codec) {
    return null;
  }

  switch (codec) {
    case "aac":
      return "AAC";
    case "alac":
      return "ALAC";
    case "flac":
      return "FLAC";
    case "mp3":
      return "MP3";
    case "opus":
      return "Opus";
    case "vorbis":
      return "Vorbis";
    default:
      return codec.replace(/_/g, " ").toLocaleUpperCase();
  }
}

function getPrimaryContainer(container: string | null): string | null {
  if (!container) {
    return null;
  }

  return container.split(",")[0]?.trim() || null;
}

function joinAudioQualityParts(parts: readonly (string | null)[], separator = " · "): string {
  return parts.filter((part): part is string => Boolean(part)).join(separator);
}

function formatEditableBpm(bpm: number): string {
  return String(Number(bpm.toFixed(3)));
}

function placementLaneLabel(lane: PlacementLane | undefined): string {
  switch (lane) {
    case "home":
      return t("natural");
    case "modal-mixture":
      return t("modal mixture");
    case "pure-modal":
      return t("pure modal");
    case undefined:
      return t("unknown key");
    default:
      return assertNever(lane);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}
</script>

<template>
  <main class="desk-shell" :class="{ 'public-mode': isPublicMode }">
    <header class="desk-header">
      <div class="desk-brand">
        <p class="eyebrow">DJ Desk</p>
        <div class="desk-preferences">
          <label class="language-control">
            <span class="visually-hidden">{{ t("Language") }}</span>
            <select v-model="locale" :aria-label="t('Language')">
              <option value="ru">RU</option>
              <option value="en">EN</option>
            </select>
          </label>
          <HelpDialog />
        </div>
        <label class="notation-control">
          <span>{{ t("Key notation") }}</span>
          <select v-model="keyNotation">
            <option value="letters">A / B / C</option>
            <option value="solfege">{{ t("Do / Re / Mi") }}</option>
            <option value="camelot">Camelot</option>
            <option value="open-key">Open Key</option>
          </select>
        </label>
      </div>
      <section class="global-player" :aria-label="t('Now playing')">
        <button
          type="button"
          class="global-player-toggle"
          :disabled="!canControlSelectedAudio"
          :title="isAudioPlaying ? t('Pause') : t('Play')"
          @click="toggleGlobalPlayerPlayback"
        >
          {{ isAudioPlaying ? t("Pause") : t("Play") }}
        </button>
        <button
          type="button"
          class="global-player-tempo-toggle"
          :class="{ active: isTempoPreviewEnabled }"
          :disabled="!canControlSelectedAudio"
          :title="tempoPreviewStatus"
          @click="toggleTempoPreview"
        >
          {{ t("Tempo") }}
        </button>
        <div class="global-player-copy">
          <strong>{{ globalPlayerTitle }}</strong>
          <small>{{ globalPlayerArtist }}</small>
        </div>
        <div class="global-player-timeline">
          <input
            type="range"
            min="0"
            step="0.1"
            :max="audioDuration || 0"
            :value="audioCurrentTime"
            :disabled="!canControlSelectedAudio || audioDuration <= 0"
            :aria-label="t('Seek focused track')"
            @input="seekGlobalPlayer"
          />
          <span>{{ globalPlayerTimeLabel }}</span>
        </div>
        <div class="global-player-meta">
          <strong>{{ globalPlayerStatus }}</strong>
          <small>{{ globalPlayerMeta }}</small>
        </div>
      </section>
      <div class="summary-strip" :aria-label="t('Track analysis summary')">
        <span>
          <strong>{{ visibleTracks.length }}</strong
          >{{
            trackCount(visibleTracks.length).slice(String(visibleTracks.length).length + 1)
          }}</span
        >
        <span>
          <strong>{{ confirmedCount }}</strong
          >{{ t("confirmed keys") }}</span
        >
        <span>
          <strong>{{ unknownKeyCount }}</strong
          >{{ t("unknown keys") }}</span
        >
        <span>
          <strong>{{ mixtureCount }}</strong
          >{{ t("mixed modes") }}</span
        >
      </div>
    </header>

    <div v-if="hasHiddenSaveFailures" class="save-recovery" role="alert">
      <p>
        {{ t("Some sets could not be saved. Open them to recover your changes.") }}
      </p>
      <button type="button" @click="openSetPicker">{{ t("Open set") }}</button>
    </div>
    <section class="desk-grid">
      <section
        class="wheel-panel"
        :class="{ 'mobile-active': activeMobilePanel === 'map' }"
        :aria-label="t('Circle of fifths desk')"
        @click="clearCircleSelection"
      >
        <div v-if="isLoading" class="state-line">
          {{ t("Loading modal map...") }}
        </div>
        <div v-else-if="errorMessage" class="state-line error">
          {{ message(errorMessage) }}
        </div>
        <svg v-else class="circle-map" viewBox="-300 -300 600 600" role="img">
          <title>
            {{ t("Tracks arranged by modal position on the circle of fifths") }}
          </title>
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
                  selected: isSectionSliceSelected(zone.index),
                }"
                :d="zone.mainPath"
                @click.stop="selectSectionSlice(zone.index)"
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
                  selected: isSectionSliceSelected(zone.index),
                }"
                :d="zone.pureCounterPath"
                @click.stop="selectSectionSlice(zone.index)"
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
                  selected: isSectionSliceSelected(zone.index),
                }"
                :d="zone.pureClockwisePath"
                @click.stop="selectSectionSlice(zone.index)"
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
            <text class="label-main" text-anchor="middle">
              {{ section.label.primary }}
            </text>
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
        :aria-label="t('Draft set chain')"
      >
        <div class="panel-heading">
          <div>
            <p class="eyebrow">{{ t("Sets") }}</p>
            <h2>{{ activeDraftSet?.name ?? t("No set open") }}</h2>
          </div>
          <strong>{{ draftTracks.length }}</strong>
        </div>
        <div class="set-actions">
          <button
            type="button"
            class="secondary-action-button"
            @click="isSetCreatorOpen = !isSetCreatorOpen"
          >
            {{ t("Create set") }}
          </button>
          <button
            type="button"
            class="secondary-action-button"
            :aria-expanded="isSetPickerOpen"
            @click="openSetPicker"
          >
            {{ t("Open set") }}
          </button>
          <button
            v-if="activeDraftSet"
            type="button"
            class="secondary-action-button"
            @click="closeDraftSet"
          >
            {{ t("Close set") }}
          </button>
        </div>
        <form
          v-if="isSetCreatorOpen"
          class="new-set-form"
          @submit.prevent="createDraftSetFromInput"
        >
          <input
            v-model="newSetName"
            type="text"
            :placeholder="t('New set name')"
            maxlength="120"
            :aria-label="t('New set name')"
          />
          <button type="submit" :disabled="isSetSaving || !isWorkspaceReady">
            {{ t("Create") }}
          </button>
        </form>
        <p v-if="workspaceError" class="mutation-error" role="alert">
          {{ message(workspaceError) }}
          <a href="/">{{ t("Back to catalogue") }}</a>
        </p>
        <p v-if="isPublicMode && !hasWorkspace && !workspaceError" class="workspace-hint">
          {{
            t(
              "Pick a track and press Add to start your first set. Save your private access link to continue on another device. No account needed.",
            )
          }}
        </p>
        <div
          v-if="isPublicMode && hasWorkspace && (activeDraftSet || isSetPickerOpen)"
          class="workspace-access"
        >
          <template v-if="accessLink">
            <label
              >{{ t("Private access link")
              }}<input
                :value="accessLink"
                type="text"
                readonly
                autocomplete="off"
                spellcheck="false"
                @focus="($event.target as HTMLInputElement).select()"
            /></label>
            <button type="button" @click="copyAccessLink">
              {{ t("Copy link") }}
            </button>
            <button
              type="button"
              @click="
                accessLink = '';
                accessMessage = '';
              "
            >
              {{ t("I saved it · Hide") }}
            </button>
          </template>
          <button
            v-else
            type="button"
            :disabled="isAccessBusy || isSetSaving"
            @click="replaceAccessLink"
          >
            {{ t("Create a new access link") }}
          </button>
          <p v-if="accessMessage" role="status">{{ message(accessMessage) }}</p>
          <small v-else>{{
            t("Your sets are saved online. Keep your secret link to reopen them on another device.")
          }}</small>
        </div>
        <p
          v-if="activeDraftSet"
          class="save-status"
          :class="{ failed: activeSaveFailure }"
          role="status"
          aria-live="polite"
        >
          {{ saveStatus }}
        </p>
        <div v-if="activeSaveFailure" class="save-recovery" role="alert">
          <p>{{ message(activeSaveFailure.message) }}</p>
          <button
            v-if="!activeSaveFailure.conflict"
            type="button"
            :disabled="isSetSaving"
            @click="retryActiveSetSave"
          >
            {{ t("Retry save") }}
          </button>
          <button type="button" :disabled="isSetSaving" @click="reloadActiveSet">
            {{ t("Load saved version") }}
          </button>
          <button type="button" :disabled="isSetSaving" @click="copyUnsavedSet">
            {{ t("Save my version as a copy") }}
          </button>
        </div>
        <div
          v-if="isSetPickerOpen"
          class="set-tabs"
          :aria-label="t('Choose a saved set')"
          :aria-busy="isLoadingSets"
        >
          <p v-if="isLoadingSets">{{ t("Loading sets…") }}</p>
          <p v-else-if="draftSets.length === 0">{{ t("No saved sets") }}</p>
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
            maxlength="120"
            :aria-label="t('Set name')"
            @input="scheduleSetNameSave"
            @blur="saveActiveSetName"
            @keydown.enter.prevent="saveActiveSetName"
          />
          <button
            type="button"
            class="icon-button remove-button"
            :disabled="isSetSaving"
            :title="t('Delete set')"
            @click="deleteActiveSet"
          >
            ×
          </button>
        </div>
        <p v-if="setErrorMessage" class="mutation-error">
          {{ message(setErrorMessage) }}
        </p>
        <button
          v-if="activeDraftSet"
          type="button"
          class="sort-harmonic-button"
          :disabled="activeDraftTrackIds.length < 2 || isSetSaving"
          :title="t('Reorder this draft set to maximize harmonic transitions')"
          @click="sortActiveDraftHarmonically"
        >
          {{ t("Sort harmonically") }}
        </button>
        <p v-if="!activeDraftSet" class="empty-state">
          {{ t("Create a set to start saving a real running order.") }}
        </p>
        <ol v-else ref="setChainList">
          <li
            v-for="(track, index) in draftTracks"
            :key="`${track.id}-${index}`"
            :class="{
              dragging: draggedDraftIndex === index,
              'drag-over': dragOverDraftIndex === index,
              selected: selectedDraftIndex === index,
            }"
          >
            <div
              v-if="isDraftTransitionRisky(index)"
              class="chain-transition-divider"
              :title="t('Non-harmonic transition between these tracks')"
            >
              <span></span>
              <strong>{{ t("Non-harmonic transition") }}</strong>
              <span></span>
            </div>
            <button type="button" class="chain-track" @click="selectTrack(track)">
              <span class="chain-index">{{ index + 1 }}</span>
              <strong>
                {{ track.title }}
                <span
                  v-if="hasHarmonyNotes(track)"
                  class="inline-harmony-badge"
                  :title="t('Special harmony note')"
                >
                  !
                </span>
              </strong>
              <span
                v-if="shouldShowTrackAudioBadge(track)"
                class="audio-badge chain-track-quality"
                :class="getTrackAudioBadgeClass(track)"
                :title="formatTrackAudioQualitySummary(track)"
              >
                {{ getTrackAudioBadgeLabel(track) }}
              </span>
              <small>{{ formatBpm(track.bpm) }} · {{ displayKey(track) }}</small>
            </button>
            <div class="chain-controls" :aria-label="t('Draft track controls')">
              <button
                type="button"
                class="icon-button replace-target-button"
                :class="{ active: selectedDraftIndex === index }"
                :title="t('Use as replacement target')"
                :aria-label="t('Use as replacement target')"
                @click.stop="selectDraftReplacementTarget(index, track)"
              >
                ◎
              </button>
              <button
                type="button"
                class="icon-button drag-handle"
                :title="t('Drag to reorder')"
                :aria-label="t('Drag to reorder')"
              >
                ↕
              </button>
              <button
                type="button"
                class="icon-button move-button"
                :disabled="index === 0"
                :title="t('Move up')"
                @click="moveDraftTrack(index, -1)"
              >
                ↑
              </button>
              <button
                type="button"
                class="icon-button move-button"
                :disabled="index === draftTracks.length - 1"
                :title="t('Move down')"
                @click="moveDraftTrack(index, 1)"
              >
                ↓
              </button>
              <button
                type="button"
                class="icon-button remove-button"
                :title="t('Remove')"
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
        :aria-label="t('Tracks browser')"
      >
        <div class="panel-heading browser-panel-heading">
          <div class="browser-heading-copy">
            <div class="browser-heading-topline">
              <p class="eyebrow">{{ browserEyebrow }}</p>
            </div>
            <h2>{{ browserTitle }}</h2>
          </div>
          <div class="track-search-area browser-search-area" role="search">
            <label class="track-search-field">
              <span class="visually-hidden">{{ t("Search tracks") }}</span>
              <input
                :value="trackSearchQuery"
                type="search"
                :placeholder="t('Search tracks')"
                @input="updateTrackSearchQuery"
                @keydown.enter.prevent="selectFirstSearchResult"
                @keydown.escape.prevent="clearTrackSearch"
              />
              <button
                v-if="trackSearchQuery"
                type="button"
                class="icon-button search-clear-button"
                :title="t('Clear search')"
                @click="clearTrackSearch"
              >
                ×
              </button>
            </label>
            <div class="track-filter-shell">
              <button
                type="button"
                class="filter-toggle-button"
                :class="{
                  active: areTrackFiltersOpen || activeTrackFiltersCount > 0,
                }"
                @click="areTrackFiltersOpen = !areTrackFiltersOpen"
              >
                {{ t("Filters")
                }}<span v-if="activeTrackFiltersCount > 0">{{ activeTrackFiltersCount }}</span>
              </button>
              <div v-if="areTrackFiltersOpen" class="track-filter-panel">
                <div class="filter-grid">
                  <label>
                    <span>{{ t("Key") }}</span>
                    <select
                      v-model="trackFilters.keyStatus"
                      @change="setActiveMobilePanel('tracks')"
                    >
                      <option value="all">{{ t("Any key") }}</option>
                      <option value="known">{{ t("Known key") }}</option>
                      <option value="unknown">{{ t("Unknown key") }}</option>
                    </select>
                  </label>
                  <label>
                    <span>{{ t("Audio") }}</span>
                    <select v-model="trackFilters.audio" @change="setActiveMobilePanel('tracks')">
                      <option value="all">{{ t("Any audio") }}</option>
                      <option value="linked">{{ t("Audio linked") }}</option>
                      <option value="missing">{{ t("Audio missing") }}</option>
                    </select>
                  </label>
                  <label>
                    <span>{{ t("Quality") }}</span>
                    <select v-model="trackFilters.quality" @change="setActiveMobilePanel('tracks')">
                      <option value="all">{{ t("Any quality") }}</option>
                      <option value="hq">{{ t("True HQ") }}</option>
                      <option value="lossy">{{ t("Lossy") }}</option>
                      <option value="lossy-plus">
                        {{ t("High-bitrate lossy") }}
                      </option>
                      <option value="not-analyzed">
                        {{ t("Not analyzed") }}
                      </option>
                    </select>
                  </label>
                  <label>
                    <span>{{ t("BPM min") }}</span>
                    <input
                      v-model="trackFilters.bpmMin"
                      type="number"
                      min="1"
                      step="0.01"
                      :placeholder="t('Any')"
                      @input="setActiveMobilePanel('tracks')"
                    />
                  </label>
                  <label>
                    <span>{{ t("BPM max") }}</span>
                    <input
                      v-model="trackFilters.bpmMax"
                      type="number"
                      min="1"
                      step="0.01"
                      :placeholder="t('Any')"
                      @input="setActiveMobilePanel('tracks')"
                    />
                  </label>
                  <label>
                    <span>{{ t("Key state") }}</span>
                    <select
                      v-model="trackFilters.keyVerification"
                      @change="setActiveMobilePanel('tracks')"
                    >
                      <option value="all">{{ t("Any key state") }}</option>
                      <option value="confirmed">{{ t("Confirmed") }}</option>
                      <option value="unverified">{{ t("Unverified") }}</option>
                    </select>
                  </label>
                  <label>
                    <span>{{ t("BPM state") }}</span>
                    <select
                      v-model="trackFilters.bpmVerification"
                      @change="setActiveMobilePanel('tracks')"
                    >
                      <option value="all">{{ t("Any BPM state") }}</option>
                      <option value="confirmed">{{ t("Confirmed") }}</option>
                      <option value="unverified">{{ t("Unverified") }}</option>
                    </select>
                  </label>
                  <label>
                    <span>{{ t("Harmony") }}</span>
                    <select
                      v-model="trackFilters.harmonyNotes"
                      @change="setActiveMobilePanel('tracks')"
                    >
                      <option value="all">{{ t("Any notes") }}</option>
                      <option value="with-notes">{{ t("Has notes") }}</option>
                      <option value="without-notes">{{ t("No notes") }}</option>
                    </select>
                  </label>
                  <label>
                    <span>{{ t("Sets") }}</span>
                    <select
                      v-model="trackFilters.setPresence"
                      @change="setActiveMobilePanel('tracks')"
                    >
                      <option value="all">{{ t("Any set use") }}</option>
                      <option value="in-set">{{ t("Already in set") }}</option>
                      <option value="not-in-set">{{ t("Not in set") }}</option>
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
                    {{ t("Reset filters") }}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div class="browser-scope-controls">
            <label class="compatibility-toggle">
              <input
                v-model="compatibleOnly"
                type="checkbox"
                :disabled="!hasCompatibilityReference"
                aria-describedby="compatibility-context"
                @change="compatibilityNotice = ''"
              />
              <span>{{ t("Only compatible") }}</span>
            </label>
            <small id="compatibility-context">{{ compatibilityContextLabel }}</small>
            <button
              v-if="hasActiveCircleSelection"
              type="button"
              class="browser-reset-chip"
              :aria-label="`${t('First: {selection}', { selection: selectedLabel })}. ${t('Clear priority')}`"
              @click="clearCircleSelection"
            >
              {{ t("First: {selection}", { selection: selectedLabel }) }} ×
            </button>
            <small v-if="hasActiveCircleSelection && !hasPreferredMatches && browserTracks.length">
              {{ t("No matches in the preferred sector. Other matches are shown.") }}
            </small>
            <small v-if="compatibilityNotice" role="status">{{
              message(compatibilityNotice)
            }}</small>
          </div>
          <div v-if="isReplaceMode" class="replace-mode-banner">
            <div>
              <span class="replace-mode-title">{{ replaceModeTitle }}</span>
              <span class="replace-mode-track">{{
                selectedDraftSlotTrack?.title ?? t("Selected set slot")
              }}</span>
              <span class="replace-mode-meta">{{ replaceModeSubtitle }}</span>
            </div>
            <button type="button" class="secondary-action-button" @click="clearSelectedDraftSlot">
              {{ t("Append to end") }}
            </button>
          </div>
          <div class="track-browser-actions">
            <div class="target-bpm-control">
              <label class="target-bpm-field">
                <span>{{ t("Target BPM") }}</span>
                <input
                  v-model="targetBpmDraft"
                  type="number"
                  min="1"
                  step="0.01"
                  placeholder="80"
                  @blur="jumpToTargetBpm"
                  @keydown.enter.prevent="jumpToTargetBpm"
                />
              </label>
              <button
                type="button"
                class="secondary-action-button target-bpm-go-button"
                @click="jumpToTargetBpm"
              >
                {{ t("Go") }}
              </button>
            </div>
            <button
              v-if="canEditCatalog"
              type="button"
              class="secondary-action-button"
              @click="openNewTrackDialog"
            >
              New track
            </button>
            <button
              type="button"
              class="add-button"
              :class="{
                risky: isAddTransitionRisky,
                used: selectedTrackInAnyDraftSet,
              }"
              :disabled="
                !selectedTrack ||
                !isWorkspaceReady ||
                (isSetSaving && !activeDraftSet) ||
                !tracks.some((track) => track.id === selectedTrack?.id)
              "
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
              {{ addButtonReason || t("Ready") }}
            </span>
          </div>
        </div>

        <div v-if="browserTracks.length === 0" class="browser-empty-state">
          <strong>{{ getBrowserEmptyTitle() }}</strong>
          <p>{{ getBrowserEmptyCopy() }}</p>
          <button
            v-if="compatibleOnly"
            type="button"
            class="secondary-action-button"
            @click="compatibleOnly = false"
          >
            {{ t("Turn off compatibility") }}
          </button>
          <button
            v-if="isTrackSearchActive"
            type="button"
            class="secondary-action-button"
            @click="clearTrackSearchMode"
          >
            {{ t("Clear search") }}
          </button>
        </div>
        <div v-else ref="browserGrid" class="browser-grid">
          <a
            v-for="track in browserTracks"
            :key="track.id"
            :href="trackHref(track.id)"
            class="track-row"
            :class="{ selected: selectedTrack?.id === track.id }"
            :data-track-id="track.id"
            @click="openTrackLink($event, track)"
          >
            <span class="row-badges">
              <span class="mode-chip" :class="track.placement?.lane ?? 'unknown-key'">
                {{ placementLaneLabel(track.placement?.lane) }}
              </span>
              <span class="row-icon-badges">
                <span
                  v-if="shouldShowTrackAudioBadge(track)"
                  class="audio-badge"
                  :class="getTrackAudioBadgeClass(track)"
                  :title="formatTrackAudioQualitySummary(track)"
                >
                  {{ getTrackAudioBadgeLabel(track) }}
                </span>
                <span
                  v-if="hasHarmonyNotes(track)"
                  class="harmony-badge"
                  :title="t('Special harmony note')"
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
                {{ displayKey(track) }}
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
                  :title="t('Not aligned to standard A=440 Hz tuning')"
                  >{{ t("non-440") }}</span
                >
              </span>
            </small>
            <span
              v-if="draftTransitionContext.referenceTrack"
              class="bpm-score"
              :title="getTrackBpmCompatibilityTitle(track)"
            >
              <span class="bpm-score-label">
                <span>{{ t("BPM match") }}</span>
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
          </a>
        </div>
      </section>

      <aside
        class="focus-panel"
        :class="{ 'mobile-active': activeMobilePanel === 'focus' }"
        :aria-label="t('Selected track')"
      >
        <p class="eyebrow">{{ t("Focus track") }}</p>
        <p v-if="unavailableTrackId" role="status">
          {{ t("This track is unavailable.") }}
        </p>
        <template v-if="selectedTrack">
          <div class="focus-track-heading">
            <h2>
              <a
                class="track-title-link"
                :href="trackHref(selectedTrack.id)"
                @click="openTrackLink($event, selectedTrack)"
                >{{ selectedTrack.title }}</a
              >
            </h2>
            <button
              type="button"
              class="track-link-button"
              :title="t('Copy track link')"
              :aria-label="t('Copy track link')"
              @click="copyTrackLink"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7" />
                <path d="M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7" />
              </svg>
            </button>
          </div>
          <p class="artist">{{ selectedTrack.artist }}</p>
          <p v-if="trackLinkMessage" role="status">{{ trackLinkMessage }}</p>
          <input
            v-if="trackLinkFallback"
            :value="trackLinkFallback"
            readonly
            :aria-label="t('Copy track link')"
            @focus="($event.target as HTMLInputElement).select()"
          />
          <section class="track-audio-panel" :class="{ empty: !selectedTrack.audioAvailable }">
            <div class="track-audio-heading">
              <span>{{ t("Audio") }}</span>
              <small>{{ selectedTrack.audioFileName ?? t("Not linked") }}</small>
            </div>
            <audio
              v-if="selectedTrack.audioUrl"
              ref="audioPlayer"
              :key="selectedTrack.id"
              :data-track-id="selectedTrack.id"
              :data-tempo-preview-enabled="String(isTempoPreviewEnabled)"
              :data-tempo-preview-rate="tempoPreviewRate.toFixed(4)"
              controls
              preload="metadata"
              :src="selectedTrack.audioUrl"
              @durationchange="handleAudioMetadataChange"
              @ended="handleAudioEnded"
              @loadedmetadata="handleAudioMetadataChange"
              @play="handleAudioPlay"
              @pause="handleAudioPause"
              @timeupdate="handleAudioTimeUpdate"
            ></audio>
            <p v-else class="muted">
              {{ t("Audio is not available for this track.") }}
            </p>
            <a
              v-if="isPublicMode && selectedTrack.audioUrl"
              class="audio-download"
              :href="`${selectedTrack.audioUrl}?download=1`"
              download
              >{{ t("Download audio") }}</a
            >
            <div class="tempo-preview-row">
              <div class="tempo-preview-controls">
                <label class="tempo-preview-toggle">
                  <input
                    v-model="isTempoPreviewEnabled"
                    type="checkbox"
                    :disabled="!selectedTrack.audioUrl"
                  />
                  <span>{{ t("Tempo preview") }}</span>
                </label>
                <label class="tempo-preview-bpm-field">
                  <span>{{ t("Playback BPM") }}</span>
                  <input
                    v-model="tempoPreviewTargetBpmDraft"
                    type="number"
                    min="1"
                    step="0.01"
                    placeholder="80"
                    :disabled="!selectedTrack.audioUrl"
                  />
                </label>
              </div>
              <small>{{ tempoPreviewStatus }}</small>
            </div>
            <div v-if="canEditCatalog" class="audio-upload-row">
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
            <div v-if="canEditCatalog" class="retrieval-launch-row">
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
          <section v-if="canEditCatalog" class="track-edit-panel" aria-label="Track editor">
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
            <p v-if="trackEditErrorMessage" class="mutation-error">
              {{ trackEditErrorMessage }}
            </p>
          </section>
          <dl>
            <div>
              <dt>{{ t("Key") }}</dt>
              <dd class="value-with-badges">
                {{ displayKey(selectedTrack) }}
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
                  :title="t('Not aligned to standard A=440 Hz tuning')"
                  >{{ t("non-440") }}</span
                >
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
              <dt>{{ t("Quality") }}</dt>
              <dd
                class="value-with-badges"
                :title="selectedTrack.audioQuality?.probeError ?? undefined"
              >
                {{ formatTrackAudioQualitySummary(selectedTrack) }}
              </dd>
            </div>
            <div>
              <dt>{{ t("Placement") }}</dt>
              <dd>{{ displayPlacement(selectedTrack) }}</dd>
            </div>
            <div>
              <dt>{{ t("Used chords") }}</dt>
              <dd>
                <span v-if="isHarmonyLoading" class="muted">{{ t("Loading chords...") }}</span>
                <span v-else-if="harmonyErrorMessage" class="muted">{{
                  message(harmonyErrorMessage)
                }}</span>
                <span v-else class="chord-chip-list">
                  <span v-for="chord in usedChordList" :key="chord">{{ chord }}</span>
                </span>
              </dd>
            </div>
            <div v-if="visibleChordSegments.length > 0" class="full-chord-table-block">
              <dt>{{ t("Full chord table") }}</dt>
              <dd>
                <details>
                  <summary>
                    {{ segmentCount(visibleChordSegments.length) }}
                  </summary>
                  <div class="segment-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>{{ t("Start") }}</th>
                          <th>{{ t("End") }}</th>
                          <th>{{ t("Chord") }}</th>
                          <th>{{ t("Bass") }}</th>
                          <th>{{ t("Basic") }}</th>
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
              <dt>{{ t("Harmony note") }}</dt>
              <dd>{{ selectedTrack.harmonyNotes }}</dd>
            </div>
            <div v-if="selectedTrack.comment">
              <dt>{{ t("Comment") }}</dt>
              <dd>{{ selectedTrack.comment }}</dd>
            </div>
          </dl>
          <div class="tag-row">
            <span v-for="tag in selectedTrack.tags" :key="tag">{{ tag }}</span>
          </div>
        </template>
        <p v-else-if="!unavailableTrackId" class="muted">
          {{ t("Select a track in the catalogue.") }}
        </p>
      </aside>
    </section>
    <div
      v-if="canEditCatalog && isNewTrackDialogOpen"
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
              <option v-for="mode in MODE_OPTIONS" :key="mode" :value="mode">
                {{ mode }}
              </option>
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
        <p v-if="createTrackErrorMessage" class="mutation-error">
          {{ createTrackErrorMessage }}
        </p>
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
      v-if="canEditCatalog && isRetrievalDialogOpen"
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
            <p v-if="retrievalErrorMessage" class="mutation-error">
              {{ retrievalErrorMessage }}
            </p>
            <p v-if="retrievalJob?.error" class="mutation-error">
              {{ retrievalJob.error }}
            </p>
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
    <nav class="mobile-tab-bar" :aria-label="t('Mobile workspace sections')">
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
