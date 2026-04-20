import type { DiatonicMode } from "@djdesk/domain";

import { parseImportedKey, type ImportedKey } from "../shared/keys.ts";

export interface RekordboxCommentAnalysis {
  comment: string | null;
  doesNotFit: boolean;
  harmonyNotes: string | null;
  key: ImportedKey | null;
  meter: string | null;
}

const explicitModalPattern =
  /(?:^|[^A-Za-z#b])([A-G](?:#|b)?m?)?\s*(dorian|frig|phrygian|phr)(?=$|[^A-Za-z])/i;

export function analyzeRekordboxComment(
  comment: string | null,
  key: ImportedKey | null,
): RekordboxCommentAnalysis {
  if (!comment) {
    return {
      comment: null,
      doesNotFit: false,
      harmonyNotes: null,
      key,
      meter: null,
    };
  }

  const normalized = comment.trim();
  const lower = normalized.toLocaleLowerCase();
  const doesNotFit = /\b(?:ne|no)\s+stroit\b/.test(lower);
  const meter = /\b3\/4\b/.test(normalized) ? "3/4" : null;
  let nextKey = applyModalComment(normalized, key);

  if (/\bharm\b/i.test(normalized) && nextKey) {
    nextKey = {
      ...nextKey,
      variant: "raised-leading-tone",
    };
  }

  return {
    comment: getCommentRemainder(normalized),
    doesNotFit,
    harmonyNotes: null,
    key: nextKey,
    meter,
  };
}

function applyModalComment(comment: string, key: ImportedKey | null): ImportedKey | null {
  const match = explicitModalPattern.exec(comment);

  if (!match) {
    return key;
  }

  const rawKey = match[1];
  const modeText = match[2];
  const mode = getModalMode(modeText);

  if (!mode) {
    return key;
  }

  if (rawKey) {
    const parsedKey = parseImportedKey(rawKey, "Rekordbox comment");

    return {
      ...parsedKey,
      mode,
    };
  }

  if (!key) {
    return key;
  }

  return {
    ...key,
    mode,
  };
}

function getModalMode(value: string | undefined): DiatonicMode | null {
  if (!value) {
    return null;
  }

  const normalized = value.toLocaleLowerCase();

  if (normalized === "dorian") {
    return "dorian";
  }

  if (normalized === "frig" || normalized === "phr" || normalized === "phrygian") {
    return "phrygian";
  }

  return null;
}

function getCommentRemainder(comment: string): string | null {
  if (/\bchorus\s+[A-G](?:#|b)?m?\b/i.test(comment)) {
    return comment;
  }

  if (/needs/i.test(comment)) {
    return comment;
  }

  if (/fermata/i.test(comment)) {
    const [, remainder] = /\+\s*(.+)$/.exec(comment) ?? [];

    return remainder?.trim() || comment;
  }

  if (/^last$/i.test(comment)) {
    return comment;
  }

  const withoutMeter = comment.replace(/\b3\/4\b/g, "").trim();

  if (withoutMeter && withoutMeter !== comment) {
    return withoutMeter;
  }

  return null;
}
