import assert from "node:assert/strict";
import test from "node:test";

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
