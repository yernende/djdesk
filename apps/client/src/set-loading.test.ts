import assert from "node:assert/strict";
import test from "node:test";
import { mergeLoadedSets } from "./set-loading.ts";

test("a list requested before successful deletion cannot restore the deleted set", async () => {
  const deleted = { id: "deleted", name: "Old set" };
  const kept = { id: "kept", name: "Kept set" };
  let finishList!: (sets: (typeof deleted)[]) => void;
  const response = new Promise<(typeof deleted)[]>((resolve) => {
    finishList = resolve;
  });
  const deletedIds = new Set<string>();
  let current = [deleted, kept];
  const loading = response.then((sets) => {
    current = mergeLoadedSets(current, sets, deletedIds);
  });

  deletedIds.add(deleted.id);
  current = current.filter((set) => set.id !== deleted.id);
  finishList([deleted, kept]);
  await loading;

  assert.deepEqual(current, [kept]);
});

test("loading preserves newer local edits and creations while adding other saved sets once", () => {
  const edited = { id: "edited", name: "Renamed", trackIds: ["b", "a"] };
  const created = { id: "created", name: "New set", trackIds: ["c"] };
  const unseen = { id: "unseen", name: "Another saved set", trackIds: [] };
  const current = [edited, created];
  const result = mergeLoadedSets(
    current,
    [{ id: "edited", name: "Old name", trackIds: ["a", "b"] }, unseen, unseen],
    new Set(),
  );

  assert.deepEqual(result, [edited, created, unseen]);
  assert.equal(result[0], edited);
  assert.deepEqual(current, [edited, created]);
});

test("failed deletion leaves the set loadable and workspace reset clears deletion exclusions", () => {
  const saved = { id: "set" };
  const deletedIds = new Set<string>();
  assert.deepEqual(mergeLoadedSets([], [saved], deletedIds), [saved]);
  deletedIds.add(saved.id);
  assert.deepEqual(mergeLoadedSets([], [saved], deletedIds), []);
  deletedIds.clear();
  assert.deepEqual(mergeLoadedSets([], [saved], deletedIds), [saved]);
});
