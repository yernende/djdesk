import assert from "node:assert/strict";
import test from "node:test";

import { canKeysTransition, type TrackKey } from "@djdesk/domain";

import {
  formatDraftCompatibilityReason,
  getDraftCandidateCompatibility,
  getDraftTransitionContext,
  type DraftTransitionContext,
} from "./draft-slot.ts";

interface TestTrack {
  id: string;
}

const track = (id: string): TestTrack => ({ id });

function canFollow(previousTrack: TestTrack, nextTrack: TestTrack): boolean {
  return allowedTransitions.has(`${previousTrack.id}->${nextTrack.id}`);
}

const allowedTransitions = new Set<string>([
  "a->b",
  "b->c",
  "a->x",
  "x->c",
  "x->b",
  "b->x",
  "a->bad-previous",
  "bad-next->c",
]);

test("append context uses the last draft track as the previous reference", () => {
  const context = getDraftTransitionContext([track("a"), track("b")], null);

  assert.equal(context.mode, "append");
  assert.equal(context.selectedIndex, null);
  assert.equal(context.previousTrack?.id, "b");
  assert.equal(context.nextTrack, null);
  assert.equal(context.referenceTrack?.id, "b");
});

test("replace context for a middle slot checks both neighbors", () => {
  const context = getDraftTransitionContext([track("a"), track("b"), track("c")], 1);
  const compatibility = getDraftCandidateCompatibility(context, track("x"), canFollow);

  assertReplaceContext(context, "a", "c");
  assert.deepEqual(compatibility, {
    isRisky: false,
    nextOk: true,
    previousOk: true,
    risk: "none",
  });
});

test("replace context for the first slot checks only the next link", () => {
  const context = getDraftTransitionContext([track("a"), track("b")], 0);
  const compatibility = getDraftCandidateCompatibility(context, track("x"), canFollow);

  assertReplaceContext(context, null, "b");
  assert.equal(compatibility.previousOk, true);
  assert.equal(compatibility.nextOk, true);
  assert.equal(compatibility.risk, "none");
});

test("replace context for the last slot checks only the previous link", () => {
  const context = getDraftTransitionContext([track("a"), track("b")], 1);
  const compatibility = getDraftCandidateCompatibility(context, track("x"), canFollow);

  assertReplaceContext(context, "a", null);
  assert.equal(compatibility.previousOk, true);
  assert.equal(compatibility.nextOk, true);
  assert.equal(compatibility.risk, "none");
});

test("candidate risk tells whether the previous, next, or both links fail", () => {
  const context = getDraftTransitionContext([track("a"), track("b"), track("c")], 1);

  assert.equal(getDraftCandidateCompatibility(context, track("bad-left"), canFollow).risk, "both");
  assert.equal(
    getDraftCandidateCompatibility(context, track("bad-next"), canFollow).risk,
    "previous",
  );
  assert.equal(
    getDraftCandidateCompatibility(context, track("bad-previous"), canFollow).risk,
    "next",
  );
});

test("formats append and replace risk reasons", () => {
  const appendContext = getDraftTransitionContext([track("a")], null);
  const replaceContext = getDraftTransitionContext([track("a"), track("b"), track("c")], 1);

  assert.equal(
    formatDraftCompatibilityReason(
      appendContext,
      getDraftCandidateCompatibility(appendContext, track("bad"), canFollow),
    ),
    "Non-harmonic",
  );
  assert.equal(
    formatDraftCompatibilityReason(
      replaceContext,
      getDraftCandidateCompatibility(replaceContext, track("bad"), canFollow),
    ),
    "Breaks both links",
  );
  assert.equal(
    formatDraftCompatibilityReason(
      replaceContext,
      getDraftCandidateCompatibility(replaceContext, track("bad-previous"), canFollow),
    ),
    "Breaks next link",
  );
});

interface KeyedTestTrack extends TestTrack {
  key: TrackKey | null;
}

function keyedTrack(
  id: string,
  tonic: TrackKey["tonic"] | null,
  mode: TrackKey["mode"] = "natural-minor",
  variant: TrackKey["variant"] = "diatonic",
): KeyedTestTrack {
  return { id, key: tonic ? { tonic, mode, variant } : null };
}

function canKeyedTracksFollow(previous: KeyedTestTrack, next: KeyedTestTrack): boolean {
  return canKeysTransition(previous.key, next.key);
}

test("compatible candidate filtering uses the set endpoint while retaining neighboring collections", () => {
  const context = getDraftTransitionContext([keyedTrack("endpoint", "A")], null);
  const candidates = [
    keyedTrack("same", "A"),
    keyedTrack("counter", "D"),
    keyedTrack("clockwise", "E"),
    keyedTrack("modal-clockwise", "A", "dorian"),
    keyedTrack("boundary", "A", "dorian", "variable-degree"),
    keyedTrack("too-far", "B"),
    keyedTrack("unknown", null),
  ];
  const matches = () =>
    candidates
      .filter(
        (candidate) =>
          !getDraftCandidateCompatibility(context, candidate, canKeyedTracksFollow).isRisky,
      )
      .map(({ id }) => id);

  assert.deepEqual(matches(), ["same", "counter", "clockwise", "modal-clockwise", "boundary"]);
  getDraftCandidateCompatibility(context, keyedTrack("auditioned", "F#"), canKeyedTracksFollow);
  assert.equal(context.previousTrack?.id, "endpoint");
  assert.deepEqual(matches(), ["same", "counter", "clockwise", "modal-clockwise", "boundary"]);
});

test("replacement candidates must satisfy both canonical harmonic links", () => {
  const context = getDraftTransitionContext(
    [keyedTrack("previous", "A"), keyedTrack("replaced", "F"), keyedTrack("next", "B")],
    1,
  );
  const risk = (candidate: KeyedTestTrack) =>
    getDraftCandidateCompatibility(context, candidate, canKeyedTracksFollow).risk;

  assert.equal(risk(keyedTrack("bridge", "E")), "none");
  assert.equal(risk(keyedTrack("modal-bridge", "A", "dorian")), "none");
  assert.equal(risk(keyedTrack("previous-only", "D")), "next");
  assert.equal(risk(keyedTrack("next-only", "F#")), "previous");
  assert.equal(risk(keyedTrack("wrong-boundary", "A", "dorian", "variable-degree")), "next");
  assert.equal(risk(keyedTrack("unknown", null)), "both");
});

test("no-neighbor contexts stay unconstrained and expose the absent compatibility reference", () => {
  const candidates = [keyedTrack("known", "A"), keyedTrack("unknown", null)];
  const contexts = [
    getDraftTransitionContext<KeyedTestTrack>([], null),
    getDraftTransitionContext([keyedTrack("only-slot", "E")], 0),
  ];

  for (const context of contexts) {
    assert.equal(context.previousTrack, null);
    assert.equal(context.nextTrack, null);
    assert.equal(context.referenceTrack, null);
    for (const candidate of candidates) {
      assert.equal(
        getDraftCandidateCompatibility(context, candidate, canKeyedTracksFollow).isRisky,
        false,
      );
    }
  }
});

test("unknown-key neighbors cannot establish a compatible transition", () => {
  const append = getDraftTransitionContext([keyedTrack("unknown-endpoint", null)], null);
  const replace = getDraftTransitionContext(
    [keyedTrack("selected", "A"), keyedTrack("unknown-next", null)],
    0,
  );

  assert.equal(
    getDraftCandidateCompatibility(append, keyedTrack("candidate", "A"), canKeyedTracksFollow).risk,
    "previous",
  );
  assert.equal(
    getDraftCandidateCompatibility(replace, keyedTrack("candidate", "A"), canKeyedTracksFollow)
      .risk,
    "next",
  );
});

function assertReplaceContext(
  context: DraftTransitionContext<TestTrack>,
  previousId: string | null,
  nextId: string | null,
): void {
  assert.equal(context.mode, "replace");
  assert.equal(context.previousTrack?.id ?? null, previousId);
  assert.equal(context.nextTrack?.id ?? null, nextId);
  assert.equal(context.referenceTrack?.id ?? null, previousId);
}
