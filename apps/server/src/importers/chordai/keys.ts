import { parseImportedKey } from "../shared/keys.ts";
import type { ChordAiKey } from "./types.ts";

export function parseChordAiKey(rawKey: string): ChordAiKey {
  return parseImportedKey(rawKey, "ChordAI");
}
